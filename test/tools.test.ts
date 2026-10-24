import { describe, it, expect } from "vitest";
import { makeTools } from "../src/tools";
import { Bridge, Transport } from "../src/bridge";
import { pairBody } from "../src/http";
import { DEVICES, lamp } from "./fixtures";

type Call = { method: string; url: string; headers: Record<string, string>; body?: any };

/// A fake homekit-bridge: canned /devices and /discover, records writes.
function fake(opts: { discover?: any[]; down?: boolean } = {}) {
  const calls: Call[] = [];
  const t: Transport = {
    request(req) {
      if (opts.down) throw new Error("connection refused");
      const body = req.body ? JSON.parse(req.body) : undefined;
      calls.push({ method: req.method, url: req.url, headers: req.headers, body });
      const path = req.url.replace("http://127.0.0.1:7782", "");
      if (req.method === "GET" && path === "/devices") return { status: 200, body: JSON.stringify({ devices: DEVICES }) };
      if (req.method === "GET" && path.startsWith("/discover")) return { status: 200, body: JSON.stringify({ accessories: opts.discover ?? [] }) };
      if (req.method === "POST" && path.endsWith("/characteristics")) {
        const d = JSON.parse(JSON.stringify(lamp));
        for (const s of body.set) d.accessories[0].services[1].characteristics.find((c: any) => c.iid === s.iid).value = s.value;
        return { status: 200, body: JSON.stringify({ device: d }) };
      }
      if (req.method === "POST" && path === "/devices/pair") {
        if (body.setup_code !== "111-22-333") return { status: 400, body: JSON.stringify({ error: "wrong setup code", code: "bad_setup_code" }) };
        return { status: 201, body: JSON.stringify({ ...lamp, id: body.id, name: body.name ?? "New" }) };
      }
      return { status: 404, body: JSON.stringify({ error: "not found", code: "not_found" }) };
    },
  };
  const tools = makeTools(() => new Bridge(t, { url: "http://127.0.0.1:7782", token: "secret-token-123456", token_source: "file" }), () => "homekit-bridge is being installed");
  return { tools, calls };
}

describe("homekit_set", () => {
  it("resolves name → aid/iid, coerces the value, and reports the read-back", () => {
    const { tools, calls } = fake();
    const r: any = tools.homekit_set({ device: "Desk lamp", characteristic: "brightness", value: "60" });
    expect(r).toMatchObject({ ok: true, device: "Desk lamp", characteristic: "brightness", sent: 60, value: 60 });
    const w = calls.find((c) => c.method === "POST")!;
    expect(w.url).toBe("http://127.0.0.1:7782/devices/AA%3ABB%3ACC%3ADD%3AEE%3A01/characteristics");
    expect(w.body).toEqual({ set: [{ aid: 1, iid: 11, value: 60 }] });
    expect(w.headers.Authorization).toBe("Bearer secret-token-123456");
  });

  it("does not write on an invalid value or an ambiguous target", () => {
    const { tools, calls } = fake();
    expect(() => tools.homekit_set({ device: "Desk lamp", characteristic: "brightness", value: 200 })).toThrow(/at most 100/);
    expect(() => tools.homekit_set({ device: "Hue Bridge", characteristic: "on", value: true })).toThrow(/ambiguous/);
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("appends the setup state when the bridge is down", () => {
    const { tools } = fake({ down: true });
    expect(() => tools.homekit_list({})).toThrow(/isn't reachable at http:\/\/127\.0\.0\.1:7782.*being installed/);
  });
});

describe("homekit_pair", () => {
  const owned = { id: "11:22:33:44:55:66", name: "Eve Energy", paired_with_us: false, available_for_pairing: false, address: "10.0.0.2", port: 5000 };
  const free = { ...owned, id: "11:22:33:44:55:77", name: "Eve Door", available_for_pairing: true };

  it("refuses accessories owned by another controller before contacting them", () => {
    const { tools, calls } = fake({ discover: [owned] });
    expect(() => tools.homekit_pair({ accessory: "Eve Energy", setup_code: "111-22-333" })).toThrow(/Remove it from Apple Home \(or factory reset it\) first/);
    expect(calls.some((c) => c.url.endsWith("/devices/pair"))).toBe(false);
  });

  it("validates the setup code and pairs by discovered name", () => {
    const { tools, calls } = fake({ discover: [free] });
    expect(() => tools.homekit_pair({ accessory: "Eve Door", setup_code: "1234" })).toThrow(/8 digits/);
    const r: any = tools.homekit_pair({ accessory: "eve door", setup_code: "11122333", name: "Front door" });
    expect(r.paired).toMatchObject({ id: free.id, name: "Front door" });
    expect(calls.find((c) => c.url.endsWith("/devices/pair"))!.body).toEqual({ id: free.id, setup_code: "111-22-333", name: "Front door" });
    expect(() => tools.homekit_pair({ accessory: "Eve Door", setup_code: "999-99-999" })).toThrow(/wrong setup code/);
  });
});

describe("pairBody (UI)", () => {
  it("flags the offending field", () => {
    expect(() => pairBody({ id: "x", setup_code: "12" })).toThrow(expect.objectContaining({ field: "setup_code" }));
    expect(() => pairBody({ id: "x", setup_code: "12345678", address: "10.0.0.9" })).toThrow(expect.objectContaining({ field: "port" }));
    expect(pairBody({ id: "x", setup_code: "12345678", address: "10.0.0.9", port: "5001", name: " Lamp " })).toEqual({
      id: "x",
      setup_code: "123-45-678",
      address: "10.0.0.9",
      port: 5001,
      name: "Lamp",
    });
  });
});
