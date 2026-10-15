import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The plugin manifests are five small JSON files that must agree with each
// other and with package.json forever. This test is the agreement.

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function readJson(rel: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(ROOT, rel), "utf8")) as Record<string, unknown>;
}

const pkg = readJson("package.json");
const VERSION = pkg.version as string;

describe("plugin packaging manifests", () => {
  it("every manifest carries the package version", () => {
    expect(readJson(".claude-plugin/plugin.json").version).toBe(VERSION);
    expect(readJson(".codex-plugin/plugin.json").version).toBe(VERSION);
    expect(readJson("plugin.json").version).toBe(VERSION);
    expect(readJson("manifest.json").version).toBe(VERSION);

    const claudeMarketplace = readJson(".claude-plugin/marketplace.json");
    const plugins = claudeMarketplace.plugins as {
      name: string;
      version: string;
      source: string;
    }[];
    expect(plugins[0]?.version).toBe(VERSION);
    expect(plugins[0]?.source).toBe("./");

    const server = readJson("server.json");
    expect(server.version).toBe(VERSION);
    const packages = server.packages as { identifier: string; version: string }[];
    expect(packages[0]?.identifier).toBe(pkg.name);
    expect(packages[0]?.version).toBe(VERSION);
  });

  it("the MCP Registry name matches package.json mcpName (npm ownership proof)", () => {
    expect(pkg.mcpName).toBe("io.github.jestatsio/toolprint");
    expect(readJson("server.json").name).toBe(pkg.mcpName);
  });

  it(".mcp.json pins the exact npm version (directory requirement)", () => {
    const mcp = readJson(".mcp.json");
    const servers = mcp.mcpServers as Record<string, { command: string; args: string[] }>;
    expect(servers.toolprint?.command).toBe("npx");
    expect(servers.toolprint?.args).toEqual(["-y", `toolprint@${VERSION}`, "serve"]);
  });

  it("all manifests share one plugin identity", () => {
    for (const rel of [".claude-plugin/plugin.json", ".codex-plugin/plugin.json", "plugin.json"]) {
      const manifest = readJson(rel);
      expect(manifest.name, rel).toBe("toolprint");
      expect(manifest.license, rel).toBe("Apache-2.0");
      expect(manifest.repository, rel).toBe("https://github.com/jestatsio/toolprint");
    }
    expect(readJson("manifest.json").name).toBe("toolprint");
  });

  it("referenced icon and skill files exist", () => {
    const codex = readJson(".codex-plugin/plugin.json");
    const iface = codex.interface as { logo: string; composerIcon: string };
    for (const rel of [iface.logo, iface.composerIcon].map((p) => p.replace("./", ""))) {
      expect(existsSync(join(ROOT, rel)), rel).toBe(true);
    }
    const manifest = readJson("manifest.json");
    expect(existsSync(join(ROOT, manifest.icon as string))).toBe(true);

    const skill = readFileSync(join(ROOT, "skills/toolprint/SKILL.md"), "utf8");
    expect(skill).toMatch(/^---\nname: toolprint\n/);
    for (const cmd of ["commands/scan.md", "commands/pin.md"]) {
      expect(readFileSync(join(ROOT, cmd), "utf8")).toMatch(/^---\ndescription: /);
    }
    for (const asset of [
      "assets/icon.svg",
      "assets/install-claude.svg",
      "assets/install-code.svg",
      "assets/install-codex.svg",
    ]) {
      expect(existsSync(join(ROOT, asset)), asset).toBe(true);
    }
  });

  it("the mascot is a square PNG of at least 512px (host icon rules)", () => {
    const bytes = readFileSync(join(ROOT, "assets/mascot.png"));
    expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    expect(width).toBe(height);
    expect(width).toBeGreaterThanOrEqual(512);
  });

  it("the Codex marketplace entry is complete", () => {
    const marketplace = readJson(".agents/plugins/marketplace.json");
    const plugins = marketplace.plugins as {
      name: string;
      policy: { installation: string; authentication: string };
      category: string;
    }[];
    expect(plugins[0]?.name).toBe("toolprint");
    expect(plugins[0]?.policy.installation).toBeTruthy();
    expect(plugins[0]?.policy.authentication).toBeTruthy();
    expect(plugins[0]?.category).toBeTruthy();
  });
});
