#!/usr/bin/env node
// Browser walkthrough of the HomeKit page against a running scratch Peckboard
// (homekit.wasm in its plugins dir) and the fake bridge
// (test/fixtures/fake-bridge.mjs). Approves the plugin, points it at the fake
// bridge, drives the real UI, asserts the key flows, and writes screenshots.
//
//   node test/e2e/page-check.mjs <base-url> <user> <pass> <bridge-url> <bridge-token> <out-dir>
//
// Uses the repo's Playwright (web/node_modules). Not part of `npm test`.
import { createRequire } from "module";
import path from "path";
import fs from "fs";
import { spawn } from "child_process";

const require = createRequire(import.meta.url);
const here = path.dirname(new URL(import.meta.url).pathname);
const { chromium } = require(path.resolve(here, "../../../../web/node_modules/playwright"));

const [base, user, pass, bridgeUrl, bridgeToken, out] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
let failed = 0;
const check = async (name, fn) => {
  try {
    await fn();
    console.log("ok  ", name);
  } catch (e) {
    failed++;
    console.error("FAIL", name, "—", e.message.split("\n")[0]);
  }
};

const api = async (method, p, token, body) => {
  const r = await fetch(base + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${p}: ${r.status} ${t}`);
  return t ? JSON.parse(t) : {};
};

// The fake bridge directly (its Hue light state, the "link button").
const BID = "ecb5fafffe0a1b2c";
const fb = (method, p) => fetch(bridgeUrl + p, { method, headers: { Authorization: `Bearer ${bridgeToken}` } });
const hueVal = async (rid, type) => {
  const d = await (await fb("GET", `/devices/${encodeURIComponent(`hue:${BID}:${rid}`)}`)).json();
  return d.accessories[0].services[1].characteristics.find((c) => c.type === type).value;
};

const { token } = await api("POST", "/api/auth/login", null, { username: user, password: pass });
await api("POST", "/api/plugins/homekit/approval", token, { decision: "approve" });
await api("PUT", "/api/plugins/homekit/settings", token, { updates: { bridge_url: bridgeUrl, bridge_token: bridgeToken } });
// The first-run wizard would overlay the page (same as web/e2e/global-setup.ts).
await api("POST", "/api/settings/setup/complete", token);

for (const scheme of ["light", "dark"]) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: 1360, height: 900 } });
  ctx.setDefaultTimeout(15000);
  const page = await ctx.newPage();
  await page.addInitScript((t) => localStorage.setItem("peckboard_token", t), token);
  await page.goto(`${base}/plugin-page/homekit/homekit`);
  const f = page.frameLocator('[data-testid="plugin-fullpage-frame"]');
  await f.locator("#app header").waitFor({ timeout: 20000 });
  await f.locator(".card[data-device]").first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(out, `devices-${scheme}.png`) });
  if (scheme === "dark") {
    // Linked during the light pass: rooms, then the Hue section and Unlink.
    await check("dark: Hue rooms render", async () => {
      await f.locator(`.room[data-room="${BID}:room-living"] .room-head`).waitFor();
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(out, `devices-hue-dark.png`) });
    });
    await check("hue: unlink asks to confirm, then the bridge is unlinked", async () => {
      await f.getByRole("tab", { name: "Discover" }).click();
      const row = f.locator(`.drow[data-hue-bridge="${BID}"]`);
      await row.locator(".pill", { hasText: /^Linked$/ }).waitFor();
      await page.screenshot({ path: path.join(out, `discover-dark.png`) });
      await row.getByRole("button", { name: "Unlink" }).click();
      const dlg = f.getByRole("dialog");
      await dlg.locator("text=Nothing changes on the bridge").waitFor();
      await page.screenshot({ path: path.join(out, `hue-unlink-confirm-dark.png`) });
      await dlg.getByRole("button", { name: "Unlink" }).click();
      await row.locator(".pill", { hasText: "Not linked" }).waitFor();
      await row.getByRole("button", { name: "Link" }).click();
      await f.getByRole("dialog").locator(".countdown").waitFor();
      await page.waitForTimeout(2500);
      await page.screenshot({ path: path.join(out, `hue-link-waiting-dark.png`) });
      await f.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    });
    await browser.close();
    continue;
  }

  const lamp = f.locator('.card[data-device="AA:BB:CC:00:00:01"]');
  const thermo = f.locator('.card[data-device="AA:BB:CC:00:00:02"]');
  const lock = f.locator('.card[data-device="AA:BB:CC:00:00:03"]');

  await check("hides accessory-information, shows services", async () => {
    if ((await f.locator(".badge", { hasText: "accessory-information" }).count()) !== 0) throw new Error("accessory-information rendered");
    await thermo.locator(".badge", { hasText: "humidity-sensor" }).waitFor();
    await thermo.locator(".ctl", { hasText: "Humidity" }).locator(".v", { hasText: "44 %" }).waitFor();
  });

  await check("toggle writes through the bridge", async () => {
    const sw = lamp.getByRole("switch", { name: "Power" });
    await sw.click();
    await page.waitForTimeout(800);
    const d = await (await fetch(`${bridgeUrl}/devices/AA:BB:CC:00:00:01`, { headers: { Authorization: `Bearer ${bridgeToken}` } })).json();
    if (d.accessories[0].services[1].characteristics[0].value !== false) throw new Error("bridge value not false");
    if ((await lamp.getByRole("switch", { name: "Power" }).getAttribute("aria-checked")) !== "false") throw new Error("switch not off");
  });

  await check("slider sets brightness", async () => {
    const r = lamp.getByRole("slider", { name: "Brightness" });
    await r.fill("25");
    await r.dispatchEvent("change");
    await page.waitForTimeout(800);
    const d = await (await fetch(`${bridgeUrl}/devices/AA:BB:CC:00:00:01`, { headers: { Authorization: `Bearer ${bridgeToken}` } })).json();
    if (d.accessories[0].services[1].characteristics[1].value !== 25) throw new Error("brightness " + d.accessories[0].services[1].characteristics[1].value);
  });

  await check("thermostat mode is a dropdown", async () => {
    const s = thermo.getByRole("combobox", { name: "Mode" });
    await s.selectOption({ label: "Cool" });
    await page.waitForTimeout(800);
    await thermo.locator(".ctl", { hasText: "Mode" }).locator("select").evaluate((el) => {
      if (el.value !== "2") throw new Error("mode not cool");
    });
  });

  await check("offline device: controls disabled with reason", async () => {
    await lock.locator(".msg", { hasText: "is offline" }).waitFor();
    if (!(await lock.getByRole("combobox", { name: "Lock" }).isDisabled())) throw new Error("lock select enabled");
    if (!(await lock.getByRole("button", { name: "Identify" }).isDisabled())) throw new Error("identify enabled");
  });
  await page.screenshot({ path: path.join(out, `devices-after-light.png`) });

  await check("rename", async () => {
    await lamp.getByRole("button", { name: "Rename" }).click();
    const dlg = f.getByRole("dialog");
    await dlg.getByRole("textbox").fill("Office lamp");
    await dlg.getByRole("button", { name: "Save" }).click();
    await f.locator(".card .name", { hasText: "Office lamp" }).waitFor();
  });

  await check("discover: owned elsewhere is explained and blocked", async () => {
    await f.getByRole("tab", { name: "Discover" }).click();
    const row = f.locator('.drow[data-accessory="DD:EE:FF:00:00:11"]');
    await row.locator("text=Remove it from Apple Home (or factory reset it) first").waitFor({ timeout: 15000 });
    if (!(await row.getByRole("button", { name: "Pair" }).isDisabled())) throw new Error("pair enabled");
  });
  await page.screenshot({ path: path.join(out, `discover-light.png`) });

  await check("pair dialog validates the setup code inline, then pairs", async () => {
    await f.locator('.drow[data-accessory="DD:EE:FF:00:00:10"]').getByRole("button", { name: "Pair" }).click();
    const dlg = f.getByRole("dialog");
    const code = dlg.getByRole("textbox", { name: /Setup code/ });
    await code.fill("1234");
    await code.blur();
    await dlg.locator(".field-error", { hasText: "8 digits" }).waitFor();
    if (!(await dlg.getByRole("button", { name: "Pair" }).isDisabled())) throw new Error("pair enabled with bad code");
    await dlg.locator(".reason", { hasText: "valid setup code" }).waitFor();
    await page.screenshot({ path: path.join(out, `pair-invalid-light.png`) });
    await code.fill("99999999");
    await dlg.getByRole("button", { name: "Pair" }).click();
    await dlg.locator(".field-error", { hasText: "rejected this setup code" }).waitFor();
    await code.fill("11122333");
    await dlg.getByRole("textbox", { name: /Name/ }).fill("Kettle plug");
    await dlg.getByRole("button", { name: "Pair" }).click();
    await f.locator(".card .name", { hasText: "Kettle plug" }).waitFor({ timeout: 15000 });
  });

  await check("unpair asks to confirm, explains Apple Home", async () => {
    const card = f.locator(".card", { has: f.locator(".name", { hasText: "Kettle plug" }) });
    await card.getByRole("button", { name: "Unpair" }).click();
    const dlg = f.getByRole("dialog");
    await dlg.locator("text=add it back to Apple Home").waitFor();
    await page.screenshot({ path: path.join(out, `unpair-confirm-light.png`) });
    await dlg.getByRole("button", { name: "Unpair" }).click();
    await f.locator(".card .name", { hasText: "Kettle plug" }).waitFor({ state: "detached", timeout: 10000 });
  });

  // ── Philips Hue ──
  const hueRow = f.locator(`.drow[data-hue-bridge="${BID}"]`);
  const living = f.locator(`.room[data-room="${BID}:room-living"]`);

  await check("hue: link waits for the button, times out with Retry, then links", async () => {
    await f.getByRole("tab", { name: "Discover" }).click();
    await hueRow.locator(".pill", { hasText: "Not linked" }).waitFor();
    await page.screenshot({ path: path.join(out, `discover-hue-light.png`) });
    await hueRow.getByRole("button", { name: "Link" }).click();
    const dlg = f.getByRole("dialog");
    await dlg.locator("text=Press the button on your Hue Bridge").waitFor();
    await dlg.locator(".countdown", { hasText: /Waiting for the link button… \d+ s/ }).waitFor();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(out, `hue-link-waiting-light.png`) });
    await dlg.locator("text=The link button wasn't pressed in time").waitFor({ timeout: 40000 });
    await page.screenshot({ path: path.join(out, `hue-link-timeout-light.png`) });
    await fb("POST", "/_test/press-link-button");
    await dlg.getByRole("button", { name: "Try again" }).click();
    await f.locator(".toast", { hasText: "Linked Hue Bridge" }).waitFor();
    await hueRow.locator(".pill", { hasText: /^Linked$/ }).waitFor();
    await hueRow.locator("text=3 lights").waitFor();
  });

  await check("hue: lights grouped by room, Hue badge, no Unpair", async () => {
    await f.getByRole("tab", { name: "Devices" }).click();
    await living.locator(".room-head h3", { hasText: "Living room" }).waitFor({ timeout: 15000 });
    const sofa = living.locator(`.card[data-device="hue:${BID}:l-sofa"]`);
    await sofa.locator(".badge.src", { hasText: "Hue" }).waitFor();
    if (await sofa.getByRole("button", { name: "Unpair" }).count()) throw new Error("Unpair shown on a Hue light");
    await f.locator(`.room[data-room="${BID}:zone-down"] .badge`, { hasText: "Zone" }).waitFor();
    await f.locator('.room[data-room="other"] .card[data-device="AA:BB:CC:00:00:02"]').waitFor();
    await living.getByRole("button", { name: "Concentrate" }).waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(out, `devices-hue-light.png`) });
  });

  await check("hue: room power toggle switches every light", async () => {
    await living.getByRole("switch", { name: "Living room power" }).click();
    await page.waitForTimeout(1200);
    for (const l of ["l-sofa", "l-ceiling"]) if ((await hueVal(l, "on")) !== false) throw new Error(`${l} still on`);
    await living.locator(".room-title", { hasText: "0 of 2 lights on" }).waitFor();
  });

  await check("hue: room brightness slider (turns the room on)", async () => {
    const r = living.getByRole("slider", { name: "Living room brightness" });
    await r.fill("30");
    await r.dispatchEvent("change");
    await page.waitForTimeout(1200);
    for (const l of ["l-sofa", "l-ceiling"]) {
      if ((await hueVal(l, "brightness")) !== 30 || (await hueVal(l, "on")) !== true) throw new Error(`${l} not on at 30`);
    }
  });

  await check("hue: scene recall with feedback", async () => {
    await living.getByRole("button", { name: "Concentrate" }).click();
    await f.locator(".toast", { hasText: "Scene “Concentrate” recalled in Living room" }).waitFor();
    await page.screenshot({ path: path.join(out, `hue-scene-light.png`) });
    if ((await hueVal("l-sofa", "brightness")) !== 100) throw new Error("scene not applied");
  });

  await check("phone width renders", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await f.getByRole("tab", { name: "Devices" }).click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(out, `devices-phone-light.png`) });
    await f.getByRole("tab", { name: "Discover" }).click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(out, `discover-phone-light.png`) });
  });
  await browser.close();
}
// ── a homekit-bridge older than 0.2.0: Hue shows "Update homekit-bridge" ──
const oldPort = Number(new URL(bridgeUrl).port) + 7;
const oldBridge = spawn(process.execPath, [path.resolve(here, "../fixtures/fake-bridge.mjs"), String(oldPort), bridgeToken, "old"], { stdio: "ignore" });
try {
  await new Promise((r) => setTimeout(r, 600));
  await api("PUT", "/api/plugins/homekit/settings", token, { updates: { bridge_url: `http://127.0.0.1:${oldPort}` } });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ colorScheme: "light", viewport: { width: 1360, height: 900 } });
  ctx.setDefaultTimeout(15000);
  const page = await ctx.newPage();
  await page.addInitScript((t) => localStorage.setItem("peckboard_token", t), token);
  await page.goto(`${base}/plugin-page/homekit/homekit`);
  const f = page.frameLocator('[data-testid="plugin-fullpage-frame"]');
  await check("old homekit-bridge: HomeKit still works, Hue asks for an update", async () => {
    await f.locator('.card[data-device="AA:BB:CC:00:00:01"]').waitFor({ timeout: 20000 });
    await f.getByRole("tab", { name: "Discover" }).click();
    const n = f.locator('[data-hue="outdated"]');
    await n.locator("text=Update homekit-bridge to use Philips Hue").waitFor();
    await n.locator("text=this one is 0.1.0").waitFor();
    if (!(await f.getByRole("button", { name: "Scan again" }).first().isDisabled())) throw new Error("Hue scan enabled on an old bridge");
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(out, `hue-outdated-light.png`) });
  });
  await browser.close();
} finally {
  oldBridge.kill();
  await api("PUT", "/api/plugins/homekit/settings", token, { updates: { bridge_url: bridgeUrl } }).catch(() => undefined);
}

console.log(failed ? `${failed} check(s) failed` : "all checks passed");
process.exitCode = failed ? 1 : 0;
