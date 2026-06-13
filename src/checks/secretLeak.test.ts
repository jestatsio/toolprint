import { describe, expect, it } from "vitest";
import type { Capability, ServerCapabilities, ServerTarget } from "../model.js";
import { secretLeakCheck } from "./secretLeak.js";
import type { CheckInput } from "./types.js";

function inputFor(target: Partial<ServerTarget>, tools: Capability[] = []): CheckInput {
  const fullTarget: ServerTarget = {
    id: "s",
    transport: "stdio",
    source: "x",
    command: "x",
    ...target,
  };
  const server: ServerCapabilities = {
    id: "s",
    transport: "stdio",
    source: "x",
    tools,
    prompts: [],
    resources: [],
    resourceTemplates: [],
  };
  const empty = { added: [], removed: [], changed: [] };
  return {
    target: fullTarget,
    server,
    diff: {
      id: "s",
      isUnpinned: false,
      tool: empty,
      prompt: empty,
      resource: empty,
      resourceTemplate: empty,
    },
  };
}

function run(target: Partial<ServerTarget>, tools: Capability[] = []) {
  return secretLeakCheck.run(inputFor(target, tools));
}

describe("secretLeakCheck — precision (must NOT false-positive)", () => {
  it("ignores env-var placeholders and references", () => {
    const findings = run({
      env: {
        OPENAI_API_KEY: "${OPENAI_API_KEY}",
        TOKEN: "<your-token-here>",
        OTHER: "changeme",
        PATH_DIR: "/var/lib/app/data",
        MODE: "production",
      },
    });
    expect(findings).toHaveLength(0);
  });

  it("ignores ordinary low-entropy args and urls", () => {
    const findings = run({
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      url: "https://mcp.example.com/mcp",
    });
    expect(findings).toHaveLength(0);
  });
});

describe("secretLeakCheck — detection (must fire on planted secrets)", () => {
  it("flags a live-looking OpenAI key in env", () => {
    const findings = run({ env: { OPENAI_API_KEY: "sk-abcd1234efgh5678ijkl9012mnop3456qrst" } });
    expect(findings.some((f) => f.severity === "high")).toBe(true);
  });

  it("flags an AWS access key id in env", () => {
    const findings = run({ env: { AWS_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE" } });
    expect(findings.some((f) => f.severity === "high")).toBe(true);
  });

  it("flags a secret inside an Authorization header", () => {
    const findings = run({
      headers: { Authorization: "Bearer ghp_abcdefghijklmnopqrstuvwxyz0123456789" },
    });
    expect(findings.some((f) => f.severity === "high")).toBe(true);
  });

  it("does NOT scan runtime auth headers (intentional, never committed)", () => {
    // The same token in a config `headers` entry fires; in `authHeaders`
    // (supplied via --bearer/--header/env at run time) it must not.
    const token = "Bearer ghp_abcdefghijklmnopqrstuvwxyz0123456789";
    expect(run({ headers: { Authorization: token } }).length).toBeGreaterThan(0);
    expect(run({ authHeaders: { Authorization: token } })).toHaveLength(0);
  });

  it("flags a high-entropy value as a probable secret (medium)", () => {
    const findings = run({ env: { SESSION: "Zx9Kq2Lm8Wp4Rt6Yv0Bn3Cd5Ef7Gh1Jk" } });
    expect(findings.some((f) => f.severity === "medium")).toBe(true);
  });

  it("flags a key embedded in a tool description and attaches the capability", () => {
    const tool: Capability = {
      kind: "tool",
      name: "leaky",
      description: "Uses key sk-abcd1234efgh5678ijkl9012mnop3456qrst internally.",
      raw: { name: "leaky" },
    };
    const findings = run({}, [tool]);
    expect(findings.some((f) => f.capability?.name === "leaky")).toBe(true);
  });

  it("never prints the full secret (always redacted)", () => {
    const secret = "sk-abcd1234efgh5678ijkl9012mnop3456qrst";
    const findings = run({ env: { OPENAI_API_KEY: secret } });
    for (const finding of findings) {
      expect(finding.evidence).toContain("redacted");
      expect(finding.evidence).not.toContain(secret);
    }
  });

  it("flags a database connection string with embedded credentials in a url", () => {
    const findings = run({ url: "postgres://appuser:hunter2hunter2@db.internal:5432/app" });
    expect(findings.some((f) => f.severity === "high")).toBe(true);
  });

  it("flags an Anthropic key embedded in a tool description", () => {
    const tool: Capability = {
      kind: "tool",
      name: "leaky",
      description: "Calls Anthropic with sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWx0123456789.",
      raw: { name: "leaky" },
    };
    const findings = run({}, [tool]);
    expect(findings.some((f) => f.severity === "high" && f.capability?.name === "leaky")).toBe(
      true,
    );
  });
});
