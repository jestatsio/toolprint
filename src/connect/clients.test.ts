import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AGENT_CLIENT_IDS, expandPath, locateClientConfigs } from "./clients.js";
import { discoverClientTargets } from "./target.js";

/** A throwaway HOME with a handful of agent-client configs planted in it. */
function makeHome(files: Record<string, string>): string {
  const home = mkdtempSync(join(tmpdir(), "toolprint-home-"));
  for (const [relative, content] of Object.entries(files)) {
    const path = join(home, relative);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content);
  }
  return home;
}

let home: string | undefined;
const originalHome = process.env.HOME;

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  home = undefined;
});

describe("expandPath", () => {
  it("expands ~ to the home directory", () => {
    expect(expandPath("~/.claude.json")).toBe(join(process.env.HOME ?? "", ".claude.json"));
  });
});

describe("locateClientConfigs", () => {
  it("finds only configs that exist, and reports which client each belongs to", () => {
    home = makeHome({
      ".claude.json": JSON.stringify({ mcpServers: { github: { command: "gh-mcp" } } }),
      ".cursor/mcp.json": JSON.stringify({ mcpServers: { linear: { url: "https://l/mcp" } } }),
    });
    process.env.HOME = home;

    const found = locateClientConfigs({ cwd: home, platform: "darwin" });
    const ids = found.map((location) => location.client.id);

    expect(ids).toContain("claude-code");
    expect(ids).toContain("cursor");
    // Nothing was planted for these, so they must not appear.
    expect(ids).not.toContain("windsurf");
    expect(ids).not.toContain("zed");
  });
});

describe("discoverClientTargets", () => {
  it("namespaces server ids by client so two `github` entries cannot collide", () => {
    home = makeHome({
      ".claude.json": JSON.stringify({ mcpServers: { github: { command: "a" } } }),
      ".cursor/mcp.json": JSON.stringify({ mcpServers: { github: { command: "b" } } }),
    });
    process.env.HOME = home;

    const { targets } = discoverClientTargets({ cwd: home, platform: "darwin" });
    const ids = targets.map((target) => target.id).sort();

    expect(ids).toEqual(["claude-code:github", "cursor:github"]);
  });

  it("skips a config with no MCP servers instead of aborting the whole run", () => {
    home = makeHome({
      // A large settings file that simply has no MCP block — very common.
      ".claude.json": JSON.stringify({ theme: "dark", projects: {} }),
      ".cursor/mcp.json": JSON.stringify({ mcpServers: { linear: { command: "l" } } }),
    });
    process.env.HOME = home;

    const { targets } = discoverClientTargets({ cwd: home, platform: "darwin" });
    expect(targets.map((target) => target.id)).toEqual(["cursor:linear"]);
  });

  it("reports a non-JSON config as skipped rather than pretending it was covered", () => {
    home = makeHome({
      ".codex/config.toml": '[mcp_servers.github]\ncommand = "gh"\n',
      ".cursor/mcp.json": JSON.stringify({ mcpServers: { linear: { command: "l" } } }),
    });
    process.env.HOME = home;

    const { targets, notes } = discoverClientTargets({ cwd: home, platform: "darwin" });
    expect(targets.map((target) => target.id)).toEqual(["cursor:linear"]);
    expect(notes.some((note) => note.reason.includes("TOML"))).toBe(true);
  });

  it("reports a disabled server as skipped, never silently dropped", () => {
    home = makeHome({
      ".cursor/mcp.json": JSON.stringify({
        mcpServers: { on: { command: "a" }, off: { command: "b", enabled: false } },
      }),
    });
    process.env.HOME = home;

    const { targets, notes } = discoverClientTargets({ cwd: home, platform: "darwin" });
    expect(targets.map((target) => target.id)).toEqual(["cursor:on"]);
    expect(notes.some((note) => note.reason.includes('"off"'))).toBe(true);
  });

  it("finds Claude Code servers scoped to the current project", () => {
    // ~/.claude.json often has no top-level mcpServers at all; the servers an
    // agent actually reaches in a repo live under projects.<dir>.mcpServers.
    const project = join(tmpdir(), "toolprint-proj-a");
    home = makeHome({
      ".claude.json": JSON.stringify({
        numStartups: 3,
        projects: { [project]: { mcpServers: { github: { command: "gh-mcp" } } } },
      }),
    });
    process.env.HOME = home;

    const { targets } = discoverClientTargets({ cwd: project, platform: "darwin" });
    expect(targets.map((target) => target.id)).toEqual(["claude-code:github"]);
  });

  it("reports project scopes it did not scan instead of silently missing them", () => {
    const here = join(tmpdir(), "toolprint-proj-here");
    const elsewhere = join(tmpdir(), "toolprint-proj-elsewhere");
    home = makeHome({
      ".claude.json": JSON.stringify({
        projects: { [elsewhere]: { mcpServers: { other: { command: "x" } } } },
      }),
    });
    process.env.HOME = home;

    const { targets, notes } = discoverClientTargets({ cwd: here, platform: "darwin" });
    expect(targets).toEqual([]);
    expect(notes.some((note) => note.reason.includes("other project scope"))).toBe(true);
  });

  it("restricts to the requested client with `only`", () => {
    home = makeHome({
      ".claude.json": JSON.stringify({ mcpServers: { a: { command: "a" } } }),
      ".cursor/mcp.json": JSON.stringify({ mcpServers: { b: { command: "b" } } }),
    });
    process.env.HOME = home;

    const { targets } = discoverClientTargets({ cwd: home, platform: "darwin", only: ["cursor"] });
    expect(targets.map((target) => target.id)).toEqual(["cursor:b"]);
  });
});

describe("AGENT_CLIENT_IDS", () => {
  it("covers the clients SkillRoute knows about", () => {
    for (const id of ["claude-code", "claude-desktop", "cursor", "vscode", "zed", "windsurf"]) {
      expect(AGENT_CLIENT_IDS).toContain(id);
    }
  });
});
