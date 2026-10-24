import { describe, it, expect } from "vitest";
import { resolveGroup, resolveScene, roomSetBody, roomSections, cardActions, versionLt, HueGroup, HueScene } from "../src/hue";
import { makeTools } from "../src/tools";
import { Bridge, Transport } from "../src/bridge";
import { lamp } from "./fixtures";
import type { Device } from "../src/hap";

const BID = "ecb5fafffe0a1b2c";
const g = (rid: string, name: string, kind = "room", device_ids: string[] = []): HueGroup => ({ id: `${BID}:${rid}`, bridge_id: BID, kind, name, device_ids, on: true, brightness: 50 });
const LIVING = g("r1", "Living room", "room", [`hue:${BID}:l1`]);
const BED = g("r2", "Bedroom", "room", [`hue:${BID}:l2`]);
const DOWN = g("z1", "Downstairs", "zone", [`hue:${BID}:l1`]);
const GROUPS = [LIVING, BED, DOWN];
const sc = (rid: string, name: string, grp: HueGroup): HueScene => ({ id: `${BID}:${rid}`, bridge_id: BID, name, group_id: grp.id, group_name: grp.name });
const SCENES = [sc("s1", "Relax", LIVING), sc("s2", "Concentrate", LIVING), sc("s3", "Relax", BED)];

const hueLamp = (rid: string, name: string, room: HueGroup | null): Device => ({
  ...JSON.parse(JSON.stringify(lamp)),
  id: `hue:${BID}:${rid}`,
  name,
  accessory_name: name,
  source: "hue",
  room: room?.name ?? null,
  room_id: room?.id ?? null,
});

describe("room / scene resolution", () => {
  it("resolves rooms by id, exact name, or unique substring", () => {
    expect(resolveGroup(GROUPS, `${BID}:r2`)).toBe(BED);
    expect(resolveGroup(GROUPS, "living ROOM")).toBe(LIVING);
    expect(resolveGroup(GROUPS, "down")).toBe(DOWN);
    expect(() => resolveGroup(GROUPS, "Kitchen")).toThrow(/no room "Kitchen" — rooms: Living room, Bedroom, Downstairs/);
    expect(() => resolveGroup([LIVING, { ...LIVING, id: "other:r1", bridge_id: "other" }], "Living room")).toThrow(/matches several rooms.*pass the id/);
    expect(() => resolveGroup([], "x")).toThrow(/link a Hue Bridge/);
  });

  it("asks for the room when a scene name exists in several rooms", () => {
    expect(() => resolveScene(SCENES, "relax")).toThrow(/exists in several rooms: Living room .*Bedroom .*pass `room`/);
    expect(resolveScene(SCENES, "Relax", BED).id).toBe(`${BID}:s3`);
    expect(resolveScene(SCENES, "conc").id).toBe(`${BID}:s2`);
    expect(resolveScene(SCENES, `${BID}:s3`).name).toBe("Relax");
    expect(() => resolveScene(SCENES, "Concentrate", BED)).toThrow(/no scene "Concentrate" — scenes: Relax/);
    expect(() => resolveScene(SCENES, "Relax", DOWN)).toThrow(/Downstairs has no scenes/);
  });

  it("validates room writes", () => {
    expect(roomSetBody({ on: "off" })).toEqual({ on: false });
    expect(roomSetBody({ brightness: "40%" })).toEqual({ brightness: 40 });
    expect(() => roomSetBody({})).toThrow(/pass `on` and\/or `brightness`/);
    expect(() => roomSetBody({ brightness: 140 })).toThrow(/0–100/);
    expect(() => roomSetBody({ on: "maybe" })).toThrow(/true\/false/);
  });
});

describe("Devices tab decisions", () => {
  it("groups by room: rooms, then zones, then Other", () => {
    const secs = roomSections([lamp, hueLamp("l1", "Sofa", LIVING), hueLamp("l2", "Bedside", BED)], GROUPS);
    expect(secs.map((s) => [s.name, s.devices.map((d) => d.name)])).toEqual([
      ["Bedroom", ["Bedside"]],
      ["Living room", ["Sofa"]],
      ["Downstairs", []],
      ["Other", ["Desk lamp"]],
    ]);
    // Without groups (e.g. the call failed), the device's own room still groups it.
    expect(roomSections([hueLamp("l1", "Sofa", LIVING)], []).map((s) => [s.key, s.group])).toEqual([["room:Living room", null]]);
    // Only HomeKit devices: a single Other section.
    expect(roomSections([lamp], []).map((s) => s.key)).toEqual(["other"]);
  });

  it("Hue lights get a source badge and no Unpair", () => {
    expect(cardActions(hueLamp("l1", "Sofa", LIVING))).toEqual({ identify: true, rename: true, unpair: false, badge: "Hue" });
    expect(cardActions({ id: `hue:${BID}:l9` })).toMatchObject({ unpair: false });
    expect(cardActions(lamp)).toEqual({ identify: true, rename: true, unpair: true, badge: null });
  });
});

describe("versionLt", () => {
  it("compares dotted versions; unparseable counts as older", () => {
    expect(versionLt("0.1.0", "0.2.0")).toBe(true);
    expect(versionLt("v0.2.0", "0.2.0")).toBe(false);
    expect(versionLt("0.10.0", "0.2.0")).toBe(false);
    expect(versionLt("", "0.2.0")).toBe(true);
  });
});

/// A fake 0.2.0 bridge (or a 0.1.0 one with `old`) for the Hue tools.
function fake(opts: { old?: boolean; pressed?: boolean } = {}) {
  const calls: Array<{ method: string; path: string; body?: any }> = [];
  const devices = [lamp, hueLamp("l1", "Sofa lamp", LIVING), hueLamp("l2", "Bedside", BED)];
  const ok = (b: unknown, status = 200) => ({ status, body: JSON.stringify(b) });
  const t: Transport = {
    request(req) {
      const path = req.url.replace("http://127.0.0.1:7782", "");
      const body = req.body ? JSON.parse(req.body) : undefined;
      calls.push({ method: req.method, path, body });
      if (path === "/health") return ok({ ok: true, version: opts.old ? "0.1.0" : "0.2.0" });
      if (path === "/devices") return ok({ devices });
      if (path.startsWith("/hue/") && opts.old) return ok({ error: "no route", code: "not_found" }, 404);
      if (path === "/hue/bridges") return ok({ bridges: [{ bridge_id: BID, name: "Hue Bridge", address: "192.168.1.30", linked: false }] });
      if (path === "/hue/link") return opts.pressed ? ok({ bridge_id: BID, name: "Hue Bridge", linked: true, lights: 2 }, 201) : ok({ error: "press the button", code: "link_button_not_pressed" }, 409);
      if (path === "/hue/groups") return ok({ groups: GROUPS });
      if (path.startsWith("/hue/groups/")) return ok({ ...LIVING, ...body });
      if (path.startsWith("/hue/scenes?") || path === "/hue/scenes") return ok({ scenes: SCENES });
      if (path.endsWith("/recall")) return ok({ ok: true });
      if (path.endsWith("/characteristics")) return ok({ device: devices[1] });
      return ok({ error: "not found", code: "not_found" }, 404);
    },
  };
  const tools = makeTools(() => new Bridge(t, { url: "http://127.0.0.1:7782", token: "secret-token-123456", token_source: "file" }));
  return { tools, calls };
}

describe("Hue tools", () => {
  it("homekit_hue_link: a not-pressed button is a clear instruction, not an error", () => {
    const r: any = fake().tools.homekit_hue_link({});
    expect(r).toMatchObject({ ok: false, waiting_for_link_button: true });
    expect(r.message).toMatch(/press the round link button on top of Hue Bridge, then call homekit_hue_link again/);
    const { tools, calls } = fake({ pressed: true });
    expect(tools.homekit_hue_link({ bridge: "hue bridge" })).toMatchObject({ ok: true, linked: true });
    expect(calls.find((c) => c.path === "/hue/link")!.body).toEqual({ bridge_id: BID, address: "192.168.1.30" });
  });

  it("room set, scene recall and homekit_set address Hue by name", () => {
    const { tools, calls } = fake();
    expect(tools.homekit_room_set({ room: "living", on: false })).toMatchObject({ ok: true, room: "Living room", sent: { on: false } });
    expect(calls.find((c) => c.method === "POST" && c.path.startsWith("/hue/groups/"))!.path).toBe(`/hue/groups/${encodeURIComponent(`${BID}:r1`)}`);
    expect(() => tools.homekit_scene_recall({ scene: "Relax" })).toThrow(/several rooms/);
    expect(tools.homekit_scene_recall({ scene: "Relax", room: "Bedroom" })).toEqual({ ok: true, scene: "Relax", room: "Bedroom" });
    expect(calls.some((c) => c.path === `/hue/scenes/${encodeURIComponent(`${BID}:s3`)}/recall`)).toBe(true);
    tools.homekit_set({ device: "Sofa lamp", characteristic: "brightness", value: 30 });
    expect(calls.find((c) => c.path.endsWith("/characteristics"))!.path).toBe(`/devices/${encodeURIComponent(`hue:${BID}:l1`)}/characteristics`);
  });

  it("refuses to unpair a Hue light without calling the bridge", () => {
    const { tools, calls } = fake();
    expect(() => tools.homekit_unpair({ device: "Bedside" })).toThrow(/Philips Hue light.*Unlink the bridge/);
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  it("a pre-0.2.0 bridge's 404 becomes an update instruction", () => {
    expect(() => fake({ old: true }).tools.homekit_rooms({})).toThrow(/homekit-bridge 0\.1\.0 doesn't support Philips Hue — it needs 0\.2\.0/);
  });
});
