// Zero-touch setup banner: GET setup probes homekit-bridge and starts its
// install when it's missing; this polls while the install runs, shows a
// non-blocking banner, and fires SETUP_CHANGED so the views re-check.

import { h, icon, btn, toast, errText } from "./dom";
import { get, post, appManagerLink } from "./api";

export interface SetupView {
  status: "ok" | "running" | "failed" | "external";
  reason?: string;
  phase?: string;
  error?: string;
  log_tail?: string;
  no_systemd?: boolean;
  no_node?: boolean;
  upgrade?: boolean;
}

export interface Setup {
  bridge: SetupView;
  health: { reachable: boolean; version?: string; error?: string; auth_failed?: boolean };
  url: string;
  outdated?: { version: string; min: string } | null;
}

export const SETUP_CHANGED = "homekit-setup-changed";
const POLL_MS = 2000;

export const setupState: { current: Setup | null } = { current: null };

let retryFn: () => Promise<void> = async () => undefined;
/// Restart the setup now (the banner's Retry; also "Update homekit-bridge").
export function retrySetup(): Promise<void> {
  return retryFn();
}

function phaseText(s: SetupView): string {
  switch (s.phase) {
    case "download":
      return "Downloading…";
    case "install":
      return "Installing…";
    case "start":
      return "Starting the service…";
    default:
      return "Starting…";
  }
}

function banner(s: Setup, retry: () => void): HTMLElement | null {
  const b = s.bridge;
  if (b.status === "running") {
    return h(
      "div",
      { class: "banner info", role: "status", "data-setup": "bridge" },
      icon("refresh"),
      h(
        "div",
        { class: "grow" },
        h("b", { text: b.upgrade ? "Updating homekit-bridge…" : "Setting up homekit-bridge…" }),
        h("p", {
          text:
            (b.upgrade
              ? "Installing the latest homekit-bridge for Philips Hue support. HomeKit accessories reconnect once the service restarts. "
              : "HomeKit is installing the local homekit-bridge daemon that talks to your accessories. ") + phaseText(b),
        }),
        h("div", { class: "row" }, h("div", { style: { flex: "1" } }, h("div", { class: "prog indet" }, h("div", { style: { width: "35%" } })))),
      ),
    );
  }
  if (b.status === "failed" || b.status === "external") {
    const title = b.no_node
      ? "homekit-bridge needs Node.js"
      : b.no_systemd
        ? "homekit-bridge can't run as a service on this host"
        : s.health.auth_failed
          ? "homekit-bridge rejected the token"
          : b.status === "external"
            ? `homekit-bridge isn't reachable at ${s.url}`
            : b.upgrade
              ? "Couldn't update homekit-bridge"
              : "Couldn't set up homekit-bridge";
    const actions = h("div", { class: "row" });
    if (b.no_node) actions.append(appManagerLink("node", "Install Node.js in App Manager"));
    else if (b.status === "failed" && !s.health.auth_failed) actions.append(appManagerLink("homekit-bridge", "Install with App Manager"));
    if (b.status === "failed" && !s.health.auth_failed) actions.append(btn("Retry", { cls: "sm primary", icon: "refresh", onClick: retry }));
    return h(
      "div",
      { class: "banner " + (b.no_node || b.no_systemd || b.upgrade ? "warn" : "bad"), role: "alert", "data-setup": "bridge" },
      icon("warn"),
      h(
        "div",
        { class: "grow" },
        h("b", { text: title }),
        h("p", { text: b.error || s.health.error || "The installer failed." }),
        b.no_systemd
          ? h("p", {
              text: "Start it by hand instead: homekit-bridge --token-file ~/.config/homekit-bridge/token (it listens on 127.0.0.1:7782).",
            })
          : null,
        b.log_tail ? h("details", { class: "log" }, h("summary", { text: "Installer log" }), h("pre", { text: b.log_tail })) : null,
        actions.childNodes.length ? actions : null,
      ),
    );
  }
  return null;
}

export function setupWatch(): { el: HTMLElement; check(): Promise<void> } {
  const el = h("div", { class: "setup", "aria-live": "polite" });
  let timer = 0;

  const apply = (s: Setup) => {
    const was = setupState.current;
    setupState.current = s;
    if (was?.bridge.status === "running" && s.bridge.status === "ok") toast(was.bridge.upgrade ? "homekit-bridge is updated and running." : "homekit-bridge is installed and running.", "ok");
    el.replaceChildren();
    const b = banner(s, retry);
    if (b) el.appendChild(b);
    window.dispatchEvent(new Event(SETUP_CHANGED));
    clearTimeout(timer);
    if (s.bridge.status === "running") timer = window.setTimeout(check, POLL_MS);
    else if (!s.health.reachable) timer = window.setTimeout(check, POLL_MS * 15);
  };

  async function check(): Promise<void> {
    try {
      apply(await get<Setup>("setup"));
    } catch (_e) {
      // Transient (plugin reloading): try again a little later.
      clearTimeout(timer);
      timer = window.setTimeout(check, POLL_MS * 5);
    }
  }

  async function retry() {
    try {
      apply(await post<Setup>("setup/retry"));
    } catch (e) {
      toast("Couldn't restart the homekit-bridge setup: " + errText(e), "bad");
    }
  }

  retryFn = retry;
  return { el, check };
}
