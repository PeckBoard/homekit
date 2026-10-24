import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BRIDGE_INSTALL } from "../src/setup";

// Runs the real install script offline: curl / systemctl / loginctl are
// stubs, and PATH holds only the coreutils the script needs, so "no node"
// and "system node" are both controllable.
const TOOLS = ["sh", "cut", "sha256sum", "awk", "tar", "gzip", "mkdir", "rm", "mv", "install", "chmod", "cat", "od", "tr", "id", "uname", "sleep", "cp"];
const narch = process.arch === "arm64" ? "arm64" : "x64";
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");

let root: string, home: string, bin: string, fix: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "hk-install-"));
  home = join(root, "home");
  bin = join(root, "bin");
  fix = join(root, "fix");
  for (const d of [home, bin, fix]) mkdirSync(d, { recursive: true });
  for (const t of TOOLS) symlinkSync(execFileSync("sh", ["-c", `command -v ${t}`]).toString().trim(), join(bin, t));
  const stub = (name: string, body: string) => writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  stub("systemctl", `echo "systemctl $*" >> "${fix}/calls.log"`);
  stub("loginctl", `echo "loginctl $*" >> "${fix}/calls.log"`);
  stub(
    "curl",
    `out=; url=
while [ $# -gt 0 ]; do case "$1" in -o) out=$2; shift 2 ;; -H|-m) shift 2 ;; -*) shift ;; *) url=$1; shift ;; esac; done
echo "curl $url" >> "${fix}/calls.log"
case "$url" in */health) exit 0 ;; esac
cp "${fix}/\${url##*/}" "$out"`,
  );
  // Release asset + a fake official Node tarball with its SHASUMS256.txt.
  writeFileSync(join(fix, "homekit-bridge.mjs"), "// bundle\n");
  writeFileSync(join(fix, "homekit-bridge.mjs.sha256"), `${sha(join(fix, "homekit-bridge.mjs"))}  homekit-bridge.mjs\n`);
  const nd = join(root, "nodesrc", `node-v22.99.0-linux-${narch}`, "bin");
  mkdirSync(nd, { recursive: true });
  writeFileSync(join(nd, "node"), "#!/bin/sh\necho v22.99.0\n", { mode: 0o755 });
  const tarball = `node-v22.99.0-linux-${narch}.tar.gz`;
  execFileSync("tar", ["-czf", join(fix, tarball), "-C", join(root, "nodesrc"), `node-v22.99.0-linux-${narch}`]);
  writeFileSync(join(fix, "SHASUMS256.txt"), `${"0".repeat(64)}  node-v22.99.0-linux-${narch}.tar.xz\n${sha(join(fix, tarball))}  ${tarball}\n`);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function run() {
  const job = join(root, "job");
  mkdirSync(job);
  return spawnSync(join(bin, "sh"), ["-c", BRIDGE_INSTALL, "sh", job], {
    env: { HOME: home, PATH: bin, HKB_RELEASES: "http://releases", USER: "u" },
    encoding: "utf8",
  });
}

describe("BRIDGE_INSTALL", () => {
  it("fetches a private Node 22 when there is no system node, and wires the wrapper + unit", () => {
    const r = run();
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    const lib = join(home, ".local/lib/homekit-bridge");
    expect(readFileSync(join(home, ".local/bin/homekit-bridge"), "utf8")).toBe(
      `#!/bin/sh\nexec "${lib}/node/bin/node" "${lib}/homekit-bridge.mjs" "$@"\n`,
    );
    expect(execFileSync(join(lib, "node/bin/node")).toString().trim()).toBe("v22.99.0");
    expect(existsSync(join(lib, "homekit-bridge.mjs"))).toBe(true);
    expect(statSync(join(home, ".config/homekit-bridge/token")).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(home, ".config/systemd/user/homekit-bridge.service"), "utf8")).toContain(
      "ExecStart=%h/.local/bin/homekit-bridge --bind 127.0.0.1:7782 --token-file %h/.config/homekit-bridge/token\n",
    );
    const calls = readFileSync(join(fix, "calls.log"), "utf8");
    expect(calls).toContain("curl https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt");
    expect(calls).toContain("systemctl --user restart homekit-bridge");
  });

  it("uses a system node >= 20 as-is and never fetches Node", () => {
    symlinkSync(process.execPath, join(bin, "node"));
    const r = run();
    expect(r.status).toBe(0);
    expect(readFileSync(join(home, ".local/bin/homekit-bridge"), "utf8")).toContain(`exec "${join(bin, "node")}"`);
    expect(readFileSync(join(fix, "calls.log"), "utf8")).not.toContain("nodejs.org");
  });

  it("refuses a Node tarball whose sha256 doesn't match", () => {
    writeFileSync(join(fix, `node-v22.99.0-linux-${narch}.tar.gz`), "tampered");
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/sha256 mismatch/);
    expect(existsSync(join(home, ".local/bin/homekit-bridge"))).toBe(false);
  });
});
