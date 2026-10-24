// HTTP surfaces: the served page (`http.request.before`) and the
// authenticated app-UI JSON API (`http.request.authed`) under
// /api/plugin-ui/homekit/*. Every request here is a logged-in user's. The
// bridge token never leaves through this surface.

import { htmlResponse, jsonResponse, errMsg } from "./verdict";
import { PAGE } from "./page";
import { Bridge, BridgeError, hostTransport } from "./bridge";
import { bridgeConfig } from "./config";
import { ensureSetup } from "./setup";
import { discoveredView, normalizeSetupCode, setupCodeError } from "./hap";

export const PAGE_PATH = "/plugin-api/v1/homekit";
export const API = "/api/plugin-ui/homekit";

function up(v: unknown): string {
  return (typeof v === "string" ? v : "").toUpperCase();
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function parseBody(body: string): any {
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch (e) {
    throw new HttpError(400, "invalid request body: " + errMsg(e));
  }
}

export function serveHttp(payload: any): string {
  if (up(payload?.method) === "GET" && str(payload?.path) === PAGE_PATH) {
    return htmlResponse(200, PAGE);
  }
  return htmlResponse(404, "<!doctype html><title>Not found</title><p>Not found.</p>");
}

class HttpError extends Error {
  constructor(public status: number, msg: string, public field?: string) {
    super(msg);
  }
}

/// HTTP status for a thrown error. A bridge 401 is reported as 502 so the
/// host never mistakes it for the user's own session expiring.
export function errorStatus(e: unknown): number {
  if (e instanceof HttpError) return e.status;
  if (e instanceof BridgeError) return e.status === 401 || e.status < 400 ? 502 : e.status;
  return 400;
}

/// `{error, code?, field?}` for a thrown error. Pure.
export function errorBody(e: unknown): { error: string; code?: string; field?: string } {
  const out: { error: string; code?: string; field?: string } = { error: errMsg(e) };
  if (e instanceof BridgeError) out.code = e.code;
  if (e instanceof HttpError && e.field) out.field = e.field;
  return out;
}

function bridge(): Bridge {
  return new Bridge(hostTransport, bridgeConfig());
}

type Handler = (ctx: { params: Record<string, string>; query: string; body: any }) => unknown;

/// Pair body from the page, validated (setup code, manual address/port). Pure.
export function pairBody(body: any): { id: string; setup_code: string; address?: string; port?: number; name?: string } {
  const codeErr = setupCodeError(str(body?.setup_code));
  if (codeErr) throw new HttpError(400, codeErr, "setup_code");
  const id = str(body?.id).trim();
  if (!id) throw new HttpError(400, "the accessory id is required", "id");
  const out: { id: string; setup_code: string; address?: string; port?: number; name?: string } = { id, setup_code: normalizeSetupCode(str(body?.setup_code))! };
  const address = str(body?.address).trim();
  if (address) out.address = address;
  if (body?.port !== undefined && body?.port !== null && body?.port !== "") {
    const port = Number(body.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new HttpError(400, "the port must be a number from 1 to 65535", "port");
    out.port = port;
  }
  if (address && out.port === undefined) throw new HttpError(400, "a manual address needs its port too", "port");
  const name = str(body?.name).trim();
  if (name) out.name = name;
  return out;
}

/// Route table: "METHOD path" (with :params) → handler. Mirrors manifest ui_routes.
export const ROUTES: Array<[string, Handler]> = [
  ["GET setup", () => ensureSetup()],
  ["POST setup/retry", () => ensureSetup(true)],
  ["GET devices", () => ({ devices: bridge().devices() })],
  ["GET devices/:id", ({ params, query }) => ({ device: bridge().device(params.id, queryParam(query, "refresh") === "1") })],
  [
    "PUT devices/:id",
    ({ params, body }) => {
      const name = str(body?.name).trim();
      if (!name) throw new HttpError(400, "enter a name", "name");
      return { device: bridge().rename(params.id, name) };
    },
  ],
  ["DELETE devices/:id", ({ params, query }) => bridge().unpair(params.id, queryParam(query, "force") === "1")],
  [
    "POST devices/:id/characteristics",
    ({ params, body }) => {
      const set = Array.isArray(body?.set) ? body.set : [];
      if (!set.length) throw new HttpError(400, "nothing to set");
      return { device: bridge().write(params.id, set) };
    },
  ],
  [
    "POST devices/:id/identify",
    ({ params }) => {
      bridge().identify(params.id);
      return { ok: true };
    },
  ],
  ["GET discover", ({ query }) => ({ accessories: bridge().discover(queryParam(query, "refresh") === "1").map(discoveredView) })],
  ["POST pair", ({ body }) => ({ device: bridge().pair(pairBody(body)) })],
];

/// Match "METHOD pattern" against a request (path relative to API). Pure.
export function matchRoute(decl: string, method: string, rel: string): Record<string, string> | null {
  const [m, pat] = decl.split(" ");
  if (m !== method) return null;
  const ps = pat.split("/");
  const rs = rel.split("/").filter(Boolean);
  if (ps.length !== rs.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < ps.length; i++) {
    if (ps[i].startsWith(":")) params[ps[i].slice(1)] = decodeURIComponent(rs[i]);
    else if (ps[i] !== rs[i]) return null;
  }
  return params;
}

export function serveAuthed(payload: any): string {
  const method = up(payload?.method);
  let path = str(payload?.path);
  let query = str(payload?.query);
  const q = path.indexOf("?");
  if (q >= 0) {
    query = query || path.slice(q + 1);
    path = path.slice(0, q);
  }
  if (!path.startsWith(API + "/")) return jsonResponse(404, { error: "not found" });
  const rel = path.slice(API.length + 1);
  try {
    for (const [decl, handler] of ROUTES) {
      const params = matchRoute(decl, method, rel);
      if (params) {
        return jsonResponse(200, handler({ params, query, body: parseBody(str(payload?.body)) }));
      }
    }
  } catch (e) {
    return jsonResponse(errorStatus(e), errorBody(e));
  }
  return jsonResponse(404, { error: "not found" });
}

/// The manifest's ui_routes, derived from ROUTES so they can't drift.
export function uiRoutes(): string[] {
  return ROUTES.map(([decl]) => {
    const [m, pat] = decl.split(" ");
    return `${m} ${API}/${pat}`;
  });
}

/// Extract and URL-decode `name`'s value from a `&`-separated query string.
export function queryParam(query: string, name: string): string | undefined {
  for (const pair of query.split("&")) {
    const idx = pair.indexOf("=");
    if (idx < 0) continue;
    if (pair.slice(0, idx) !== name) continue;
    const v = pair.slice(idx + 1);
    try {
      return decodeURIComponent(v.replace(/\+/g, "%20"));
    } catch (_e) {
      return v;
    }
  }
  return undefined;
}
