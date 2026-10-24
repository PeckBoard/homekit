# HomeKit — Peckboard Plugin

Control HomeKit accessories from Peckboard — lights, plugs, switches,
thermostats, locks, blinds, garage doors, fans and sensors — on a live device
page, and let agents read and set them through MCP tools.

- **Page**: every paired device with its live state (polled every 3 s) and a
  control per characteristic: on/off toggle, brightness / hue / saturation /
  color-temperature sliders, thermostat target temperature + mode dropdown,
  lock / unlock, window-covering and garage position, fan speed, and read-only
  sensors (temperature, humidity, contact, motion, battery, …). Discover,
  pair (setup code), rename, identify, unpair.
- **Philips Hue**: link a Hue Bridge from the Discover tab; its lights show
  up as devices grouped by room, with room on/off + brightness and scenes.
- **Agents**: `homekit_list`, `homekit_get`, `homekit_set`,
  `homekit_discover`, `homekit_pair`, `homekit_unpair`, `homekit_identify`,
  `homekit_hue_bridges`, `homekit_hue_link`, `homekit_rooms`,
  `homekit_room_set`, `homekit_scenes`, `homekit_scene_recall`.
- **homekit-bridge**: the plugin is a thin client. The HomeKit controller
  (HAP pair-setup, encrypted sessions, event subscriptions, mDNS browsing)
  is the local `homekit-bridge` Node daemon on `127.0.0.1:7782`
  (`peck-plugins/homekit-bridge`, contract in its `BRIDGE_API.md`). Pairings
  (keys) live in the bridge's data dir, not in Peckboard.

TypeScript → esbuild → `extism-js` → `dist/plugin.wasm`, same layout as
`print-farm`. The page UI (`ui/`) is a separate esbuild stage spliced into the
served HTML (see `esbuild.js`).

```bash
./build.sh        # npm install on first run, then dist/plugin.wasm
npm test          # vitest (name resolution, value coercion, setup codes, tools vs a fake bridge, setup + upgrade decisions, Hue rooms/scenes)
npm run typecheck # plugin + ui/
```

## Pairing Caveats

- **One owner at a time.** A HomeKit accessory pairs with one controller
  "family". An accessory in Apple Home shows up in Discover as **Owned by
  another controller** — remove it from the Home app (or factory reset it)
  first, then pair it here. Unpairing here frees it again, so it can go back
  to Apple Home.
- **IP accessories only.** HomeKit over Wi-Fi / Ethernet (mDNS `_hap._tcp`).
  Bluetooth LE and Thread accessories are not supported, nor is exposing
  devices *to* Apple Home.
- **Setup code**: the 8-digit `XXX-XX-XXX` code from the accessory's label,
  box or manual (dashes optional). The page validates it inline; the
  accessory itself rejects a wrong one.
- **Not discovered?** (another subnet, mDNS filtered) — use **Add by address**
  on the Discover tab with the accessory's IP, HAP port and device id (mDNS
  TXT `id`).
- Unpairing an unreachable accessory offers **Forget anyway** (bridge
  `?force=1`); the accessory still thinks it's paired, so factory reset it
  before adding it to Apple Home.

## Philips Hue

Hue lights come in through a **Hue Bridge** linked to homekit-bridge (CLIP v2,
local network only); they stay in the Hue app and Apple Home — nothing is
unpaired.

- **Link**: Discover → **Hue Bridge** lists bridges found on the network.
  **Link** opens a dialog asking you to press the round button on the bridge
  and polls for 30 s (every 2 s); if the button isn't pressed in time it says
  so and offers **Try again**. A bridge discovery can't see: **Bridge not
  listed? Link it by address** (IP, bridge id optional). **Unlink** forgets the
  key and removes its lights from Devices.
- **Devices**: Hue lights are ordinary device cards (power, brightness, color,
  color temperature) with a **Hue** badge, grouped by room. Each Hue room and
  zone header has a power toggle, a brightness slider, and its scenes as
  chips (click to recall). HomeKit and room-less devices sit under **Other**.
  Hue lights have no Unpair — unlink the bridge instead.
- **Agents**: Hue lights work with `homekit_list` / `homekit_get` /
  `homekit_set` by name; rooms and scenes have their own tools (below).

## Bridge Setup

On page load (and on every tool call) the plugin probes `GET /health` on the
bridge with the token. When the bridge on the **default URL** doesn't answer,
the plugin installs it by itself, mirroring App Manager's `homekit-bridge`
catalog recipe (plugins can't call each other): the sha256-checked
`homekit-bridge.mjs` release asset into `~/.local/lib/homekit-bridge`, a
`~/.local/bin/homekit-bridge` launcher, a random token in
`~/.config/homekit-bridge/token` (kept across reinstalls), a
`homekit-bridge.service` systemd user unit (node by absolute path), then
`systemctl --user enable` + `restart` and `loginctl enable-linger`. The page
shows progress; a failure shows the installer's reason and log, a **Retry**,
and an **Install with App Manager** link. It needs **Node.js ≥ 20** — when
`node` is missing the banner links to App Manager to install it. Without a
systemd user manager the banner gives the manual command. A bridge on a
non-default `bridge_url` is never installed or touched.

Override the release location with `HKB_RELEASES` in Peckboard's environment
(default `https://github.com/PeckBoard/homekit-bridge/releases/latest/download`).

**Upgrades.** Philips Hue needs homekit-bridge **0.2.0** or newer. When the
bridge on the default URL answers `GET /health` with an older version, the same
installer runs again (it fetches the latest release, keeps the token and the
pairings, and restarts the service); the banner says **Updating
homekit-bridge…**. If the latest release is still too old, the page says so
instead of reinstalling in a loop (Retry tries again). A bridge on a
non-default URL is only reported as outdated.

## Permissions

| Permission           | Why                                                        |
| -------------------- | ---------------------------------------------------------- |
| `http_request`       | The homekit-bridge JSON API on loopback                    |
| `process_exec_any`   | Read the bridge token file; install homekit-bridge         |
| `data_store`         | Setup job state                                            |
| `provide_mcp_tools`  | The MCP tools below                                        |
| `user_authority`     | The authenticated page API                                 |
| `contribute_sidebar` | The HomeKit sidebar entry                                  |

## Settings

| Key            | Default                           | Notes                                                                 |
| -------------- | --------------------------------- | --------------------------------------------------------------------- |
| `bridge_url`   | `http://127.0.0.1:7782`           | homekit-bridge daemon; only the default is auto-installed             |
| `bridge_token` | `~/.config/homekit-bridge/token`  | secret; sent as `Authorization: Bearer`. Empty = read `${XDG_CONFIG_HOME:-~/.config}/homekit-bridge/token`; never logged or sent to the UI |

## MCP Tools

| Tool                | Arguments                                              | Notes |
| ------------------- | ------------------------------------------------------ | ----- |
| `homekit_list`      | —                                                      | Devices with connection state and compact values per service (`{on: true, brightness: 60}`, enum labels like `heat` / `locked`) |
| `homekit_get`       | `device`, `refresh?`                                   | Every visible service/characteristic with value, writability, unit, min/max/step, enum options |
| `homekit_set`       | `device`, `characteristic`, `value`, `service?`        | See below |
| `homekit_discover`  | `refresh?`                                             | Each accessory as `paired` / `available` / `owned_elsewhere` |
| `homekit_pair`      | `accessory`, `setup_code`, `name?`, `address?`, `port?`| `accessory` = discovered id or name; refuses `owned_elsewhere` with the fix |
| `homekit_unpair`    | `device`, `force?`                                     | Frees the accessory for Apple Home |
| `homekit_identify`  | `device`                                               | Blink / beep |
| `homekit_hue_bridges` | `refresh?`                                           | Hue Bridges seen + linked ones (id, address, linked, connected, light count) |
| `homekit_hue_link`  | `bridge?`, `address?`                                  | One link attempt; until the button is pressed returns `waiting_for_link_button` with "press the link button, then call again" |
| `homekit_rooms`     | —                                                      | Hue rooms and zones with `on`, `brightness`, light names |
| `homekit_room_set`  | `room`, `on?`, `brightness?`                           | Whole room / zone at once (0–100) |
| `homekit_scenes`    | `room?`                                                | Hue scenes, optionally of one room |
| `homekit_scene_recall` | `scene`, `room?`                                    | `room` is required when the scene name exists in several rooms |

`device` is a name (exact, then unique substring) or id (colons optional).
`homekit_set` resolves `characteristic` as the friendly HAP type (`on`,
`brightness`, `hue`, `saturation`, `color-temperature`, `target-temperature`,
`target-heating-cooling-state`, `lock-target-state`, `target-position`,
`target-door-state`, `rotation-speed`, `active`, …), its description, a
shorthand (`power`, `mode`, `lock`, `position`, `speed`, `temperature`, …) or
`"aid.iid"`. Read-only matches are skipped; when a device (e.g. a HAP bridge)
has several matches, the error lists them and `service` (name, type, or a
bridged accessory's name) picks one. Values are checked before anything is
sent: booleans take `true`/`false`/`on`/`off`, numbers must be in range (floats
snap to `step`), enums take the number or the label (`heat`, `cool`, `auto`,
`off`, `locked`, `unlocked`, `open`, `closed`, …) and must be in the
accessory's valid values. The result carries the value read back after the
write.

Example: `{"device": "Desk lamp", "characteristic": "brightness", "value": 60}`.

## UI API

All routes are authenticated (`/api/plugin-ui/homekit/...`, JSON in/out).
Errors: `{error, code?, field?}` — `code` is the bridge's error slug, `field`
names the offending input (pair form). A bridge 401 is returned as 502.

| Route                                  | Bridge call                              |
| -------------------------------------- | ---------------------------------------- |
| `GET setup` / `POST setup/retry`       | `GET /health` (+ install job)            |
| `GET devices`                          | `GET /devices`                           |
| `GET devices/:id?refresh=1`            | `GET /devices/{id}?refresh=1`            |
| `PUT devices/:id` `{name}`             | `PATCH /devices/{id}`                    |
| `DELETE devices/:id?force=1`           | `DELETE /devices/{id}?force=1`           |
| `POST devices/:id/characteristics`     | `POST /devices/{id}/characteristics`     |
| `POST devices/:id/identify`            | `POST /devices/{id}/identify`            |
| `GET discover?refresh=1`               | `GET /discover?refresh=1`                |
| `POST pair`                            | `POST /devices/pair` (code validated first) |
| `GET hue/bridges?refresh=1`            | `GET /hue/bridges?refresh=1`             |
| `POST hue/link` `{bridge_id?, address?}` | `POST /hue/link` (one attempt; 409 `link_button_not_pressed`) |
| `DELETE hue/bridges/:id`               | `DELETE /hue/bridges/{bridge_id}`        |
| `GET hue/groups`                       | `GET /hue/groups`                        |
| `POST hue/groups/:id` `{on?, brightness?}` | `POST /hue/groups/{id}`              |
| `GET hue/scenes?group_id=`             | `GET /hue/scenes?group_id=`              |
| `POST hue/scenes/:id/recall`           | `POST /hue/scenes/{id}/recall`           |

A Hue call answered with 404 by a homekit-bridge older than 0.2.0 comes back
as code `bridge_outdated`.

## Manual End-to-End Check

`test/fixtures/fake-bridge.mjs` implements `BRIDGE_API.md` in memory (a lamp,
a thermostat, an offline lock; discovery with a free and an Apple-owned plug;
pairing accepts `111-22-333`; an unlinked Hue Bridge with 3 lights, 2 rooms, a
zone and 5 scenes whose "link button" is `POST /_test/press-link-button`; a
third argument `old` emulates homekit-bridge 0.1.0). `test/e2e/page-check.mjs`
drives the real page in a scratch Peckboard with the plugin sideloaded — HomeKit
controls, pairing, the Hue link flow (waiting, timeout + Retry, success), room
toggle / brightness, scene recall, unlink, and the "Update homekit-bridge" state
against an `old` fake bridge it starts itself (the link timeout makes it take
~1 min):

```bash
./build.sh
d=test/.tmp-e2e; rm -rf "$d"; mkdir -p "$d/data/plugins"; cp dist/plugin.wasm "$d/data/plugins/homekit.wasm"
node test/fixtures/fake-bridge.mjs 27433 fake-token-0123456789 &
PECKBOARD_NO_RESUME=1 PECKBOARD_BOOTSTRAP_USERNAME=hk-user PECKBOARD_BOOTSTRAP_PASSWORD=hk-password-1234 \
  ../../target/verify/peckboard --data-dir "$d/data" --port 27431 --https-port 27432 --host 127.0.0.1 &
node test/e2e/page-check.mjs http://127.0.0.1:27431 hk-user hk-password-1234 \
  http://127.0.0.1:27433 fake-token-0123456789 "$d/shots"
```
