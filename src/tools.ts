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
import { canUnpair, HUE_UNPAIR, resolveGroup, resolveScene, roomSetBody, type HueBridge } from "./hue";

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
        if (!canUnpair(d)) throw new Error(`${d.name} ${HUE_UNPAIR}`);
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

    // ── Philips Hue ──

    homekit_hue_bridges: (args) =>
      run((b) => {
        const bridges = b.hueBridges(args.refresh === true);
        return {
          bridges,
          hint: bridges.some((x) => !x.linked)
            ? "Link an unlinked bridge with homekit_hue_link: the user must press the round link button on the bridge, then you call it (again)."
            : bridges.length
              ? "Linked bridges' lights are ordinary devices in homekit_list; rooms/zones: homekit_rooms; scenes: homekit_scenes."
              : "No Hue Bridge seen. Try refresh: true, or pass its IP address to homekit_hue_link.",
        };
      }),

    homekit_hue_link: (args) =>
      run((b) => {
        const ref = s(args.bridge);
        const address = s(args.address);
        let body: { bridge_id?: string; address?: string };
        let name = ref || address;
        if (ref || !address) {
          const all = b.hueBridges(false);
          let pick: HueBridge | undefined;
          if (ref) {
            const n = ref.toLowerCase();
            const hits = all.filter((x) => x.bridge_id.toLowerCase() === n || x.name.toLowerCase() === n || x.address === ref);
            if (hits.length > 1) throw new Error(`"${ref}" matches several bridges: ${hits.map((x) => `${x.name} (${x.bridge_id})`).join(", ")} — use the bridge_id`);
            pick = hits[0];
            if (!pick && !/^[0-9a-f]{16}$/i.test(ref)) {
              throw new Error(`no Hue Bridge "${ref}"${all.length ? ` — bridges: ${all.map((x) => `${x.name} (${x.bridge_id})`).join(", ")}` : " — none seen; pass its IP as address"}`);
            }
          } else {
            const unlinked = all.filter((x) => !x.linked);
            if (unlinked.length > 1) throw new Error(`several unlinked Hue Bridges: ${unlinked.map((x) => `${x.name} (${x.bridge_id})`).join(", ")} — pass bridge`);
            pick = unlinked[0];
            if (!pick) throw new Error(all.length ? "every Hue Bridge seen is already linked" : "no Hue Bridge seen on the network — pass its IP as address (homekit_hue_bridges refresh: true to re-scan)");
          }
          if (pick?.linked) return { ok: true, already_linked: true, bridge: pick };
          body = { bridge_id: pick ? pick.bridge_id : ref.toLowerCase() };
          if (address || pick?.address) body.address = address || pick!.address;
          name = pick?.name ?? ref;
        } else body = { address };
        try {
          const linked = b.hueLink(body);
          return { ok: true, linked: true, bridge: linked, hint: "Its lights are now devices in homekit_list; rooms: homekit_rooms." };
        } catch (e) {
          if (e instanceof BridgeError && e.code === "link_button_not_pressed") {
            return {
              ok: false,
              linked: false,
              waiting_for_link_button: true,
              message: `Ask the user to press the round link button on top of ${name}, then call homekit_hue_link again within 30 seconds.`,
            };
          }
          throw e;
        }
      }),

    homekit_rooms: () =>
      run((b) => {
        const groups = b.hueGroups();
        const names = new Map(b.devices().map((d) => [d.id, d.name]));
        return {
          rooms: groups.map((g) => ({
            id: g.id,
            name: g.name,
            kind: g.kind,
            on: g.on,
            brightness: g.brightness,
            lights: g.device_ids.map((id) => names.get(id) ?? id),
          })),
          ...(groups.length ? {} : { hint: "No Hue rooms: link a Hue Bridge first (homekit_hue_bridges, homekit_hue_link)." }),
        };
      }),

    homekit_room_set: (args) =>
      run((b) => {
        const body = roomSetBody(args);
        const g = resolveGroup(b.hueGroups(), args.room);
        if (g.on === null && g.brightness === null) throw new Error(`${g.name} has no grouped light to control (no lights in it?)`);
        const after = b.hueGroupSet(g.id, body);
        return { ok: true, room: g.name, kind: g.kind, sent: body, on: after?.on ?? null, brightness: after?.brightness ?? null };
      }),

    homekit_scenes: (args) =>
      run((b) => {
        const room = s(args.room) ? resolveGroup(b.hueGroups(), args.room) : null;
        const scenes = b.hueScenes(room?.id);
        return {
          scenes: scenes.map((x) => ({ id: x.id, name: x.name, room: x.group_name ?? x.group_id })),
          ...(scenes.length ? {} : { hint: room ? `${room.name} has no scenes — create them in the Hue app.` : "No scenes: link a Hue Bridge first, or create scenes in the Hue app." }),
        };
      }),

    homekit_scene_recall: (args) =>
      run((b) => {
        const room = s(args.room) ? resolveGroup(b.hueGroups(), args.room) : null;
        const sc = resolveScene(b.hueScenes(), args.scene, room);
        b.hueRecall(sc.id);
        return { ok: true, scene: sc.name, room: sc.group_name ?? room?.name ?? sc.group_id };
      }),
  };
}

export const TOOLS = makeTools(() => new Bridge(hostTransport, bridgeConfig()), setupNote);
