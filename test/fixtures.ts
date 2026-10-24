// Device objects in the bridge's shape (BRIDGE_API.md) for the tests.

import type { Device, Characteristic } from "../src/hap";

const info = (iid: number) => ({
  iid,
  type: "accessory-information",
  name: "Info",
  characteristics: [{ iid: iid + 1, type: "identify", format: "bool", perms: ["pw"] }, { iid: iid + 2, type: "name", format: "string", perms: ["pr"], value: "x" }] as Characteristic[],
});

export const lamp: Device = {
  id: "AA:BB:CC:DD:EE:01",
  name: "Desk lamp",
  accessory_name: "Nanoleaf Bulb 1A2B",
  connected: true,
  category_name: "lightbulb",
  accessories: [
    {
      aid: 1,
      name: "Nanoleaf Bulb 1A2B",
      services: [
        info(1),
        {
          iid: 9,
          type: "lightbulb",
          name: "Light",
          primary: true,
          characteristics: [
            { iid: 10, type: "on", format: "bool", perms: ["pr", "pw", "ev"], value: false },
            { iid: 11, type: "brightness", format: "int", unit: "percentage", perms: ["pr", "pw", "ev"], min: 0, max: 100, step: 1, value: 40 },
            { iid: 12, type: "hue", format: "float", unit: "arcdegrees", perms: ["pr", "pw", "ev"], min: 0, max: 360, step: 1, value: 10 },
            { iid: 13, type: "color-temperature", format: "uint32", perms: ["pr", "pw", "ev"], min: 140, max: 500, step: 1, value: 300 },
          ],
        },
      ],
    },
  ],
};

export const hub: Device = {
  id: "AA:BB:CC:DD:EE:02",
  name: "Hue Bridge",
  connected: true,
  category_name: "bridge",
  accessories: [
    { aid: 1, name: "Hue Bridge", services: [info(1)] },
    {
      aid: 2,
      name: "Kitchen",
      services: [info(1), { iid: 9, type: "lightbulb", name: "Kitchen", primary: true, characteristics: [{ iid: 10, type: "on", format: "bool", perms: ["pr", "pw", "ev"], value: true }] }],
    },
    {
      aid: 3,
      name: "Hallway",
      services: [info(1), { iid: 9, type: "lightbulb", name: "Hallway", primary: true, characteristics: [{ iid: 10, type: "on", format: "bool", perms: ["pr", "pw", "ev"], value: false }] }],
    },
  ],
};

export const thermostat: Device = {
  id: "AA:BB:CC:DD:EE:03",
  name: "Living room thermostat",
  connected: false,
  category_name: "thermostat",
  accessories: [
    {
      aid: 1,
      name: "ecobee",
      services: [
        info(1),
        {
          iid: 20,
          type: "thermostat",
          name: "Thermostat",
          primary: true,
          characteristics: [
            { iid: 21, type: "current-temperature", format: "float", unit: "celsius", perms: ["pr", "ev"], min: 0, max: 100, step: 0.1, value: 20.4 },
            { iid: 22, type: "target-temperature", format: "float", unit: "celsius", perms: ["pr", "pw", "ev"], min: 10, max: 38, step: 0.5, value: 21 },
            { iid: 23, type: "current-heating-cooling-state", format: "uint8", perms: ["pr", "ev"], min: 0, max: 2, value: 1, valid_values: [0, 1, 2] },
            { iid: 24, type: "target-heating-cooling-state", format: "uint8", perms: ["pr", "pw", "ev"], min: 0, max: 3, value: 1, valid_values: [0, 1, 3] },
          ],
        },
        {
          iid: 30,
          type: "humidity-sensor",
          name: "Humidity",
          characteristics: [{ iid: 31, type: "current-relative-humidity", format: "float", unit: "percentage", perms: ["pr", "ev"], min: 0, max: 100, value: 45 }],
        },
      ],
    },
  ],
};

export const DEVICES = [lamp, hub, thermostat];
