import { describe, expect, it } from "vitest";
import type { Capability, ServerCapabilities } from "../model.js";
import { lockedContentEquals, mergeLockfile, serializeLockfile } from "./io.js";
import type { Lockfile } from "./schema.js";

function tool(name: string, description: string): Capability {
  return {
    kind: "tool",
    name,
    description,
    raw: { name, description, inputSchema: { type: "object" } },
  };
}

function server(id: string, tools: Capability[]): ServerCapabilities {
  return { id, transport: "stdio", source: `cmd ${id}`, tools, prompts: [], resources: [] };
}

describe("mergeLockfile", () => {
  it("creates a fresh lockfile from scanned servers", () => {
    const lock = mergeLockfile(null, [server("a", [tool("t", "x")])], "2026-01-01T00:00:00Z");
    expect(Object.keys(lock.servers)).toEqual(["a"]);
    expect(lock.servers.a?.tools.t?.description).toBe("x");
    expect(lock.generatedAt).toBe("2026-01-01T00:00:00Z");
  });

  it("overlays re-scanned servers while preserving servers not in this run", () => {
    const first = mergeLockfile(
      null,
      [server("a", [tool("t", "x")]), server("b", [tool("u", "y")])],
      "t1",
    );
    const next = mergeLockfile(first, [server("a", [tool("t", "x2")])], "t2");
    expect(Object.keys(next.servers).sort()).toEqual(["a", "b"]);
    expect(next.servers.a?.tools.t?.description).toBe("x2");
    expect(next.servers.b).toEqual(first.servers.b);
  });
});

describe("lockedContentEquals", () => {
  it("treats two locks with identical content but different timestamps as equal", () => {
    const a = mergeLockfile(null, [server("a", [tool("t", "x")])], "t1");
    const b = mergeLockfile(null, [server("a", [tool("t", "x")])], "much-later");
    expect(lockedContentEquals(a, b)).toBe(true);
  });

  it("detects a changed description", () => {
    const a = mergeLockfile(null, [server("a", [tool("t", "x")])], "t1");
    const b = mergeLockfile(null, [server("a", [tool("t", "CHANGED")])], "t1");
    expect(lockedContentEquals(a, b)).toBe(false);
  });

  it("detects added or removed servers", () => {
    const a = mergeLockfile(null, [server("a", [tool("t", "x")])], "t1");
    const b = mergeLockfile(
      null,
      [server("a", [tool("t", "x")]), server("c", [tool("t", "z")])],
      "t1",
    );
    expect(lockedContentEquals(a, b)).toBe(false);
  });

  it("rejects a pathologically deep structure instead of overflowing the stack", () => {
    let deep: Record<string, unknown> = { hash: "x" };
    for (let i = 0; i < 5000; i++) deep = { nested: deep };
    const lock = {
      lockfileVersion: 1,
      toolprintVersion: "0.0.0",
      generatedAt: "t",
      servers: { s: { transport: "stdio", tools: { t: deep }, prompts: {}, resources: {} } },
    } as unknown as Lockfile;
    expect(() => lockedContentEquals(lock, lock)).toThrow(/nested deeper/);
  });
});

describe("serializeLockfile", () => {
  it("is deterministic and ends with a trailing newline", () => {
    const lock = mergeLockfile(
      null,
      [server("b", [tool("z", "1")]), server("a", [tool("y", "2")])],
      "t1",
    );
    const once = serializeLockfile(lock);
    expect(once).toBe(serializeLockfile(lock));
    expect(once.endsWith("\n")).toBe(true);
    // servers sorted: "a" before "b"
    expect(once.indexOf('"a"')).toBeLessThan(once.indexOf('"b"'));
  });
});
