/**
 * Shared internal model. MCP capabilities (tools, prompts, resources) are
 * normalized into a uniform {@link Capability} shape so the lockfile, diff,
 * and checks can treat them consistently.
 */

export type TransportKind = "stdio" | "sse" | "http";

export type CapabilityKind = "tool" | "prompt" | "resource";

/**
 * A normalized MCP capability. `raw` is the full object as returned by the
 * server (used for hashing); `name`/`description` are pulled out for diffing
 * and check heuristics.
 */
export interface Capability {
  kind: CapabilityKind;
  /** Unique key within its kind: tool/prompt name, or resource uri. */
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
  headers?: Record<string, string>;
}

/** Result of connecting to a server and listing all its capabilities. */
export interface ServerCapabilities {
  id: string;
  transport: TransportKind;
  source: string;
  tools: Capability[];
  prompts: Capability[];
  resources: Capability[];
}

export const CAPABILITY_KINDS: CapabilityKind[] = ["tool", "prompt", "resource"];
