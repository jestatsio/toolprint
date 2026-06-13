import { describe, expect, it } from "vitest";
import type { ServerTarget } from "../model.js";
import { connectionHint } from "./hints.js";

const http: ServerTarget = {
  id: "s",
  transport: "http",
  source: "https://mcp.example.com/mcp",
  url: "https://mcp.example.com/mcp",
};
const stdio: ServerTarget = {
  id: "s",
  transport: "stdio",
  source: "my-server",
  command: "my-server",
};

describe("connectionHint", () => {
  it("points at auth flags on 401/403/unauthorized", () => {
    expect(connectionHint("HTTP 401 Unauthorized", http)).toMatch(/--bearer/);
    expect(connectionHint("403 Forbidden", http)).toMatch(/TOOLPRINT_BEARER/);
  });

  it("explains a refused connection and names the url", () => {
    const hint = connectionHint("connect ECONNREFUSED 127.0.0.1:3000", http);
    expect(hint).toMatch(/refused/i);
    expect(hint).toContain("https://mcp.example.com/mcp");
  });

  it("explains ENOENT for stdio and names the command", () => {
    const hint = connectionHint("spawn my-server ENOENT", stdio);
    expect(hint).toMatch(/PATH/);
    expect(hint).toContain("my-server");
  });

  it("does not give an ENOENT hint for http targets", () => {
    expect(connectionHint("spawn ENOENT", http)).toBeUndefined();
  });

  it("suggests raising --timeout on a timeout", () => {
    expect(connectionHint("Timed out after 30000ms: connect to …", http)).toMatch(/--timeout/);
  });

  it("returns undefined when nothing useful applies", () => {
    expect(connectionHint("some unrelated error", http)).toBeUndefined();
  });
});
