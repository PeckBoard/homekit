import { describe, it, expect } from "vitest";
import { bridgeNeed, shouldStart, failureReason, outdatedBridge } from "../src/setup";
import { resolveBridgeToken, DEFAULT_BRIDGE_URL } from "../src/config";

describe("bridgeNeed", () => {
  it("installs only when the default loopback bridge doesn't answer", () => {
    expect(bridgeNeed({ reachable: false, token_source: "none" }, DEFAULT_BRIDGE_URL)).toEqual({ kind: "missing", reason: "homekit-bridge isn't running" });
    expect(bridgeNeed({ reachable: false, token_source: "none" }, DEFAULT_BRIDGE_URL + "/")).not.toBeNull();
    expect(bridgeNeed({ reachable: true, version: "0.2.0", token_source: "file" }, DEFAULT_BRIDGE_URL)).toBeNull();
    // Running but refusing the token: reinstalling won't help.
    expect(bridgeNeed({ reachable: false, auth_failed: true, token_source: "setting" }, DEFAULT_BRIDGE_URL)).toBeNull();
    // A bridge the user runs elsewhere is theirs.
    expect(bridgeNeed({ reachable: false, token_source: "setting" }, "http://10.0.0.5:7782")).toBeNull();
  });
});

describe("upgrade need", () => {
  it("upgrades a default-URL bridge older than 0.2.0; reports any outdated bridge", () => {
    const old = { reachable: true, version: "0.1.0", token_source: "file" as const };
    expect(bridgeNeed(old, DEFAULT_BRIDGE_URL)).toMatchObject({ kind: "upgrade", target: "0.2.0" });
    expect(bridgeNeed({ ...old, version: "0.2.0" }, DEFAULT_BRIDGE_URL)).toBeNull();
    expect(bridgeNeed({ ...old, version: undefined }, DEFAULT_BRIDGE_URL)).toMatchObject({ kind: "upgrade" });
    // Not ours to upgrade, but the page still says it's too old.
    expect(bridgeNeed(old, "http://10.0.0.5:7782")).toBeNull();
    expect(outdatedBridge(old)).toEqual({ version: "0.1.0", min: "0.2.0" });
    expect(outdatedBridge({ ...old, version: "0.3.1" })).toBeNull();
    expect(outdatedBridge({ reachable: false, token_source: "none" })).toBeNull();
  });

  it("starts an upgrade at once, but doesn't repeat one that already reached the latest release", () => {
    const need = { kind: "upgrade" as const, reason: "x", target: "0.2.0" };
    const now = 10 * 60 * 60 * 1000;
    // A recent 0.1.0 install (no target) doesn't hold the upgrade back.
    expect(shouldStart({ status: "succeeded", started_at: now - 1000, finished_at: now - 1000 }, need, now, false)).toBe(true);
    expect(shouldStart({ status: "succeeded", started_at: 0, finished_at: 0, target: "0.2.0" }, need, now, false)).toBe(false);
    expect(shouldStart({ status: "succeeded", started_at: 0, finished_at: 0, target: "0.2.0" }, need, now, true)).toBe(true);
    expect(shouldStart({ status: "failed", started_at: now - 1000, finished_at: now - 1000, target: "0.2.0" }, need, now, false)).toBe(false);
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
