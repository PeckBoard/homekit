// HomeKit page entry: header with the device summary, tabs (Devices /
// Discover), the setup banner, and the two views.

import { h, icon } from "./dom";
import { setupWatch, setupState, SETUP_CHANGED } from "./setup";
import { devicesView } from "./devices";
import { discoverView } from "./discover";

type Tab = "devices" | "discover";

const app = document.getElementById("app")!;
const summary = h("div", { class: "summary", "aria-live": "polite" });
const tabs: Record<Tab, HTMLButtonElement> = {} as any;
const tablist = h("div", { class: "tabs", role: "tablist", "aria-label": "HomeKit sections" });
const ORDER: Tab[] = ["devices", "discover"];
const labels: Record<Tab, string> = { devices: "Devices", discover: "Discover" };
for (const id of ORDER) {
  const b = h("button", { class: "tab", role: "tab", id: "tab-" + id, "aria-controls": "panel-" + id, "aria-selected": "false", tabindex: "-1", type: "button" }, labels[id]);
  b.addEventListener("click", () => go(id));
  b.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const next = ORDER[(ORDER.indexOf(id) + 1) % ORDER.length];
      go(next);
      tabs[next].focus();
    }
  });
  tabs[id] = b;
  tablist.appendChild(b);
}

const header = h("header", { class: "top" }, h("h1", null, icon("home"), "HomeKit"), summary, tablist);

const setup = setupWatch();
const devices = devicesView(() => go("discover"));
const discover = discoverView(
  () => go("devices"),
  () => devices.reload(),
);
devices.onSummary((list) => {
  summary.replaceChildren();
  if (!list || !list.length) return;
  const on = list.filter((d) => d.connected).length;
  const item = (n: number, label: string) => h("span", null, h("b", { text: String(n) }), " " + label);
  summary.append(item(list.length, list.length === 1 ? "device" : "devices"), item(on, "connected"));
  if (on < list.length) summary.append(item(list.length - on, "offline"));
});

const panels: Record<Tab, HTMLElement> = {
  devices: h("div", { role: "tabpanel", id: "panel-devices", "aria-labelledby": "tab-devices" }, devices.el),
  discover: h("div", { role: "tabpanel", id: "panel-discover", "aria-labelledby": "tab-discover" }, discover.el),
};
app.append(header, h("main", null, setup.el, panels.devices, panels.discover));

let current: Tab | null = null;
function go(t: Tab) {
  if (current === t) return;
  if (current === "devices") devices.hide();
  if (current === "discover") discover.hide();
  current = t;
  for (const id of ORDER) {
    const on = id === t;
    tabs[id].setAttribute("aria-selected", on ? "true" : "false");
    tabs[id].tabIndex = on ? 0 : -1;
    panels[id].hidden = !on;
  }
  try {
    history.replaceState(null, "", "#" + t);
  } catch (_e) {
    /* sandboxed: ignore */
  }
  if (t === "devices") devices.show();
  else discover.show();
}

// A finished install: reload the current view against the now-running bridge.
let wasReachable: boolean | null = null;
window.addEventListener(SETUP_CHANGED, () => {
  const ok = !!setupState.current?.health.reachable;
  if (wasReachable === false && ok && current) {
    const t = current;
    current = null;
    go(t);
  }
  wasReachable = ok;
});

const initial = (location.hash.slice(1) || new URLSearchParams(location.search).get("tab") || "devices") as Tab;
go(ORDER.includes(initial) ? initial : "devices");
setup.check();
