import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { describe, expect, it } from "vitest";
import type { Capability, ServerCapabilities } from "../model.js";
import { probeTools, probeWarning, selectToolsToProbe } from "./probe.js";

function tool(
  name: string,
  opts: { readOnlyHint?: boolean; required?: string[] } = {},
): Capability {
  const inputSchema: Record<string, unknown> = { type: "object" };
  if (opts.required) inputSchema.required = opts.required;
  const raw: Record<string, unknown> = { name, inputSchema };
  if (opts.readOnlyHint !== undefined) raw.annotations = { readOnlyHint: opts.readOnlyHint };
  return { kind: "tool", name, raw };
}

function server(tools: Capability[]): ServerCapabilities {
  return {
    id: "s",
    transport: "stdio",
    source: "x",
    tools,
    prompts: [],
    resources: [],
    resourceTemplates: [],
  };
}

const srv = server([
  tool("get_status", { readOnlyHint: true }),
  tool("lookup", { readOnlyHint: true, required: ["id"] }),
  tool("write_file", { readOnlyHint: false, required: ["path"] }),
  tool("delete_all"),
]);

describe("selectToolsToProbe — read-only-only default", () => {
  it("runs read-only tools without required args and skips read-only tools that need args", () => {
    const { run, skipped } = selectToolsToProbe(srv, { includeReadOnly: true, tools: [] });
    expect(run.map((t) => t.name)).toEqual(["get_status"]);
    expect(skipped.find((s) => s.name === "lookup")?.reason).toMatch(/requires arguments/);
  });

  it("never runs tools that aren't annotated read-only", () => {
    const { run, skipped } = selectToolsToProbe(srv, { includeReadOnly: true, tools: [] });
    expect(run.map((t) => t.name)).not.toContain("write_file");
    expect(run.map((t) => t.name)).not.toContain("delete_all");
    // Non-candidates aren't even reported as skipped (no noise).
    expect(skipped.map((s) => s.name)).not.toContain("delete_all");
  });

  it("does nothing when neither read-only nor a forced tool is requested", () => {
    const { run } = selectToolsToProbe(srv, { includeReadOnly: false, tools: [] });
    expect(run).toHaveLength(0);
  });
});

describe("selectToolsToProbe — explicit --probe-tool allowlist", () => {
  it("force-runs a named tool regardless of annotation or required args", () => {
    const { run } = selectToolsToProbe(srv, { includeReadOnly: false, tools: ["write_file"] });
    expect(run.map((t) => t.name)).toEqual(["write_file"]);
  });

  it("reports a named tool the server does not offer as skipped", () => {
    const { run, skipped } = selectToolsToProbe(srv, { includeReadOnly: false, tools: ["nope"] });
    expect(run).toHaveLength(0);
    expect(skipped.find((s) => s.name === "nope")?.reason).toMatch(/not offered/);
  });
});

describe("selectToolsToProbe — execution limit", () => {
  it("caps the run at 50 tools and reports the overflow as skipped (no silent truncation)", () => {
    const many = Array.from({ length: 60 }, (_, i) => tool(`t${i}`, { readOnlyHint: true }));
    const { run, skipped } = selectToolsToProbe(server(many), { includeReadOnly: true, tools: [] });
    expect(run).toHaveLength(50);
    expect(skipped.filter((s) => /probe limit/.test(s.reason ?? ""))).toHaveLength(10);
  });
});

describe("probeWarning", () => {
  it("names the tools that will execute", () => {
    const warning = probeWarning(srv, { includeReadOnly: true, tools: [] });
    expect(warning).toMatch(/EXECUTE/);
    expect(warning).toContain('"get_status"');
  });

  it("is undefined when nothing will run", () => {
    expect(probeWarning(srv, { includeReadOnly: false, tools: [] })).toBeUndefined();
  });
});

describe("probeTools — execution", () => {
  function fakeClient(callTool: Client["callTool"]): Client {
    return { callTool } as unknown as Client;
  }

  it("captures flattened text output on success", async () => {
    const client = fakeClient(async () => ({
      content: [{ type: "text", text: "hello" }],
    }));
    const probes = await probeTools(client, server([tool("get_status", { readOnlyHint: true })]), {
      includeReadOnly: true,
      tools: [],
      timeoutMs: 1000,
    });
    const ok = probes.find((p) => p.name === "get_status");
    expect(ok?.status).toBe("ok");
    expect(ok?.outputText).toBe("hello");
  });

  it("records an error status when a call throws", async () => {
    const client = fakeClient(async () => {
      throw new Error("boom");
    });
    const probes = await probeTools(client, server([tool("get_status", { readOnlyHint: true })]), {
      includeReadOnly: true,
      tools: [],
      timeoutMs: 1000,
    });
    expect(probes.find((p) => p.name === "get_status")?.status).toBe("error");
  });
});
