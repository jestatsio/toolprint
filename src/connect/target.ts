import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { OperationalError } from "../errors.js";
import type { ServerTarget } from "../model.js";
import { locateClientConfigs } from "./clients.js";
import { parseConfigFile, parseConfigFileDetailed } from "./configParser.js";
import { detectViaSkillroute } from "./skillroute.js";

/** Config filenames we auto-discover when no target is given. */
const CONFIG_CANDIDATES = [
  ".mcp.json",
  "mcp.json",
  join(".vscode", "mcp.json"),
  join(".cursor", "mcp.json"),
];

function discoverConfig(cwd: string): string | undefined {
  for (const candidate of CONFIG_CANDIDATES) {
    const path = join(cwd, candidate);
    if (existsSync(path) && statSync(path).isFile()) return path;
  }
  return undefined;
}

function isUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function isExistingFile(value: string): boolean {
  return existsSync(value) && statSync(value).isFile();
}

export interface ResolveOptions {
  config?: string;
}

/**
 * Turn a CLI invocation into a concrete list of servers to scan.
 *
 * Accepted positional forms:
 *   - a path to an MCP config file       → all servers in it
 *   - an http(s) URL                     → one remote server
 *   - `npx:<package>`                    → stdio server via `npx -y <package>`
 *   - a raw command string               → stdio server (split on whitespace)
 * With no positional and no `--config`, auto-discovers a config in `cwd`.
 */
export function resolveTargets(
  positional: string | undefined,
  options: ResolveOptions,
  cwd: string,
): ServerTarget[] {
  if (options.config) return parseConfigFile(options.config);

  if (!positional) {
    const discovered = discoverConfig(cwd);
    if (discovered) return parseConfigFile(discovered);
    throw new OperationalError(
      "No target given and no MCP config found. Pass a config path, an http(s) URL, " +
        "an `npx:<package>` spec, or a command — or run where an mcp.json lives.",
    );
  }

  if (positional.startsWith("npx:")) {
    const spec = positional.slice("npx:".length);
    return [
      {
        id: spec,
        transport: "stdio",
        source: `npx -y ${spec}`,
        command: "npx",
        args: ["-y", spec],
      },
    ];
  }

  if (isUrl(positional)) {
    return [{ id: positional, transport: "http", source: positional, url: positional }];
  }

  if (isExistingFile(positional)) {
    return parseConfigFile(positional);
  }

  // Treat as a command string. Naive whitespace split — fine for `npx -y pkg`
  // and `node server.js`; use `--config` or `npx:` for anything with quoting.
  const parts = positional.split(/\s+/).filter(Boolean);
  const command = parts[0];
  if (!command) {
    throw new OperationalError(`Could not interpret target: "${positional}"`);
  }
  return [{ id: command, transport: "stdio", source: positional, command, args: parts.slice(1) }];
}

/** A config that was found but not scanned, and why. Always surfaced: a trust
 * tool must never imply coverage it does not have. */
export interface DiscoveryNote {
  client: string;
  path: string;
  reason: string;
}

export interface DiscoveryResult {
  targets: ServerTarget[];
  notes: DiscoveryNote[];
  /** Config files that were successfully read. */
  scanned: number;
}

export interface DiscoverOptions {
  cwd: string;
  /** Restrict to these client ids; omit for every known client. */
  only?: string[];
  /** Also ask the SkillRoute CLI where clients are installed (opt-in). */
  useSkillroute?: boolean;
  platform?: NodeJS.Platform;
}

/**
 * Expand every agent client installed on this machine into scan targets.
 *
 * Server ids are namespaced by client (`claude-code:github`) so one lockfile can
 * hold servers from several clients without two `github` entries colliding.
 */
export function discoverClientTargets(options: DiscoverOptions): DiscoveryResult {
  const locations = locateClientConfigs({
    cwd: options.cwd,
    only: options.only,
    ...(options.platform ? { platform: options.platform } : {}),
  });

  const targets: ServerTarget[] = [];
  const notes: DiscoveryNote[] = [];
  let scanned = 0;

  for (const location of locations) {
    if (location.client.format !== "json") {
      notes.push({
        client: location.client.name,
        path: location.path,
        reason: `${location.client.format.toUpperCase()} configs are not supported yet — not scanned`,
      });
      continue;
    }

    const parsed = parseConfigFileDetailed(location.path, {
      lenient: true,
      projectDir: options.cwd,
    });
    scanned += 1;
    if (parsed.otherProjectScopes) {
      notes.push({
        client: location.client.name,
        path: location.path,
        reason: `${parsed.otherProjectScopes} other project scope(s) in this config were not scanned — run toolprint from those directories to cover them`,
      });
    }
    for (const skip of parsed.skipped) {
      notes.push({
        client: location.client.name,
        path: location.path,
        reason: `server "${skip.id}": ${skip.reason}`,
      });
    }
    for (const target of parsed.targets) {
      targets.push({ ...target, id: `${location.client.id}:${target.id}` });
    }
  }

  if (options.useSkillroute) {
    const bridge = detectViaSkillroute();
    if (bridge.unavailable) {
      notes.push({ client: "skillroute", path: "-", reason: bridge.unavailable });
    }
    const known = new Set(locations.map((location) => location.path));
    for (const detection of bridge.detections) {
      const path = resolve(detection.configPath);
      if (known.has(path) || !isExistingFile(path)) continue;
      if (!path.endsWith(".json")) {
        notes.push({
          client: detection.name,
          path,
          reason: "non-JSON config reported by skillroute — not scanned",
        });
        continue;
      }
      known.add(path);
      const parsed = parseConfigFileDetailed(path, { lenient: true });
      scanned += 1;
      for (const target of parsed.targets) {
        targets.push({ ...target, id: `${detection.id}:${target.id}` });
      }
    }
  }

  return { targets, notes, scanned };
}

/** Default places an agent loads skill bundles from, mirroring SkillRoute's
 * `[modes.skills].discovery` for Claude Code. */
export function defaultSkillRoots(cwd: string): string[] {
  const home = homedir();
  const roots = [join(cwd, ".claude", "skills"), join(home, ".claude", "skills")];

  // Plugin-provided skills are in the agent's hands too, so they are in scope.
  const pluginsDir = join(home, ".claude", "plugins");
  if (existsSync(pluginsDir) && statSync(pluginsDir).isDirectory()) {
    for (const entry of readdirSync(pluginsDir)) {
      const candidate = join(pluginsDir, entry, "skills");
      if (existsSync(candidate) && statSync(candidate).isDirectory()) roots.push(candidate);
    }
  }

  return roots.filter((root) => existsSync(root) && statSync(root).isDirectory());
}

/**
 * A portable spelling of a skills directory: relative when it is under `cwd`,
 * `~`-prefixed when it is under the home directory, absolute otherwise. Both the
 * lockfile id and the recorded `source` use it, so a committed lockfile does not
 * churn when a teammate checks the repo out somewhere else.
 */
export function skillsDisplayPath(dir: string, cwd: string): string {
  const absolute = resolve(dir);
  const home = homedir();
  if (absolute === cwd) return ".";
  if (absolute.startsWith(cwd + sep)) return relative(cwd, absolute);
  if (absolute.startsWith(home + sep)) return `~/${relative(home, absolute)}`;
  return absolute;
}

export function skillsTargetId(dir: string, cwd: string): string {
  return `skills:${skillsDisplayPath(dir, cwd)}`;
}

/** Turn skill roots into scan targets. With no explicit dirs, the default roots
 * are discovered; an explicit dir that does not exist is an error, because the
 * user named it and silently scanning nothing would be a false all-clear. */
export function resolveSkillTargets(dirs: string[], cwd: string): ServerTarget[] {
  const roots = dirs.length > 0 ? dirs.map((dir) => resolve(cwd, dir)) : defaultSkillRoots(cwd);

  if (roots.length === 0) {
    throw new OperationalError(
      "No skill bundles found. Looked in .claude/skills and ~/.claude/skills — " +
        "pass a directory explicitly with `--skills <dir>`.",
    );
  }

  for (const root of roots) {
    if (!existsSync(root) || !statSync(root).isDirectory()) {
      throw new OperationalError(`Skills directory not found: ${root}`);
    }
  }

  return roots.map((root) => {
    const display = skillsDisplayPath(root, cwd);
    return { id: `skills:${display}`, transport: "skills" as const, source: display };
  });
}
