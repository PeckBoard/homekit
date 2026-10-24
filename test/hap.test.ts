import { describe, it, expect } from "vitest";
import { resolveDevice, resolveTarget, coerceValue, normalizeSetupCode, setupCodeError, controlKind, enumOptions, compactDevice, discoveredView } from "../src/hap";
import { DEVICES, lamp, hub, thermostat } from "./fixtures";

describe("resolveDevice", () => {
  it("finds by id (colons optional, any case), name, and unique substring", () => {
    expect(resolveDevice(DEVICES, "aabbccddee01").name).toBe("Desk lamp");
    expect(resolveDevice(DEVICES, "AA:BB:CC:DD:EE:02").name).toBe("Hue Bridge");
    expect(resolveDevice(DEVICES, "desk LAMP").id).toBe(lamp.id);
    expect(resolveDevice(DEVICES, "thermo").id).toBe(thermostat.id);
    expect(resolveDevice(DEVICES, "Nanoleaf Bulb 1A2B").id).toBe(lamp.id);
  });

  it("rejects ambiguous and unknown names with the options", () => {
    const twins = [lamp, { ...lamp, id: "AA:BB:CC:DD:EE:09", name: "Desk lamp 2", accessory_name: "x" }];
    expect(() => resolveDevice(twins, "desk")).toThrow(/several devices.*Desk lamp \(AA:BB:CC:DD:EE:01\).*Desk lamp 2/);
    expect(() => resolveDevice(DEVICES, "garage")).toThrow(/no paired device "garage" — paired devices: Desk lamp, Hue Bridge/);
    expect(() => resolveDevice([], "x")).toThrow(/nothing is paired yet/);
  });
});

describe("resolveTarget", () => {
  it("maps friendly names, descriptions and aliases to aid/iid", () => {
    const t = resolveTarget(lamp, { characteristic: "brightness" }, true);
    expect([t.aid, t.characteristic.iid]).toEqual([1, 11]);
    expect(resolveTarget(lamp, { characteristic: "Color Temperature" }, true).characteristic.iid).toBe(13);
    expect(resolveTarget(lamp, { characteristic: "power" }, true).characteristic.type).toBe("on");
    expect(resolveTarget(thermostat, { characteristic: "temperature" }, true).characteristic.type).toBe("target-temperature");
    expect(resolveTarget(thermostat, { characteristic: "temperature" }, false).characteristic.type).toBe("target-temperature");
    expect(resolveTarget(thermostat, { characteristic: "mode" }, true).characteristic.iid).toBe(24);
    expect(resolveTarget(lamp, { characteristic: "1.12" }, true).characteristic.type).toBe("hue");
  });

  it("asks for a service when a bridge has several matches, and honours it", () => {
    expect(() => resolveTarget(hub, { characteristic: "on" }, true)).toThrow(/ambiguous on Hue Bridge; pass `service`.*Kitchen.*\[2\.10\].*Hallway.*\[3\.10\]/);
    const t = resolveTarget(hub, { service: "hallway", characteristic: "on" }, true);
    expect([t.aid, t.characteristic.iid]).toEqual([3, 10]);
    expect(() => resolveTarget(hub, { service: "porch", characteristic: "on" }, true)).toThrow(/no service "porch" — services: Kitchen \(lightbulb\), Hallway \(lightbulb\)/);
  });

  it("refuses read-only and unknown characteristics, listing writable ones", () => {
    expect(() => resolveTarget(thermostat, { characteristic: "current-temperature" }, true)).toThrow(/read-only/);
    expect(() => resolveTarget(lamp, { characteristic: "speed" }, true)).toThrow(/no writable characteristic "speed" — available: on, brightness, hue, color-temperature/);
    // accessory-information is never a target
    expect(() => resolveTarget(lamp, { characteristic: "identify" }, true)).toThrow(/no writable characteristic/);
  });
});

describe("coerceValue", () => {
  const c = (type: string) => resolveTarget(type === "on" || type === "brightness" ? lamp : thermostat, { characteristic: type }, false).characteristic;

  it("coerces booleans, numbers and enum labels", () => {
    expect(coerceValue(c("on"), "on")).toBe(true);
    expect(coerceValue(c("on"), 0)).toBe(false);
    expect(coerceValue(c("brightness"), "60")).toBe(60);
    expect(coerceValue(c("brightness"), "75%")).toBe(75);
    expect(coerceValue(c("target-heating-cooling-state"), "auto")).toBe(3);
    expect(coerceValue(c("target-heating-cooling-state"), "Heat")).toBe(1);
    expect(coerceValue(c("target-temperature"), 21.3)).toBe(21.5); // snapped to step 0.5
  });

  it("rejects bad values with an actionable message", () => {
    expect(() => coerceValue(c("on"), "maybe")).toThrow(/true\/false/);
    expect(() => coerceValue(c("brightness"), 150)).toThrow(/at most 100 %/);
    expect(() => coerceValue(c("brightness"), "bright")).toThrow(/takes a number/);
    expect(() => coerceValue(c("target-heating-cooling-state"), "cool")).toThrow(/doesn't accept 2 — valid: 0 \(Off\), 1 \(Heat\), 3 \(Auto\)/);
    expect(() => coerceValue(c("target-temperature"), 5)).toThrow(/at least 10 °C/);
    expect(() => coerceValue(c("brightness"), undefined)).toThrow(/value is required/);
  });
});

describe("setup codes", () => {
  it("accepts XXX-XX-XXX and 8 digits, normalising to dashed form", () => {
    expect(normalizeSetupCode("12345678")).toBe("123-45-678");
    expect(normalizeSetupCode(" 031-45-154 ")).toBe("031-45-154");
    expect(normalizeSetupCode("031 45 154")).toBe("031-45-154");
    expect(setupCodeError("031-45-154")).toBeNull();
  });
  it("rejects anything else with an inline message", () => {
    for (const bad of ["1234567", "123456789", "12-345-678", "abc-de-fgh", "1234-5678"]) {
      expect(normalizeSetupCode(bad)).toBeNull();
      expect(setupCodeError(bad)).toMatch(/8 digits/);
    }
    expect(setupCodeError("")).toMatch(/Enter the 8-digit/);
  });
});

describe("rendering helpers", () => {
  it("picks a control per characteristic and limits enum options to valid values", () => {
    const tt = resolveTarget(thermostat, { characteristic: "target-heating-cooling-state" }, false).characteristic;
    expect(controlKind(tt)).toBe("select");
    expect(enumOptions(tt)).toEqual([
      { value: 0, label: "Off" },
      { value: 1, label: "Heat" },
      { value: 3, label: "Auto" },
    ]);
    expect(controlKind(resolveTarget(lamp, { characteristic: "on" }, false).characteristic)).toBe("toggle");
    expect(controlKind(resolveTarget(lamp, { characteristic: "brightness" }, false).characteristic)).toBe("slider");
    expect(controlKind(resolveTarget(thermostat, { characteristic: "current-temperature" }, false).characteristic)).toBe("readonly");
  });

  it("compacts state with enum labels and no accessory-information", () => {
    expect(compactDevice(thermostat)).toMatchObject({
      name: "Living room thermostat",
      connected: false,
      services: [
        { type: "thermostat", values: { "current-temperature": 20.4, "target-heating-cooling-state": "heat", "current-heating-cooling-state": "heating" } },
        { type: "humidity-sensor", values: { "current-relative-humidity": 45 } },
      ],
    });
    expect(JSON.stringify(compactDevice(lamp))).not.toContain("accessory-information");
  });

  it("flags accessories owned by another controller", () => {
    const base = { id: "x", name: "Plug", paired_with_us: false };
    expect(discoveredView({ ...base, available_for_pairing: false })).toMatchObject({ status: "owned_elsewhere", note: expect.stringMatching(/Remove it from Apple Home \(or factory reset it\) first/) });
    expect(discoveredView({ ...base, available_for_pairing: true }).status).toBe("available");
    expect(discoveredView({ ...base, paired_with_us: true, available_for_pairing: false }).status).toBe("paired");
  });
});
