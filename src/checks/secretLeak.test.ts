import { describe, expect, it } from "vitest";
import type { Capability, ServerCapabilities, ServerTarget } from "../model.js";
import { secretLeakCheck } from "./secretLeak.js";
import type { CheckInput } from "./types.js";

// Fake credentials are assembled from fragments so no credential-shaped
// literal is ever committed; the assembled values are inert but match the
// provider formats under test.
const CHARS = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
function body(n: number): string {
  return Array.from({ length: n }, (_, i) => CHARS[i % CHARS.length]).join("");
}
function fake(...parts: string[]): string {
  return parts.join("");
}
const FAKE_OPENAI = fake("sk-", body(36));
const FAKE_ANTHROPIC = fake("sk-", "ant-", "api03-", body(36));
const FAKE_GITHUB = fake("ghp_", body(36));
const FAKE_AWS = fake("AKIA", "IOSFODNN7E", "XAMPLE");
const FAKE_DB_URI = fake("postgres://app", "user:", "hunter2", "hunter2", "@db.internal:5432/app");
const FAKE_ENTROPY = ["Zx9K", "q2Lm", "8Wp4", "Rt6Y", "v0Bn", "3Cd5", "Ef7G", "h1Jk"].join("");

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
    skills: [],
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
    const findings = run({ env: { OPENAI_API_KEY: FAKE_OPENAI } });
    expect(findings.some((f) => f.severity === "high")).toBe(true);
  });

  it("flags an AWS access key id in env", () => {
    const findings = run({ env: { AWS_ACCESS_KEY_ID: FAKE_AWS } });
    expect(findings.some((f) => f.severity === "high")).toBe(true);
  });

  it("flags a secret inside an Authorization header", () => {
    const findings = run({
      headers: { Authorization: `Bearer ${FAKE_GITHUB}` },
    });
    expect(findings.some((f) => f.severity === "high")).toBe(true);
  });

  it("does NOT scan runtime auth headers (intentional, never committed)", () => {
    // The same token in a config `headers` entry fires; in `authHeaders`
    // (supplied via --bearer/--header/env at run time) it must not.
    const token = `Bearer ${FAKE_GITHUB}`;
    expect(run({ headers: { Authorization: token } }).length).toBeGreaterThan(0);
    expect(run({ authHeaders: { Authorization: token } })).toHaveLength(0);
  });

  it("flags a high-entropy value as a probable secret (medium)", () => {
    const findings = run({ env: { SESSION: FAKE_ENTROPY } });
    expect(findings.some((f) => f.severity === "medium")).toBe(true);
  });

  it("flags a key embedded in a tool description and attaches the capability", () => {
    const tool: Capability = {
      kind: "tool",
      name: "leaky",
      description: `Uses key ${FAKE_OPENAI} internally.`,
      raw: { name: "leaky" },
    };
    const findings = run({}, [tool]);
    expect(findings.some((f) => f.capability?.name === "leaky")).toBe(true);
  });

  it("never prints the full secret (always redacted)", () => {
    const secret = FAKE_OPENAI;
    const findings = run({ env: { OPENAI_API_KEY: secret } });
    for (const finding of findings) {
      expect(finding.evidence).toContain("redacted");
      expect(finding.evidence).not.toContain(secret);
    }
  });

  it("flags a database connection string with embedded credentials in a url", () => {
    const findings = run({ url: FAKE_DB_URI });
    expect(findings.some((f) => f.severity === "high")).toBe(true);
  });

  it("flags an Anthropic key embedded in a tool description", () => {
    const tool: Capability = {
      kind: "tool",
      name: "leaky",
      description: `Calls Anthropic with ${FAKE_ANTHROPIC}.`,
      raw: { name: "leaky" },
    };
    const findings = run({}, [tool]);
    expect(findings.some((f) => f.severity === "high" && f.capability?.name === "leaky")).toBe(
      true,
    );
  });
});
