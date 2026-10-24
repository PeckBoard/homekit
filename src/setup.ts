// Zero-touch setup: the plugin installs homekit-bridge by itself when the
// bridge on the default URL is missing or unreachable — same model as
// print-farm's print-bridge install. The script mirrors App Manager's
// `homekit-bridge` catalog recipe (plugins can't call each other): the
// sha256-checked release bundle under ~/.local/lib/homekit-bridge, a
// ~/.local/bin/homekit-bridge launcher, the existing token kept (or a new one
// made) in ~/.config/homekit-bridge/token, a systemd user unit, and the
// service restarted. It needs Node.js ≥ 20 (App Manager app `node`); without
// it the install stops and the page links to App Manager.
//
// The install runs as a detached job (nohup, log + exit file under
// ~/.local/share/peckboard-homekit/setup), kicked off by the page loading or a
// tool call and polled by the page. A failed install is not retried
// automatically for an hour (the page's Retry starts it at once).

import { storeGet, storePut, storePutIfAbsent, storeDelete, sh } from "./host";
import { bridgeConfig, invalidateBridgeToken, DEFAULT_BRIDGE_URL } from "./config";
import { bridgeHealth, hostTransport, BridgeHealth } from "./bridge";

export interface SetupJob {
  status: "running" | "succeeded" | "failed";
  reason: string;
  dir: string;
  pid: number;
  started_at: number;
  finished_at?: number;
  error?: string;
  log_tail?: string;
  /// No systemd user manager: the bridge can't run as a service here.
  no_systemd?: boolean;
  /// Node.js is missing or too old: install `node` from App Manager.
  no_node?: boolean;
}

export interface SetupView {
  status: "ok" | "running" | "failed" | "external";
  reason?: string;
  phase?: string;
  error?: string;
  log_tail?: string;
  no_systemd?: boolean;
  no_node?: boolean;
}

export interface SetupState {
  bridge: SetupView;
  health: BridgeHealth;
  url: string;
}

export type BridgeNeed = { kind: "missing"; reason: string } | null;

// ── pure ────────────────────────────────────────────────────────────────────

/// Why homekit-bridge must be installed, or null. Only for the default
/// loopback URL — a bridge the user runs elsewhere is theirs to manage — and
/// never when it answered (a rejected token isn't fixed by reinstalling).
/// Pure — tested.
export function bridgeNeed(health: BridgeHealth, url: string): BridgeNeed {
  if (url.replace(/\/+$/, "") !== DEFAULT_BRIDGE_URL) return null;
  if (health.reachable || health.auth_failed) return null;
  return { kind: "missing", reason: "homekit-bridge isn't running" };
}

const COOLDOWN_FAILED_MS = 60 * 60 * 1000;
const COOLDOWN_REINSTALL_MS = 30 * 60 * 1000;

/// Should an install start now? Pure — tested.
export function shouldStart(job: Pick<SetupJob, "status" | "started_at" | "finished_at"> | null, need: BridgeNeed, now: number, force: boolean): boolean {
  if (job?.status === "running") return false;
  if (!need) return false;
  if (force || !job) return true;
  const since = now - (job.finished_at ?? job.started_at);
  return since >= (job.status === "failed" ? COOLDOWN_FAILED_MS : COOLDOWN_REINSTALL_MS);
}

/// Split `@@TAG` sections of the poll script's output. Pure.
export function parseSections(out: string): Record<string, string> {
  const sections: Record<string, string[]> = {};
  let cur = "";
  for (const line of out.split("\n")) {
    const m = /^@@([A-Z]+)$/.exec(line);
    if (m) sections[(cur = m[1])] = [];
    else if (cur) sections[cur].push(line);
  }
  const res: Record<string, string> = {};
  for (const [k, v] of Object.entries(sections)) res[k] = v.join("\n").trim();
  return res;
}

/// The last few meaningful log lines — the installer's real reason. Pure.
export function failureReason(log: string, exitCode: number | null): string {
  const lines = log.split("\n").map((l) => l.trim()).filter(Boolean);
  const last = lines.slice(-3).join(" | ");
  return last || (exitCode === null ? "the installer stopped unexpectedly" : `the installer exited with code ${exitCode}`);
}

// ── install script ($1 = the job dir) ───────────────────────────────────────

function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/// Exit 3 = no systemd user manager, 4 = no usable Node.js (nothing touched).
/// Mirrors App Manager's `homekit-bridge` recipe: system node when >= 20,
/// else a private sha256-checked official Node 22 (distro node often lags —
/// Ubuntu 24.04 ships 18). The ~/.local/bin/homekit-bridge wrapper pins the
/// node binary by absolute path (systemd user services don't see nvm PATHs)
/// and the unit runs the wrapper.
export const BRIDGE_INSTALL = `set -e
d=$1
base=\${HKB_RELEASES:-https://github.com/PeckBoard/homekit-bridge/releases/latest/download}
asset=homekit-bridge.mjs
if [ -z "\${XDG_RUNTIME_DIR:-}" ] && [ -d "/run/user/$(id -u)" ]; then export XDG_RUNTIME_DIR="/run/user/$(id -u)"; fi
export PATH="$HOME/.local/bin:$HOME/.local/node/bin:$PATH"
if ! systemctl --user show-environment >/dev/null 2>&1; then
  echo "no systemd user manager is reachable (systemctl --user failed), so homekit-bridge can't run as a service here" >&2; exit 3
fi
command -v curl >/dev/null 2>&1 || { echo "curl is not installed on this host" >&2; exit 1; }
tmp="$d/tmp"; rm -rf "$tmp"; mkdir -p "$tmp"
lib="$HOME/.local/lib/homekit-bridge"
node=$(command -v node || true)
if [ -n "$node" ] && "$node" -e 'process.exit(+process.versions.node.split(".")[0] >= 20 ? 0 : 1)' 2>/dev/null; then :; else
  echo node > "$d/phase"
  case "$(uname -m)" in x86_64|amd64) narch=x64 ;; aarch64|arm64) narch=arm64 ;;
    *) echo "homekit-bridge needs Node.js 20 or newer and there is no official build for $(uname -m) — install \\"node\\" from App Manager, then Retry" >&2; exit 4 ;; esac
  nbase=https://nodejs.org/dist/latest-v22.x
  curl -fsSL -o "$tmp/SHASUMS256.txt" "$nbase/SHASUMS256.txt" || { echo "download failed: $nbase/SHASUMS256.txt" >&2; exit 1; }
  line=$(awk -v a="linux-$narch.tar.gz" 'index($2, a) && $2 ~ /^node-v22/ {print; exit}' "$tmp/SHASUMS256.txt")
  nwant=\${line%% *}; tarball=\${line##* }
  [ -n "$tarball" ] || { echo "no Node 22 build for linux-$narch" >&2; exit 1; }
  curl -fsSL -o "$tmp/$tarball" "$nbase/$tarball" || { echo "download failed: $nbase/$tarball" >&2; exit 1; }
  [ "$(sha256sum "$tmp/$tarball" | cut -d" " -f1)" = "$nwant" ] || { echo "sha256 mismatch for $tarball — not installed" >&2; exit 1; }
  rm -rf "$lib/node"; mkdir -p "$lib/node"
  tar -xzf "$tmp/$tarball" -C "$lib/node" --strip-components=1
  node="$lib/node/bin/node"
fi
echo download > "$d/phase"
curl -fsSL -o "$tmp/$asset" "$base/$asset" || { echo "download failed: $base/$asset" >&2; exit 1; }
curl -fsSL -o "$tmp/$asset.sha256" "$base/$asset.sha256" || { echo "download failed: $base/$asset.sha256" >&2; exit 1; }
want=$(cut -d" " -f1 "$tmp/$asset.sha256"); got=$(sha256sum "$tmp/$asset" | cut -d" " -f1)
[ "$want" = "$got" ] || { echo "sha256 mismatch for $asset — not installed" >&2; exit 1; }
echo install > "$d/phase"
lib="$HOME/.local/lib/homekit-bridge"
mkdir -p "$lib" "$HOME/.local/bin" "$HOME/.config/homekit-bridge" "$HOME/.config/systemd/user"
install -m 644 "$tmp/$asset" "$lib/$asset.new"
mv -f "$lib/$asset.new" "$lib/$asset"
printf '#!/bin/sh\\nexec "%s" "%s" "$@"\\n' "$node" "$lib/$asset" > "$HOME/.local/bin/homekit-bridge"
chmod 755 "$HOME/.local/bin/homekit-bridge"
rm -rf "$tmp"
tok="$HOME/.config/homekit-bridge/token"
if [ ! -s "$tok" ]; then (umask 077; od -An -N32 -tx1 /dev/urandom | tr -d ' \\n' > "$tok"); chmod 600 "$tok"; fi
unit="$HOME/.config/systemd/user/homekit-bridge.service"
printf '%s\\n' ${shQuote("[Unit]")} ${shQuote("Description=homekit-bridge: local HTTP bridge that controls HomeKit IP accessories")} ${shQuote("Wants=network-online.target")} ${shQuote("After=network-online.target")} '' ${shQuote("[Service]")} ${shQuote("ExecStart=%h/.local/bin/homekit-bridge --bind 127.0.0.1:7782 --token-file %h/.config/homekit-bridge/token")} ${shQuote("Restart=on-failure")} ${shQuote("RestartSec=5")} ${shQuote("NoNewPrivileges=yes")} ${shQuote("PrivateTmp=yes")} '' ${shQuote("[Install]")} ${shQuote("WantedBy=default.target")} > "$unit"
echo start > "$d/phase"
systemctl --user daemon-reload
systemctl --user enable homekit-bridge
systemctl --user restart homekit-bridge
loginctl enable-linger "\${USER:-$(id -un)}" 2>/dev/null || echo "warning: loginctl enable-linger failed; the service stops when you log out" >&2
i=0; while [ $i -lt 15 ]; do curl -fsS -m 2 -o /dev/null -H "Authorization: Bearer $(cat "$tok")" http://127.0.0.1:7782/health && break; i=$((i + 1)); sleep 1; done
echo "homekit-bridge installed; listening on 127.0.0.1:7782"
`;

const JOB_HEARTBEAT = '(while [ ! -e "$d/exit" ]; do touch "$d/hb"; sleep 5; done) &';
const JOB_ALIVE =
  'if [ "$pid" -gt 0 ] && kill -0 "$pid" 2>/dev/null; then echo 1; ' +
  'elif [ -e "$d/hb" ] && [ $(( $(date +%s) - $(stat -c %Y "$d/hb") )) -lt 30 ]; then echo 1; else echo 0; fi';

const LAUNCH = [
  'd=$1; s=$2',
  'rm -rf "$d"; mkdir -p "$d" || exit 1',
  `nohup sh -c 's=$1; d=$2; ${JOB_HEARTBEAT} sh -c "$s" sh "$d"; echo $? > "$d/exit"' sh "$s" "$d" > "$d/log" 2>&1 < /dev/null &`,
  'echo $!',
].join("\n");

const POLL = [
  'd=$1; pid=$2',
  'echo @@EXIT; cat "$d/exit" 2>/dev/null',
  `echo @@ALIVE; ${JOB_ALIVE}`,
  'echo @@PHASE; cat "$d/phase" 2>/dev/null',
  'echo @@LOG; tail -c 3000 "$d/log" 2>/dev/null',
  'true',
].join("\n");

// ── job store ───────────────────────────────────────────────────────────────

const JOBS = "setup_jobs";
const LOCKS = "setup_locks";
const KEY = "bridge";
const LAUNCH_LOCK_SECS = 60;

function getJob(): SetupJob | null {
  return (storeGet(JOBS, KEY) as SetupJob) ?? null;
}

function jobDir(): string {
  const out = sh('d="${XDG_DATA_HOME:-$HOME/.local/share}/peckboard-homekit/setup"; mkdir -p "$d" && cd "$d" && pwd -P', [], 15).trim();
  if (!out.startsWith("/")) throw new Error("could not resolve the setup dir");
  return out + "/bridge";
}

/// Launch the install. Calls run concurrently (manifest `concurrency`); an
/// atomic claim lets only one launch it.
function startJob(reason: string): SetupJob | null {
  if (!storePutIfAbsent(LOCKS, KEY, Date.now(), LAUNCH_LOCK_SECS)) return getJob();
  const dir = jobDir();
  const pid = Number(sh(LAUNCH, [dir, BRIDGE_INSTALL], 30).trim());
  const job: SetupJob = { status: "running", reason, dir, pid: isFinite(pid) ? pid : 0, started_at: Date.now() };
  storePut(JOBS, KEY, job);
  return job;
}

/// Poll a running job; settle it when the script has exited.
function pollJob(job: SetupJob): SetupView {
  const s = parseSections(sh(POLL, [job.dir, String(job.pid)], 30));
  const exitCode = s.EXIT === "" || s.EXIT === undefined ? null : Number(s.EXIT);
  const exited = exitCode !== null && isFinite(exitCode);
  if (!exited && s.ALIVE === "1") return { status: "running", reason: job.reason, phase: s.PHASE || "starting" };
  const next: SetupJob = { ...job, finished_at: Date.now(), log_tail: (s.LOG ?? "").slice(-1500) };
  if (exited && exitCode === 0) {
    next.status = "succeeded";
    delete next.error;
    invalidateBridgeToken();
  } else {
    next.status = "failed";
    next.error = failureReason(s.LOG ?? "", exited ? exitCode : null);
    if (exitCode === 3) next.no_systemd = true;
    if (exitCode === 4) next.no_node = true;
  }
  storePut(JOBS, KEY, next);
  storeDelete(LOCKS, KEY); // settled: the next launch may claim it
  return next.status === "succeeded" ? { status: "ok" } : failedView(next);
}

function failedView(j: SetupJob): SetupView {
  return { status: "failed", reason: j.reason, error: j.error, log_tail: j.log_tail, no_systemd: j.no_systemd, no_node: j.no_node };
}

// ── entry point ─────────────────────────────────────────────────────────────

/// Probe the bridge, start the install if it should run, poll a running one.
/// `force` = the page's Retry.
export function ensureSetup(force = false): SetupState {
  const now = Date.now();
  if (force) storeDelete(LOCKS, KEY);
  const cfg = bridgeConfig();
  let job = getJob();
  let health: BridgeHealth = { reachable: false, token_source: cfg.token_source };
  let need: BridgeNeed = null;
  if (job?.status !== "running") {
    health = bridgeHealth(hostTransport, cfg);
    need = bridgeNeed(health, cfg.url);
    if (shouldStart(job, need, now, force)) job = startJob(need!.reason);
  }
  let view: SetupView;
  if (job?.status === "running") view = pollJob(job);
  else if (!need) {
    // Reachable; or answering with a rejected token; or a user-run bridge elsewhere.
    if (health.reachable) view = { status: "ok" };
    else view = { status: cfg.url === DEFAULT_BRIDGE_URL ? "failed" : "external", error: health.error };
  }
  else if (job?.status === "failed") view = failedView(job);
  else if (job?.status === "succeeded") {
    // Installed, but still not answering: say so instead of looping.
    view = { status: "failed", reason: need.reason, error: `homekit-bridge was installed but isn't answering on ${cfg.url}`, log_tail: job.log_tail };
  } else view = { status: "failed", reason: need.reason, error: health.error };
  if (view.status === "ok" && !health.reachable && job?.status === "running") health = bridgeHealth(hostTransport, cfg);
  return { bridge: view, health, url: cfg.url };
}

/// For tool calls: kick setup off if needed (never throws). Returns a one-line
/// note for the agent when the bridge isn't usable yet, else null.
export function setupNote(): string | null {
  try {
    const s = ensureSetup();
    if (s.health.reachable) return null;
    if (s.bridge.status === "running") return `homekit-bridge is being installed automatically (${s.bridge.phase ?? "starting"}); try again in a minute.`;
    if (s.bridge.no_node) return "homekit-bridge needs Node.js: the user must install \"node\" from App Manager, then press Retry on the HomeKit page.";
    if (s.bridge.status === "failed") return `homekit-bridge could not be installed automatically: ${s.bridge.error ?? "unknown error"}. The user can press Retry on the HomeKit page.`;
    return s.health.error ?? null;
  } catch (_e) {
    return null;
  }
}
