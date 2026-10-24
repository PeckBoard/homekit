// Philips Hue on the Discover tab: the "Hue Bridge" section (GET hue/bridges)
// with Link / Unlink per bridge, manual address entry for a bridge discovery
// can't see, and the link dialog that polls POST hue/link every 2 s for 30 s
// while the user presses the bridge's link button. A homekit-bridge older
// than 0.2.0 (no /hue routes) shows the "Update homekit-bridge" state instead.

import { h, icon, btn, toast, errText, openModal, confirmDialog, field } from "./dom";
import { get, post, del, ApiError, appManagerLink } from "./api";
import { setupState, retrySetup, SETUP_CHANGED } from "./setup";
import { MIN_HUE_VERSION, type HueBridge } from "../src/hue";

const LINK_WINDOW_MS = 30_000;
const LINK_EVERY_MS = 2000;
const DEFAULT_URL = "http://127.0.0.1:7782";

/// A Hue Bridge id: 16 hex characters. Pure.
export function bridgeIdError(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  return /^[0-9a-f]{16}$/i.test(s) ? null : "The bridge id is 16 hex characters, e.g. ecb5fafffe0a1b2c (optional).";
}

/// Is this a "homekit-bridge is too old for Hue" failure (the plugin maps a
/// pre-0.2.0 bridge's 404 to `bridge_outdated`)? Pure.
export function isOutdatedError(e: unknown): boolean {
  return e instanceof ApiError && e.code === "bridge_outdated";
}

/// The "Update homekit-bridge" state shown wherever Hue isn't available yet.
export function outdatedNotice(version?: string): HTMLElement {
  const s = setupState.current;
  const v = version ?? s?.outdated?.version ?? s?.health.version;
  const running = s?.bridge.status === "running";
  const managed = (s?.url ?? DEFAULT_URL).replace(/\/+$/, "") === DEFAULT_URL;
  const actions = h("div", { class: "row" });
  if (running) {
    actions.append(h("div", { style: { flex: "1", maxWidth: "260px" } }, h("div", { class: "prog indet" }, h("div", { style: { width: "35%" } }))), h("span", { class: "reason", text: "Updating homekit-bridge…" }));
  } else if (managed) {
    actions.append(
      btn("Update homekit-bridge", {
        cls: "sm primary",
        icon: "refresh",
        onClick: async (e) => {
          (e.currentTarget as HTMLButtonElement).disabled = true;
          await retrySetup();
        },
      }),
      appManagerLink("homekit-bridge", "Reinstall with App Manager"),
    );
  }
  return h(
    "div",
    { class: "banner warn", role: "status", "data-hue": "outdated" },
    icon("warn"),
    h(
      "div",
      { class: "grow" },
      h("b", { text: "Update homekit-bridge to use Philips Hue" }),
      h("p", {
        text:
          `Philips Hue needs homekit-bridge ${MIN_HUE_VERSION} or newer${v ? ` — this one is ${v}` : ""}. ` +
          (managed
            ? "Updating keeps your HomeKit pairings; accessories reconnect after the service restarts."
            : `It runs at ${s?.url}, which Peckboard doesn't manage — update it there.`),
      }),
      actions.childNodes.length ? actions : null,
    ),
  );
}

export interface HueSection {
  el: HTMLElement;
  load(refresh?: boolean): Promise<void>;
}

export function hueSection(onLinked: () => void): HueSection {
  const list = h("div", { class: "dlist" });
  const status = h("span", { class: "reason", "aria-live": "polite" });
  const refreshBtn = btn("Scan again", { cls: "sm", icon: "refresh", onClick: () => load(true) });
  const manual = manualLink((t) => linkDialog(t, linked));
  const el = h(
    "section",
    { class: "hue-section", "aria-labelledby": "hue-h" },
    h("div", { class: "section-head" }, h("h2", { id: "hue-h", text: "Hue Bridge" }), status, h("span", { class: "grow" }), refreshBtn),
    list,
    manual,
  );
  let loaded = false;
  let outdated = false;

  function linked(b: HueBridge) {
    load();
    onLinked();
    toast(`Linked ${b.name}${typeof b.lights === "number" ? ` — ${b.lights} ${b.lights === 1 ? "light" : "lights"} added to Devices` : ""}.`, "ok");
  }

  function row(b: HueBridge): HTMLElement {
    const pill = !b.linked
      ? h("span", { class: "pill busy", text: "Not linked" })
      : b.connected === false
        ? h("span", { class: "pill warn", text: "Linked · not reachable" })
        : h("span", { class: "pill ok", text: "Linked" });
    const lights = b.linked && typeof b.lights === "number" ? `${b.lights} ${b.lights === 1 ? "light" : "lights"}` : null;
    return h(
      "div",
      { class: "drow", "data-hue-bridge": b.bridge_id },
      h("div", { class: "t" }, h("b", { text: b.name || "Hue Bridge" }), b.model ? h("span", { class: "badge", text: b.model }) : null, pill),
      h(
        "div",
        { class: "sub" },
        lights ? h("span", { text: lights }) : null,
        h("span", { class: "mono", text: b.bridge_id }),
        b.address ? h("span", { class: "mono", text: b.address }) : null,
        b.linked && b.connected === false ? h("span", { text: "Its lights show as offline until the bridge is back." }) : null,
      ),
      h(
        "div",
        { class: "acts" },
        b.linked
          ? btn("Unlink", { cls: "sm danger", icon: "trash", onClick: () => unlink(b) })
          : btn("Link", { cls: "sm primary", icon: "link", onClick: () => linkDialog({ bridge_id: b.bridge_id, address: b.address, name: b.name || "Hue Bridge" }, linked) }),
      ),
    );
  }

  async function unlink(b: HueBridge) {
    const n = typeof b.lights === "number" ? `its ${b.lights} ${b.lights === 1 ? "light" : "lights"}` : "its lights";
    const ok = await confirmDialog({
      title: `Unlink ${b.name}?`,
      body: `Peckboard forgets this bridge's key and ${n} disappear from Devices. Nothing changes on the bridge, in the Hue app or in Apple Home — you can link it again any time (it needs the link button again).`,
      confirm: "Unlink",
      danger: true,
    });
    if (!ok) return;
    try {
      await del(`hue/bridges/${encodeURIComponent(b.bridge_id)}`);
      toast(`${b.name} unlinked.`, "ok");
      onLinked();
    } catch (e) {
      toast(`Unlink failed: ${errText(e)}`, "bad");
    }
    load();
  }

  async function load(refresh = false) {
    refreshBtn.disabled = true;
    status.textContent = refresh ? "Scanning…" : loaded ? "" : "Loading…";
    try {
      const r = await get<{ bridges: HueBridge[] }>(refresh ? "hue/bridges?refresh=1" : "hue/bridges");
      loaded = true;
      outdated = false;
      const rows = r.bridges.slice().sort((a, b) => Number(a.linked) - Number(b.linked) || a.name.localeCompare(b.name));
      list.replaceChildren();
      if (!rows.length) {
        list.append(
          h(
            "div",
            { class: "empty sm" },
            h("div", { class: "ico" }, icon("bridge")),
            h("h3", { text: "No Hue Bridge found" }),
            h("p", { text: "Make sure the bridge is powered on and on the same network as this Peckboard host, then scan again — or enter its address below." }),
          ),
        );
        manual.open = true;
      } else list.append(...rows.map(row));
      status.textContent = rows.length ? `${rows.length} found` : "";
    } catch (e) {
      status.textContent = "";
      if (isOutdatedError(e)) {
        outdated = true;
        list.replaceChildren(outdatedNotice());
      } else {
        list.replaceChildren(h("div", { class: "banner bad", role: "alert" }, icon("warn"), h("div", { class: "grow" }, h("b", { text: "Couldn't list Hue Bridges" }), h("p", { text: errText(e) }))));
      }
    }
    manual.hidden = outdated;
    refreshBtn.disabled = outdated;
    if (outdated) refreshBtn.title = "Update homekit-bridge first";
    else refreshBtn.removeAttribute("title");
  }

  // An update finishing (or starting): re-check.
  window.addEventListener(SETUP_CHANGED, () => {
    if (outdated) {
      if (setupState.current?.health.reachable && !setupState.current.outdated) load();
      else list.replaceChildren(outdatedNotice());
    }
  });

  return { el, load };
}

/// "Bridge not listed?" — link by IP (bridge id optional).
function manualLink(open: (t: { bridge_id?: string; address: string; name: string }) => void): HTMLDetailsElement {
  const addr = h("input", { type: "text", placeholder: "192.168.1.30", autocomplete: "off", inputmode: "decimal" }) as HTMLInputElement;
  const id = h("input", { type: "text", placeholder: "ecb5fafffe0a1b2c", autocomplete: "off", class: "mono", maxlength: "16" }) as HTMLInputElement;
  const fa = field("IP address", addr, { hint: "Shown in the Hue app under Settings → My Hue system." });
  const fi = field("Bridge id (optional)", id, { hint: "16 characters; only needed if the bridge doesn't answer by address alone." });
  const go = btn("Link", { cls: "primary sm", icon: "link" });
  const submit = () => {
    const ea = addr.value.trim() ? (/^[A-Za-z0-9.\-:\[\]]+$/.test(addr.value.trim()) ? null : "Enter an IP address or host name.") : "Enter the bridge's IP address.";
    const ei = bridgeIdError(id.value);
    fa.setError(ea);
    fi.setError(ei);
    if (ea || ei) return;
    open({ address: addr.value.trim(), bridge_id: id.value.trim().toLowerCase() || undefined, name: `the bridge at ${addr.value.trim()}` });
  };
  go.addEventListener("click", submit);
  for (const i of [addr, id]) i.addEventListener("keydown", (e) => e.key === "Enter" && submit());
  return h(
    "details",
    { class: "more" },
    h("summary", { text: "Bridge not listed? Link it by address" }),
    h("div", { class: "more-body" }, h("div", { class: "grid2" }, fa.el, fi.el), h("div", { class: "row" }, go)),
  ) as HTMLDetailsElement;
}

/// The link dialog: asks the user to press the bridge's button and polls
/// POST hue/link (409 link_button_not_pressed = keep waiting) for 30 s.
export function linkDialog(target: { bridge_id?: string; address?: string; name: string }, onLinked: (b: HueBridge) => void) {
  let stopped = false;
  let tick = 0;
  let next = 0;
  const m = openModal(`Link ${target.name}`, {
    onClose: () => {
      stopped = true;
      clearInterval(tick);
      clearTimeout(next);
    },
  });
  const bar = h("div", { style: { width: "100%" } });
  const count = h("span", { class: "countdown", "aria-live": "polite" });
  const msg = h("div");
  const wait = h("div", { class: "link-wait" }, h("div", { class: "prog" }, bar), count);
  const retry = btn("Try again", { cls: "primary", icon: "refresh", onClick: () => start() });
  const cancel = btn("Cancel", { onClick: () => m.close() });
  m.body.append(
    h(
      "div",
      { class: "link-hero" },
      h("div", { class: "link-ico" }, icon("bridge")),
      h(
        "div",
        null,
        h("h3", { text: "Press the button on your Hue Bridge" }),
        h("p", { text: "Press the large round link button on top of the bridge. Peckboard keeps asking for 30 seconds after you open this." }),
      ),
    ),
    wait,
    msg,
  );
  m.foot.append(cancel, retry);

  function done(state: "timeout" | "error", text: string) {
    clearInterval(tick);
    clearTimeout(next);
    wait.hidden = true;
    retry.hidden = false;
    msg.replaceChildren(
      h(
        "div",
        { class: "banner " + (state === "timeout" ? "warn" : "bad"), role: "alert" },
        icon("warn"),
        h("div", { class: "grow" }, h("b", { text: state === "timeout" ? "The link button wasn't pressed in time" : "Linking failed" }), h("p", { text })),
      ),
    );
    setTimeout(() => retry.focus(), 0);
  }

  function start() {
    const deadline = Date.now() + LINK_WINDOW_MS;
    wait.hidden = false;
    retry.hidden = true;
    msg.replaceChildren();
    const paint = () => {
      const left = Math.max(0, deadline - Date.now());
      bar.style.width = `${(left / LINK_WINDOW_MS) * 100}%`;
      count.textContent = `Waiting for the link button… ${Math.ceil(left / 1000)} s — nothing to click here.`;
    };
    paint();
    clearInterval(tick);
    tick = window.setInterval(paint, 250);
    const attempt = async () => {
      if (stopped) return;
      try {
        const body: Record<string, string> = {};
        if (target.bridge_id) body.bridge_id = target.bridge_id;
        if (target.address) body.address = target.address;
        const r = await post<{ bridge: HueBridge }>("hue/link", body);
        if (stopped) return;
        m.close();
        onLinked(r.bridge);
      } catch (e) {
        if (stopped) return;
        if (e instanceof ApiError && e.code === "link_button_not_pressed") {
          if (Date.now() + LINK_EVERY_MS > deadline) return done("timeout", "Press the round button on top of the bridge, then try again — you'll have another 30 seconds.");
          next = window.setTimeout(attempt, LINK_EVERY_MS);
          return;
        }
        done("error", isOutdatedError(e) ? `homekit-bridge is too old for Philips Hue (needs ${MIN_HUE_VERSION}). Update it on the Discover tab.` : errText(e));
      }
    };
    attempt();
  }

  start();
}
