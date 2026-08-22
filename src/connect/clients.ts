import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Where each agent client keeps its MCP configuration.
 *
 * The table is derived from SkillRoute's harness manifests
 * (https://github.com/erichare/skillroute → `harnesses/*.toml`), which track
 * these locations across 15 clients and three platforms. It is vendored rather
 * than imported so toolprint keeps its "no install, no Python" promise; when the
 * `skillroute` CLI happens to be on PATH, {@link discoverClientConfigs} layers
 * its live `harness detect --json` output on top.
 *
 * Only JSON configs can be scanned today. Clients that store MCP servers in TOML
 * or YAML are still listed, and are reported as explicitly *skipped* rather than
 * omitted — a trust tool must never imply coverage it does not have.
 */

export type ConfigFormat = "json" | "toml" | "yaml";

export interface ClientPaths {
  /** Same path on every platform. */
  all?: string[];
  darwin?: string[];
  linux?: string[];
  win32?: string[];
}

export interface AgentClient {
  id: string;
  name: string;
  format: ConfigFormat;
  /** User-level config locations. `~` and `%APPDATA%` are expanded on resolve. */
  paths: ClientPaths;
  /** Project-level config locations, relative to the working directory. */
  projectPaths?: string[];
}

export const AGENT_CLIENTS: AgentClient[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    format: "json",
    paths: { all: ["~/.claude.json"] },
    projectPaths: [".mcp.json"],
  },
  {
    id: "claude-desktop",
    name: "Claude Desktop",
    format: "json",
    paths: {
      darwin: ["~/Library/Application Support/Claude/claude_desktop_config.json"],
      linux: ["~/.config/Claude/claude_desktop_config.json"],
      win32: ["%APPDATA%/Claude/claude_desktop_config.json"],
    },
  },
  {
    id: "cursor",
    name: "Cursor",
    format: "json",
    paths: { all: ["~/.cursor/mcp.json"] },
    projectPaths: [join(".cursor", "mcp.json")],
  },
  {
    id: "vscode",
    name: "VS Code",
    format: "json",
    paths: {
      darwin: ["~/Library/Application Support/Code/User/mcp.json"],
      linux: ["~/.config/Code/User/mcp.json"],
      win32: ["%APPDATA%/Code/User/mcp.json"],
    },
    projectPaths: [join(".vscode", "mcp.json")],
  },
  {
    id: "windsurf",
    name: "Windsurf",
    format: "json",
    paths: { all: ["~/.codeium/windsurf/mcp_config.json"] },
  },
  {
    id: "zed",
    name: "Zed",
    format: "json",
    paths: {
      darwin: ["~/.config/zed/settings.json"],
      linux: ["~/.config/zed/settings.json"],
      win32: ["%APPDATA%/Zed/settings.json"],
    },
  },
  {
    id: "gemini-cli",
    name: "Gemini CLI",
    format: "json",
    paths: { all: ["~/.gemini/settings.json"] },
    projectPaths: [join(".gemini", "settings.json")],
  },
  {
    id: "amp",
    name: "Amp",
    format: "json",
    paths: { all: ["~/.config/amp/settings.json"] },
  },
  {
    id: "opencode",
    name: "OpenCode",
    format: "json",
    paths: { all: ["~/.config/opencode/opencode.json"] },
    projectPaths: ["opencode.json"],
  },
  {
    id: "ibm-bob",
    name: "IBM Bob",
    format: "json",
    paths: { all: ["~/.bob/mcp.json"] },
    projectPaths: [join(".bob", "mcp.json")],
  },
  {
    id: "pi",
    name: "Pi",
    format: "json",
    paths: { all: ["~/.pi/agent/mcp.json", "~/.pi/agent/settings.json"] },
    projectPaths: [join(".pi", "mcp.json")],
  },
  // Non-JSON configs. Listed so `--all-clients` can say "found but not scanned"
  // instead of leaving the user to assume they were covered.
  { id: "codex", name: "Codex", format: "toml", paths: { all: ["~/.codex/config.toml"] } },
  {
    id: "goose",
    name: "Goose",
    format: "yaml",
    paths: {
      darwin: ["~/.config/goose/config.yaml"],
      linux: ["~/.config/goose/config.yaml"],
      win32: ["%APPDATA%/Block/goose/config/config.yaml"],
    },
  },
  { id: "hermes", name: "Hermes Agent", format: "yaml", paths: { all: ["~/.hermes/config.yaml"] } },
  {
    id: "deepseek",
    name: "DeepSeek Harness",
    format: "yaml",
    paths: { all: ["~/.dsh/cordis.patch.yml"] },
  },
];

/** Expand `~` and `%APPDATA%` into absolute paths. */
export function expandPath(path: string): string {
  let expanded = path;
  if (expanded.startsWith("~/")) expanded = join(homedir(), expanded.slice(2));
  if (expanded.includes("%APPDATA%")) {
    const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    expanded = expanded.replace("%APPDATA%", appData);
  }
  return resolve(expanded);
}

function platformPaths(client: AgentClient, platform: NodeJS.Platform): string[] {
  const { paths } = client;
  const specific =
    platform === "darwin" ? paths.darwin : platform === "win32" ? paths.win32 : paths.linux;
  return [...(paths.all ?? []), ...(specific ?? [])];
}

export interface ClientConfigLocation {
  client: AgentClient;
  /** Absolute path to an existing config file. */
  path: string;
  /** "user" for a home-directory config, "project" for one under `cwd`. */
  scope: "user" | "project";
}

export interface LocateOptions {
  cwd: string;
  platform?: NodeJS.Platform;
  /** Restrict to these client ids. */
  only?: string[];
}

/**
 * Every agent-client config that actually exists on this machine, user-level and
 * project-level. Non-existent paths are dropped silently (a client that is not
 * installed is not a gap); unsupported *formats* are kept, so the caller can
 * report them.
 */
export function locateClientConfigs(options: LocateOptions): ClientConfigLocation[] {
  const platform = options.platform ?? process.platform;
  const only = options.only ? new Set(options.only) : undefined;
  const seen = new Set<string>();
  const found: ClientConfigLocation[] = [];

  for (const client of AGENT_CLIENTS) {
    if (only && !only.has(client.id)) continue;

    const candidates: { path: string; scope: "user" | "project" }[] = [
      ...platformPaths(client, platform).map((p) => ({
        path: expandPath(p),
        scope: "user" as const,
      })),
      ...(client.projectPaths ?? []).map((p) => ({
        path: resolve(options.cwd, p),
        scope: "project" as const,
      })),
    ];

    for (const candidate of candidates) {
      if (seen.has(candidate.path)) continue;
      if (!existsSync(candidate.path) || !statSync(candidate.path).isFile()) continue;
      seen.add(candidate.path);
      found.push({ client, path: candidate.path, scope: candidate.scope });
    }
  }

  return found;
}

/** Client ids toolprint knows about, for `--client` validation and `--help`. */
export const AGENT_CLIENT_IDS: string[] = AGENT_CLIENTS.map((client) => client.id);
