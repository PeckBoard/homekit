// Tiny DOM toolkit for the page (same shape as print-farm's): element
// builder, icons, toasts, modal + confirm dialog, labelled fields and
// selects. Data is always rendered with textContent; innerHTML is used only
// for the static icon SVGs below.

type Child = Node | string | null | undefined | false;
type Attrs = Record<string, any>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
      else if (k in el && typeof v !== "string") (el as any)[k] = v;
      else el.setAttribute(k, v === true ? "" : String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el: Node, children: (Child | Child[])[]) {
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
}

// ── icons (lucide paths) ───────────────────────────────────────────────────

const P: Record<string, string> = {
  home: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  bulb: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6M10 22h4"/>',
  plug: '<path d="M12 22v-5M9 8V2M15 8V2M18 8v5a6 6 0 0 1-12 0V8z"/>',
  power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>',
  thermo: '<path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0z"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  blinds: '<path d="M3 3h18M20 7H8M20 11H8M10 19h10M8 15h12M4 3v14"/><circle cx="4" cy="19" r="2"/>',
  garage: '<path d="M3 21V8l9-5 9 5v13"/><path d="M7 21v-8h10v8M7 17h10"/>',
  fan: '<path d="M10.8 3.5a3 3 0 0 1 4.6 3.4L13.5 12l5.1-1.9a3 3 0 1 1 1.4 5.3L12 12l1.9 5.1a3 3 0 1 1-5.3 1.4L12 12l-5.1 1.9a3 3 0 1 1-1.4-5.3L12 12z"/>',
  sensor: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  bridge: '<rect x="2" y="14" width="20" height="8" rx="2"/><path d="M6 18h.01M10 18h.01M12 2v8M8 6l4-4 4 4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  warn: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  ext: '<path d="M7 17 17 7M8 7h9v9"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
};

export function icon(name: string): SVGElement {
  const wrap = document.createElement("span");
  wrap.innerHTML =
    '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    (P[name] || "") +
    "</svg>";
  return wrap.firstChild as SVGElement;
}

export function btn(label: string | null, opts: { icon?: string; cls?: string; onClick?: (e: MouseEvent) => void; title?: string; disabled?: boolean; aria?: string; type?: string } = {}): HTMLButtonElement {
  const b = h("button", {
    type: opts.type || "button",
    class: "btn " + (opts.cls || ""),
    title: opts.title,
    "aria-label": opts.aria,
    disabled: opts.disabled,
  });
  if (opts.icon) b.appendChild(icon(opts.icon));
  if (label) b.appendChild(document.createTextNode(label));
  if (opts.onClick) b.addEventListener("click", opts.onClick);
  return b;
}

// ── toasts ─────────────────────────────────────────────────────────────────

let toastHost: HTMLElement | null = null;

export function toast(msg: string, tone: "ok" | "bad" | "info" = "info", ms = tone === "bad" ? 7000 : 3500) {
  if (!toastHost) {
    toastHost = h("div", { class: "toasts", role: "status", "aria-live": "polite" });
    document.body.appendChild(toastHost);
  }
  const close = btn(null, { icon: "x", cls: "ghost sm", aria: "Dismiss" });
  const t = h("div", { class: "toast " + tone }, icon(tone === "bad" ? "warn" : tone === "ok" ? "check" : "info"), h("div", { class: "grow", text: msg }), close);
  const kill = () => t.remove();
  close.onclick = kill;
  toastHost.appendChild(t);
  setTimeout(kill, ms);
}

export function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ── modal ──────────────────────────────────────────────────────────────────

export interface ModalHandle {
  close(): void;
  body: HTMLElement;
  foot: HTMLElement;
  root: HTMLElement;
}

/// Open a modal dialog. Esc / backdrop click close it; focus is trapped and
/// restored to the opener afterwards.
export function openModal(title: string, opts: { small?: boolean; onClose?: () => void } = {}): ModalHandle {
  const opener = document.activeElement as HTMLElement | null;
  const titleId = "m" + Math.random().toString(36).slice(2);
  const body = h("div", { class: "modal-body" });
  const foot = h("div", { class: "modal-foot" });
  const closeBtn = btn(null, { icon: "x", cls: "ghost sm", aria: "Close" });
  const modal = h(
    "div",
    { class: "modal" + (opts.small ? " sm" : ""), role: "dialog", "aria-modal": "true", "aria-labelledby": titleId },
    h("div", { class: "modal-head" }, h("h2", { id: titleId, text: title }), closeBtn),
    body,
    foot,
  );
  const backdrop = h("div", { class: "backdrop" }, modal);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    backdrop.remove();
    document.removeEventListener("keydown", onKey, true);
    opts.onClose?.();
    opener?.focus?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") {
      const f = Array.from(modal.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href], [tabindex]:not([tabindex='-1'])")).filter(
        (x) => !(x as HTMLButtonElement).disabled && x.offsetParent !== null,
      );
      if (!f.length) return;
      const first = f[0],
        last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  closeBtn.onclick = close;
  backdrop.addEventListener("mousedown", (e) => {
    if (e.target === backdrop) close();
  });
  document.addEventListener("keydown", onKey, true);
  document.body.appendChild(backdrop);
  setTimeout(() => {
    const first = modal.querySelector<HTMLElement>(".modal-body input, .modal-body select, .modal-foot .btn.primary, .modal-foot .btn.danger");
    (first || closeBtn).focus();
  }, 0);
  return { close, body, foot, root: modal };
}

/// A confirm dialog; resolves true only on the confirm button.
export function confirmDialog(o: { title: string; body: string | Node; confirm: string; danger?: boolean; cancel?: string }): Promise<boolean> {
  return new Promise((resolve) => {
    let result = false;
    const m = openModal(o.title, { small: true, onClose: () => resolve(result) });
    m.body.appendChild(typeof o.body === "string" ? h("p", { text: o.body }) : o.body);
    const ok = btn(o.confirm, {
      cls: o.danger ? "danger solid" : "primary",
      onClick: () => {
        result = true;
        m.close();
      },
    });
    m.foot.append(btn(o.cancel || "Cancel", { onClick: () => m.close() }), ok);
    setTimeout(() => ok.focus(), 0);
  });
}

/// Labelled form field wrapper with an inline error slot.
export function field(label: string, control: HTMLElement, opts: { hint?: string } = {}): { el: HTMLElement; setError(msg: string | null): void } {
  const err = h("div", { class: "field-error", role: "alert" });
  err.hidden = true;
  const el = h("label", { class: "f" }, h("span", { text: label }), control, opts.hint ? h("span", { class: "hint", text: opts.hint }) : null, err);
  return {
    el,
    setError(msg) {
      err.hidden = !msg;
      err.textContent = msg || "";
      const inp = control.matches("input,select") ? control : control.querySelector("input,select");
      if (inp) {
        if (msg) inp.setAttribute("aria-invalid", "true");
        else inp.removeAttribute("aria-invalid");
      }
    },
  };
}

export function select(opts: { value: string; label: string }[], value: string, onChange?: (v: string) => void): HTMLSelectElement {
  const s = h("select") as HTMLSelectElement;
  for (const o of opts) s.appendChild(h("option", { value: o.value, text: o.label }));
  s.value = value;
  if (onChange) s.addEventListener("change", () => onChange(s.value));
  return s;
}
