// Parent-proxied fetch bridge (same as print-farm). The page runs in a
// sandboxed iframe without same-origin, so the host performs authenticated
// /api/plugin-ui/* requests on its behalf (web/src/components/
// PluginFullPage.tsx). The JWT never enters the frame.

export const API = "/api/plugin-ui/homekit";

let seq = 0;
const pending = new Map<number, (r: { status: number; body: string }) => void>();
// Has the host ever answered? A request posted before the host's message
// listener is attached is silently lost, so until the first reply arrives,
// idempotent GETs are re-posted (and the first reply to any copy wins).
let bridgeUp = false;
// Longest plugin call (pairing, ~90 s) plus slack.
const TIMEOUT_MS = 150_000;

window.addEventListener("message", (e) => {
  const m = e.data;
  if (m && m.type === "plugin-ui-fetch-result" && pending.has(m.requestId)) {
    bridgeUp = true;
    pending.get(m.requestId)!({ status: m.status, body: m.body });
  }
});

function raw(method: string, path: string, body?: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve) => {
    const ids: number[] = [];
    let done = false;
    const finish = (r: { status: number; body: string }) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearInterval(resend);
      ids.forEach((i) => pending.delete(i));
      resolve(r);
    };
    const send = () => {
      const id = ++seq;
      ids.push(id);
      pending.set(id, finish);
      window.parent.postMessage({ type: "plugin-ui-fetch", requestId: id, method, path: API + "/" + path, body }, "*");
    };
    const timer = setTimeout(() => finish({ status: 504, body: JSON.stringify({ error: "the request timed out" }) }), TIMEOUT_MS);
    const resend = setInterval(() => {
      if (bridgeUp || method !== "GET" || ids.length >= 10) clearInterval(resend);
      else send();
    }, 1000);
    send();
  });
}

export class ApiError extends Error {
  /// The parsed error body (`{error, code?, field?}`), if any.
  constructor(public status: number, msg: string, public body: any = null) {
    super(msg);
  }
  get code(): string | null {
    return typeof this.body?.code === "string" ? this.body.code : null;
  }
  get field(): string | null {
    return typeof this.body?.field === "string" ? this.body.field : null;
  }
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await raw(method, path, body === undefined ? undefined : JSON.stringify(body));
  let parsed: any = {};
  try {
    parsed = res.body ? JSON.parse(res.body) : {};
  } catch (_e) {
    parsed = { error: res.status >= 400 ? `request failed (${res.status})` : "bad response from the plugin" };
  }
  if (res.status >= 400 || (parsed && typeof parsed.error === "string")) {
    throw new ApiError(res.status, parsed?.error || `request failed (${res.status})`, parsed);
  }
  return parsed as T;
}

export const get = <T = any>(path: string) => api<T>("GET", path);
export const post = <T = any>(path: string, body: unknown = {}) => api<T>("POST", path, body);
export const put = <T = any>(path: string, body: unknown) => api<T>("PUT", path, body);
export const del = <T = any>(path: string) => api<T>("DELETE", path);

/// Ask the host to open another plugin's page (App Manager deep link).
export function openPluginPage(plugin: string, item: string, query: string) {
  window.parent.postMessage({ type: "plugin-ui-open-page", plugin, item, query }, "*");
}

/// An "Open App Manager" link that installs `app` (deep link).
export function appManagerLink(app: string, label = "Open App Manager"): HTMLAnchorElement {
  const q = `install=${encodeURIComponent(app)}&from=homekit`;
  const a = document.createElement("a");
  a.className = "btn sm";
  a.href = "/plugin-page/app-manager/app-manager?" + q;
  a.textContent = label;
  a.addEventListener("click", (e) => {
    e.preventDefault();
    openPluginPage("app-manager", "app-manager", q);
  });
  return a;
}
