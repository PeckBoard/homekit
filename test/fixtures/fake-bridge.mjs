#!/usr/bin/env node
// A fake homekit-bridge implementing BRIDGE_API.md in memory, for driving the
// HomeKit page / tools without real accessories:
//
//   node test/fixtures/fake-bridge.mjs <port> <token>
//
// Point the plugin's bridge_url setting at http://127.0.0.1:<port> and its
// bridge_token at <token>. Pairing accepts setup code 111-22-333.
import http from "http";

const [port = "7799", token = "fake-token-0123456789"] = process.argv.slice(2);

const info = (name) => ({
  iid: 1,
  type: "accessory-information",
  name: "Accessory Information",
  characteristics: [
    { iid: 2, type: "identify", format: "bool", perms: ["pw"], value: null },
    { iid: 3, type: "name", format: "string", perms: ["pr"], value: name },
  ],
});
const ch = (iid, type, format, perms, value, extra = {}) => ({ iid, type, format, perms, unit: null, min: null, max: null, step: null, valid_values: null, value, ...extra });
const RW = ["pr", "pw", "ev"];
const RO = ["pr", "ev"];

const devices = new Map();
function add(d) {
  devices.set(d.id, { connected: true, last_seen: new Date().toISOString(), firmware: "1.0.0", ...d });
}
add({
  id: "AA:BB:CC:00:00:01",
  name: "Desk lamp",
  accessory_name: "Bulb 0001",
  manufacturer: "Nanoleaf",
  model: "Essentials A19",
  category: 5,
  category_name: "lightbulb",
  address: "192.168.1.41",
  port: 5001,
  accessories: [
    {
      aid: 1,
      name: "Bulb 0001",
      services: [
        info("Bulb 0001"),
        {
          iid: 9,
          type: "lightbulb",
          name: "Light",
          primary: true,
          characteristics: [
            ch(10, "on", "bool", RW, true),
            ch(11, "brightness", "int", RW, 60, { unit: "percentage", min: 0, max: 100, step: 1 }),
            ch(12, "hue", "float", RW, 30, { unit: "arcdegrees", min: 0, max: 360, step: 1 }),
            ch(13, "saturation", "float", RW, 80, { unit: "percentage", min: 0, max: 100, step: 1 }),
            ch(14, "color-temperature", "uint32", RW, 300, { min: 140, max: 500, step: 1 }),
          ],
        },
      ],
    },
  ],
});
add({
  id: "AA:BB:CC:00:00:02",
  name: "Hallway thermostat",
  accessory_name: "ecobee3",
  manufacturer: "ecobee",
  model: "ecobee3 lite",
  category: 9,
  category_name: "thermostat",
  address: "192.168.1.42",
  port: 5002,
  accessories: [
    {
      aid: 1,
      name: "ecobee3",
      services: [
        info("ecobee3"),
        {
          iid: 20,
          type: "thermostat",
          name: "Thermostat",
          primary: true,
          characteristics: [
            ch(21, "current-temperature", "float", RO, 20.4, { unit: "celsius", min: 0, max: 100, step: 0.1 }),
            ch(22, "target-temperature", "float", RW, 21, { unit: "celsius", min: 10, max: 38, step: 0.5 }),
            ch(23, "current-heating-cooling-state", "uint8", RO, 1, { min: 0, max: 2, valid_values: [0, 1, 2] }),
            ch(24, "target-heating-cooling-state", "uint8", RW, 1, { min: 0, max: 3, valid_values: [0, 1, 2, 3] }),
            ch(25, "temperature-display-units", "uint8", RW, 0, { min: 0, max: 1 }),
          ],
        },
        { iid: 30, type: "humidity-sensor", name: "Humidity", characteristics: [ch(31, "current-relative-humidity", "float", RO, 44, { unit: "percentage", min: 0, max: 100 })] },
        {
          iid: 40,
          type: "battery",
          name: "Battery",
          characteristics: [ch(41, "battery-level", "uint8", RO, 87, { unit: "percentage", min: 0, max: 100 }), ch(42, "status-low-battery", "uint8", RO, 0, { min: 0, max: 1 })],
        },
      ],
    },
  ],
});
add({
  id: "AA:BB:CC:00:00:03",
  name: "Front door",
  accessory_name: "Lock 03",
  manufacturer: "August",
  model: "Smart Lock",
  category: 6,
  category_name: "door-lock",
  address: "192.168.1.43",
  port: 5003,
  connected: false,
  accessories: [
    {
      aid: 1,
      name: "Lock 03",
      services: [
        info("Lock 03"),
        {
          iid: 50,
          type: "lock-mechanism",
          name: "Lock",
          primary: true,
          characteristics: [ch(51, "lock-current-state", "uint8", RO, 1, { min: 0, max: 3 }), ch(52, "lock-target-state", "uint8", RW, 1, { min: 0, max: 1 })],
        },
        { iid: 60, type: "contact-sensor", name: "Door", characteristics: [ch(61, "contact-sensor-state", "uint8", RO, 0, { min: 0, max: 1 })] },
      ],
    },
  ],
});

const discovered = [
  { id: "AA:BB:CC:00:00:01", name: "Bulb 0001", model: "Essentials A19", category: 5, category_name: "lightbulb", address: "192.168.1.41", port: 5001, paired_with_us: true, available_for_pairing: false },
  { id: "DD:EE:FF:00:00:10", name: "Eve Energy 1A2B", model: "Eve Energy", category: 7, category_name: "outlet", address: "192.168.1.50", port: 51827, paired_with_us: false, available_for_pairing: true },
  { id: "DD:EE:FF:00:00:11", name: "Meross Plug", model: "MSS110", category: 7, category_name: "outlet", address: "192.168.1.51", port: 80, paired_with_us: false, available_for_pairing: false },
];

let seq = 0;
const send = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
const err = (res, status, code, error) => send(res, status, { error, code });
const findDev = (raw) => {
  const want = decodeURIComponent(raw).replace(/:/g, "").toLowerCase();
  for (const d of devices.values()) if (d.id.replace(/:/g, "").toLowerCase() === want) return d;
  return null;
};

http
  .createServer((req, res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      if (req.headers.authorization !== `Bearer ${token}`) return err(res, 401, "unauthorized", "missing or wrong token");
      const url = new URL(req.url, "http://x");
      const parts = url.pathname.split("/").filter(Boolean);
      let body = {};
      try {
        body = data ? JSON.parse(data) : {};
      } catch {
        return err(res, 400, "bad_request", "invalid JSON");
      }
      const m = req.method;
      if (m === "GET" && url.pathname === "/health") return send(res, 200, { ok: true, version: "0.1.0", paired: devices.size, connected: [...devices.values()].filter((d) => d.connected).length });
      if (m === "GET" && url.pathname === "/discover")
        return send(res, 200, { accessories: discovered.map((a) => ({ ...a, paired_with_us: devices.has(a.id), available_for_pairing: devices.has(a.id) ? false : a.available_for_pairing })) });
      if (m === "GET" && url.pathname === "/devices") return send(res, 200, { devices: [...devices.values()] });
      if (m === "GET" && url.pathname === "/events") return send(res, 200, { seq, events: [] });
      if (m === "POST" && url.pathname === "/devices/pair") {
        if (!/^\d{3}-?\d{2}-?\d{3}$/.test(body.setup_code ?? "")) return err(res, 400, "bad_setup_code", "setup code must be XXX-XX-XXX");
        if (devices.has(body.id)) return err(res, 409, "already_paired", "already paired");
        const a = discovered.find((x) => x.id === body.id);
        if (!a && !body.address) return err(res, 404, "not_found", "accessory not discovered; give address and port");
        if (a && !a.available_for_pairing) return err(res, 409, "pair_failed", "accessory is already paired with another controller");
        if (body.setup_code.replace(/-/g, "") !== "11122333") return err(res, 400, "bad_setup_code", "the accessory rejected the setup code");
        const name = body.name || a?.name || body.id;
        add({
          id: body.id,
          name,
          accessory_name: a?.name ?? body.id,
          model: a?.model,
          manufacturer: "Eve Systems",
          category: 7,
          category_name: "outlet",
          address: body.address ?? a.address,
          port: body.port ?? a.port,
          accessories: [{ aid: 1, name: a?.name ?? name, services: [info(name), { iid: 9, type: "outlet", name: "Outlet", primary: true, characteristics: [ch(10, "on", "bool", RW, false), ch(11, "outlet-in-use", "bool", RO, true)] }] }],
        });
        return send(res, 201, devices.get(body.id));
      }
      if (parts[0] === "devices" && parts[1]) {
        const d = findDev(parts[1]);
        if (!d) return err(res, 404, "not_found", "no such device");
        if (parts.length === 2 && m === "GET") return send(res, 200, d);
        if (parts.length === 2 && m === "PATCH") {
          if (typeof body.name === "string" && body.name.trim()) d.name = body.name.trim();
          return send(res, 200, d);
        }
        if (parts.length === 2 && m === "DELETE") {
          if (!d.connected && url.searchParams.get("force") !== "1") return err(res, 502, "unreachable", `${d.name} is unreachable`);
          devices.delete(d.id);
          return send(res, 200, { ok: true, removed_from_accessory: d.connected });
        }
        if (parts[2] === "identify" && m === "POST") return d.connected ? send(res, 200, { ok: true }) : err(res, 502, "unreachable", `${d.name} is unreachable`);
        if (parts[2] === "characteristics" && m === "POST") {
          if (!d.connected) return err(res, 502, "unreachable", `${d.name} is unreachable`);
          for (const s of body.set ?? []) {
            const acc = d.accessories.find((a) => a.aid === s.aid);
            const c = acc?.services.flatMap((x) => x.characteristics).find((x) => x.iid === s.iid);
            if (!c) return err(res, 404, "not_found", `no characteristic ${s.aid}.${s.iid}`);
            if (!c.perms.includes("pw")) return err(res, 400, "read_only", `${c.type} is read-only`);
            if (typeof c.min === "number" && s.value < c.min) return err(res, 400, "invalid_value", `${c.type} below min`);
            if (typeof c.max === "number" && s.value > c.max) return err(res, 400, "invalid_value", `${c.type} above max`);
            c.value = s.value;
            if (c.type === "lock-target-state") acc.services.flatMap((x) => x.characteristics).find((x) => x.type === "lock-current-state").value = s.value;
            seq++;
          }
          return send(res, 200, { device: d });
        }
      }
      err(res, 404, "not_found", "no route");
    });
  })
  .listen(Number(port), "127.0.0.1", () => console.log(`fake homekit-bridge on 127.0.0.1:${port}`));
