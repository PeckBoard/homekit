// homekit-bridge HTTP client (peck-plugins/homekit-bridge/BRIDGE_API.md).
// Every call carries `Authorization: Bearer <token>`; non-2xx answers become
// a BridgeError with the bridge's `{error, code}`. The transport is injected
// so tests run without the Extism host.

import { httpRequest } from "./host";
import type { BridgeConfig, TokenSource } from "./config";
import type { Device, Discovered } from "./hap";
import { versionLt, MIN_HUE_VERSION, type HueBridge, type HueGroup, type HueScene } from "./hue";

export interface Transport {
  request(req: { method: string; url: string; headers: Record<string, string>; body?: string; timeoutSecs: number }): { status: number; body: string };
}

export const hostTransport: Transport = {
  request(req) {
    const r = httpRequest({ url: req.url, method: req.method, headers: req.headers, body: req.body, timeout_secs: req.timeoutSecs });
    return { status: r.status, body: r.body ?? "" };
  },
};

/// A bridge (or bridge-connection) failure. `code` is the bridge's slug, or
/// `bridge_unreachable` / `bad_response` for failures on our side.
export class BridgeError extends Error {
  constructor(public status: number, public code: string, msg: string) {
    super(msg);
  }
}

export const UNREACHABLE = "bridge_unreachable";
/// The bridge predates the Hue endpoints (older than MIN_HUE_VERSION).
export const OUTDATED = "bridge_outdated";

/// Bridge device ids are MAC-like ("A1:B2:…"); URL-encode for path segments.
export function encodeId(id: string): string {
  return encodeURIComponent(id);
}

export class Bridge {
  constructor(private t: Transport, private cfg: BridgeConfig) {}

  call(method: string, path: string, body?: unknown, timeoutSecs = 30): any {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.cfg.token) headers.Authorization = `Bearer ${this.cfg.token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let res: { status: number; body: string };
    try {
      res = this.t.request({ method, url: this.cfg.url + path, headers, body: body === undefined ? undefined : JSON.stringify(body), timeoutSecs });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/timed? ?out/i.test(msg)) throw new BridgeError(504, "timeout", `homekit-bridge didn't answer in ${timeoutSecs}s`);
      throw new BridgeError(502, UNREACHABLE, `homekit-bridge isn't reachable at ${this.cfg.url} — is it installed and running?`);
    }
    let parsed: any = {};
    if (res.body) {
      try {
        parsed = JSON.parse(res.body);
      } catch (_e) {
        throw new BridgeError(502, "bad_response", `homekit-bridge answered HTTP ${res.status} with non-JSON: ${res.body.slice(0, 120)}`);
      }
    }
    if (res.status < 200 || res.status >= 300) {
      if (res.status === 401) {
        throw new BridgeError(
          401,
          "unauthorized",
          this.cfg.token_source === "none"
            ? "homekit-bridge requires a token, and none was found (~/.config/homekit-bridge/token)"
            : "homekit-bridge rejected the token — check ~/.config/homekit-bridge/token or the bridge_token setting",
        );
      }
      const msg = typeof parsed?.error === "string" && parsed.error ? parsed.error : `homekit-bridge: HTTP ${res.status}`;
      throw new BridgeError(res.status, typeof parsed?.code === "string" ? parsed.code : "error", msg);
    }
    return parsed;
  }

  health(): any {
    return this.call("GET", "/health", undefined, 3);
  }
  devices(): Device[] {
    const r = this.call("GET", "/devices");
    return Array.isArray(r?.devices) ? r.devices : [];
  }
  device(id: string, refresh = false): Device {
    return this.call("GET", `/devices/${encodeId(id)}${refresh ? "?refresh=1" : ""}`, undefined, refresh ? 30 : 15);
  }
  rename(id: string, name: string): Device {
    return this.call("PATCH", `/devices/${encodeId(id)}`, { name });
  }
  unpair(id: string, force = false): { ok: boolean; removed_from_accessory: boolean } {
    return this.call("DELETE", `/devices/${encodeId(id)}${force ? "?force=1" : ""}`, undefined, 30);
  }
  write(id: string, set: Array<{ aid: number; iid: number; value: unknown }>): Device {
    const r = this.call("POST", `/devices/${encodeId(id)}/characteristics`, { set });
    return r?.device;
  }
  identify(id: string): void {
    this.call("POST", `/devices/${encodeId(id)}/identify`, {});
  }
  discover(refresh = false): Discovered[] {
    const r = this.call("GET", `/discover${refresh ? "?refresh=1" : ""}`, undefined, refresh ? 15 : 10);
    return Array.isArray(r?.accessories) ? r.accessories : [];
  }
  pair(body: { id: string; setup_code: string; address?: string; port?: number; name?: string }): Device {
    // Pair-setup is SRP + a full accessory-database read: allow a minute.
    return this.call("POST", "/devices/pair", body, 90);
  }

  // ── Philips Hue (bridge 0.2.0) ──

  /// Run a Hue call; a 404 from a bridge older than MIN_HUE_VERSION (no
  /// /hue routes) becomes `bridge_outdated` with the fix spelled out.
  private hue<T>(f: () => T): T {
    try {
      return f();
    } catch (e) {
      if (!(e instanceof BridgeError) || e.status !== 404 || e.code === "not_linked") throw e;
      let version = "";
      try {
        version = String(this.health()?.version ?? "");
      } catch (_e) {
        throw e;
      }
      if (!versionLt(version, MIN_HUE_VERSION)) throw e;
      throw new BridgeError(
        404,
        OUTDATED,
        `homekit-bridge ${version || "(unknown version)"} doesn't support Philips Hue — it needs ${MIN_HUE_VERSION} or newer. Update it from the HomeKit page (or reinstall homekit-bridge in App Manager).`,
      );
    }
  }
  hueBridges(refresh = false): HueBridge[] {
    const r = this.hue(() => this.call("GET", `/hue/bridges${refresh ? "?refresh=1" : ""}`, undefined, refresh ? 15 : 10));
    return Array.isArray(r?.bridges) ? r.bridges : [];
  }
  /// One link attempt; `link_button_not_pressed` (409) until the button is pressed.
  hueLink(body: { bridge_id?: string; address?: string }): HueBridge {
    return this.hue(() => this.call("POST", "/hue/link", body, 15));
  }
  hueUnlink(bridgeId: string): void {
    this.hue(() => this.call("DELETE", `/hue/bridges/${encodeId(bridgeId)}`));
  }
  hueGroups(): HueGroup[] {
    const r = this.hue(() => this.call("GET", "/hue/groups"));
    return Array.isArray(r?.groups) ? r.groups : [];
  }
  hueGroupSet(id: string, body: { on?: boolean; brightness?: number }): HueGroup {
    return this.hue(() => this.call("POST", `/hue/groups/${encodeId(id)}`, body));
  }
  hueScenes(groupId?: string): HueScene[] {
    const r = this.hue(() => this.call("GET", `/hue/scenes${groupId ? `?group_id=${encodeURIComponent(groupId)}` : ""}`));
    return Array.isArray(r?.scenes) ? r.scenes : [];
  }
  hueRecall(id: string): void {
    this.hue(() => this.call("POST", `/hue/scenes/${encodeId(id)}/recall`, {}));
  }
}

export interface BridgeHealth {
  reachable: boolean;
  version?: string;
  paired?: number;
  connected?: number;
  hue_bridges?: number;
  hue_linked?: number;
  token_source: TokenSource;
  error?: string;
  /// It answered but refused the token (so it IS installed and running).
  auth_failed?: boolean;
}

/// Probe `GET /health`. Never throws; never echoes the token.
export function bridgeHealth(t: Transport, cfg: BridgeConfig): BridgeHealth {
  const out: BridgeHealth = { reachable: false, token_source: cfg.token_source };
  try {
    const h = new Bridge(t, cfg).health();
    out.reachable = true;
    if (typeof h?.version === "string" && h.version) out.version = h.version;
    if (typeof h?.paired === "number") out.paired = h.paired;
    if (typeof h?.connected === "number") out.connected = h.connected;
    if (typeof h?.hue_bridges === "number") out.hue_bridges = h.hue_bridges;
    if (typeof h?.hue_linked === "number") out.hue_linked = h.hue_linked;
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
    if (e instanceof BridgeError && e.status === 401) out.auth_failed = true;
  }
  return out;
}
