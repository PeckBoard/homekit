// FFI layer: the Peckboard core host functions this plugin calls. Host calls
// are kept LAZY (inside functions) so the pure modules load under vitest
// without an Extism runtime. See peckboard/src/plugin/host.rs for the Rust
// side of every function called here. Every name used must also be declared
// in index.d.ts (test/hostfns.test.ts checks).

type HostFn = (offset: bigint) => bigint;

/// Call a host function and parse its JSON response, surfacing an
/// `{"error": ...}` envelope (or a trap) as a thrown Error.
export function hostCall(name: string, input: unknown): any {
  const f = (Host.getFunctions() as Record<string, HostFn>)[name];
  if (typeof f !== "function") throw new Error(`host function ${name} is not available`);
  const mem = Memory.fromString(JSON.stringify(input));
  const out = f(mem.offset as unknown as bigint);
  const parsed = JSON.parse(Memory.find(out).readString());
  if (parsed && parsed.error !== undefined && parsed.error !== null) {
    throw new Error(String(parsed.error));
  }
  return parsed;
}

// ── Settings ────────────────────────────────────────────────────────────────

export function getSetting(key: string): any {
  const result = hostCall("peckboard_get_plugin_setting", { key });
  return result?.value ?? null;
}

// ── Plugin document store (data_store) ──────────────────────────────────────

export function storePut(collection: string, key: string, data: unknown): void {
  hostCall("peckboard_store_put", { collection, key, data });
}

export function storeGet(collection: string, key: string): any {
  const result = hostCall("peckboard_store_get", { collection, key });
  return result?.value ?? null;
}

/// Atomic create: true when this call wrote the row, false when it existed.
/// `ttlSecs` > 0 lets a call steal a row older than that (a stale lock).
export function storePutIfAbsent(collection: string, key: string, data: unknown, ttlSecs = 0): boolean {
  return hostCall("peckboard_store_put_if_absent", { collection, key, data, ttl_secs: ttlSecs })?.acquired === true;
}

export function storeDelete(collection: string, key: string): void {
  hostCall("peckboard_store_delete", { collection, key });
}

// ── Process exec (process_exec_any) ─────────────────────────────────────────

export interface ExecResult {
  exit_code: number | null;
  stdout: string;
  stderr: string;
  timed_out: boolean;
}

export function execAny(command: string, args: string[], timeoutSecs?: number): ExecResult {
  const input: any = { command, args };
  if (typeof timeoutSecs === "number") input.timeout_secs = timeoutSecs;
  return hostCall("peckboard_exec_any", input) as ExecResult;
}

/// Run `sh -c script` with positional args; throws on non-zero exit.
export function sh(script: string, args: string[] = [], timeoutSecs = 60): string {
  const r = execAny("sh", ["-c", script, "sh", ...args], timeoutSecs);
  if (r.timed_out) throw new Error("command timed out");
  if (r.exit_code !== 0) {
    const msg = (r.stderr || r.stdout || "").trim().split("\n").slice(-3).join(" | ");
    throw new Error(msg || `command failed (exit ${r.exit_code})`);
  }
  return r.stdout;
}

// ── Outbound HTTP (http_request) ────────────────────────────────────────────

export interface HostHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export function httpRequest(input: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeout_secs?: number;
}): HostHttpResponse {
  return hostCall("peckboard_http_request", input) as HostHttpResponse;
}
