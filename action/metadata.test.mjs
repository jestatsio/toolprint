import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * GitHub Marketplace validates `action.yml` when a release is published to it,
 * and rejects the release outright if the metadata is wrong. Those rules are
 * invisible from the CLI and only surface as a form error at publish time —
 * after a tag exists — so a fix costs a whole patch release. Guard them here.
 *
 * Rules: https://docs.github.com/actions/creating-actions/metadata-syntax-for-github-actions
 */

const actionYml = readFileSync(fileURLToPath(new URL("../action.yml", import.meta.url)), "utf8");

/** Read a top-level scalar out of action.yml without pulling in a YAML parser. */
function topLevel(field) {
  const match = actionYml.match(new RegExp(`^${field}:\\s*"?([^"\\n]+)"?`, "m"));
  return match?.[1]?.trim();
}

/** Read a scalar nested one level under `branding:`. */
function branding(field) {
  const block = actionYml.match(/^branding:\n((?:\s+.*\n)+)/m)?.[1] ?? "";
  return block.match(new RegExp(`^\\s+${field}:\\s*"?([^"\\n]+)"?`, "m"))?.[1]?.trim();
}

/** The eight colors Marketplace accepts for a branding badge. */
const BRANDING_COLORS = [
  "white",
  "yellow",
  "blue",
  "green",
  "orange",
  "red",
  "purple",
  "gray-dark",
];

describe("action.yml — GitHub Marketplace metadata", () => {
  it("has a name", () => {
    expect(topLevel("name")).toBeTruthy();
  });

  it("keeps the description under the 125-character Marketplace cap", () => {
    const description = topLevel("description");
    expect(description).toBeTruthy();
    // 0.3.1 shipped solely to fix this: 128 chars was rejected at publish time,
    // and Marketplace reads action.yml from the release tag, so main alone
    // could not fix it.
    expect(description.length).toBeLessThan(125);
  });

  it("declares branding, which Marketplace requires", () => {
    expect(branding("icon")).toBeTruthy();
    expect(BRANDING_COLORS).toContain(branding("color"));
  });
});
