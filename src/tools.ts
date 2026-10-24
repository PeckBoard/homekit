// MCP tool handlers. Each takes the tool arguments and returns a JSON result;
// a thrown Error becomes `{error}` for the agent (see lib.ts). The bridge is
// injected (`makeTools`) so tests drive the handlers with a fake transport.

import { Bridge, BridgeError, UNREACHABLE, hostTransport } from "./bridge";
import { bridgeConfig } from "./config";
import { setupNote } from "./setup";
import {
  resolveDevice,
  resolveTarget,
  coerceValue,
  compactDevice,
  fullDevice,
  discoveredView,
  normalizeSetupCode,
  setupCodeError,
  serviceLabel,
  agentValue,
  OWNED_ELSEWHERE,
  Device,
} from "./hap";

type Tool = (args: any) => unknown;

function s(v: unknown): string {
  return typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
}

export function makeTools(bridge: () => Bridge, note: () => string | null = () => null): Record<string, Tool> {
  /// Bridge calls; an unreachable bridge gets the setup state appended.
  const run = <T>(f: (b: Bridge) => T): T => {
    try {
      return f(bridge());
    } catch (e) {
      if (e instanceof BridgeError && (e.code === UNREACHABLE || e.code === "unauthorized")) {
        const n = note();
        if (n) throw new Error(`${e.message} — ${n}`);
      }
      throw e;
    }
  };
  const find = (b: Bridge, ref: unknown): Device => resolveDevice(b.devices(), ref);

  return {
    homekit_list: () =>
      run((b) => {
        const devices = b.devices();
        return {
          devices: devices.map(compactDevice),
          ...(devices.length ? {} : { hint: "Nothing is paired yet. Use homekit_discover to find accessories, then homekit_pair with the setup code." }),
        };
      }),

    homekit_get: (args) =>
      run((b) => {
        const d = find(b, args.device);
        return fullDevice(args.refresh === true ? b.device(d.id, true) : d);
      }),

    homekit_set: (args) =>
      run((b) => {
        const d = find(b, args.device);
        const t = resolveTarget(d, { service: args.service, characteristic: args.characteristic }, true);
        const value = coerceValue(t.characteristic, args.value);
        const after = b.write(d.id, [{ aid: t.aid, iid: t.characteristic.iid, value }]);
        const back = after ? resolveTarget(after, { characteristic: `${t.aid}.${t.characteristic.iid}` }, false).characteristic : null;
        return {
          ok: true,
          device: d.name,
          service: serviceLabel(t.service, t.accessory),
          characteristic: t.characteristic.type,
          sent: value,
          value: back ? agentValue(back) : value,
        };
      }),

    homekit_discover: (args) =>
      run((b) => {
        const list = b.discover(args.refresh === true).map(discoveredView);
        return {
          accessories: list,
          hint:
            "Pair an 'available' accessory with homekit_pair (needs its 8-digit setup code). 'owned_elsewhere' ones must be " +
            "removed from Apple Home (or factory reset) first. Only HomeKit-over-IP (Wi-Fi/Ethernet) accessories are " +
            "supported — no Bluetooth or Thread.",
        };
      }),

    homekit_pair: (args) =>
      run((b) => {
        const codeErr = setupCodeError(s(args.setup_code));
        if (codeErr) throw new Error(codeErr);
        const ref = s(args.accessory);
        if (!ref) throw new Error("`accessory` is required: the id (or name) from homekit_discover");
        const address = s(args.address);
        const port = args.port === undefined || args.port === null || args.port === "" ? undefined : Number(args.port);
        if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) throw new Error("`port` must be 1–65535");
        let id = ref;
        if (!address) {
          const seen = b.discover(false);
          const bare = (x: string) => x.replace(/:/g, "").toLowerCase();
          const hits = seen.filter((a) => bare(a.id) === bare(ref) || a.name.toLowerCase() === ref.toLowerCase());
          if (hits.length > 1) throw new Error(`"${ref}" matches several accessories: ${hits.map((a) => `${a.name} (${a.id})`).join(", ")} — use the id`);
          const a = hits[0];
          if (!a) throw new Error(`no discovered accessory "${ref}" — run homekit_discover (refresh: true), or pass address + port for one mDNS can't see`);
          if (a.paired_with_us) throw new Error(`${a.name} is already paired with Peckboard`);
          if (!a.available_for_pairing) throw new Error(OWNED_ELSEWHERE);
          id = a.id;
        }
        const body: { id: string; setup_code: string; address?: string; port?: number; name?: string } = {
          id,
          setup_code: normalizeSetupCode(s(args.setup_code))!,
        };
        if (address) body.address = address;
        if (port !== undefined) body.port = port;
        if (s(args.name)) body.name = s(args.name);
        return { paired: compactDevice(b.pair(body)) };
      }),

    homekit_unpair: (args) =>
      run((b) => {
        const d = find(b, args.device);
        let r: { removed_from_accessory?: boolean };
        try {
          r = b.unpair(d.id, args.force === true);
        } catch (e) {
          if (e instanceof BridgeError && e.code === "unreachable" && args.force !== true) {
            throw new Error(`${e.message} — pass force: true to forget ${d.name} locally anyway (then factory reset it before adding it to Apple Home)`);
          }
          throw e;
        }
        return {
          ok: true,
          device: d.name,
          removed_from_accessory: r?.removed_from_accessory === true,
          note: r?.removed_from_accessory
            ? "The accessory is free again — it can be added back to Apple Home."
            : "Forgotten locally only; the accessory may still think it is paired — factory reset it before adding it to Apple Home.",
        };
      }),

    homekit_identify: (args) =>
      run((b) => {
        const d = find(b, args.device);
        b.identify(d.id);
        return { ok: true, device: d.name };
      }),
  };
}

export const TOOLS = makeTools(() => new Bridge(hostTransport, bridgeConfig()), setupNote);
