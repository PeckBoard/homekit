// Philips Hue model helpers (BRIDGE_API.md "Philips Hue (0.2.0)"): the
// bridge / group / scene shapes, name-or-id resolution of rooms and scenes
// for the tools, and the Devices tab's room grouping. Pure — no host calls,
// imported by ui/ as well.

import type { Device } from "./hap";

export interface HueBridge {
  bridge_id: string;
  name: string;
  model?: string;
  address?: string;
  linked: boolean;
  connected?: boolean;
  lights?: number;
}

export interface HueGroup {
  id: string;
  bridge_id: string;
  kind: "room" | "zone" | string;
  name: string;
  device_ids: string[];
  on: boolean | null;
  brightness: number | null;
}

export interface HueScene {
  id: string;
  bridge_id: string;
  name: string;
  group_id: string;
  group_name?: string;
}

/// The homekit-bridge version that first speaks the Hue endpoints.
export const MIN_HUE_VERSION = "0.2.0";

/// Is version `a` older than `b`? Leading `v` and pre-release suffixes are
/// ignored; an unparseable `a` counts as older (same as print-farm). Pure.
export function versionLt(a: string, b: string): boolean {
  const parse = (s: string) => {
    const m = /(\d+(?:\.\d+)*)/.exec(String(s ?? ""));
    return m ? m[1].split(".").map(Number) : null;
  };
  const pa = parse(a);
  const pb = parse(b) ?? [0];
  if (!pa) return true;
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

export function isHue(d: Pick<Device, "id"> & { source?: string }): boolean {
  return d.source === "hue" || d.id.startsWith("hue:");
}

/// Hue lights are owned by their Hue Bridge: unpairing doesn't apply (the
/// bridge answers 400 — unlink the bridge instead). Pure.
export function canUnpair(d: Pick<Device, "id"> & { source?: string }): boolean {
  return !isHue(d);
}

export const HUE_UNPAIR =
  "is a Philips Hue light, owned by its Hue Bridge — it can't be unpaired on its own. Unlink the bridge on the HomeKit page's Discover tab to remove all of its lights.";

/// What a device card offers. Hue lights have no Unpair (their bridge owns
/// them) and carry a "Hue" source badge. Pure — tested.
export function cardActions(d: Pick<Device, "id"> & { source?: string }): { identify: boolean; rename: boolean; unpair: boolean; badge: string | null } {
  const hue = isHue(d);
  return { identify: true, rename: true, unpair: !hue, badge: hue ? "Hue" : null };
}

/// Find one item by id (exact, case-insensitive) or name (exact, then unique
/// substring). `what` names the kind ("room", "scene"), `label` renders an
/// item in error lists. Throws a message listing the options. Pure.
export function resolveNamed<T extends { id: string; name: string }>(items: T[], ref: unknown, what: string, label: (x: T) => string, hint: string): T {
  const r = String(ref ?? "").trim();
  if (!r) throw new Error(`\`${what}\` is required (a ${what} name or id — ${hint})`);
  const n = r.toLowerCase();
  const byId = items.find((x) => x.id.toLowerCase() === n);
  if (byId) return byId;
  const exact = items.filter((x) => x.name.toLowerCase() === n);
  const pool = exact.length ? exact : items.filter((x) => x.name.toLowerCase().includes(n));
  if (pool.length === 1) return pool[0];
  if (pool.length > 1) throw new Error(`"${r}" matches several ${what}s: ${pool.map(label).join(", ")} — pass the id`);
  const names = Array.from(new Set(items.map((x) => x.name))).join(", ");
  throw new Error(`no ${what} "${r}"${names ? ` — ${what}s: ${names}` : ` — none found (${hint})`}`);
}

export function groupLabel(g: HueGroup): string {
  return `${g.name} (${g.kind}, ${g.id})`;
}

export function resolveGroup(groups: HueGroup[], ref: unknown): HueGroup {
  return resolveNamed(groups, ref, "room", groupLabel, "see homekit_rooms; link a Hue Bridge first with homekit_hue_link");
}

/// Resolve a scene, optionally inside `room` (already resolved). A name
/// that exists in several rooms asks for the room. Pure.
export function resolveScene(scenes: HueScene[], ref: unknown, room?: HueGroup | null): HueScene {
  const pool = room ? scenes.filter((s) => s.group_id === room.id) : scenes;
  const r = String(ref ?? "").trim();
  if (!r) throw new Error("`scene` is required (a scene name or id — see homekit_scenes)");
  const n = r.toLowerCase();
  const exact = pool.filter((s) => s.name.toLowerCase() === n);
  if (!room && exact.length > 1) {
    throw new Error(`scene "${r}" exists in several rooms: ${exact.map((s) => `${s.group_name ?? s.group_id} (${s.id})`).join(", ")} — pass \`room\` (or the scene id)`);
  }
  if (!pool.length && room) throw new Error(`${room.name} has no scenes — create them in the Hue app`);
  return resolveNamed(pool, r, "scene", (s) => `${s.name} in ${s.group_name ?? s.group_id} (${s.id})`, room ? `scenes in ${room.name}` : "see homekit_scenes");
}

/// `{on?, brightness?}` for a room write, validated. Pure.
export function roomSetBody(args: { on?: unknown; brightness?: unknown }): { on?: boolean; brightness?: number } {
  const out: { on?: boolean; brightness?: number } = {};
  if (args.on !== undefined && args.on !== null && args.on !== "") {
    const s = String(args.on).trim().toLowerCase();
    if (args.on === true || ["true", "on", "yes", "1"].includes(s)) out.on = true;
    else if (args.on === false || ["false", "off", "no", "0"].includes(s)) out.on = false;
    else throw new Error(`\`on\` takes true/false (or on/off), got ${JSON.stringify(args.on)}`);
  }
  if (args.brightness !== undefined && args.brightness !== null && args.brightness !== "") {
    const b = typeof args.brightness === "number" ? args.brightness : Number(String(args.brightness).trim().replace(/%$/, ""));
    if (!isFinite(b)) throw new Error(`\`brightness\` takes a number from 0 to 100, got ${JSON.stringify(args.brightness)}`);
    if (b < 0 || b > 100) throw new Error(`\`brightness\` must be 0–100, got ${b}`);
    out.brightness = Math.round(b);
  }
  if (out.on === undefined && out.brightness === undefined) throw new Error("pass `on` and/or `brightness` (0–100)");
  return out;
}

// ── Devices tab grouping ────────────────────────────────────────────────────

export interface RoomSection {
  /// Stable key: the group id, `room:<name>` without a group, or `other`.
  key: string;
  name: string;
  group: HueGroup | null;
  devices: Device[];
}

/// Group devices into sections: one per Hue room (in name order, from
/// `groups` when known, else from the device's own `room`), then zones (no
/// cards of their own — their lights already sit in a room), then "Other"
/// for HomeKit / room-less devices. Pure.
export function roomSections(devices: Device[], groups: HueGroup[]): RoomSection[] {
  const byKey = new Map<string, RoomSection>();
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const other: RoomSection = { key: "other", name: "Other", group: null, devices: [] };
  for (const d of devices) {
    const rid = d.room_id ?? null;
    const g = rid ? groupById.get(rid) ?? null : null;
    if (!g && !d.room) {
      other.devices.push(d);
      continue;
    }
    const key = g ? g.id : `room:${d.room}`;
    let s = byKey.get(key);
    if (!s) byKey.set(key, (s = { key, name: g?.name ?? d.room ?? "Room", group: g, devices: [] }));
    s.devices.push(d);
  }
  for (const g of groups) {
    if (g.kind === "room" && !byKey.has(g.id) && g.device_ids.length) byKey.set(g.id, { key: g.id, name: g.name, group: g, devices: [] });
  }
  const byName = (a: RoomSection, b: RoomSection) => a.name.localeCompare(b.name);
  const rooms = Array.from(byKey.values()).sort(byName);
  const zones = groups
    .filter((g) => g.kind !== "room")
    .map((g) => ({ key: g.id, name: g.name, group: g, devices: [] as Device[] }))
    .sort(byName);
  const out = [...rooms, ...zones];
  if (other.devices.length) out.push(other);
  return out;
}
