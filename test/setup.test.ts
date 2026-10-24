import { describe, it, expect } from "vitest";
import { bridgeNeed, shouldStart, failureReason } from "../src/setup";
import { resolveBridgeToken, DEFAULT_BRIDGE_URL } from "../src/config";

describe("bridgeNeed", () => {
  it("installs only when the default loopback bridge doesn't answer", () => {
    expect(bridgeNeed({ reachable: false, token_source: "none" }, DEFAULT_BRIDGE_URL)).toEqual({ kind: "missing", reason: "homekit-bridge isn't running" });
    expect(bridgeNeed({ reachable: false, token_source: "none" }, DEFAULT_BRIDGE_URL + "/")).not.toBeNull();
    expect(bridgeNeed({ reachable: true, version: "0.1.0", token_source: "file" }, DEFAULT_BRIDGE_URL)).toBeNull();
    // Running but refusing the token: reinstalling won't help.
    expect(bridgeNeed({ reachable: false, auth_failed: true, token_source: "setting" }, DEFAULT_BRIDGE_URL)).toBeNull();
    // A bridge the user runs elsewhere is theirs.
    expect(bridgeNeed({ reachable: false, token_source: "setting" }, "http://10.0.0.5:7782")).toBeNull();
  });
});

describe("shouldStart", () => {
  const need = { kind: "missing" as const, reason: "x" };
  const now = 10 * 60 * 60 * 1000;
  it("starts once, never while running, and backs off after a failure", () => {
    expect(shouldStart(null, need, now, false)).toBe(true);
    expect(shouldStart(null, null, now, false)).toBe(false);
    expect(shouldStart({ status: "running", started_at: now }, need, now, true)).toBe(false);
    expect(shouldStart({ status: "failed", started_at: now - 1000, finished_at: now - 1000 }, need, now, false)).toBe(false);
    expect(shouldStart({ status: "failed", started_at: now - 1000, finished_at: now - 1000 }, need, now, true)).toBe(true);
    expect(shouldStart({ status: "failed", started_at: 0, finished_at: now - 61 * 60 * 1000 }, need, now, false)).toBe(true);
  });
  it("reports the installer's last lines as the reason", () => {
    expect(failureReason("ok\nNode.js isn't installed on this host\n", 4)).toBe("ok | Node.js isn't installed on this host");
    expect(failureReason("", null)).toMatch(/stopped unexpectedly/);
  });
});

describe("resolveBridgeToken", () => {
  it("prefers the setting, then the token file", () => {
    expect(resolveBridgeToken(" tok ", () => "file")).toEqual({ token: "tok", source: "setting" });
    expect(resolveBridgeToken("", () => "file-token\n")).toEqual({ token: "file-token", source: "file" });
    expect(
      resolveBridgeToken("", () => {
        throw new Error("no exec");
      }),
    ).toEqual({ token: "", source: "none" });
  });
});
