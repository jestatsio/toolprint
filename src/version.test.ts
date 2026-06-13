import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TOOLPRINT_VERSION } from "./version.js";

/**
 * version.ts is hand-maintained (it has no build step that reads package.json),
 * so the two can drift — and did: 0.1.1 shipped reporting `v0.1.0`. This guards
 * the invariant so `--version` and every report always match the published
 * package.
 */
describe("TOOLPRINT_VERSION", () => {
  it("matches the version in package.json", () => {
    const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
    expect(TOOLPRINT_VERSION).toBe(pkg.version);
  });
});
