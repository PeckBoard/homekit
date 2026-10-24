// Plugin settings with their defaults applied (core returns null for unset),
// plus the homekit-bridge token lookup.

import { getSetting, execAny } from "./host";

export const DEFAULT_BRIDGE_URL = "http://127.0.0.1:7782";

export type TokenSource = "setting" | "file" | "none";

export interface BridgeConfig {
  url: string;
  token: string;
  token_source: TokenSource;
}

function str(key: string): string {
  const v = getSetting(key);
  return typeof v === "string" ? v.trim() : "";
}

/// The explicit `bridge_token` setting wins; otherwise the token the
/// homekit-bridge install wrote to disk. Pure (reader injected).
export function resolveBridgeToken(setting: string, readFile: () => string): { token: string; source: TokenSource } {
  const s = setting.trim();
  if (s) return { token: s, source: "setting" };
  let f = "";
  try {
    f = readFile().trim();
  } catch (_e) {
    f = "";
  }
  return f ? { token: f, source: "file" } : { token: "", source: "none" };
}

// Re-read at most this often, so a reinstall's new token is picked up
// without an exec on every device poll.
const TOKEN_FILE_TTL_MS = 30_000;
let tokenFile: { value: string; at: number } | null = null;

/// Forget the cached token file (an install may just have written it).
export function invalidateBridgeToken(): void {
  tokenFile = null;
}

/// `${XDG_CONFIG_HOME:-~/.config}/homekit-bridge/token`, or "" when absent.
/// The token is never logged or returned to the UI.
function readBridgeTokenFile(): string {
  const now = Date.now();
  if (tokenFile && now - tokenFile.at < TOKEN_FILE_TTL_MS) return tokenFile.value;
  const r = execAny("sh", ["-c", 'f="${XDG_CONFIG_HOME:-$HOME/.config}/homekit-bridge/token"; [ -r "$f" ] && head -c 4096 "$f" || true'], 10);
  const value = r.exit_code === 0 ? r.stdout.trim() : "";
  tokenFile = { value, at: now };
  return value;
}

export function bridgeConfig(): BridgeConfig {
  const { token, source } = resolveBridgeToken(str("bridge_token"), readBridgeTokenFile);
  return { url: (str("bridge_url") || DEFAULT_BRIDGE_URL).replace(/\/+$/, ""), token, token_source: source };
}
