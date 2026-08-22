import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OperationalError } from "../errors.js";
import { parseConfig, parseConfigFileDetailed } from "./configParser.js";

describe("parseConfig", () => {
  it("parses Claude Desktop / Cursor `mcpServers` stdio entries", () => {
    const content = JSON.stringify({
      mcpServers: {
        filesystem: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
        },
      },
    });
    const [target] = parseConfig(content, "test");
    expect(target?.transport).toBe("stdio");
    expect(target?.command).toBe("npx");
    expect(target?.args).toEqual(["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]);
    expect(target?.source).toContain("npx");
  });

  it("parses VS Code `servers` with an http url", () => {
    const content = JSON.stringify({
      servers: { remote: { url: "https://mcp.example.com/sse", type: "sse" } },
    });
    const [target] = parseConfig(content, "test");
    expect(target?.transport).toBe("sse");
    expect(target?.url).toBe("https://mcp.example.com/sse");
  });

  it("defaults remote entries to http when type is unspecified", () => {
    const content = JSON.stringify({ mcpServers: { r: { url: "https://mcp.example.com/mcp" } } });
    const [target] = parseConfig(content, "test");
    expect(target?.transport).toBe("http");
  });

  it("parses VS Code settings.json nested `mcp.servers`", () => {
    const content = JSON.stringify({
      mcp: { servers: { x: { command: "node", args: ["s.js"] } } },
    });
    const [target] = parseConfig(content, "test");
    expect(target?.command).toBe("node");
  });

  it("captures env and headers", () => {
    const content = JSON.stringify({
      mcpServers: {
        a: { command: "node", env: { TOKEN: "x" } },
        b: { url: "https://h", headers: { Authorization: "Bearer y" } },
      },
    });
    const targets = parseConfig(content, "test");
    expect(targets.find((t) => t.id === "a")?.env).toEqual({ TOKEN: "x" });
    expect(targets.find((t) => t.id === "b")?.headers).toEqual({ Authorization: "Bearer y" });
  });

  it("throws OperationalError on malformed JSON", () => {
    expect(() => parseConfig("{not json", "test")).toThrow(OperationalError);
  });

  it("throws when an entry has neither command nor url", () => {
    const content = JSON.stringify({ mcpServers: { bad: { foo: "bar" } } });
    expect(() => parseConfig(content, "test")).toThrow(OperationalError);
  });
});

describe("parseConfigFileDetailed — reads without a check-then-read race", () => {
  const dir = mkdtempSync(join(tmpdir(), "toolprint-cfg-"));

  it("reads a real config", () => {
    const path = join(dir, "ok.json");
    writeFileSync(path, JSON.stringify({ mcpServers: { a: { command: "x" } } }));
    expect(parseConfigFileDetailed(path).targets.map((t) => t.id)).toEqual(["a"]);
  });

  it("reports a missing file with a clear error, not a crash", () => {
    expect(() => parseConfigFileDetailed(join(dir, "nope.json"))).toThrow(OperationalError);
    expect(() => parseConfigFileDetailed(join(dir, "nope.json"))).toThrow(/not found/);
  });

  it("skips an unreadable path in lenient mode instead of sinking a multi-config run", () => {
    const result = parseConfigFileDetailed(join(dir, "nope.json"), { lenient: true });
    expect(result.targets).toEqual([]);
    expect(result.skipped[0]?.reason).toBe("not readable");
  });

  it("treats a directory as unreadable rather than throwing something opaque", () => {
    // A directory surfaces as EISDIR from the read; strict mode still errors
    // cleanly and lenient mode still just skips it.
    expect(() => parseConfigFileDetailed(dir)).toThrow(OperationalError);
    expect(parseConfigFileDetailed(dir, { lenient: true }).targets).toEqual([]);
  });
});
