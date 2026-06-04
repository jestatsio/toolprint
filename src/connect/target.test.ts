import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveTargets } from "./target.js";

const cwd = process.cwd();

describe("resolveTargets", () => {
  it("maps an npx: spec to a stdio `npx -y <pkg>` command", () => {
    const [target] = resolveTargets("npx:@modelcontextprotocol/server-everything", {}, cwd);
    expect(target?.transport).toBe("stdio");
    expect(target?.command).toBe("npx");
    expect(target?.args).toEqual(["-y", "@modelcontextprotocol/server-everything"]);
  });

  it("maps an http(s) URL to an http target", () => {
    const [target] = resolveTargets("https://mcp.example.com/mcp", {}, cwd);
    expect(target?.transport).toBe("http");
    expect(target?.url).toBe("https://mcp.example.com/mcp");
  });

  it("treats a bare command string as a stdio target, split on whitespace", () => {
    const [target] = resolveTargets("node server.js --port 9000", {}, cwd);
    expect(target?.transport).toBe("stdio");
    expect(target?.command).toBe("node");
    expect(target?.args).toEqual(["server.js", "--port", "9000"]);
  });

  it("prefers --config over the positional target", () => {
    // A non-existent config path should be the source of the (eventual) error,
    // proving --config wins over the positional.
    expect(() => resolveTargets("npx:something", { config: "/no/such/config.json" }, cwd)).toThrow(
      /config/i,
    );
  });

  it("throws when no target is given and no config is discoverable", () => {
    const empty = mkdtempSync(join(tmpdir(), "toolprint-notarget-"));
    expect(() => resolveTargets(undefined, {}, empty)).toThrow(/No target/i);
  });
});
