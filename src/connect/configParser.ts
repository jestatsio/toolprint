import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { OperationalError } from "../errors.js";
import type { ServerTarget, TransportKind } from "../model.js";

/**
 * A raw server entry from an MCP client config. Shapes vary by client: the
 * de-facto standard is `{command, args, env}` under `mcpServers`, but VS Code
 * uses `servers`, Zed uses `context_servers`, Amp namespaces under
 * `amp.mcpServers`, and OpenCode nests under `mcp` with an array `command` and
 * an `environment` key.
 */
interface RawEntry {
  command?: unknown;
  args?: unknown;
  env?: unknown;
  environment?: unknown;
  url?: unknown;
  type?: unknown;
  transport?: unknown;
  headers?: unknown;
  enabled?: unknown;
}

/** An entry that was found but not turned into a scan target, and why. */
export interface SkippedEntry {
  id: string;
  reason: string;
}

export interface ParseResult {
  targets: ServerTarget[];
  skipped: SkippedEntry[];
  /** Project scopes in this config other than the one requested. Reported so a
   * user knows servers exist that this run did not cover. */
  otherProjectScopes?: number;
}

function asStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

/** Normalize the two command spellings: `"npx"` + `args`, or `["npx", "-y", …]`. */
function readCommand(raw: RawEntry): { command: string; args: string[] } | undefined {
  const extraArgs = asStringArray(raw.args);
  if (typeof raw.command === "string") {
    return { command: raw.command, args: extraArgs };
  }
  if (Array.isArray(raw.command)) {
    const parts = asStringArray(raw.command);
    const [command, ...rest] = parts;
    if (command) return { command, args: [...rest, ...extraArgs] };
  }
  return undefined;
}

type EntryOutcome = { target: ServerTarget } | { skip: string };

function entryToTarget(id: string, raw: RawEntry): EntryOutcome {
  // An explicitly disabled server is not in the agent's hands, so it is not
  // scanned — but it is reported, never silently dropped.
  if (raw.enabled === false) return { skip: "disabled in config" };

  const command = readCommand(raw);
  if (command) {
    const env = asStringRecord(raw.env) ?? asStringRecord(raw.environment);
    const target: ServerTarget = {
      id,
      transport: "stdio",
      source: [command.command, ...command.args].join(" "),
      command: command.command,
      args: command.args,
    };
    if (env) target.env = env;
    return { target };
  }

  if (typeof raw.url === "string") {
    const hint = String(raw.type ?? raw.transport ?? "http").toLowerCase();
    const transport: TransportKind = hint.includes("sse") ? "sse" : "http";
    const headers = asStringRecord(raw.headers);
    const target: ServerTarget = { id, transport, source: raw.url, url: raw.url };
    if (headers) target.headers = headers;
    return { target };
  }

  return { skip: 'entry has neither "command" nor "url"' };
}

function isEntryMap(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

interface ProjectScopes {
  /** Servers scoped to the requested project directory. */
  map: Record<string, unknown>;
  /** How many *other* project scopes carry servers. */
  others: number;
}

/**
 * Claude Code stores per-project servers under `projects.<absolute dir>`. A
 * top-level `mcpServers` may be entirely absent while the agent still reaches
 * several servers inside a given repo, so those must not be missed.
 */
function collectProjectScopes(
  root: Record<string, unknown>,
  projectDir: string | undefined,
): ProjectScopes {
  const projects = root.projects;
  if (!isEntryMap(projects)) return { map: {}, others: 0 };

  let map: Record<string, unknown> = {};
  let others = 0;
  for (const [dir, value] of Object.entries(projects)) {
    if (!isEntryMap(value)) continue;
    const servers = value.mcpServers;
    if (!isEntryMap(servers) || Object.keys(servers).length === 0) continue;
    if (projectDir !== undefined && resolve(dir) === resolve(projectDir)) map = servers;
    else others += 1;
  }
  return { map, others };
}

/**
 * Locate the server map inside a client config. Checked in order so that a
 * VS Code `mcp.servers` wrapper is never mistaken for OpenCode's flat `mcp` map.
 */
function findServerMap(root: Record<string, unknown>): Record<string, unknown> | undefined {
  const nested = root.mcp as Record<string, unknown> | undefined;
  const candidates: unknown[] = [
    root.mcpServers, // de-facto standard: Claude, Cursor, Windsurf, Gemini, Bob, Pi
    root.servers, // VS Code
    nested?.servers, // VS Code settings.json
    root.context_servers, // Zed
    root["amp.mcpServers"], // Amp
    isEntryMap(nested) && !nested.servers ? nested : undefined, // OpenCode
  ];
  return candidates.find(isEntryMap) as Record<string, unknown> | undefined;
}

export interface ParseOptions {
  /**
   * Skip what cannot be understood instead of throwing. Used by multi-config
   * discovery (`--all-clients`), where one odd file among a dozen must not sink
   * the whole run. Everything skipped is returned, so nothing is hidden.
   */
  lenient?: boolean;
  /**
   * Absolute directory whose project-scoped servers should be included. Claude
   * Code keeps per-project servers under `projects.<dir>.mcpServers` in
   * `~/.claude.json`, so a config can look empty at the top level while the
   * agent still reaches several servers in this repo.
   */
  projectDir?: string;
}

/** Parse an MCP client config into targets, plus anything deliberately skipped. */
export function parseConfigDetailed(
  content: string,
  source: string,
  options: ParseOptions = {},
): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch (error) {
    if (options.lenient)
      return { targets: [], skipped: [{ id: source, reason: "not valid JSON" }] };
    throw new OperationalError(`Config at ${source} is not valid JSON`, error);
  }

  const root = (json ?? {}) as Record<string, unknown>;
  const serversObj = findServerMap(root);
  const scopes = collectProjectScopes(root, options.projectDir);

  if (!serversObj && Object.keys(scopes.map).length === 0) {
    if (options.lenient) {
      return scopes.others > 0
        ? { targets: [], skipped: [], otherProjectScopes: scopes.others }
        : { targets: [], skipped: [] };
    }
    throw new OperationalError(`Config at ${source} has no "mcpServers" or "servers" object.`);
  }

  // Project-scoped entries win on a name clash: they are what applies here.
  const merged: Record<string, unknown> = { ...(serversObj ?? {}), ...scopes.map };

  const targets: ServerTarget[] = [];
  const skipped: SkippedEntry[] = [];
  for (const [id, entry] of Object.entries(merged)) {
    const outcome = entryToTarget(id, (entry ?? {}) as RawEntry);
    if ("target" in outcome) {
      targets.push(outcome.target);
    } else if (options.lenient) {
      skipped.push({ id, reason: outcome.skip });
    } else {
      throw new OperationalError(`Server "${id}" in config has neither "command" nor "url".`);
    }
  }

  if (targets.length === 0 && !options.lenient) {
    throw new OperationalError(`Config at ${source} defines no servers.`);
  }
  return scopes.others > 0
    ? { targets, skipped, otherProjectScopes: scopes.others }
    : { targets, skipped };
}

/** Parse the contents of an MCP client config into a list of targets. */
export function parseConfig(
  content: string,
  source: string,
  options: ParseOptions = {},
): ServerTarget[] {
  return parseConfigDetailed(content, source, options).targets;
}

export function parseConfigFile(path: string, options: ParseOptions = {}): ServerTarget[] {
  return parseConfigFileDetailed(path, options).targets;
}

export function parseConfigFileDetailed(path: string, options: ParseOptions = {}): ParseResult {
  if (!existsSync(path) || !statSync(path).isFile()) {
    if (options.lenient) return { targets: [], skipped: [{ id: path, reason: "not found" }] };
    throw new OperationalError(`Config file not found: ${path}`);
  }
  return parseConfigDetailed(readFileSync(path, "utf8"), path, options);
}
