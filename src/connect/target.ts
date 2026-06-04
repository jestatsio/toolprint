import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { OperationalError } from "../errors.js";
import type { ServerTarget } from "../model.js";
import { parseConfigFile } from "./configParser.js";

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
