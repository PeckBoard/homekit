// The HomeKit page: an HTML shell (theme tokens + stylesheet) around the
// stage-1 browser bundle (ui/main.ts — see esbuild.js). The page is framed
// in a sandboxed iframe and reaches the JSON API in http.ts through the
// host's parent-proxied fetch bridge.
//
// Palette mirrors Peckboard's own tokens (web/src/index.css), same as
// print-farm: light by default, dark via the host's ?theme=dark stamp or
// prefers-color-scheme, the stamp winning.

import { PAGE_JS } from "./generated/pageBundle";

const DARK = `
    --bg: #0f1117; --surface: #1a1d27; --surface2: #22252f; --surface3: #2a2d38; --hover: #252833;
    --text: #e5e7eb; --text2: #9ca3af; --text3: #8f97a5;
    --accent: hsl(220, 65%, 62%); --accent-hover: hsl(220, 65%, 56%); --accent-subtle: hsl(220, 30%, 16%);
    --danger: #f87171; --danger-bg: rgba(239,68,68,.1); --danger-border: rgba(239,68,68,.3);
    --success: #34d399; --success-bg: rgba(16,185,129,.1); --success-border: rgba(16,185,129,.3);
    --warn: #fbbf24; --warn-bg: rgba(245,158,11,.1); --warn-border: rgba(245,158,11,.3);
    --info: #60a5fa; --info-bg: rgba(59,130,246,.12); --info-border: rgba(59,130,246,.3);
    --border: #2a2d38; --border-strong: #3a3d48; --code-bg: #14161d;
    --shadow: 0 1px 2px rgba(0,0,0,.3); --shadow-lg: 0 12px 32px rgba(0,0,0,.55);
    --overlay: rgba(0,0,0,.6); --skel: #252833; --skel2: #2e3240;
    color-scheme: dark;`;

const CSS = `
  :root {
    --bg: #f8f9fb; --surface: #ffffff; --surface2: #f3f4f6; --surface3: #e9ebef; --hover: #f0f1f4;
    --text: #1a1d23; --text2: #4b5563; --text3: #6b7280;
    --accent: hsl(220, 72%, 50%); --accent-hover: hsl(220, 72%, 44%); --accent-subtle: hsl(220, 60%, 95%);
    --danger: #dc2626; --danger-bg: #fef2f2; --danger-border: #fecaca;
    --success: #059669; --success-bg: #ecfdf5; --success-border: #a7f3d0;
    --warn: #b45309; --warn-bg: #fffbeb; --warn-border: #fde68a;
    --info: #1d4ed8; --info-bg: #eff6ff; --info-border: #bfdbfe;
    --border: #e5e7eb; --border-strong: #d1d5db; --code-bg: #f6f7f9;
    --shadow: 0 1px 2px rgba(16,24,40,.05); --shadow-lg: 0 12px 32px rgba(16,24,40,.18);
    --overlay: rgba(17,24,39,.45); --skel: #eceef2; --skel2: #f6f7f9;
    color-scheme: light;
  }
  :root[data-theme="dark"] {${DARK}
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {${DARK}
    }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; min-height: 100%; }
  body { background: var(--bg); color: var(--text); font: 13px/1.5 Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; -webkit-font-smoothing: antialiased; }
  .mono, code, pre { font-family: ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace; }
  svg.i { width: 14px; height: 14px; flex: 0 0 auto; vertical-align: -2px; }
  [hidden] { display: none !important; }

  /* ── header + tabs ── */
  .top { position: sticky; top: 0; z-index: 20; display: flex; align-items: center; gap: 14px; padding: 10px 18px 0; background: var(--surface); border-bottom: 1px solid var(--border); flex-wrap: wrap; }
  .top h1 { font-size: 15px; margin: 0 0 10px; font-weight: 650; display: flex; align-items: center; gap: 8px; }
  .top h1 svg { width: 18px; height: 18px; color: var(--accent); }
  .summary { display: flex; gap: 12px; font-size: 12px; color: var(--text2); margin-bottom: 10px; font-variant-numeric: tabular-nums; flex-wrap: wrap; }
  .summary b { color: var(--text); font-weight: 600; }
  .tabs { display: flex; gap: 2px; margin-left: auto; align-self: flex-end; }
  .tab { border: none; background: none; color: var(--text2); font: inherit; font-weight: 550; font-size: 13px; padding: 8px 14px 10px; cursor: pointer; border-bottom: 2px solid transparent; display: inline-flex; gap: 6px; align-items: center; }
  .tab:hover { color: var(--text); }
  .tab[aria-selected="true"] { color: var(--accent); border-bottom-color: var(--accent); }
  main { padding: 18px; max-width: 1500px; margin: 0 auto; }
  .section-head { display: flex; align-items: center; gap: 10px; margin: 0 0 12px; flex-wrap: wrap; }
  .section-head h2 { margin: 0; font-size: 12px; font-weight: 700; letter-spacing: .6px; text-transform: uppercase; color: var(--text2); }
  .section-head .grow { flex: 1; }
  .muted { color: var(--text3); }

  /* ── controls ── */
  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 30px; padding: 0 12px; border-radius: 7px; border: 1px solid var(--border-strong); background: var(--surface); color: var(--text); font: inherit; font-size: 12.5px; font-weight: 550; cursor: pointer; white-space: nowrap; text-decoration: none; }
  .btn:hover { background: var(--hover); }
  .btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  .btn.primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
  .btn.danger { color: var(--danger); border-color: var(--danger-border); }
  .btn.danger:hover { background: var(--danger-bg); }
  .btn.danger.solid { background: var(--danger); border-color: var(--danger); color: #fff; }
  .btn.ghost { border-color: transparent; background: transparent; color: var(--text2); }
  .btn.ghost:hover { background: var(--surface3); color: var(--text); }
  .btn.sm { height: 26px; padding: 0 9px; font-size: 12px; }
  .btn[disabled] { opacity: .55; cursor: not-allowed; }
  .btn:focus-visible, .tab:focus-visible, a:focus-visible, .switch:focus-visible, input[type=range]:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  label.f { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text2); font-weight: 550; min-width: 0; }
  label.f .hint { font-weight: 400; color: var(--text3); font-size: 11.5px; }
  input[type=text], input[type=number], select { background: var(--surface); color: var(--text); border: 1px solid var(--border-strong); border-radius: 7px; padding: 0 10px; height: 32px; font: inherit; font-size: 13px; width: 100%; }
  input:focus, select:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-subtle); }
  input[aria-invalid="true"], select[aria-invalid="true"] { border-color: var(--danger); }
  input[disabled], select[disabled] { opacity: .6; cursor: not-allowed; }
  .field-error { color: var(--danger); font-size: 11.5px; font-weight: 500; }
  .reason { color: var(--text3); font-size: 12px; }
  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .grid3 { display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 12px; }

  /* switch */
  .switch { position: relative; width: 38px; height: 22px; border-radius: 999px; border: 1px solid var(--border-strong); background: var(--surface3); cursor: pointer; padding: 0; flex: none; transition: background .15s; }
  .switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; box-shadow: var(--shadow); transition: transform .15s; }
  .switch[aria-checked="true"] { background: var(--accent); border-color: var(--accent); }
  .switch[aria-checked="true"]::after { transform: translateX(16px); }
  .switch[disabled] { opacity: .5; cursor: not-allowed; }

  /* ── badges / pills ── */
  .badge { display: inline-flex; align-items: center; gap: 4px; border-radius: 5px; padding: 0 6px; font-size: 10.5px; font-weight: 600; white-space: nowrap; line-height: 18px; border: 1px solid var(--border); background: var(--surface2); color: var(--text2); }
  .pill { display: inline-flex; align-items: center; gap: 6px; border-radius: 999px; padding: 0 9px 0 8px; font-size: 11.5px; font-weight: 650; line-height: 22px; border: 1px solid; white-space: nowrap; }
  .pill::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
  .pill.ok { color: var(--success); background: var(--success-bg); border-color: var(--success-border); }
  .pill.busy { color: var(--info); background: var(--info-bg); border-color: var(--info-border); }
  .pill.busy::before { animation: pulse 1.4s ease-in-out infinite; }
  .pill.warn { color: var(--warn); background: var(--warn-bg); border-color: var(--warn-border); }
  .pill.bad { color: var(--danger); background: var(--danger-bg); border-color: var(--danger-border); }
  .pill.muted { color: var(--text3); background: var(--surface2); border-color: var(--border); }
  @keyframes pulse { 50% { opacity: .35; } }

  /* ── banners ── */
  .banner { display: flex; gap: 10px; align-items: flex-start; padding: 10px 14px; border-radius: 10px; border: 1px solid; margin-bottom: 14px; }
  .banner svg.i { width: 16px; height: 16px; margin-top: 1px; }
  .banner .grow { flex: 1; min-width: 0; }
  .banner b { display: block; margin-bottom: 2px; }
  .banner p { margin: 0; color: var(--text2); font-size: 12.5px; }
  .banner .row { margin-top: 8px; }
  .banner.warn { background: var(--warn-bg); border-color: var(--warn-border); }
  .banner.warn > svg { color: var(--warn); }
  .banner.bad { background: var(--danger-bg); border-color: var(--danger-border); }
  .banner.bad > svg { color: var(--danger); }
  .banner.info { background: var(--info-bg); border-color: var(--info-border); }
  .banner.info > svg { color: var(--info); }
  .banner.ok { background: var(--success-bg); border-color: var(--success-border); }
  .banner.ok > svg { color: var(--success); }
  .prog { height: 8px; background: var(--surface3); border-radius: 999px; overflow: hidden; }
  .prog > div { height: 100%; background: var(--accent); border-radius: 999px; }
  .prog.indet > div { width: 35% !important; animation: indet 1.2s ease-in-out infinite; }
  @keyframes indet { 0% { transform: translateX(-100%); } 100% { transform: translateX(290%); } }
  details.log summary { cursor: pointer; color: var(--text2); font-size: 12px; }
  details.log pre { margin: 6px 0 0; padding: 8px 10px; background: var(--code-bg); border: 1px solid var(--border); border-radius: 6px; font-size: 11px; white-space: pre-wrap; word-break: break-word; max-height: 220px; overflow: auto; }

  /* ── device cards ── */
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 14px; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow); overflow: hidden; display: flex; flex-direction: column; min-width: 0; }
  .card.offline { border-color: var(--warn-border); }
  .card-head { display: flex; align-items: center; gap: 8px; padding: 11px 14px; min-width: 0; }
  .card-head .ico { width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; background: var(--accent-subtle); color: var(--accent); flex: none; }
  .card-head .ico svg { width: 16px; height: 16px; }
  .card-head .t { min-width: 0; flex: 1; }
  .card-head .name-row { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .card-head .name { font-weight: 650; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .card-head .sub { color: var(--text3); font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .card-body { padding: 4px 14px 12px; display: flex; flex-direction: column; gap: 10px; flex: 1; }
  .svc { border-top: 1px solid var(--border); padding-top: 10px; display: flex; flex-direction: column; gap: 8px; }
  .svc:first-child { border-top: none; padding-top: 6px; }
  .svc-head { display: flex; align-items: center; gap: 8px; font-size: 11.5px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase; color: var(--text3); }
  .svc-head .grow { flex: 1; }
  .ctl { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: 4px 10px; align-items: center; font-size: 12.5px; }
  .ctl > .k { color: var(--text2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ctl > .v { display: flex; align-items: center; gap: 8px; min-width: 0; font-variant-numeric: tabular-nums; }
  .ctl > .v input[type=range] { flex: 1; min-width: 80px; accent-color: var(--accent); }
  .ctl > .v .num { min-width: 52px; text-align: right; color: var(--text); font-weight: 600; }
  .ctl > .v select { height: 28px; font-size: 12.5px; }
  .ctl > .v input[type=number], .ctl > .v input[type=text] { height: 28px; font-size: 12.5px; max-width: 160px; }
  .ctl.ro > .v { font-weight: 600; }
  .ctl.err > .v { color: var(--danger); }
  .hue { background: linear-gradient(90deg, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00); border-radius: 999px; height: 6px; }
  .card-foot { display: flex; gap: 6px; padding: 10px 14px; border-top: 1px solid var(--border); background: var(--surface2); flex-wrap: wrap; align-items: center; }
  .card-foot .spacer { flex: 1; }
  .msg { font-size: 12px; color: var(--warn); background: var(--warn-bg); border: 1px solid var(--warn-border); border-radius: 6px; padding: 5px 8px; overflow-wrap: anywhere; }

  /* ── discover list ── */
  .dlist { display: grid; gap: 10px; }
  .drow { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px 14px; padding: 12px 14px; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; box-shadow: var(--shadow); align-items: center; }
  .drow .t { display: flex; align-items: center; gap: 8px; min-width: 0; flex-wrap: wrap; }
  .drow .t b { font-size: 13.5px; }
  .drow .sub { color: var(--text2); font-size: 12px; display: flex; gap: 10px; flex-wrap: wrap; min-width: 0; }
  .drow .acts { grid-column: 2; grid-row: 1 / span 2; display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
  .drow .note { grid-column: 1 / -1; }
  .drow .note .banner { margin: 0; }
  .panel { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow); padding: 14px; display: flex; flex-direction: column; gap: 12px; margin-top: 18px; }
  .panel h3 { margin: 0; font-size: 13px; font-weight: 650; }
  .panel p { margin: 0; color: var(--text2); font-size: 12.5px; }

  /* ── rooms (Hue) ── */
  .rooms { display: flex; flex-direction: column; gap: 22px; }
  .room-head { display: flex; align-items: center; gap: 10px 18px; flex-wrap: wrap; margin: 0 0 10px; padding: 10px 14px; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow); }
  .room:has(> .cards[hidden]) > .room-head { margin-bottom: 0; }
  .room-title { display: flex; align-items: baseline; gap: 8px; min-width: 0; flex: 1 1 200px; flex-wrap: wrap; }
  .room-title h3 { margin: 0; font-size: 14px; font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .room-title .muted { font-size: 12px; font-variant-numeric: tabular-nums; }
  .room-ctl { display: flex; align-items: center; gap: 10px; flex: 0 1 340px; min-width: 240px; }
  .room-ctl .state { width: 24px; font-size: 12px; }
  .room-ctl input[type=range] { flex: 1; min-width: 80px; accent-color: var(--accent); }
  .room-ctl .num { min-width: 40px; text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }
  .chips { flex-basis: 100%; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .chips-k { font-size: 11px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase; color: var(--text3); margin-right: 2px; }
  .chip { display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 11px; border-radius: 999px; border: 1px solid var(--border-strong); background: var(--surface2); color: var(--text); font: inherit; font-size: 12px; font-weight: 550; cursor: pointer; white-space: nowrap; }
  .chip:hover { background: var(--accent-subtle); border-color: var(--accent); color: var(--accent); }
  .chip:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .chip.busy { opacity: .7; cursor: progress; }
  .chip.done { background: var(--success-bg); border-color: var(--success-border); color: var(--success); }
  .chip[disabled]:not(.busy):not(.done) { opacity: .55; cursor: not-allowed; }
  .room-lights, .room-why { flex-basis: 100%; font-size: 12px; }
  .badge.src { color: var(--accent); background: var(--accent-subtle); border-color: transparent; }

  /* ── Hue Bridge (Discover) ── */
  .hue-section { margin-bottom: 28px; }
  details.more { margin-top: 10px; }
  details.more summary { cursor: pointer; color: var(--accent); font-size: 12.5px; font-weight: 550; width: fit-content; }
  details.more .more-body { margin-top: 10px; padding: 14px; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow); display: flex; flex-direction: column; gap: 12px; }
  .empty.sm { padding: 24px; }
  .empty.sm p { margin-bottom: 0; }
  .link-hero { display: flex; gap: 14px; align-items: flex-start; }
  .link-ico { width: 48px; height: 48px; border-radius: 12px; display: grid; place-items: center; background: var(--accent-subtle); color: var(--accent); flex: none; }
  .link-ico svg { width: 24px; height: 24px; }
  .link-hero h3 { margin: 0 0 4px; font-size: 14px; font-weight: 650; }
  .link-wait { display: flex; flex-direction: column; gap: 6px; }
  .link-wait .prog > div { transition: width .25s linear; }
  .countdown { font-size: 12px; color: var(--text2); font-variant-numeric: tabular-nums; }
  /* skeleton */
  .skel { background: linear-gradient(90deg, var(--skel) 25%, var(--skel2) 50%, var(--skel) 75%); background-size: 200% 100%; animation: shimmer 1.3s linear infinite; border-radius: 12px; height: 180px; }
  @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

  /* ── empty ── */
  .empty { padding: 44px 24px; text-align: center; color: var(--text2); background: var(--surface); border: 1px dashed var(--border-strong); border-radius: 12px; }
  .empty .ico { width: 44px; height: 44px; border-radius: 12px; display: inline-grid; place-items: center; background: var(--accent-subtle); color: var(--accent); margin-bottom: 10px; }
  .empty .ico svg { width: 22px; height: 22px; }
  .empty h3 { margin: 0 0 4px; font-size: 14px; color: var(--text); font-weight: 650; }
  .empty p { margin: 0 auto 14px; max-width: 420px; font-size: 12.5px; }

  /* ── modal + toasts ── */
  .backdrop { position: fixed; inset: 0; background: var(--overlay); z-index: 70; display: grid; place-items: center; padding: 16px; }
  .modal { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--shadow-lg); width: min(520px, 100%); max-height: calc(100vh - 32px); display: flex; flex-direction: column; }
  .modal.sm { width: min(420px, 100%); }
  .modal-head { padding: 14px 18px 10px; display: flex; align-items: center; gap: 8px; }
  .modal-head h2 { margin: 0; font-size: 15px; font-weight: 650; flex: 1; }
  .modal-body { padding: 4px 18px 14px; overflow: auto; display: flex; flex-direction: column; gap: 12px; }
  .modal-body p { margin: 0; color: var(--text2); }
  .modal-foot { padding: 12px 18px; border-top: 1px solid var(--border); display: flex; gap: 8px; justify-content: flex-end; align-items: center; flex-wrap: wrap; }
  .modal-foot .reason { margin-right: auto; }
  .toasts { position: fixed; right: 16px; bottom: 16px; z-index: 100; display: flex; flex-direction: column; gap: 8px; max-width: min(380px, calc(100vw - 32px)); }
  .toast { display: flex; gap: 8px; align-items: flex-start; background: var(--surface); border: 1px solid var(--border-strong); border-radius: 10px; box-shadow: var(--shadow-lg); padding: 10px 12px; font-size: 12.5px; animation: tin .18s ease-out; }
  .toast.bad { border-color: var(--danger-border); }
  .toast.bad svg { color: var(--danger); }
  .toast.ok svg { color: var(--success); }
  .toast .grow { flex: 1; overflow-wrap: anywhere; }
  @keyframes tin { from { transform: translateY(8px); opacity: 0; } }

  @media (max-width: 640px) {
    main { padding: 12px; }
    .top { padding: 8px 12px 0; gap: 4px 12px; }
    .tabs { margin-left: 0; width: 100%; }
    .tab { flex: 1; justify-content: center; padding: 8px 6px 10px; }
    .cards { grid-template-columns: minmax(0, 1fr); }
    .grid2, .grid3 { grid-template-columns: minmax(0, 1fr); }
    .drow { grid-template-columns: minmax(0, 1fr); }
    .drow .acts { grid-column: 1; grid-row: auto; justify-content: flex-start; }
    .ctl { grid-template-columns: 96px minmax(0, 1fr); }
    .room-ctl { flex-basis: 100%; min-width: 0; }
    .link-hero { flex-direction: column; }
  }
  @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
`;

export const PAGE: string =
  "<!doctype html>\n" +
  '<html lang="en">\n' +
  "<head>\n" +
  '<meta charset="utf-8" />\n' +
  '<meta name="viewport" content="width=device-width, initial-scale=1" />\n' +
  "<title>HomeKit</title>\n" +
  "<script>(function(){var t=new URLSearchParams(location.search).get(\"theme\");" +
  'if(t==="dark"||t==="light")document.documentElement.dataset.theme=t;})();</script>\n' +
  "<style>" +
  CSS +
  "</style>\n" +
  "</head>\n" +
  "<body>\n" +
  '<div id="app"></div>\n' +
  "<script>\n" +
  PAGE_JS +
  "\n</script>\n" +
  "</body>\n" +
  "</html>\n";
