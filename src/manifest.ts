// The plugin manifest JSON body — identity, hooks, permissions, the MCP tools,
// the page + authenticated data routes, the sidebar entry, and settings.

import { version as VERSION } from "../package.json";
import { uiRoutes, PAGE_PATH } from "./http";
import { DEFAULT_BRIDGE_URL } from "./config";

const DESCRIPTION =
  "HomeKit: control HomeKit-over-IP accessories (lights, plugs, switches, thermostats, locks, blinds, garage " +
  "doors, fans, sensors) and Philips Hue lights (via a linked Hue Bridge: lights, rooms, zones, scenes) from Peckboard — " +
  "a live device page grouped by room with per-service controls, discovery and pairing, plus homekit_* MCP tools so " +
  "agents can read and set device state. Talks to the local homekit-bridge daemon (installed automatically, needs " +
  "Node.js) on 127.0.0.1:7782. HomeKit accessories must be removed from Apple Home before pairing; Bluetooth and " +
  "Thread accessories are not supported.";

const REPOSITORY = "https://github.com/PeckBoard/homekit";

// Inline SVG (lucide "house") for the sidebar entry; rendered sandboxed.
const ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ' +
  'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/>' +
  '<path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';

const DEVICE_REF = { type: "string", description: "Device name or id (see homekit_list)." };

function deviceOnly() {
  return { type: "object", properties: { device: DEVICE_REF }, required: ["device"], additionalProperties: false };
}

const MCP_TOOLS = [
  {
    name: "homekit_list",
    description:
      "List paired HomeKit devices with their connection state and compact current values per service " +
      "(e.g. lightbulb: {on: true, brightness: 60}). Enum values are given as labels (heat, locked, …).",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "homekit_get",
    description:
      "Full detail of one device: every service and characteristic with type, value, writability, unit, " +
      "min/max/step and enum options. refresh=true re-reads values from the accessory first.",
    input_schema: {
      type: "object",
      properties: { device: DEVICE_REF, refresh: { type: "boolean" } },
      required: ["device"],
      additionalProperties: false,
    },
  },
  {
    name: "homekit_set",
    description:
      "Set one characteristic, e.g. {device: \"Desk lamp\", characteristic: \"brightness\", value: 60}. " +
      "characteristic is the friendly type (on, brightness, hue, saturation, color-temperature, target-temperature, " +
      "target-heating-cooling-state, lock-target-state, target-position, target-door-state, rotation-speed, active, …), " +
      "a shorthand (power, mode, lock, position, speed, temperature) or \"aid.iid\". Pass service (name or type, e.g. " +
      "\"lightbulb\" or a bridged accessory's name) when a device has several matches. Values: true/false or on/off for " +
      "switches, numbers within the characteristic's range, or enum labels (heat, cool, auto, off, locked, unlocked, " +
      "open, closed). Returns the value read back after the write.",
    input_schema: {
      type: "object",
      properties: {
        device: DEVICE_REF,
        service: { type: "string", description: "Service name or type, to disambiguate." },
        characteristic: { type: "string" },
        value: { description: "New value: boolean, number, or enum label." },
      },
      required: ["device", "characteristic", "value"],
      additionalProperties: false,
    },
  },
  {
    name: "homekit_discover",
    description:
      "HomeKit IP accessories visible on the LAN via mDNS, each with status paired (ours), available (can be paired), " +
      "or owned_elsewhere (still paired to Apple Home — must be removed there or factory reset first). refresh=true " +
      "re-browses for 3 s.",
    input_schema: { type: "object", properties: { refresh: { type: "boolean" } }, additionalProperties: false },
  },
  {
    name: "homekit_pair",
    description:
      "Pair an accessory using its 8-digit setup code (XXX-XX-XXX, from its label or manual). accessory is the id " +
      "or name from homekit_discover; pass address + port for one mDNS can't see (accessory is then its device id). " +
      "name sets an optional label.",
    input_schema: {
      type: "object",
      properties: {
        accessory: { type: "string" },
        setup_code: { type: "string" },
        name: { type: "string" },
        address: { type: "string" },
        port: { type: "integer", minimum: 1, maximum: 65535 },
      },
      required: ["accessory", "setup_code"],
      additionalProperties: false,
    },
  },
  {
    name: "homekit_unpair",
    description:
      "Unpair a HomeKit device: removes Peckboard's pairing from the accessory (so it can go back to Apple Home) and forgets " +
      "it. force=true forgets it locally even when the accessory is unreachable. Not for Hue lights (unlink their bridge on the page).",
    input_schema: {
      type: "object",
      properties: { device: DEVICE_REF, force: { type: "boolean" } },
      required: ["device"],
      additionalProperties: false,
    },
  },
  {
    name: "homekit_identify",
    description: "Make a device identify itself (blink / beep) so the user can tell which one it is.",
    input_schema: deviceOnly(),
  },
  {
    name: "homekit_hue_bridges",
    description:
      "Philips Hue Bridges on the LAN and linked ones: bridge_id, name, address, linked, connected, light count. " +
      "Linked bridges' lights appear as ordinary devices (source: hue, with a room) in homekit_list / homekit_set. refresh=true re-scans.",
    input_schema: { type: "object", properties: { refresh: { type: "boolean" } }, additionalProperties: false },
  },
  {
    name: "homekit_hue_link",
    description:
      "One attempt to link a Hue Bridge (needs its physical link button). bridge = bridge_id or name (optional when exactly one " +
      "bridge is unlinked); address = its IP for a bridge discovery can't see. Until the user presses the round button on the " +
      "bridge this returns waiting_for_link_button: ask them to press it, then call again within 30 s.",
    input_schema: {
      type: "object",
      properties: { bridge: { type: "string" }, address: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "homekit_rooms",
    description: "Hue rooms and zones of every linked bridge with their state (on, brightness 0–100) and light names.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "homekit_room_set",
    description: "Switch a whole Hue room or zone on/off and/or set its brightness (0–100), e.g. {room: \"Living room\", on: true, brightness: 40}.",
    input_schema: {
      type: "object",
      properties: {
        room: { type: "string", description: "Room or zone name or id (see homekit_rooms)." },
        on: { type: "boolean" },
        brightness: { type: "number", minimum: 0, maximum: 100 },
      },
      required: ["room"],
      additionalProperties: false,
    },
  },
  {
    name: "homekit_scenes",
    description: "Hue scenes (from the Hue app), optionally only those of one room or zone.",
    input_schema: { type: "object", properties: { room: { type: "string" } }, additionalProperties: false },
  },
  {
    name: "homekit_scene_recall",
    description:
      "Recall (activate) a Hue scene by name or id. Pass room when the same scene name exists in several rooms (e.g. \"Relax\").",
    input_schema: {
      type: "object",
      properties: { scene: { type: "string" }, room: { type: "string" } },
      required: ["scene"],
      additionalProperties: false,
    },
  },
];

export function manifestJson(): string {
  return JSON.stringify({
    description: DESCRIPTION,
    version: VERSION,
    repository: REPOSITORY,
    // Pair-setup + the accessory-database read can take a minute.
    call_timeout_secs: 120,
    // The page polls devices while a pair or install runs alongside.
    // Install launches are claimed atomically (setup.ts).
    concurrency: 4,
    hooks: ["mcp.tool.invoke", "http.request.before", "http.request.authed"],
    permissions: [
      "provide_mcp_tools", // homekit_* tools
      "data_store", // setup job state
      "http_request", // the homekit-bridge HTTP API on loopback
      "process_exec_any", // read the bridge token file; install homekit-bridge
      "user_authority", // serve the authenticated page API
      "contribute_sidebar", // the HomeKit sidebar page
    ],
    sidebar_items: [{ id: "homekit", label: "HomeKit", icon: ICON, path: PAGE_PATH }],
    http_routes: [`GET ${PAGE_PATH}`],
    ui_routes: uiRoutes(),
    settings: [
      {
        key: "bridge_url",
        title: "homekit-bridge URL",
        type: "url",
        default: DEFAULT_BRIDGE_URL,
        description: "Base URL of the local homekit-bridge daemon. Only the default loopback URL is installed automatically.",
      },
      {
        key: "bridge_token",
        title: "homekit-bridge token",
        type: "string",
        secret: true,
        description: "Bearer token homekit-bridge expects. Leave empty to use ~/.config/homekit-bridge/token (written by the automatic install).",
      },
    ],
    mcp_tools: MCP_TOOLS,
  });
}
