// Discover tab: the Hue Bridge section (ui/hue.ts) on top, then HomeKit IP
// accessories seen on the LAN (GET discover), each with its pairing status
// and a Pair button; accessories still owned by another controller say so
// and can't be paired. A manual-add form covers accessories mDNS can't see.
// Pairing goes through one dialog (setup code with inline validation +
// optional name).

import { h, icon, btn, toast, errText, openModal, field } from "./dom";
import { get, post, ApiError } from "./api";
import { Discovered, Device, OWNED_ELSEWHERE, setupCodeError, normalizeSetupCode } from "../src/hap";
import { hueSection } from "./hue";

type Row = Discovered & { status: "paired" | "available" | "owned_elsewhere"; note?: string };

/// A HAP device id: six hex pairs, colons optional. Pure.
export function deviceIdError(raw: string): string | null {
  const s = raw.trim();
  if (!s) return "Enter the accessory's device id.";
  return /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(s) || /^[0-9a-f]{12}$/i.test(s) ? null : "The device id looks like A1:B2:C3:D4:E5:F6 (mDNS TXT record “id”).";
}

export interface DiscoverView {
  el: HTMLElement;
  show(): void;
  hide(): void;
}

export function discoverView(onPaired: (d: Device) => void, onHueChanged: () => void = () => undefined): DiscoverView {
  const list = h("div", { class: "dlist" });
  const status = h("span", { class: "reason", "aria-live": "polite" });
  const refreshBtn = btn("Scan again", { cls: "sm", icon: "refresh", onClick: () => load(true) });
  const hue = hueSection(onHueChanged);
  const el = h(
    "div",
    null,
    hue.el,
    h("div", { class: "section-head" }, h("h2", { text: "HomeKit accessories on your network" }), status, h("span", { class: "grow" }), refreshBtn),
    h(
      "div",
      { class: "banner info" },
      icon("info"),
      h(
        "div",
        { class: "grow" },
        h("b", { text: "Before you pair" }),
        h("p", {
          text:
            "A HomeKit accessory has one owner. If it's in Apple Home, remove it there (or factory reset it) first. Only Wi-Fi / Ethernet (HomeKit over IP) accessories work — Bluetooth and Thread accessories aren't supported.",
        }),
      ),
    ),
    list,
    manualPanel(),
  );
  let loaded = false;

  function row(a: Row): HTMLElement {
    const pill =
      a.status === "paired"
        ? h("span", { class: "pill ok", text: "Paired" })
        : a.status === "available"
          ? h("span", { class: "pill busy", text: "Ready to pair" })
          : h("span", { class: "pill warn", text: "Owned by another controller" });
    const reason = a.status === "paired" ? "Already paired with Peckboard" : a.status === "owned_elsewhere" ? "Remove it from Apple Home (or factory reset) first" : undefined;
    return h(
      "div",
      { class: "drow", "data-accessory": a.id },
      h("div", { class: "t" }, h("b", { text: a.name }), a.category_name ? h("span", { class: "badge", text: a.category_name }) : null, pill),
      h("div", { class: "sub" }, a.model ? h("span", { text: a.model }) : null, h("span", { class: "mono", text: a.id }), a.address ? h("span", { class: "mono", text: `${a.address}:${a.port}` }) : null),
      h(
        "div",
        { class: "acts" },
        a.status === "paired"
          ? null
          : btn("Pair", { cls: "sm primary", icon: "link", disabled: a.status !== "available", title: reason, onClick: () => pairDialog({ id: a.id, name: a.name }, onPaired) }),
      ),
      a.status === "owned_elsewhere"
        ? h(
            "div",
            { class: "note" },
            h("div", { class: "banner warn", role: "note" }, icon("warn"), h("div", { class: "grow" }, h("b", { text: "Still owned by another controller" }), h("p", { text: OWNED_ELSEWHERE }))),
          )
        : null,
    );
  }

  async function load(refresh = false) {
    refreshBtn.disabled = true;
    status.textContent = refresh ? "Scanning…" : loaded ? "" : "Loading…";
    try {
      const r = await get<{ accessories: Row[] }>(refresh ? "discover?refresh=1" : "discover");
      loaded = true;
      list.replaceChildren();
      const rows = r.accessories.slice().sort((x, y) => order(x) - order(y) || x.name.localeCompare(y.name));
      if (!rows.length) {
        list.append(
          h(
            "div",
            { class: "empty" },
            h("div", { class: "ico" }, icon("search")),
            h("h3", { text: "No HomeKit accessories found" }),
            h("p", { text: "Make sure the accessory is powered on and on the same network as this Peckboard host, then scan again — or add it by address below." }),
          ),
        );
      } else list.append(...rows.map(row));
      status.textContent = `${rows.length} found`;
    } catch (e) {
      list.replaceChildren(h("div", { class: "banner bad", role: "alert" }, icon("warn"), h("div", { class: "grow" }, h("b", { text: "Discovery failed" }), h("p", { text: errText(e) }))));
      status.textContent = "";
    }
    refreshBtn.disabled = false;
  }

  function manualPanel(): HTMLElement {
    const addr = h("input", { type: "text", placeholder: "192.168.1.40", autocomplete: "off" }) as HTMLInputElement;
    const port = h("input", { type: "number", min: "1", max: "65535", placeholder: "51827" }) as HTMLInputElement;
    const id = h("input", { type: "text", placeholder: "A1:B2:C3:D4:E5:F6", autocomplete: "off" }) as HTMLInputElement;
    const fa = field("Address", addr);
    const fp = field("Port", port);
    const fi = field("Device id", id, { hint: "The accessory's HAP id (mDNS TXT “id”)." });
    const go = btn("Continue", { cls: "primary sm", icon: "link" });
    go.addEventListener("click", () => {
      const ea = addr.value.trim() ? null : "Enter the accessory's IP address or host name.";
      const pn = Number(port.value);
      const ep = Number.isInteger(pn) && pn >= 1 && pn <= 65535 ? null : "Enter a port from 1 to 65535.";
      const ei = deviceIdError(id.value);
      fa.setError(ea);
      fp.setError(ep);
      fi.setError(ei);
      if (ea || ep || ei) return;
      pairDialog({ id: id.value.trim(), name: addr.value.trim(), address: addr.value.trim(), port: pn }, onPaired);
    });
    return h(
      "div",
      { class: "panel" },
      h("h3", { text: "Add by address" }),
      h("p", { text: "For an accessory discovery can't see (another subnet, mDNS blocked). You'll need its address, HAP port, device id and setup code." }),
      h("div", { class: "grid3" }, fa.el, fp.el, fi.el),
      h("div", { class: "row" }, go),
    );
  }

  return {
    el,
    show() {
      hue.load();
      load(!loaded);
    },
    hide() {
      /* nothing polls here */
    },
  };
}

function order(a: Row): number {
  return a.status === "available" ? 0 : a.status === "owned_elsewhere" ? 1 : 2;
}

/// The pair dialog: setup code (inline validation) + optional name.
export function pairDialog(target: { id: string; name: string; address?: string; port?: number }, onPaired: (d: Device) => void) {
  const m = openModal(`Pair ${target.name}`);
  const code = h("input", { type: "text", inputmode: "numeric", autocomplete: "off", placeholder: "123-45-678", maxlength: "10", class: "mono" }) as HTMLInputElement;
  const name = h("input", { type: "text", placeholder: target.address ? "" : target.name, maxlength: "64" }) as HTMLInputElement;
  const fc = field("Setup code", code, { hint: "8 digits from the accessory's label, box or manual." });
  const fn = field("Name (optional)", name, { hint: "How it shows up in Peckboard. Defaults to the accessory's own name." });
  const err = h("div");
  const reason = h("span", { class: "reason" });
  const pair = btn("Pair", { cls: "primary", icon: "link" });
  let touched = false;
  const sync = () => {
    const e = setupCodeError(code.value);
    fc.setError(touched ? e : null);
    pair.disabled = !!e;
    reason.textContent = e ? "Enter a valid setup code to pair." : "";
  };
  code.addEventListener("input", sync);
  code.addEventListener("blur", () => {
    touched = !!code.value.trim();
    const n = normalizeSetupCode(code.value);
    if (n) code.value = n;
    sync();
  });
  sync();
  m.body.append(
    h("p", { text: "Make sure the accessory isn't paired with Apple Home (remove it there or factory reset it). Pairing can take up to a minute." }),
    fc.el,
    fn.el,
    err,
  );
  const submit = async () => {
    touched = true;
    sync();
    if (pair.disabled) return;
    pair.disabled = true;
    pair.lastChild!.textContent = "Pairing…";
    reason.textContent = "Exchanging keys with the accessory…";
    err.replaceChildren();
    try {
      const body: Record<string, unknown> = { id: target.id, setup_code: normalizeSetupCode(code.value) };
      if (name.value.trim()) body.name = name.value.trim();
      if (target.address) {
        body.address = target.address;
        body.port = target.port;
      }
      const r = await post<{ device: Device }>("pair", body);
      m.close();
      toast(`${r.device.name} is paired.`, "ok");
      onPaired(r.device);
    } catch (e) {
      pair.lastChild!.textContent = "Pair";
      const ae = e instanceof ApiError ? e : null;
      if (ae && (ae.field === "setup_code" || ae.code === "bad_setup_code")) {
        fc.setError(ae.code === "bad_setup_code" ? "The accessory rejected this setup code — check it and try again." : errText(e));
      } else {
        const msg = ae?.code === "already_paired" ? `${errText(e)} — ${OWNED_ELSEWHERE}` : errText(e);
        err.replaceChildren(h("div", { class: "banner bad", role: "alert" }, icon("warn"), h("div", { class: "grow" }, h("b", { text: "Pairing failed" }), h("p", { text: msg }))));
      }
      // Not sync(): it would clear the server's field error just set.
      pair.disabled = false;
      reason.textContent = "";
    }
  };
  code.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
  });
  name.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
  });
  pair.addEventListener("click", submit);
  m.foot.append(reason, btn("Cancel", { onClick: () => m.close() }), pair);
}
