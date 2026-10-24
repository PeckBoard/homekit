import { describe, it, expect } from "vitest";
import { manifestJson } from "../src/manifest";
import { TOOLS } from "../src/tools";
import pkg from "../package.json";

describe("manifest", () => {
  const m = JSON.parse(manifestJson());

  it("self-reports the package.json version and declares tools + routes", () => {
    expect(m.version).toBe(pkg.version);
    expect(m.mcp_tools.map((t: any) => t.name).sort()).toEqual(Object.keys(TOOLS).sort());
    expect(Object.keys(TOOLS).sort()).toEqual([
      "homekit_discover",
      "homekit_get",
      "homekit_hue_bridges",
      "homekit_hue_link",
      "homekit_identify",
      "homekit_list",
      "homekit_pair",
      "homekit_room_set",
      "homekit_rooms",
      "homekit_scene_recall",
      "homekit_scenes",
      "homekit_set",
      "homekit_unpair",
    ]);
    for (const r of [
      "GET setup",
      "GET devices",
      "PUT devices/:id",
      "DELETE devices/:id",
      "POST devices/:id/characteristics",
      "GET discover",
      "POST pair",
      "GET hue/bridges",
      "POST hue/link",
      "DELETE hue/bridges/:id",
      "GET hue/groups",
      "POST hue/groups/:id",
      "GET hue/scenes",
      "POST hue/scenes/:id/recall",
    ]) {
      const [method, path] = r.split(" ");
      expect(m.ui_routes).toContain(`${method} /api/plugin-ui/homekit/${path}`);
    }
  });
});
