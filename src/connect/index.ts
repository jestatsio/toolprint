import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { getErrorMessage, OperationalError } from "../errors.js";
import type { Capability, McpCapabilityKind, ServerCapabilities, ServerTarget } from "../model.js";
import { TOOLPRINT_VERSION } from "../version.js";
import { mergeHeaders } from "./auth.js";
import { connectionHint } from "./hints.js";

const CLIENT_INFO = { name: "toolprint", version: TOOLPRINT_VERSION };
const DEFAULT_TIMEOUT_MS = 30_000;

export interface ConnectOptions {
  timeoutMs?: number;
}

/** Append an actionable hint (auth, refused, ENOENT, timeout) to a failure,
 * preserving the original message and cause. */
function enrich(error: unknown, target: ServerTarget): OperationalError {
  const base =
    error instanceof OperationalError ? error : new OperationalError(getErrorMessage(error), error);
  const hint = connectionHint(base.message, target);
  return hint ? new OperationalError(`${base.message}\n  → ${hint}`, base) : base;
}

async function listAll(
  client: Client,
  target: ServerTarget,
  timeoutMs: number,
): Promise<ServerCapabilities> {
  const [tools, prompts, resources, resourceTemplates] = await Promise.all([
    listKind(client, target, "tool", timeoutMs),
    listKind(client, target, "prompt", timeoutMs),
    listKind(client, target, "resource", timeoutMs),
    listKind(client, target, "resourceTemplate", timeoutMs),
  ]);
  return {
    id: target.id,
    transport: target.transport,
    source: target.source,
    tools,
    prompts,
    resources,
    resourceTemplates,
    skills: [],
  };
}

/**
 * Connect to one MCP server, list its capabilities, and run `fn` while the
 * client is still open — the seam that lets `--probe` execute tools before the
 * connection closes. The client is always closed afterward. Connect/list
 * failures throw {@link OperationalError} (CLI exit 1) with an actionable hint;
 * errors thrown by `fn` propagate unwrapped.
 */
export async function withConnectedServer<T>(
  target: ServerTarget,
  options: ConnectOptions,
  fn: (client: Client, server: ServerCapabilities) => Promise<T>,
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let client: Client;
  try {
    client = await connectClient(target, timeoutMs);
  } catch (error) {
    throw enrich(error, target);
  }
  try {
    let server: ServerCapabilities;
    try {
      server = await listAll(client, target, timeoutMs);
    } catch (error) {
      throw enrich(error, target);
    }
    return await fn(client, server);
  } finally {
    await client.close().catch(() => {
      /* best-effort cleanup */
    });
  }
}

/**
 * Connect to one MCP server and list every tool, prompt, and resource.
 * Read-only: we never *call* a tool. Failures throw {@link OperationalError}
 * (CLI exit 1), never a security failure.
 */
export async function connectAndList(
  target: ServerTarget,
  options: ConnectOptions = {},
): Promise<ServerCapabilities> {
  return withConnectedServer(target, options, async (_client, server) => server);
}

async function connectClient(target: ServerTarget, timeoutMs: number): Promise<Client> {
  if (target.transport === "stdio") {
    if (!target.command) {
      throw new OperationalError(`stdio server "${target.id}" has no command`);
    }
    const transport = new StdioClientTransport({
      command: target.command,
      args: target.args ?? [],
      env: target.env ? { ...getDefaultEnvironment(), ...target.env } : getDefaultEnvironment(),
      // Don't let a scanned server's stderr pollute our report.
      stderr: "ignore",
    });
    return connectWith(transport, timeoutMs, `start "${target.command}"`);
  }

  if (!target.url) {
    throw new OperationalError(`${target.transport} server "${target.id}" has no url`);
  }
  const url = new URL(target.url);
  // Config-declared headers, with runtime auth (CLI/env) layered on top.
  const headers = mergeHeaders(target.headers, target.authHeaders);
  const requestInit = headers ? { headers } : undefined;

  if (target.transport === "sse") {
    return connectWith(
      new SSEClientTransport(url, { requestInit }),
      timeoutMs,
      `connect to ${target.url}`,
    );
  }

  // Streamable HTTP is the modern transport; fall back to SSE for older servers.
  try {
    return await connectWith(
      new StreamableHTTPClientTransport(url, { requestInit }),
      timeoutMs,
      `connect to ${target.url}`,
    );
  } catch {
    try {
      return await connectWith(
        new SSEClientTransport(url, { requestInit }),
        timeoutMs,
        `connect to ${target.url} (SSE)`,
      );
    } catch (sseError) {
      throw new OperationalError(
        `Could not connect to ${target.source} via Streamable HTTP or SSE: ${getErrorMessage(sseError)}`,
        sseError,
      );
    }
  }
}

async function connectWith(
  transport: Transport,
  timeoutMs: number,
  label: string,
): Promise<Client> {
  const client = new Client(CLIENT_INFO);
  await withTimeout(client.connect(transport), timeoutMs, label);
  return client;
}

const LIST_METHODS = {
  tool: "tools",
  prompt: "prompts",
  resource: "resources",
  resourceTemplate: "resourceTemplates",
} as const;

async function listKind(
  client: Client,
  target: ServerTarget,
  kind: McpCapabilityKind,
  timeoutMs: number,
): Promise<Capability[]> {
  const out: Capability[] = [];
  let cursor: string | undefined;
  try {
    do {
      const page = await listPage(client, kind, cursor, timeoutMs);
      out.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
  } catch (error) {
    // A server that doesn't implement this capability replies MethodNotFound.
    if (error instanceof McpError && error.code === ErrorCode.MethodNotFound) return [];
    throw new OperationalError(
      `Failed to list ${LIST_METHODS[kind]} on "${target.id}": ${getErrorMessage(error)}`,
      error,
    );
  }
  return out;
}

interface Page {
  items: Capability[];
  nextCursor: string | undefined;
}

async function listPage(
  client: Client,
  kind: Capability["kind"],
  cursor: string | undefined,
  timeoutMs: number,
): Promise<Page> {
  const params = cursor ? { cursor } : undefined;
  const requestOptions = { timeout: timeoutMs };
  if (kind === "tool") {
    const res = await client.listTools(params, requestOptions);
    return {
      items: res.tools.map((t) => normalize("tool", t.name, t)),
      nextCursor: res.nextCursor,
    };
  }
  if (kind === "prompt") {
    const res = await client.listPrompts(params, requestOptions);
    return {
      items: res.prompts.map((p) => normalize("prompt", p.name, p)),
      nextCursor: res.nextCursor,
    };
  }
  if (kind === "resourceTemplate") {
    const res = await client.listResourceTemplates(params, requestOptions);
    return {
      // Key by name (the stable identifier); a changed uriTemplate then reads as
      // a definition change (rug-pull), not a remove + add.
      items: res.resourceTemplates.map((t) =>
        normalize("resourceTemplate", String(t.name ?? t.uriTemplate), t),
      ),
      nextCursor: res.nextCursor,
    };
  }
  const res = await client.listResources(params, requestOptions);
  return {
    items: res.resources.map((r) => normalize("resource", String(r.uri ?? r.name), r)),
    nextCursor: res.nextCursor,
  };
}

function normalize(
  kind: Capability["kind"],
  name: string,
  raw: Record<string, unknown>,
): Capability {
  const capability: Capability = { kind, name, raw };
  if (typeof raw.title === "string") capability.title = raw.title;
  if (typeof raw.description === "string") capability.description = raw.description;
  return capability;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new OperationalError(`Timed out after ${ms}ms: ${label}`)), ms);
  });
  return Promise.race([promise.finally(() => clearTimeout(timer)), timeout]);
}
