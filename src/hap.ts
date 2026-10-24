// HAP model helpers shared by the MCP tools, the UI API, and the page: the
// bridge's Device shape (BRIDGE_API.md), friendly-name resolution of
// device → service → characteristic, value coercion against a
// characteristic's format/range/valid values, enum labels, and setup-code
// validation. Pure — no host calls, imported by ui/ as well.

export interface Characteristic {
  iid: number;
  type: string;
  type_uuid?: string;
  description?: string;
  format: string;
  unit?: string | null;
  perms: string[];
  min?: number | null;
  max?: number | null;
  step?: number | null;
  valid_values?: number[] | null;
  value?: unknown;
}

export interface Service {
  iid: number;
  type: string;
  type_uuid?: string;
  name?: string;
  primary?: boolean;
  characteristics: Characteristic[];
}

export interface Accessory {
  aid: number;
  name?: string;
  services: Service[];
}

export interface Device {
  id: string;
  name: string;
  accessory_name?: string;
  model?: string;
  manufacturer?: string;
  firmware?: string;
  category?: number;
  category_name?: string;
  address?: string;
  port?: number;
  connected: boolean;
  last_seen?: string;
  accessories: Accessory[];
  /// "homekit" (paired here) or "hue" (a light of a linked Hue Bridge; 0.2.0).
  source?: "homekit" | "hue";
  /// Hue room name / "<bridge_id>:<room_rid>"; null for HomeKit devices.
  room?: string | null;
  room_id?: string | null;
}

export interface Discovered {
  id: string;
  name: string;
  model?: string;
  category?: number;
  category_name?: string;
  address?: string;
  port?: number;
  paired_with_us: boolean;
  available_for_pairing: boolean;
}

/// Services the UI and tools never show (metadata, not controls).
export const HIDDEN_SERVICES = new Set(["accessory-information", "protocol-information"]);
/// Characteristics that aren't state: names, the identify trigger, opaque blobs.
const HIDDEN_CHARS = new Set(["name", "identify", "version", "configured-name", "service-label-index"]);

export const OWNED_ELSEWHERE =
  "This accessory is still paired with another controller (e.g. Apple Home). Remove it from Apple Home (or factory reset it) first, then pair it here.";

// ── setup code ──────────────────────────────────────────────────────────────

/// "XXX-XX-XXX" for a valid code (8 digits, dashes/spaces optional), else null.
export function normalizeSetupCode(raw: string): string | null {
  const s = String(raw ?? "").trim();
  if (!/^\d{3}[- ]?\d{2}[- ]?\d{3}$/.test(s)) return null;
  const d = s.replace(/\D/g, "");
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
}

/// Inline field-error text for a setup code, or null when valid.
export function setupCodeError(raw: string): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return "Enter the 8-digit setup code from the accessory's label or manual.";
  if (normalizeSetupCode(s)) return null;
  return "The setup code is 8 digits, written XXX-XX-XXX (e.g. 123-45-678).";
}

// ── enums ───────────────────────────────────────────────────────────────────

/// Labels for the HAP enum characteristics (value → label); the first alias
/// list per value is what tools accept besides the number.
export const ENUMS: Record<string, Record<number, string>> = {
  "target-heating-cooling-state": { 0: "Off", 1: "Heat", 2: "Cool", 3: "Auto" },
  "current-heating-cooling-state": { 0: "Off", 1: "Heating", 2: "Cooling" },
  "target-heater-cooler-state": { 0: "Auto", 1: "Heat", 2: "Cool" },
  "current-heater-cooler-state": { 0: "Inactive", 1: "Idle", 2: "Heating", 3: "Cooling" },
  "lock-target-state": { 0: "Unlocked", 1: "Locked" },
  "lock-current-state": { 0: "Unlocked", 1: "Locked", 2: "Jammed", 3: "Unknown" },
  "target-door-state": { 0: "Open", 1: "Closed" },
  "current-door-state": { 0: "Open", 1: "Closed", 2: "Opening", 3: "Closing", 4: "Stopped" },
  "position-state": { 0: "Closing", 1: "Opening", 2: "Stopped" },
  "temperature-display-units": { 0: "Celsius", 1: "Fahrenheit" },
  "contact-sensor-state": { 0: "Closed", 1: "Open" },
  "occupancy-detected": { 0: "Not occupied", 1: "Occupied" },
  "leak-detected": { 0: "No leak", 1: "Leak detected" },
  "smoke-detected": { 0: "No smoke", 1: "Smoke detected" },
  "carbon-monoxide-detected": { 0: "Normal", 1: "CO detected" },
  "carbon-dioxide-detected": { 0: "Normal", 1: "CO₂ high" },
  "status-low-battery": { 0: "Normal", 1: "Low" },
  "charging-state": { 0: "Not charging", 1: "Charging", 2: "Not chargeable" },
  "air-quality": { 0: "Unknown", 1: "Excellent", 2: "Good", 3: "Fair", 4: "Inferior", 5: "Poor" },
  active: { 0: "Inactive", 1: "Active" },
  "in-use": { 0: "Not in use", 1: "In use" },
  "target-fan-state": { 0: "Manual", 1: "Auto" },
  "current-fan-state": { 0: "Inactive", 1: "Idle", 2: "Blowing" },
  "rotation-direction": { 0: "Clockwise", 1: "Counter-clockwise" },
  "swing-mode": { 0: "Off", 1: "On" },
  "lock-physical-controls": { 0: "Unlocked", 1: "Locked" },
  "security-system-target-state": { 0: "Stay", 1: "Away", 2: "Night", 3: "Disarmed" },
  "security-system-current-state": { 0: "Stay", 1: "Away", 2: "Night", 3: "Disarmed", 4: "Triggered" },
  "status-fault": { 0: "No fault", 1: "Fault" },
  "status-tampered": { 0: "Not tampered", 1: "Tampered" },
  "status-active": { 0: "Inactive", 1: "Active" },
};

/// Extra words tools accept for enum values (beyond the label itself).
const ENUM_ALIASES: Record<string, Record<string, number>> = {
  "lock-target-state": { lock: 1, secured: 1, secure: 1, unlock: 0, unsecured: 0 },
  "target-door-state": { close: 1, opened: 0 },
  active: { on: 1, off: 0 },
  "swing-mode": { enabled: 1, disabled: 0 },
  "target-heating-cooling-state": { heating: 1, cooling: 2, automatic: 3 },
  "target-heater-cooler-state": { heating: 1, cooling: 2, automatic: 0 },
  "security-system-target-state": { home: 0, disarm: 3, off: 3 },
};

export function isEnum(c: Characteristic): boolean {
  return !!ENUMS[c.type] || (Array.isArray(c.valid_values) && c.valid_values.length > 0);
}

/// The selectable values of an enum characteristic (restricted to the
/// accessory's valid_values when it lists them).
export function enumOptions(c: Characteristic): Array<{ value: number; label: string }> {
  const labels = ENUMS[c.type] ?? {};
  let values: number[];
  if (Array.isArray(c.valid_values) && c.valid_values.length) values = c.valid_values.slice();
  else if (ENUMS[c.type]) values = Object.keys(labels).map(Number);
  else values = [];
  if (typeof c.min === "number") values = values.filter((v) => v >= (c.min as number));
  if (typeof c.max === "number") values = values.filter((v) => v <= (c.max as number));
  return values.map((v) => ({ value: v, label: labels[v] ?? String(v) }));
}

// ── names ───────────────────────────────────────────────────────────────────

/// Lowercase, collapse spaces/underscores/dashes to "-": "Color Temperature",
/// "color_temperature" and "color-temperature" all compare equal.
export function norm(s: unknown): string {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_\-]+/g, "-");
}

/// Shorthands agents reach for → candidate characteristic types (in order of
/// preference). Exact type names always work too.
const CHAR_ALIASES: Record<string, string[]> = {
  power: ["on", "active"],
  state: ["on", "active"],
  "on-off": ["on", "active"],
  dim: ["brightness"],
  level: ["brightness"],
  color: ["hue"],
  "colour-temperature": ["color-temperature"],
  ct: ["color-temperature"],
  mireds: ["color-temperature"],
  temperature: ["target-temperature", "current-temperature"],
  "set-point": ["target-temperature"],
  setpoint: ["target-temperature"],
  mode: ["target-heating-cooling-state", "target-heater-cooler-state", "target-fan-state", "security-system-target-state"],
  lock: ["lock-target-state"],
  door: ["target-door-state"],
  position: ["target-position"],
  speed: ["rotation-speed"],
  "fan-speed": ["rotation-speed"],
  humidity: ["target-relative-humidity", "current-relative-humidity"],
  battery: ["battery-level"],
  motion: ["motion-detected"],
  contact: ["contact-sensor-state"],
};

export function serviceLabel(svc: Service, acc?: Accessory): string {
  return svc.name || acc?.name || svc.type;
}

export interface Target {
  aid: number;
  accessory: Accessory;
  service: Service;
  characteristic: Characteristic;
}

/// Every visible (service, characteristic) pair of a device.
export function visibleTargets(d: Device): Target[] {
  const out: Target[] = [];
  for (const acc of d.accessories ?? []) {
    for (const service of acc.services ?? []) {
      if (HIDDEN_SERVICES.has(service.type)) continue;
      for (const characteristic of service.characteristics ?? []) {
        out.push({ aid: acc.aid, accessory: acc, service, characteristic });
      }
    }
  }
  return out;
}

export function describeTarget(t: Target): string {
  return `${serviceLabel(t.service, t.accessory)} (${t.service.type}) → ${t.characteristic.type} [${t.aid}.${t.characteristic.iid}]`;
}

/// Resolve a device by id (colons optional, case-insensitive) or by name
/// (exact, then unique substring). Throws a message listing what exists.
export function resolveDevice(devices: Device[], ref: unknown): Device {
  const r = String(ref ?? "").trim();
  if (!r) throw new Error("`device` is required (a device name or id — see homekit_list)");
  const bare = (s: string) => s.replace(/:/g, "").toLowerCase();
  const byId = devices.find((d) => bare(d.id) === bare(r));
  if (byId) return byId;
  const n = r.toLowerCase();
  const exact = devices.filter((d) => d.name.toLowerCase() === n || (d.accessory_name ?? "").toLowerCase() === n);
  if (exact.length === 1) return exact[0];
  const pool = exact.length ? exact : devices.filter((d) => d.name.toLowerCase().includes(n) || (d.accessory_name ?? "").toLowerCase().includes(n));
  if (pool.length === 1) return pool[0];
  if (pool.length > 1) {
    throw new Error(`"${r}" matches several devices: ${pool.map((d) => `${d.name} (${d.id})`).join(", ")} — use the id`);
  }
  const names = devices.map((d) => d.name).join(", ");
  throw new Error(
    `no paired device "${r}"${names ? ` — paired devices: ${names}` : " — nothing is paired yet (homekit_discover, then homekit_pair; or link a Hue Bridge with homekit_hue_link)"}`,
  );
}

/// Does `svcRef` name this service? Its label, its type, or (for a bridged
/// accessory) the accessory's name; also "aid" / "aid.iid" numerically.
function serviceMatches(t: Target, svcRef: string): boolean {
  const n = norm(svcRef);
  if (n === norm(t.service.name) || n === norm(t.service.type) || n === norm(t.accessory.name)) return true;
  if (/^\d+$/.test(svcRef)) return Number(svcRef) === t.aid;
  if (/^\d+\.\d+$/.test(svcRef)) return svcRef === `${t.aid}.${t.service.iid}`;
  return false;
}

/// Find the one characteristic `characteristic` (friendly type, description,
/// alias, or "aid.iid") of `d`, optionally inside service `service`. When
/// writing, read-only matches are dropped. Ambiguity throws, listing the
/// options; a lone primary-service match wins over secondary ones.
export function resolveTarget(d: Device, ref: { service?: unknown; characteristic: unknown }, forWrite: boolean): Target {
  const cRef = String(ref.characteristic ?? "").trim();
  if (!cRef) throw new Error("`characteristic` is required (e.g. on, brightness, target-temperature)");
  let all = visibleTargets(d);
  const sRef = String(ref.service ?? "").trim();
  if (sRef) {
    all = all.filter((t) => serviceMatches(t, sRef));
    if (!all.length) {
      const svcs = uniq(visibleTargets(d).map((t) => `${serviceLabel(t.service, t.accessory)} (${t.service.type})`));
      throw new Error(`${d.name} has no service "${sRef}" — services: ${svcs.join(", ")}`);
    }
  }
  if (/^\d+\.\d+$/.test(cRef)) {
    const [aid, iid] = cRef.split(".").map(Number);
    const hit = all.find((t) => t.aid === aid && t.characteristic.iid === iid);
    if (!hit) throw new Error(`${d.name} has no characteristic ${cRef}`);
    return checkPerm(hit, forWrite);
  }
  const n = norm(cRef);
  const direct = all.filter((t) => norm(t.characteristic.type) === n || norm(t.characteristic.description) === n);
  let matches = direct;
  if (!matches.length && CHAR_ALIASES[n]) {
    // First alias candidate that exists (respecting writability) wins.
    for (const type of CHAR_ALIASES[n]) {
      const m = all.filter((t) => t.characteristic.type === type && (!forWrite || writable(t.characteristic)));
      if (m.length) {
        matches = m;
        break;
      }
    }
  }
  if (!matches.length) {
    const have = uniq(all.filter((t) => !HIDDEN_CHARS.has(t.characteristic.type) && (!forWrite || writable(t.characteristic))).map((t) => t.characteristic.type));
    throw new Error(`${d.name}${sRef ? ` / ${sRef}` : ""} has no ${forWrite ? "writable " : ""}characteristic "${cRef}" — available: ${have.join(", ") || "none"}`);
  }
  if (forWrite && matches.length > 1) {
    const w = matches.filter((t) => writable(t.characteristic));
    if (w.length) matches = w;
  }
  if (matches.length > 1) {
    const primary = matches.filter((t) => t.service.primary);
    if (primary.length === 1) matches = primary;
  }
  if (matches.length > 1) {
    throw new Error(`"${cRef}" is ambiguous on ${d.name}; pass \`service\` (name or type) to pick one of: ${matches.map(describeTarget).join("; ")}`);
  }
  return checkPerm(matches[0], forWrite);
}

function checkPerm(t: Target, forWrite: boolean): Target {
  if (forWrite && !writable(t.characteristic)) {
    throw new Error(`${t.characteristic.type} on ${serviceLabel(t.service, t.accessory)} is read-only`);
  }
  return t;
}

function uniq(xs: string[]): string[] {
  return Array.from(new Set(xs));
}

export function writable(c: Characteristic): boolean {
  return (c.perms ?? []).includes("pw");
}
export function readable(c: Characteristic): boolean {
  return (c.perms ?? []).includes("pr");
}

// ── value coercion ──────────────────────────────────────────────────────────

const INT_RANGE: Record<string, [number, number]> = {
  uint8: [0, 255],
  uint16: [0, 65535],
  uint32: [0, 4294967295],
  uint64: [0, Number.MAX_SAFE_INTEGER],
  int: [-2147483648, 2147483647],
};

function parseBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (v === 1 || v === 0) return v === 1;
  const s = String(v ?? "").trim().toLowerCase();
  if (["true", "on", "yes", "1", "enable", "enabled"].includes(s)) return true;
  if (["false", "off", "no", "0", "disable", "disabled"].includes(s)) return false;
  return null;
}

function parseEnumWord(c: Characteristic, v: unknown): number | null {
  if (typeof v !== "string") return null;
  const n = norm(v);
  // All known labels, not just valid_values: "cool" on a heat-only
  // thermostat should fail as "doesn't accept 2", not "not a number".
  for (const [v, label] of Object.entries(ENUMS[c.type] ?? {})) if (norm(label) === n) return Number(v);
  const alias = ENUM_ALIASES[c.type]?.[n];
  return alias === undefined ? null : alias;
}

/// Coerce a tool/UI value to what the characteristic takes, validating
/// format, range, step and valid values. Floats snap to `step`. Throws a
/// message the agent can act on.
export function coerceValue(c: Characteristic, raw: unknown): boolean | number | string {
  const what = c.type;
  if (raw === undefined || raw === null || raw === "") throw new Error(`a value is required for ${what}`);
  switch (c.format) {
    case "bool": {
      const b = parseBool(raw);
      if (b === null) throw new Error(`${what} takes true/false (or on/off), got ${JSON.stringify(raw)}`);
      return b;
    }
    case "string":
      return String(raw);
    case "tlv8":
    case "data":
      throw new Error(`${what} is a ${c.format} characteristic; setting it isn't supported`);
  }
  const intFmt = c.format in INT_RANGE;
  let num: number | null = null;
  if (intFmt) num = parseEnumWord(c, raw);
  if (num === null) {
    if (typeof raw === "boolean" && intFmt) num = raw ? 1 : 0;
    else if (typeof raw === "number") num = raw;
    else if (typeof raw === "string" && raw.trim() !== "" && isFinite(Number(raw.trim().replace(/%$/, "")))) num = Number(raw.trim().replace(/%$/, ""));
  }
  if (num === null || !isFinite(num)) {
    const opts = isEnum(c) ? ` — one of ${enumOptions(c).map((o) => `${o.value} (${o.label})`).join(", ")}` : "";
    throw new Error(`${what} takes a number, got ${JSON.stringify(raw)}${opts}`);
  }
  if (intFmt) {
    if (!Number.isInteger(num)) {
      if (typeof c.step === "number" && c.step >= 1) num = Math.round(num);
      else throw new Error(`${what} takes a whole number, got ${num}`);
    }
    const [lo, hi] = INT_RANGE[c.format];
    if (num < lo || num > hi) throw new Error(`${what} is out of range for ${c.format}: ${num}`);
  } else if (typeof c.step === "number" && c.step > 0) {
    const base = typeof c.min === "number" ? c.min : 0;
    num = Number((base + Math.round((num - base) / c.step) * c.step).toFixed(6));
  }
  if (Array.isArray(c.valid_values) && c.valid_values.length && !c.valid_values.includes(num)) {
    throw new Error(`${what} doesn't accept ${num} — valid: ${enumOptions(c).map((o) => `${o.value} (${o.label})`).join(", ")}`);
  }
  if (typeof c.min === "number" && num < c.min) throw new Error(`${what} must be at least ${c.min}${unitSuffix(c)}, got ${num}`);
  if (typeof c.max === "number" && num > c.max) throw new Error(`${what} must be at most ${c.max}${unitSuffix(c)}, got ${num}`);
  return num;
}

// ── display ─────────────────────────────────────────────────────────────────

function unitSuffix(c: Characteristic): string {
  switch (c.unit) {
    case "celsius":
      return " °C";
    case "percentage":
      return " %";
    case "arcdegrees":
      return "°";
    case "lux":
      return " lx";
    case "seconds":
      return " s";
    default:
      return "";
  }
}

/// Human text for a characteristic's current value.
export function formatValue(c: Characteristic, v: unknown = c.value): string {
  if (v === undefined || v === null) return "—";
  if (typeof v === "number" && ENUMS[c.type]?.[v] !== undefined) return ENUMS[c.type][v];
  if (typeof v === "boolean") {
    if (c.type === "on") return v ? "On" : "Off";
    return v ? "Yes" : "No";
  }
  if (typeof v === "number") {
    const r = Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10);
    return r + unitSuffix(c);
  }
  return String(v);
}

/// Value for an agent: the enum label when there is one, else the raw value.
export function agentValue(c: Characteristic): unknown {
  const v = c.value;
  if (typeof v === "number" && ENUMS[c.type]?.[v] !== undefined) return ENUMS[c.type][v].toLowerCase();
  return v;
}

/// How the page renders a characteristic.
export type ControlKind = "toggle" | "slider" | "select" | "number" | "text" | "readonly" | "hidden";

export function controlKind(c: Characteristic): ControlKind {
  if (HIDDEN_CHARS.has(c.type) || c.type === "custom" || c.format === "tlv8" || c.format === "data") return "hidden";
  if (!writable(c)) return readable(c) ? "readonly" : "hidden";
  if (c.format === "bool") return "toggle";
  if (c.format === "string") return "text";
  if (isEnum(c) && c.format in INT_RANGE) return "select";
  if (typeof c.min === "number" && typeof c.max === "number") return "slider";
  return "number";
}

/// Compact per-device state for homekit_list: friendly-named values per
/// visible service (custom/hidden characteristics left out).
export function compactDevice(d: Device): unknown {
  const services: Array<{ service: string; type: string; aid: number; values: Record<string, unknown> }> = [];
  for (const acc of d.accessories ?? []) {
    for (const svc of acc.services ?? []) {
      if (HIDDEN_SERVICES.has(svc.type)) continue;
      const values: Record<string, unknown> = {};
      for (const c of svc.characteristics ?? []) {
        if (controlKind(c) === "hidden" || c.value === undefined) continue;
        values[c.type] = agentValue(c);
      }
      if (Object.keys(values).length) services.push({ service: serviceLabel(svc, acc), type: svc.type, aid: acc.aid, values });
    }
  }
  const out: Record<string, unknown> = { id: d.id, name: d.name, model: d.model, category: d.category_name, connected: d.connected, services };
  if (d.source) out.source = d.source;
  if (d.room) out.room = d.room;
  return out;
}

/// Full detail for homekit_get: every visible characteristic with metadata.
export function fullDevice(d: Device): unknown {
  return {
    id: d.id,
    name: d.name,
    source: d.source,
    room: d.room ?? undefined,
    accessory_name: d.accessory_name,
    manufacturer: d.manufacturer,
    model: d.model,
    firmware: d.firmware,
    category: d.category_name,
    address: d.address,
    port: d.port,
    connected: d.connected,
    last_seen: d.last_seen,
    accessories: (d.accessories ?? []).map((acc) => ({
      aid: acc.aid,
      name: acc.name,
      services: (acc.services ?? [])
        .filter((s) => !HIDDEN_SERVICES.has(s.type))
        .map((s) => ({
          name: serviceLabel(s, acc),
          type: s.type,
          iid: s.iid,
          primary: !!s.primary,
          characteristics: (s.characteristics ?? [])
            .filter((c) => controlKind(c) !== "hidden")
            .map((c) => {
              const o: Record<string, unknown> = { type: c.type, iid: c.iid, value: c.value, writable: writable(c), format: c.format };
              if (c.unit) o.unit = c.unit;
              if (typeof c.min === "number") o.min = c.min;
              if (typeof c.max === "number") o.max = c.max;
              if (typeof c.step === "number") o.step = c.step;
              if (isEnum(c)) o.options = enumOptions(c);
              return o;
            }),
        })),
    })),
  };
}

/// Discovery entry for agents/UI, with the ownership verdict spelled out.
export function discoveredView(a: Discovered): Discovered & { status: "paired" | "available" | "owned_elsewhere"; note?: string } {
  if (a.paired_with_us) return { ...a, status: "paired" };
  if (a.available_for_pairing) return { ...a, status: "available" };
  return { ...a, status: "owned_elsewhere", note: OWNED_ELSEWHERE };
}
