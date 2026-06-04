/**
 * Shared internal model. MCP capabilities (tools, prompts, resources) are
 * normalized into a uniform {@link Capability} shape so the lockfile, diff,
 * and checks can treat them consistently.
 */

export type TransportKind = "stdio" | "sse" | "http";

export type CapabilityKind = "tool" | "prompt" | "resource" | "resourceTemplate";

/** Human-readable label for a kind (the raw kind value stays machine-friendly). */
const KIND_LABELS: Record<CapabilityKind, string> = {
  tool: "tool",
  prompt: "prompt",
  resource: "resource",
  resourceTemplate: "resource template",
};

export function kindLabel(kind: CapabilityKind): string {
  return KIND_LABELS[kind];
}

/**
 * A normalized MCP capability. `raw` is the full object as returned by the
 * server (used for hashing); `name`/`description` are pulled out for diffing
 * and check heuristics.
 */
export interface Capability {
  kind: CapabilityKind;
  /** Unique key within its kind: tool/prompt name, resource uri, or resource
   * template name. */
  name: string;
  title?: string;
  description?: string;
  /** Full server-provided object, minus volatile `_meta`. Source of the hash. */
  raw: Record<string, unknown>;
}

/** What we connect to: a single MCP server, resolved from a config or CLI arg. */
export interface ServerTarget {
  /** Logical id (config key, or derived from the source). */
  id: string;
  transport: TransportKind;
  /** Human-readable origin recorded in the lockfile (command line or url). */
  source: string;
  // stdio
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  // sse / http
  url?: string;
  /** Headers declared in a config file. May be committed, so they are scanned
   * for leaked secrets. */
  headers?: Record<string, string>;
  /** Auth headers injected at run time via CLI/env (`--header`, `--bearer`,
   * `TOOLPRINT_BEARER`, `TOOLPRINT_HEADER_*`). Merged over {@link headers} at
   * connect time; intentional runtime credentials, so they are never scanned for
   * secret leaks nor written to the lockfile. */
  authHeaders?: Record<string, string>;
}

/** Result of connecting to a server and listing all its capabilities. */
export interface ServerCapabilities {
  id: string;
  transport: TransportKind;
  source: string;
  tools: Capability[];
  prompts: Capability[];
  resources: Capability[];
  resourceTemplates: Capability[];
}

export const CAPABILITY_KINDS: CapabilityKind[] = [
  "tool",
  "prompt",
  "resource",
  "resourceTemplate",
];
