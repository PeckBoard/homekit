#!/usr/bin/env node
// Full-stack walkthrough with NO fakes between Peckboard and the accessory:
// scratch Peckboard (homekit.wasm installed) -> real homekit-bridge bundle ->
// real HAP accessory (homekit-bridge/scripts/fake-accessory.mjs, hap-nodejs).
// Pairs through the UI (mDNS row, else manual add), drives controls, pushes
// accessory-side changes back, calls homekit_set through a mock:mcp agent,
// then unpairs. Starts and kills every process itself.
//
//   node test/e2e/real-check.mjs <peckboard-bin> <shots-dir>
import { createRequire } from "module";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import readline from "readline";

const require = createRequire(import.meta.url);
const here = path.dirname(new URL(import.meta.url).pathname);
const plugin = path.resolve(here, "../..");
const bridgeDir = path.resolve(plugin, "../homekit-bridge");
const repo = path.resolve(plugin, "../..");
const { chromium } = require(path.join(repo, "web/node_modules/playwright"));

const [bin, out] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
// Data dirs live in the project, never /tmp (the exec sandbox denies the data dir).
const scratch = fs.mkdtempSync(path.join(plugin, "test/.tmp-real-"));
const procs = [];
let failed = 0;
const check = async (name, fn) => {
  try {
    await fn();
    console.log("ok  ", name);
  } catch (e) {
    failed++;
    console.error("FAIL", name, "—", String(e.message).split("\n")[0]);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (what, fn, ms = 15000) => {
  const end = Date.now() + ms;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    if (Date.now() > end) throw new Error("timed out waiting for " + what);
    await sleep(300);
  }
};
const start = (name, cmd, args, opts = {}) => {
  const p = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"], ...opts });
  const log = fs.createWriteStream(path.join(scratch, name + ".log"));
  p.stdout.pipe(log);
  p.stderr.pipe(log);
  procs.push(p);
  return p;
};

const port = 20000 + Math.floor(Math.random() * 9000);
const bridgePort = port + 3;
const accPort = port + 4;
const bridgeToken = "e2e-token-" + Math.random().toString(36).slice(2, 12);
const base = `http://127.0.0.1:${port}`;
const bridge = `http://127.0.0.1:${bridgePort}`;
const bget = async (p) => (await fetch(bridge + p, { headers: { Authorization: `Bearer ${bridgeToken}` } })).json();

try {
  // 1. Real HAP accessory.
  const acc = start("accessory", "node", [path.join(bridgeDir, "scripts/fake-accessory.mjs"), "--port", String(accPort), "--storage", path.join(scratch, "acc")]);
  const info = await new Promise((res, rej) => {
    const rl = readline.createInterface({ input: acc.stdout });
    rl.on("line", (l) => {
      try {
        const j = JSON.parse(l);
        if (j.setup_code) res(j);
      } catch {}
    });
    acc.on("exit", (c) => rej(new Error("fake accessory exited " + c)));
  });
  console.log("accessory", info.id, info.setup_code, info.port);

  // 2. Real bridge bundle.
  start("bridge", "node", [path.join(bridgeDir, "dist/homekit-bridge.mjs"), "--bind", `127.0.0.1:${bridgePort}`, "--token", bridgeToken, "--data-dir", path.join(scratch, "bridge")]);
  await until("bridge /health", async () => (await bget("/health")).ok);

  // 3. Scratch Peckboard with the plugin.
  const data = path.join(scratch, "data");
  fs.mkdirSync(path.join(data, "plugins"), { recursive: true });
  fs.copyFileSync(path.join(plugin, "dist/plugin.wasm"), path.join(data, "plugins/homekit.wasm"));
  const home = path.join(scratch, "home");
  fs.mkdirSync(home);
  start("peckboard", bin, ["--data-dir", data, "--port", String(port), "--https-port", String(port + 1)], {
    env: { ...process.env, HOME: home, PECKBOARD_NO_RESUME: "1", PECKBOARD_PREINSTALL_PLUGINS: "all", PECKBOARD_BOOTSTRAP_USERNAME: "hk-user", PECKBOARD_BOOTSTRAP_PASSWORD: "hk-password-1234" },
  });
  const api = async (method, p, token, body) => {
    const r = await fetch(base + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const t = await r.text();
    if (!r.ok) throw new Error(`${method} ${p}: ${r.status} ${t}`);
    return t ? JSON.parse(t) : {};
  };
  const { token } = await until("peckboard login", () => api("POST", "/api/auth/login", null, { username: "hk-user", password: "hk-password-1234" }), 60000);
  await api("POST", "/api/plugins/homekit/approval", token, { decision: "approve" });
  await api("PUT", "/api/plugins/homekit/settings", token, { updates: { bridge_url: bridge, bridge_token: bridgeToken } });
  await api("POST", "/api/settings/setup/complete", token);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  ctx.setDefaultTimeout(15000);
  const page = await ctx.newPage();
  await page.addInitScript((t) => localStorage.setItem("peckboard_token", t), token);
  await page.goto(`${base}/plugin-page/homekit/homekit`);
  const f = page.frameLocator('[data-testid="plugin-fullpage-frame"]');
  await f.locator("#app header").waitFor({ timeout: 20000 });

  let deviceId = info.id;
  await check("pair the real accessory through the UI (wrong code first)", async () => {
    await f.getByRole("tab", { name: "Discover" }).click();
    const row = f.locator(`.drow[data-accessory="${info.id}"]`);
    let viaMdns = true;
    try {
      await row.waitFor({ timeout: 12000 });
      await row.getByRole("button", { name: "Pair" }).click();
    } catch {
      viaMdns = false;
      await f.getByRole("textbox", { name: "Address" }).fill("127.0.0.1");
      await f.getByRole("spinbutton", { name: "Port" }).fill(String(accPort));
      await f.getByRole("textbox", { name: "Device id" }).fill(info.id);
      await f.getByRole("button", { name: "Continue" }).click();
    }
    console.log("     paired via", viaMdns ? "mDNS discovery row" : "manual add");
    const dlg = f.getByRole("dialog");
    const code = dlg.getByRole("textbox", { name: /Setup code/ });
    await code.fill("111-11-112");
    await dlg.getByRole("button", { name: "Pair" }).click();
    await dlg.locator(".field-error", { hasText: "rejected this setup code" }).waitFor({ timeout: 20000 });
    await code.fill(info.setup_code);
    await dlg.getByRole("textbox", { name: /Name/ }).fill("Desk lamp");
    await dlg.getByRole("button", { name: "Pair" }).click();
    await f.locator(".card .name", { hasText: "Desk lamp" }).waitFor({ timeout: 30000 });
    deviceId = (await bget("/devices")).devices[0].id;
  });
  await page.screenshot({ path: path.join(out, "real-paired.png") });

  const card = f.locator(".card", { has: f.locator(".name", { hasText: "Desk lamp" }) });
  const charValue = async (type) => {
    const d = await bget(`/devices/${encodeURIComponent(deviceId)}?refresh=1`);
    for (const a of d.accessories) for (const s of a.services) for (const c of s.characteristics) if (c.type === type) return c.value;
  };

  await check("UI toggle reaches the accessory", async () => {
    const sw = card.getByRole("switch", { name: "Power" });
    const before = (await sw.getAttribute("aria-checked")) === "true";
    await sw.click();
    await until("accessory on=" + !before, async () => (await charValue("on")) === !before);
  });

  await check("UI slider sets brightness on the accessory", async () => {
    const r = card.getByRole("slider", { name: "Brightness" });
    await r.fill("37");
    await r.dispatchEvent("change");
    await until("brightness 37", async () => (await charValue("brightness")) === 37);
  });

  await check("accessory-side change shows up in the UI", async () => {
    acc.stdin.write("on\n");
    await until("switch on", async () => (await card.getByRole("switch", { name: "Power" }).getAttribute("aria-checked")) === "true", 12000);
    acc.stdin.write("t 23.5\n");
    await card.locator("text=23.5").waitFor({ timeout: 12000 });
  });
  await page.screenshot({ path: path.join(out, "real-live.png") });

  await check("agent tool homekit_set goes through the running plugin", async () => {
    const folder = await api("POST", "/api/folders", token, { name: "hk", path: scratch });
    const s = await api("POST", "/api/sessions", token, { name: "hk agent", folder_id: folder.id, model: "mock:mcp" });
    const block = (tool, args) => "```mcp\n" + JSON.stringify({ tool, args }) + "\n```";
    await api("POST", `/api/sessions/${s.id}/message`, token, {
      text: block("homekit_set", { device: "Desk lamp", characteristic: "brightness", value: 81 }) + "\n" + block("homekit_list", {}),
      model: "mock:mcp",
    });
    const events = await until("agent-end", async () => {
      const ev = await api("GET", `/api/sessions/${s.id}/events`, token);
      const list = Array.isArray(ev) ? ev : ev.events;
      return list.some((e) => e.kind === "agent-end") && list;
    }, 30000);
    const ends = events.filter((e) => e.kind === "agent-tool-end");
    if (ends.length !== 2) throw new Error("tool ends: " + JSON.stringify(ends.map((e) => e.data)));
    for (const e of ends) if (e.data?.error) throw new Error("tool error: " + e.data.error);
    if (!JSON.stringify(ends[1].data).includes("Desk lamp")) throw new Error("homekit_list missing device");
    await until("brightness 81", async () => (await charValue("brightness")) === 81);
  });

  await check("unpair removes the pairing on the accessory", async () => {
    await card.getByRole("button", { name: "Unpair" }).click();
    const dlg = f.getByRole("dialog");
    await dlg.getByRole("button", { name: "Unpair" }).click();
    await f.locator(".card .name", { hasText: "Desk lamp" }).waitFor({ state: "detached", timeout: 15000 });
    if ((await bget("/devices")).devices.length !== 0) throw new Error("bridge still has the device");
    // The accessory is pairable again (sf=1) — it can go back to Apple Home.
    await until("re-pair possible", async () => {
      const r = await fetch(bridge + "/devices/pair", { method: "POST", headers: { Authorization: `Bearer ${bridgeToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ id: info.id, setup_code: info.setup_code, address: "127.0.0.1", port: accPort }) });
      return r.status === 201;
    });
  });

  // ── Philips Hue: real bridge program <-> simulated Hue Bridge (CLIP v2) ──
  const hue = start("hue", "node", [path.join(bridgeDir, "scripts/fake-hue-bridge.mjs"), "--port", "0"]);
  const hueInfo = await new Promise((res, rej) => {
    readline.createInterface({ input: hue.stdout }).on("line", (l) => {
      try {
        const j = JSON.parse(l);
        if (j.bridge_id) res(j);
      } catch {}
    });
    hue.on("exit", (c) => rej(new Error("fake hue bridge exited " + c)));
  });
  const groups = async () => (await bget("/hue/groups")).groups;
  const livingRoom = async () => (await groups()).find((g) => g.kind === "room" && g.name === "Living room");

  await check("hue: link a bridge by address in the UI (link button)", async () => {
    await f.getByRole("tab", { name: "Discover" }).click();
    const more = f.locator("details.more", { has: f.locator("summary", { hasText: "Link it by address" }) });
    // Auto-opened when no bridge is found; open it only if closed.
    await more.evaluate((el) => (el.open = true));
    await more.getByPlaceholder("192.168.1.30").fill(`127.0.0.1:${hueInfo.port}`);
    await more.getByRole("button", { name: "Link" }).click();
    const dlg = f.getByRole("dialog");
    await dlg.locator("text=Press the button on your Hue Bridge").waitFor();
    await page.waitForTimeout(2500); // a couple of 409 polls first
    hue.stdin.write("press\n");
    await f.locator(".toast", { hasText: /^Linked .+ lights added to Devices/ }).waitFor({ timeout: 20000 });
    await f.locator(`.drow[data-hue-bridge="${hueInfo.bridge_id}"] .pill`, { hasText: /^Linked$/ }).waitFor();
  });

  const living = f.locator(".room", { has: f.locator(".room-head h3", { hasText: "Living room" }) });
  await check("hue: lights grouped under their room, with the Hue badge", async () => {
    await f.getByRole("tab", { name: "Devices" }).click();
    await living.waitFor({ timeout: 15000 });
    await living.locator(".badge.src", { hasText: "Hue" }).first().waitFor();
  });
  await page.screenshot({ path: path.join(out, "real-hue.png") });

  await check("hue: room power toggle reaches the bridge", async () => {
    const before = (await livingRoom()).on;
    await living.getByRole("switch", { name: "Living room power" }).click();
    await until("room on=" + !before, async () => (await livingRoom()).on === !before);
  });

  await check("hue: scene chip recalls the scene", async () => {
    await living.getByRole("button", { name: "Relax" }).click();
    await f.locator(".toast", { hasText: "Relax" }).waitFor({ timeout: 10000 });
    await until("room on after scene", async () => (await livingRoom()).on === true);
  });

  await check("hue: agent tools set a room and recall a scene", async () => {
    fs.mkdirSync(path.join(scratch, "hue-agent"), { recursive: true });
    const folder = await api("POST", "/api/folders", token, { name: "hk-hue", path: path.join(scratch, "hue-agent") });
    const s = await api("POST", "/api/sessions", token, { name: "hue agent", folder_id: folder.id, model: "mock:mcp" });
    const block = (tool, args) => "```mcp\n" + JSON.stringify({ tool, args }) + "\n```";
    await api("POST", `/api/sessions/${s.id}/message`, token, {
      text: [block("homekit_room_set", { room: "Living room", on: true, brightness: 25 }), block("homekit_scene_recall", { scene: "Relax" }), block("homekit_rooms", {})].join("\n"),
      model: "mock:mcp",
    });
    const events = await until("agent-end", async () => {
      const ev = await api("GET", `/api/sessions/${s.id}/events`, token);
      const list = Array.isArray(ev) ? ev : ev.events;
      return list.some((e) => e.kind === "agent-end") && list;
    }, 30000);
    const ends = events.filter((e) => e.kind === "agent-tool-end");
    if (ends.length !== 3) throw new Error("tool ends: " + JSON.stringify(ends.map((e) => e.data)));
    for (const e of ends) if (e.data?.error) throw new Error("tool error: " + e.data.error);
    if (!JSON.stringify(ends[2].data).includes("Living room")) throw new Error("homekit_rooms missing Living room");
  });
  await browser.close();
} catch (e) {
  failed++;
  console.error("FAIL setup —", e.message);
} finally {
  for (const p of procs) p.kill("SIGTERM");
  await sleep(500);
  for (const p of procs) if (p.exitCode === null) p.kill("SIGKILL");
  if (failed) console.error("logs kept in", scratch);
  else fs.rmSync(scratch, { recursive: true, force: true });
}
console.log(failed ? `${failed} check(s) failed` : "all checks passed");
process.exit(failed ? 1 : 0);
