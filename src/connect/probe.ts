import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getErrorMessage } from "../errors.js";
import type { Capability, ServerCapabilities } from "../model.js";

/**
 * Opt-in tool execution (`--probe`). Toolprint is read-only by default; probing
 * is the one path that *calls* a tool, so it is deliberately conservative:
 * unless a tool is explicitly named, only tools the server annotates
 * `readOnlyHint: true` are executed, and only with empty arguments. The output
 * is then inspected for poisoning/secrets by the `tool-output` check.
 */

/** Cap on inspected output so a hostile server can't flood the scan. */
const MAX_OUTPUT_CHARS = 20_000;

/** Upper bound on tools executed in one probe run, so a server advertising
 * thousands of read-only tools can't turn `--probe` into a long-running job. */
const MAX_PROBE_TOOLS = 50;

export interface ToolProbe {
  name: string;
  status: "ok" | "skipped" | "error";
  /** Why a tool was skipped, or the error message when execution failed. */
  reason?: string;
  /** Flattened text output, present only on `status: "ok"`. */
  outputText?: string;
}

export interface ProbeRequest {
  /** Probe tools the server annotates `readOnlyHint: true` (the bare --probe flag). */
  includeReadOnly: boolean;
  /** Tool names to force-probe regardless of annotation (`--probe-tool`). */
  tools: string[];
}

export interface ProbeOptions extends ProbeRequest {
  timeoutMs: number;
}

function isReadOnly(tool: Capability): boolean {
  const annotations = (tool.raw as { annotations?: unknown }).annotations;
  return (
    typeof annotations === "object" &&
    annotations !== null &&
    (annotations as { readOnlyHint?: unknown }).readOnlyHint === true
  );
}

function hasRequiredParams(tool: Capability): boolean {
  const schema = (tool.raw as { inputSchema?: unknown }).inputSchema;
  if (typeof schema !== "object" || schema === null) return false;
  const required = (schema as { required?: unknown }).required;
  return Array.isArray(required) && required.length > 0;
}

/** Flatten a CallTool result's text content (and any structured content) into a
 * single bounded string for inspection. */
function flattenOutput(result: unknown): string {
  const parts: string[] = [];
  const content = (result as { content?: unknown }).content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (
        block &&
        typeof block === "object" &&
        (block as { type?: unknown }).type === "text" &&
        typeof (block as { text?: unknown }).text === "string"
      ) {
        parts.push((block as { text: string }).text);
      }
    }
  }
  const structured = (result as { structuredContent?: unknown }).structuredContent;
  if (structured !== undefined) {
    try {
      parts.push(JSON.stringify(structured));
    } catch {
      /* non-serializable structured content is simply skipped */
    }
  }
  const text = parts.join("\n");
  return text.length > MAX_OUTPUT_CHARS ? text.slice(0, MAX_OUTPUT_CHARS) : text;
}

/**
 * Decide which of a server's tools to execute, in display order, plus the
 * `skipped` records for candidates we deliberately won't run. Pure (no I/O) so
 * the safety policy can be unit-tested without a live server.
 */
export function selectToolsToProbe(
  server: ServerCapabilities,
  request: ProbeRequest,
): { run: Capability[]; skipped: ToolProbe[] } {
  const forced = new Set(request.tools);
  const skipped: ToolProbe[] = [];
  const run: Capability[] = [];

  for (const name of request.tools) {
    if (!server.tools.some((tool) => tool.name === name)) {
      skipped.push({ name, status: "skipped", reason: "not offered by this server" });
    }
  }

  for (const tool of server.tools) {
    const isForced = forced.has(tool.name);
    const eligible = isForced || (request.includeReadOnly && isReadOnly(tool));
    if (!eligible) continue;
    // A named tool is run as-is (explicit override); an auto-selected read-only
    // tool with required params is skipped — we won't invent argument values.
    if (!isForced && hasRequiredParams(tool)) {
      skipped.push({
        name: tool.name,
        status: "skipped",
        reason: "requires arguments (pass --probe-tool to force)",
      });
      continue;
    }
    run.push(tool);
  }

  // Cap the number of executions; surface the dropped tools rather than
  // silently truncating, so a bounded run never reads as "probed everything".
  if (run.length > MAX_PROBE_TOOLS) {
    for (const dropped of run.slice(MAX_PROBE_TOOLS)) {
      skipped.push({
        name: dropped.name,
        status: "skipped",
        reason: `probe limit reached (${MAX_PROBE_TOOLS} max); name it with --probe-tool to force`,
      });
    }
    return { run: run.slice(0, MAX_PROBE_TOOLS), skipped };
  }
  return { run, skipped };
}

/** Execute the selected tools with empty arguments and capture their output. */
export async function probeTools(
  client: Client,
  server: ServerCapabilities,
  options: ProbeOptions,
): Promise<ToolProbe[]> {
  const { run, skipped } = selectToolsToProbe(server, options);
  const probes: ToolProbe[] = [...skipped];

  for (const tool of run) {
    try {
      const result = await client.callTool({ name: tool.name, arguments: {} }, undefined, {
        timeout: options.timeoutMs,
      });
      probes.push({ name: tool.name, status: "ok", outputText: flattenOutput(result) });
    } catch (error) {
      probes.push({ name: tool.name, status: "error", reason: getErrorMessage(error) });
    }
  }
  return probes;
}

/** A human-readable, stderr-bound warning naming the tools that will run, so a
 * probe is never silent. Returns undefined when nothing will be executed. */
export function probeWarning(
  server: ServerCapabilities,
  request: ProbeRequest,
): string | undefined {
  const { run } = selectToolsToProbe(server, request);
  if (run.length === 0) return undefined;
  const names = run.map((t) => `"${t.name}"`).join(", ");
  return (
    `⚠ --probe will EXECUTE ${run.length} tool(s) on "${server.id}" with empty arguments: ${names}. ` +
    "Only probe servers you trust to run side-effect-free."
  );
}
