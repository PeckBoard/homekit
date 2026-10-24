// Devices tab: one card per device, polled every few seconds, grouped by
// room (Hue rooms first, then zones, then "Other" for HomeKit / room-less
// devices). A Hue room or zone header carries a power toggle, a brightness
// slider and scene chips. Each card has a control per characteristic chosen
// from its format/perms (toggle, slider, select, number, text, or a
// read-only value). Controls are disabled — with the reason stated — while
// the device or the bridge is offline. A card or room header isn't
// re-rendered while the user is dragging / typing in it.

import { h, icon, btn, toast, errText, openModal, confirmDialog, field, select } from "./dom";
import { get, put, post, del, ApiError } from "./api";
import { setupState, SETUP_CHANGED } from "./setup";
import { roomSections, cardActions, isHue, type RoomSection, type HueGroup, type HueScene } from "../src/hue";
import {
  Device,
  Characteristic,
  Service,
  Accessory,
  HIDDEN_SERVICES,
  controlKind,
  enumOptions,
  formatValue,
  serviceLabel,
} from "../src/hap";

const POLL_MS = 3000;

const CATEGORY_ICON: Record<string, string> = {
  lightbulb: "bulb",
  outlet: "plug",
  switch: "power",
  "programmable-switch": "power",
  thermostat: "thermo",
  "air-heater": "thermo",
  "air-conditioner": "thermo",
  "door-lock": "lock",
  lock: "lock",
  "window-covering": "blinds",
  window: "blinds",
  "garage-door-opener": "garage",
  garage: "garage",
  fan: "fan",
  "air-purifier": "fan",
  sensor: "sensor",
  bridge: "bridge",
};

/// Characteristics shown first in a service (the "main" control).
const LEAD = ["on", "active", "target-heating-cooling-state", "lock-target-state", "target-door-state", "target-position", "brightness"];

const LABEL: Record<string, string> = {
  on: "Power",
  active: "Active",
  brightness: "Brightness",
  hue: "Hue",
  saturation: "Saturation",
  "color-temperature": "Color temp",
  "current-temperature": "Temperature",
  "target-temperature": "Target temp",
  "current-heating-cooling-state": "Currently",
  "target-heating-cooling-state": "Mode",
  "target-heater-cooler-state": "Mode",
  "current-heater-cooler-state": "Currently",
  "lock-current-state": "Lock state",
  "lock-target-state": "Lock",
  "current-position": "Position",
  "target-position": "Set position",
  "current-door-state": "Door",
  "target-door-state": "Door control",
  "rotation-speed": "Fan speed",
  "current-relative-humidity": "Humidity",
  "target-relative-humidity": "Target humidity",
  "battery-level": "Battery",
  "status-low-battery": "Battery status",
  "charging-state": "Charging",
  "motion-detected": "Motion",
  "contact-sensor-state": "Contact",
  "temperature-display-units": "Units",
  "obstruction-detected": "Obstruction",
  "current-ambient-light-level": "Light level",
  "outlet-in-use": "In use",
};

function charLabel(c: Characteristic): string {
  if (LABEL[c.type]) return LABEL[c.type];
  const t = c.description || c.type.replace(/-/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function sortChars(cs: Characteristic[]): Characteristic[] {
  const rank = (c: Characteristic) => {
    const i = LEAD.indexOf(c.type);
    return i < 0 ? LEAD.length : i;
  };
  return cs.slice().sort((a, b) => rank(a) - rank(b));
}

type Write = (aid: number, c: Characteristic, value: unknown) => Promise<void>;

/// One characteristic row. `why` non-null = disabled with that reason.
function control(aid: number, c: Characteristic, why: string | null, write: Write, interacting: (on: boolean) => void): HTMLElement | null {
  const kind = controlKind(c);
  if (kind === "hidden") return null;
  const label = h("span", { class: "k", text: charLabel(c), title: c.type });
  const v = h("span", { class: "v" });
  const row = h("div", { class: "ctl" + (kind === "readonly" ? " ro" : "") }, label, v);
  const disabled = !!why;
  const title = why || undefined;
  switch (kind) {
    case "readonly":
      v.textContent = formatValue(c);
      break;
    case "toggle": {
      const on = c.value === true || c.value === 1;
      const sw = h("button", { type: "button", class: "switch", role: "switch", "aria-checked": on ? "true" : "false", "aria-label": charLabel(c), disabled, title });
      sw.addEventListener("click", () => {
        const next = sw.getAttribute("aria-checked") !== "true";
        sw.setAttribute("aria-checked", next ? "true" : "false");
        write(aid, c, next).catch(() => sw.setAttribute("aria-checked", next ? "false" : "true"));
      });
      v.append(sw, h("span", { class: "muted", text: on ? "On" : "Off" }));
      break;
    }
    case "select": {
      const opts = enumOptions(c).map((o) => ({ value: String(o.value), label: o.label }));
      const cur = typeof c.value === "number" ? String(c.value) : "";
      if (!opts.some((o) => o.value === cur)) opts.unshift({ value: cur, label: cur ? formatValue(c) : "—" });
      const s = select(opts, cur, (val) => write(aid, c, Number(val)).catch(() => (s.value = cur)));
      s.disabled = disabled;
      if (title) s.title = title;
      s.setAttribute("aria-label", charLabel(c));
      v.append(s);
      break;
    }
    case "slider": {
      const min = c.min as number;
      const max = c.max as number;
      const step = typeof c.step === "number" && c.step > 0 ? c.step : c.format === "float" ? (max - min) / 100 : 1;
      const cur = typeof c.value === "number" ? c.value : min;
      const r = h("input", { type: "range", min: String(min), max: String(max), step: String(step), value: String(cur), disabled, title, "aria-label": charLabel(c) }) as HTMLInputElement;
      if (c.type === "hue") r.classList.add("hue");
      const num = h("span", { class: "num" });
      const show = (x: number) => {
        // Color temperature is in mireds on the wire; people think in kelvin.
        num.textContent = c.type === "color-temperature" && x > 0 ? `${Math.round(1e6 / x / 50) * 50} K` : formatValue(c, x);
      };
      show(cur);
      r.addEventListener("pointerdown", () => interacting(true));
      r.addEventListener("pointercancel", () => interacting(false));
      r.addEventListener("blur", () => interacting(false));
      r.addEventListener("input", () => show(Number(r.value)));
      r.addEventListener("change", () => {
        interacting(false);
        write(aid, c, Number(r.value)).catch(() => {
          r.value = String(cur);
          show(cur);
        });
      });
      v.append(r, num);
      break;
    }
    case "number":
    case "text": {
      const inp = h("input", {
        type: kind === "number" ? "number" : "text",
        value: c.value === undefined || c.value === null ? "" : String(c.value),
        disabled,
        title,
        "aria-label": charLabel(c),
      }) as HTMLInputElement;
      inp.addEventListener("focus", () => interacting(true));
      inp.addEventListener("blur", () => interacting(false));
      inp.addEventListener("change", () => write(aid, c, kind === "number" ? Number(inp.value) : inp.value).catch(() => undefined));
      v.append(inp);
      break;
    }
  }
  return row;
}

function serviceBlock(acc: Accessory, svc: Service, multi: boolean, why: string | null, write: Write, interacting: (on: boolean) => void): HTMLElement | null {
  const rows = sortChars(svc.characteristics ?? [])
    .map((c) => control(acc.aid, c, why, write, interacting))
    .filter((x): x is HTMLElement => !!x);
  if (!rows.length) return null;
  const name = multi && acc.name && svc.name !== acc.name ? `${acc.name} · ${serviceLabel(svc, acc)}` : serviceLabel(svc, acc);
  return h("div", { class: "svc" }, h("div", { class: "svc-head" }, h("span", { class: "grow", text: name }), h("span", { class: "badge", text: svc.type })), ...rows);
}

export interface DevicesView {
  el: HTMLElement;
  show(): void;
  hide(): void;
  /// Reload now if visible (e.g. a Hue Bridge was linked or unlinked).
  reload(): void;
  onSummary(cb: (devices: Device[] | null) => void): void;
}

/// Hue scenes are re-read every this many polls (and whenever rooms change).
const SCENES_EVERY = 10;

function isOn(d: Device): boolean {
  for (const acc of d.accessories ?? []) {
    for (const svc of acc.services ?? []) {
      if (HIDDEN_SERVICES.has(svc.type)) continue;
      const c = (svc.characteristics ?? []).find((x) => x.type === "on" || x.type === "active");
      if (c && (c.value === true || c.value === 1)) return true;
    }
  }
  return false;
}

export function devicesView(goDiscover: () => void): DevicesView {
  const banner = h("div");
  const list = h("div", { class: "rooms" }, h("div", { class: "cards" }, h("div", { class: "skel" }), h("div", { class: "skel" })));
  const refreshBtn = btn("Refresh", { cls: "sm", icon: "refresh", onClick: () => load(true) });
  const el = h(
    "div",
    null,
    h("div", { class: "section-head" }, h("h2", { text: "Devices" }), h("span", { class: "grow" }), refreshBtn, btn("Add devices", { cls: "sm primary", icon: "plus", onClick: goDiscover })),
    banner,
    list,
  );
  let timer = 0;
  let visible = false;
  let devices: Device[] | null = null;
  let bridgeError: string | null = null;
  let groups: HueGroup[] = [];
  let scenes: HueScene[] = [];
  let sceneKey = "";
  let polls = 0;
  /// The bridge has no Hue routes (older than 0.2.0): stop asking until setup changes.
  let hueUnsupported = false;
  let summaryCb: (d: Device[] | null) => void = () => undefined;
  const cards = new Map<string, { el: HTMLElement; sig: string; busy: boolean }>();
  const sections = new Map<string, { el: HTMLElement; head: HTMLElement; grid: HTMLElement; sig: string; busy: boolean }>();
  window.addEventListener(SETUP_CHANGED, () => {
    if (setupState.current?.health.reachable && !setupState.current.outdated) hueUnsupported = false;
  });

  function reasonFor(d: Device): string | null {
    if (bridgeError) return "Controls are disabled: homekit-bridge isn't reachable.";
    if (!d.connected) return `Controls are disabled: ${d.name} is offline (${isHue(d) ? "its Hue Bridge can't reach it" : "not reachable on the network"}).`;
    return null;
  }

  async function write(d: Device, aid: number, c: Characteristic, value: unknown): Promise<void> {
    try {
      const r = await post<{ device: Device }>(`devices/${encodeURIComponent(d.id)}/characteristics`, { set: [{ aid, iid: c.iid, value }] });
      if (r.device) upsert(r.device, true);
    } catch (e) {
      toast(`Couldn't set ${charLabel(c).toLowerCase()} on ${d.name}: ${errText(e)}`, "bad");
      throw e;
    }
  }

  function card(d: Device): HTMLElement {
    const why = reasonFor(d);
    const acts = cardActions(d);
    const entry = cards.get(d.id);
    const interacting = (on: boolean) => {
      const e = cards.get(d.id);
      if (e) e.busy = on;
    };
    const accs = d.accessories ?? [];
    const multi = accs.length > 1;
    const blocks: HTMLElement[] = [];
    for (const acc of accs) {
      for (const svc of acc.services ?? []) {
        if (HIDDEN_SERVICES.has(svc.type)) continue;
        const b = serviceBlock(acc, svc, multi, why, (aid, c, v) => write(d, aid, c, v), interacting);
        if (b) blocks.push(b);
      }
    }
    const status = bridgeError
      ? h("span", { class: "pill muted", text: "Unknown" })
      : d.connected
        ? h("span", { class: "pill ok", text: "Connected" })
        : h("span", { class: "pill warn", text: "Offline" });
    const sub = [d.manufacturer, d.model].filter(Boolean).join(" ") || d.category_name || "";
    const unreachable = bridgeError ? "homekit-bridge isn't reachable" : undefined;
    const el = h(
      "div",
      { class: "card" + (d.connected ? "" : " offline"), "data-device": d.id, "data-source": d.source ?? "homekit" },
      h(
        "div",
        { class: "card-head" },
        h("span", { class: "ico" }, icon(CATEGORY_ICON[d.category_name ?? ""] ?? "home")),
        h(
          "div",
          { class: "t" },
          h("div", { class: "name-row" }, h("span", { class: "name", text: d.name, title: d.name }), acts.badge ? h("span", { class: "badge src", text: acts.badge, title: "Philips Hue light, via a linked Hue Bridge" }) : null),
          h("div", { class: "sub", text: sub }),
        ),
        status,
      ),
      h(
        "div",
        { class: "card-body" },
        why ? h("div", { class: "msg", role: "status", text: why }) : null,
        blocks.length ? blocks : h("p", { class: "muted", text: "This accessory exposes no controls." }),
      ),
      h(
        "div",
        { class: "card-foot" },
        btn("Identify", { cls: "sm ghost", icon: "zap", disabled: !!why, title: why ?? "Make it blink / beep", onClick: () => identify(d) }),
        btn("Rename", { cls: "sm ghost", icon: "edit", disabled: !!bridgeError, title: unreachable, onClick: () => rename(d) }),
        h("span", { class: "spacer" }),
        acts.unpair
          ? btn("Unpair", { cls: "sm danger", icon: "trash", disabled: !!bridgeError, title: unreachable, onClick: () => unpair(d) })
          : h("span", { class: "reason", text: "Managed by its Hue Bridge", title: "To remove Hue lights, unlink the bridge on the Discover tab." }),
      ),
    );
    if (entry) entry.el = el;
    return el;
  }

  function upsert(d: Device, force: boolean) {
    if (!devices) return;
    const i = devices.findIndex((x) => x.id === d.id);
    if (i >= 0) {
      devices[i] = d;
      renderCard(d, force);
    } else {
      devices.push(d);
      render();
    }
  }

  /// (Re)render one card; place it in `grid` when given.
  function renderCard(d: Device, force: boolean, grid?: HTMLElement): HTMLElement {
    const sig = JSON.stringify(d) + "|" + (bridgeError ?? "");
    const prev = cards.get(d.id);
    if (prev && !force && (prev.sig === sig || prev.busy)) {
      if (grid && prev.el.parentElement !== grid) grid.appendChild(prev.el);
      return prev.el;
    }
    const next = { el: prev?.el as HTMLElement, sig, busy: false };
    cards.set(d.id, next);
    const el = card(d);
    if (prev?.el?.isConnected) prev.el.replaceWith(el);
    if (grid && el.parentElement !== grid) grid.appendChild(el);
    next.el = el;
    return el;
  }

  // ── rooms ──

  async function setGroup(g: HueGroup, body: { on?: boolean; brightness?: number }): Promise<void> {
    try {
      const r = await post<{ group: HueGroup }>(`hue/groups/${encodeURIComponent(g.id)}`, body);
      if (r.group) groups = groups.map((x) => (x.id === r.group.id ? r.group : x));
    } catch (e) {
      toast(`Couldn't change ${g.name}: ${errText(e)}`, "bad");
      throw e;
    } finally {
      if (visible) load();
    }
  }

  async function recall(g: HueGroup, s: HueScene, chip: HTMLButtonElement) {
    chip.disabled = true;
    chip.classList.add("busy");
    try {
      await post(`hue/scenes/${encodeURIComponent(s.id)}/recall`);
      chip.classList.remove("busy");
      chip.classList.add("done");
      chip.prepend(icon("check"));
      toast(`Scene “${s.name}” recalled in ${g.name}.`, "ok");
      setTimeout(() => {
        const sec = sections.get(g.id);
        if (sec) sec.sig = ""; // repaint the chip row on the next render
        if (visible) load();
      }, 1500);
    } catch (e) {
      chip.classList.remove("busy");
      chip.disabled = false;
      toast(`Couldn't recall “${s.name}”: ${errText(e)}`, "bad");
    }
  }

  function roomHead(sec: RoomSection, sc: HueScene[]): HTMLElement {
    const g = sec.group;
    const memberIds = new Set(g ? g.device_ids : sec.devices.map((d) => d.id));
    const members = (devices ?? []).filter((d) => memberIds.has(d.id));
    const lit = members.filter(isOn).length;
    const count = g
      ? members.length
        ? `${lit} of ${members.length} ${members.length === 1 ? "light" : "lights"} on`
        : "No lights"
      : `${sec.devices.length} ${sec.devices.length === 1 ? "device" : "devices"}`;
    const head = h(
      "div",
      { class: "room-head" },
      h("div", { class: "room-title" }, h("h3", { text: sec.name }), g && g.kind !== "room" ? h("span", { class: "badge", text: "Zone" }) : null, h("span", { class: "muted", text: count })),
    );
    if (!g) return head;
    const busy = (on: boolean) => {
      const s = sections.get(sec.key);
      if (s) s.busy = on;
    };
    const why = bridgeError
      ? "Controls are disabled: homekit-bridge isn't reachable."
      : g.on === null
        ? `${g.name} has no lights to control.`
        : members.length && members.every((d) => !d.connected)
          ? `Controls are disabled: every light in ${g.name} is offline.`
          : null;
    const on = g.on === true;
    const sw = h("button", { type: "button", class: "switch", role: "switch", "aria-checked": on ? "true" : "false", "aria-label": `${g.name} power`, disabled: !!why, title: why || undefined });
    const state = h("span", { class: "muted state", text: on ? "On" : "Off" });
    sw.addEventListener("click", () => {
      const next = sw.getAttribute("aria-checked") !== "true";
      sw.setAttribute("aria-checked", next ? "true" : "false");
      state.textContent = next ? "On" : "Off";
      setGroup(g, { on: next }).catch(() => {
        sw.setAttribute("aria-checked", next ? "false" : "true");
        state.textContent = next ? "Off" : "On";
      });
    });
    const bri = typeof g.brightness === "number" ? g.brightness : 0;
    const r = h("input", { type: "range", min: "0", max: "100", step: "1", value: String(bri), disabled: !!why, title: why || undefined, "aria-label": `${g.name} brightness` }) as HTMLInputElement;
    const num = h("span", { class: "num", text: `${bri} %` });
    r.addEventListener("pointerdown", () => busy(true));
    r.addEventListener("pointercancel", () => busy(false));
    r.addEventListener("blur", () => busy(false));
    r.addEventListener("input", () => (num.textContent = `${r.value} %`));
    r.addEventListener("change", () => {
      busy(false);
      const v = Number(r.value);
      // Dragging brightness up on a room that's off turns it on (as in the Hue app).
      setGroup(g, !on && v > 0 ? { on: true, brightness: v } : { brightness: v }).catch(() => {
        r.value = String(bri);
        num.textContent = `${bri} %`;
      });
    });
    head.append(h("div", { class: "room-ctl" }, sw, state, r, num));
    if (sc.length) {
      const chips = h("div", { class: "chips", role: "group", "aria-label": `Scenes in ${g.name}` }, h("span", { class: "chips-k", text: "Scenes" }));
      for (const s of sc) {
        const chip = h("button", { type: "button", class: "chip", text: s.name, disabled: !!bridgeError, title: bridgeError ? "homekit-bridge isn't reachable" : `Recall “${s.name}”` }) as HTMLButtonElement;
        chip.addEventListener("click", () => recall(g, s, chip));
        chips.append(chip);
      }
      head.append(chips);
    }
    if (g.kind !== "room" && members.length) head.append(h("div", { class: "room-lights muted", text: "Lights: " + members.map((d) => d.name).join(", ") }));
    if (why) head.append(h("div", { class: "room-why reason", role: "status", text: why }));
    return head;
  }

  function renderSection(sec: RoomSection, showHead: boolean): { el: HTMLElement; grid: HTMLElement } {
    const sc = sec.group ? scenes.filter((s) => s.group_id === sec.group!.id).sort((a, b) => a.name.localeCompare(b.name)) : [];
    const memberIds = sec.group ? sec.group.device_ids : sec.devices.map((d) => d.id);
    const states = (devices ?? []).filter((d) => memberIds.includes(d.id)).map((d) => [d.id, d.name, d.connected, isOn(d)]);
    const sig = JSON.stringify([sec.name, sec.group, sc.map((s) => [s.id, s.name]), states, sec.devices.length, bridgeError ?? ""]);
    let s = sections.get(sec.key);
    if (!s) {
      const head = h("div");
      const grid = h("div", { class: "cards" });
      s = { el: h("section", { class: "room", "data-room": sec.key, "aria-label": sec.name }, head, grid), head, grid, sig: "", busy: false };
      sections.set(sec.key, s);
    }
    if (s.sig !== sig && !s.busy) {
      const head = roomHead(sec, sc);
      s.head.replaceWith(head);
      s.head = head;
      s.sig = sig;
    }
    s.head.hidden = !showHead;
    s.grid.hidden = !sec.devices.length;
    return s;
  }

  function render() {
    banner.replaceChildren();
    const setup = setupState.current;
    if (bridgeError && setup?.bridge.status !== "running" && !(setup && !setup.health.reachable)) {
      banner.append(
        h("div", { class: "banner bad", role: "alert" }, icon("warn"), h("div", { class: "grow" }, h("b", { text: "Can't reach homekit-bridge" }), h("p", { text: bridgeError }))),
      );
    }
    if (!devices) {
      if (bridgeError) list.replaceChildren();
      return;
    }
    if (!devices.length) {
      cards.clear();
      sections.clear();
      list.replaceChildren(
        h(
          "div",
          { class: "empty" },
          h("div", { class: "ico" }, icon("home")),
          h("h3", { text: "No devices yet" }),
          h("p", {
            text:
              "Find HomeKit accessories on your network and pair them with their setup code, or link a Philips Hue Bridge to bring in its lights. An accessory already in Apple Home must be removed there (or factory reset) first.",
          }),
          btn("Discover devices", { cls: "primary", icon: "search", onClick: goDiscover }),
        ),
      );
      return;
    }
    if (list.querySelector(".skel, .empty")) {
      list.replaceChildren();
      cards.clear();
      sections.clear();
    }
    const ids = new Set(devices.map((d) => d.id));
    for (const [id, c] of cards) {
      if (!ids.has(id)) {
        c.el?.remove();
        cards.delete(id);
      }
    }
    const secs = roomSections(devices, groups);
    const keys = new Set(secs.map((s) => s.key));
    for (const [k, s] of sections) {
      if (!keys.has(k)) {
        s.el.remove();
        sections.delete(k);
      }
    }
    // Only HomeKit devices: no room headers, the page looks as before.
    const showHeads = secs.some((s) => s.key !== "other");
    secs.forEach((sec, i) => {
      const s = renderSection(sec, showHeads);
      if (list.children[i] !== s.el) list.insertBefore(s.el, list.children[i] ?? null);
      sec.devices.forEach((d, j) => {
        const c = renderCard(d, false, s.grid);
        if (s.grid.children[j] !== c) s.grid.insertBefore(c, s.grid.children[j] ?? null);
      });
    });
  }

  /// Rooms + scenes; failures keep the last good copy (an outdated bridge stops the polling).
  async function loadHue(): Promise<void> {
    if (hueUnsupported) return;
    try {
      groups = (await get<{ groups: HueGroup[] }>("hue/groups")).groups ?? [];
      const key = groups.map((g) => g.id).join(",");
      if (!groups.length) scenes = [];
      else if (key !== sceneKey || polls % SCENES_EVERY === 0) scenes = (await get<{ scenes: HueScene[] }>("hue/scenes")).scenes ?? [];
      sceneKey = key;
    } catch (e) {
      if (e instanceof ApiError && e.code === "bridge_outdated") {
        hueUnsupported = true;
        groups = [];
        scenes = [];
      }
    }
  }

  async function load(refresh = false) {
    clearTimeout(timer);
    polls++;
    const hue = loadHue();
    try {
      const r = await get<{ devices: Device[] }>("devices");
      devices = r.devices;
      bridgeError = null;
      if (refresh) await Promise.all(devices.filter((d) => d.connected).map((d) => get<{ device: Device }>(`devices/${encodeURIComponent(d.id)}?refresh=1`).then((x) => upsert(x.device, false)).catch(() => undefined)));
    } catch (e) {
      bridgeError = errText(e);
    }
    await hue;
    render();
    summaryCb(bridgeError ? null : devices);
    clearTimeout(timer);
    if (visible) timer = window.setTimeout(() => load(), POLL_MS);
  }

  async function identify(d: Device) {
    try {
      await post(`devices/${encodeURIComponent(d.id)}/identify`);
      toast(`${d.name} is identifying itself.`, "ok");
    } catch (e) {
      toast(`Identify failed: ${errText(e)}`, "bad");
    }
  }

  function rename(d: Device) {
    const m = openModal("Rename device", { small: true });
    const inp = h("input", { type: "text", value: d.name, maxlength: "64" }) as HTMLInputElement;
    const f = field("Name", inp, {
      hint: isHue(d)
        ? "Changes the name in Peckboard only; the Hue app keeps its own."
        : d.accessory_name && d.accessory_name !== d.name
          ? `Accessory's own name: ${d.accessory_name}`
          : undefined,
    });
    const save = btn("Save", { cls: "primary", type: "submit" });
    const form = h("form", null, f.el);
    m.body.append(form);
    const go = async () => {
      const name = inp.value.trim();
      if (!name) return f.setError("Enter a name.");
      f.setError(null);
      save.disabled = true;
      try {
        const r = await put<{ device: Device }>(`devices/${encodeURIComponent(d.id)}`, { name });
        upsert(r.device, true);
        m.close();
        toast("Renamed.", "ok");
      } catch (e) {
        f.setError(errText(e));
        save.disabled = false;
      }
    };
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      go();
    });
    save.addEventListener("click", (e) => {
      e.preventDefault();
      go();
    });
    m.foot.append(btn("Cancel", { onClick: () => m.close() }), save);
  }

  async function unpair(d: Device) {
    const ok = await confirmDialog({
      title: `Unpair ${d.name}?`,
      body: h(
        "div",
        null,
        h("p", { text: "Peckboard removes its pairing from the accessory and forgets it. That frees the device, so you can add it back to Apple Home (or pair it here again later with its setup code)." }),
      ),
      confirm: "Unpair",
      danger: true,
    });
    if (!ok) return;
    try {
      await del(`devices/${encodeURIComponent(d.id)}`);
      toast(`${d.name} unpaired — it can go back to Apple Home now.`, "ok");
    } catch (e) {
      if (e instanceof ApiError && e.code === "unreachable") {
        const force = await confirmDialog({
          title: `${d.name} isn't reachable`,
          body:
            "Peckboard couldn't reach the accessory to remove its pairing. Forget it here anyway? The accessory will still think it's paired, so factory reset it before adding it to Apple Home.",
          confirm: "Forget anyway",
          danger: true,
        });
        if (!force) return;
        try {
          await del(`devices/${encodeURIComponent(d.id)}?force=1`);
          toast(`${d.name} forgotten. Factory reset it before adding it to Apple Home.`, "ok");
        } catch (e2) {
          return toast(`Unpair failed: ${errText(e2)}`, "bad");
        }
      } else return toast(`Unpair failed: ${errText(e)}`, "bad");
    }
    load();
  }

  return {
    el,
    show() {
      visible = true;
      load();
    },
    hide() {
      visible = false;
      clearTimeout(timer);
    },
    reload() {
      if (visible) load();
    },
    onSummary(cb) {
      summaryCb = cb;
    },
  };
}
