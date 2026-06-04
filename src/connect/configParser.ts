import { existsSync, readFileSync, statSync } from "node:fs";
import { OperationalError } from "../errors.js";
import type { ServerTarget, TransportKind } from "../model.js";

/** A raw server entry from an MCP client config (Claude Desktop, VS Code, Cursor). */
interface RawEntry {
  command?: unknown;
  args?: unknown;
  env?: unknown;
  url?: unknown;
  type?: unknown;
  transport?: unknown;
  headers?: unknown;
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

function entryToTarget(id: string, raw: RawEntry): ServerTarget {
  if (typeof raw.command === "string") {
    const args = asStringArray(raw.args);
    const env = asStringRecord(raw.env);
    const target: ServerTarget = {
      id,
      transport: "stdio",
      source: [raw.command, ...args].join(" "),
      command: raw.command,
      args,
    };
    if (env) target.env = env;
    return target;
  }

  if (typeof raw.url === "string") {
    const hint = String(raw.type ?? raw.transport ?? "http").toLowerCase();
    const transport: TransportKind = hint.includes("sse") ? "sse" : "http";
    const headers = asStringRecord(raw.headers);
    const target: ServerTarget = { id, transport, source: raw.url, url: raw.url };
    if (headers) target.headers = headers;
    return target;
  }

  throw new OperationalError(`Server "${id}" in config has neither "command" nor "url".`);
}

/** Parse the contents of an MCP client config into a list of targets. */
export function parseConfig(content: string, source: string): ServerTarget[] {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch (error) {
    throw new OperationalError(`Config at ${source} is not valid JSON`, error);
  }
  const root = json as Record<string, unknown>;
  const nested = root.mcp as Record<string, unknown> | undefined;
  const serversObj =
    (root.mcpServers as Record<string, unknown> | undefined) ??
    (root.servers as Record<string, unknown> | undefined) ??
    (nested?.servers as Record<string, unknown> | undefined);

  if (!serversObj || typeof serversObj !== "object") {
    throw new OperationalError(`Config at ${source} has no "mcpServers" or "servers" object.`);
  }

  const targets = Object.entries(serversObj).map(([id, entry]) =>
    entryToTarget(id, (entry ?? {}) as RawEntry),
  );
  if (targets.length === 0) {
    throw new OperationalError(`Config at ${source} defines no servers.`);
  }
  return targets;
}

export function parseConfigFile(path: string): ServerTarget[] {
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new OperationalError(`Config file not found: ${path}`);
  }
  return parseConfig(readFileSync(path, "utf8"), path);
}
