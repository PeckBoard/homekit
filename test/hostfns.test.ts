// vitest never runs the wasm, so a host function called in src/host.ts but
// missing from src/index.d.ts only shows up at runtime as "not a function".
// Node-only (fs), so excluded from tsconfig like print-farm's shell tests.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

describe("host functions", () => {
  it("declares every peckboard_* the plugin calls in index.d.ts", () => {
    const src = readFileSync(new URL("../src/host.ts", import.meta.url), "utf8");
    const dts = readFileSync(new URL("../src/index.d.ts", import.meta.url), "utf8");
    const used = Array.from(new Set(Array.from(src.matchAll(/hostCall\("(peckboard_[a-z_]+)"/g), (x) => x[1])));
    expect(used.length).toBeGreaterThan(0);
    for (const name of used) expect(dts, name).toMatch(new RegExp(`\\b${name}\\(ptr: I64\\): I64;`));
  });
});
