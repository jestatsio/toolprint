import { describe, expect, it } from "vitest";
import { OperationalError } from "../errors.js";
import type { ServerTarget } from "../model.js";
import { applyAuthHeaders, collectAuthHeaders, mergeHeaders, parseHeaderArg } from "./auth.js";

const NUL = String.fromCharCode(0);

describe("parseHeaderArg", () => {
  it("splits on the first colon and trims both sides", () => {
    expect(parseHeaderArg("Authorization: Bearer abc")).toEqual(["Authorization", "Bearer abc"]);
    expect(parseHeaderArg("  X-Api-Key :  key123 ")).toEqual(["X-Api-Key", "key123"]);
  });

  it("keeps colons in the value (e.g. a url)", () => {
    expect(parseHeaderArg("X-Origin: https://app.example.com:8443/x")).toEqual([
      "X-Origin",
      "https://app.example.com:8443/x",
    ]);
  });

  it("allows spaces inside a value (e.g. a bearer token)", () => {
    expect(parseHeaderArg("Authorization: Bearer a.b.c d")).toEqual([
      "Authorization",
      "Bearer a.b.c d",
    ]);
  });

  it("throws on a missing colon", () => {
    expect(() => parseHeaderArg("Authorization Bearer abc")).toThrow(OperationalError);
  });

  it("throws on an empty name or value", () => {
    expect(() => parseHeaderArg(": value")).toThrow(OperationalError);
    expect(() => parseHeaderArg("Name:   ")).toThrow(OperationalError);
  });

  it("throws on an invalid header name (not an HTTP token)", () => {
    expect(() => parseHeaderArg("Bad Name: value")).toThrow(OperationalError);
    expect(() => parseHeaderArg("X-Inj\nect: value")).toThrow(OperationalError);
  });

  it("throws on a CR, LF, or NUL in the value (header injection)", () => {
    expect(() => parseHeaderArg("X-Evil: a\r\nInjected: b")).toThrow(OperationalError);
    expect(() => parseHeaderArg("X-Evil: a\nb")).toThrow(OperationalError);
    expect(() => parseHeaderArg(`X-Evil: a${NUL}b`)).toThrow(OperationalError);
  });

  it("never echoes the raw argument when the colon is missing (secret hygiene)", () => {
    const secret = "ghp_supersecrettoken000000000000000000";
    let message = "";
    try {
      parseHeaderArg(secret);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/Invalid --header/);
    expect(message).not.toContain(secret);
  });
});

describe("collectAuthHeaders", () => {
  it("returns undefined when nothing is configured", () => {
    expect(collectAuthHeaders({}, {})).toBeUndefined();
    expect(collectAuthHeaders({ header: [] }, {})).toBeUndefined();
  });

  it("turns --bearer into an Authorization header", () => {
    expect(collectAuthHeaders({ bearer: "tok123" }, {})).toEqual({
      Authorization: "Bearer tok123",
    });
  });

  it("collects repeated --header flags", () => {
    const headers = collectAuthHeaders({ header: ["X-Api-Key: a", "X-Trace: b"] }, {});
    expect(headers).toEqual({ "X-Api-Key": "a", "X-Trace": "b" });
  });

  it("reads TOOLPRINT_BEARER from the environment", () => {
    expect(collectAuthHeaders({}, { TOOLPRINT_BEARER: "envtok" })).toEqual({
      Authorization: "Bearer envtok",
    });
  });

  it("reads TOOLPRINT_HEADER_* env vars, converting underscores to hyphens", () => {
    expect(collectAuthHeaders({}, { TOOLPRINT_HEADER_X_API_KEY: "secret" })).toEqual({
      "X-API-KEY": "secret",
    });
  });

  it("trims and ignores blank TOOLPRINT_HEADER_* values (parity with TOOLPRINT_BEARER)", () => {
    expect(collectAuthHeaders({}, { TOOLPRINT_HEADER_X_API_KEY: "  key  " })).toEqual({
      "X-API-KEY": "key",
    });
    expect(collectAuthHeaders({}, { TOOLPRINT_HEADER_X_API_KEY: "   " })).toBeUndefined();
  });

  it("lets CLI flags override env (explicit wins over ambient)", () => {
    const headers = collectAuthHeaders({ bearer: "cli" }, { TOOLPRINT_BEARER: "env" });
    expect(headers).toEqual({ Authorization: "Bearer cli" });
  });

  it("lets an explicit --header override --bearer for the same header (case-insensitively)", () => {
    const headers = collectAuthHeaders(
      { bearer: "tok", header: ["authorization: Custom xyz"] },
      {},
    );
    // One Authorization header, not two — the --header value wins.
    expect(Object.keys(headers ?? {})).toHaveLength(1);
    expect(Object.values(headers ?? {})).toEqual(["Custom xyz"]);
  });

  it("ignores blank env values", () => {
    expect(collectAuthHeaders({}, { TOOLPRINT_BEARER: "   " })).toBeUndefined();
  });

  it("throws on a malformed --header", () => {
    expect(() => collectAuthHeaders({ header: ["no-colon"] }, {})).toThrow(OperationalError);
  });

  it("throws on a CR/LF in a bearer token or env header value (injection)", () => {
    expect(() => collectAuthHeaders({ bearer: "tok\r\nX-Evil: 1" }, {})).toThrow(OperationalError);
    expect(() => collectAuthHeaders({}, { TOOLPRINT_BEARER: "tok\nX-Evil: 1" })).toThrow(
      OperationalError,
    );
    expect(() => collectAuthHeaders({}, { TOOLPRINT_HEADER_X_FOO: "a\r\nb" })).toThrow(
      OperationalError,
    );
  });

  it("throws when a TOOLPRINT_HEADER_* name is not a valid HTTP token", () => {
    // A space in the suffix survives the underscore→hyphen mapping, so the name
    // is rejected as a non-token.
    expect(() => collectAuthHeaders({}, { "TOOLPRINT_HEADER_X Y": "v" })).toThrow(OperationalError);
  });
});

describe("mergeHeaders", () => {
  it("returns undefined when both sides are empty", () => {
    expect(mergeHeaders(undefined, undefined)).toBeUndefined();
  });

  it("overlays override onto base", () => {
    expect(mergeHeaders({ A: "1" }, { B: "2" })).toEqual({ A: "1", B: "2" });
  });

  it("override replaces a base header with the same name, case-insensitively", () => {
    const merged = mergeHeaders(
      { authorization: "Bearer config" },
      { Authorization: "Bearer cli" },
    );
    expect(Object.keys(merged ?? {})).toHaveLength(1);
    expect(Object.values(merged ?? {})).toEqual(["Bearer cli"]);
  });
});

describe("applyAuthHeaders", () => {
  const http: ServerTarget = { id: "h", transport: "http", source: "u", url: "https://h/mcp" };
  const sse: ServerTarget = { id: "s", transport: "sse", source: "u", url: "https://s/sse" };
  const stdio: ServerTarget = { id: "c", transport: "stdio", source: "c", command: "c" };

  it("returns the targets unchanged when there are no auth headers", () => {
    const targets = [http, stdio];
    expect(applyAuthHeaders(targets, undefined)).toBe(targets);
  });

  it("attaches auth headers to http and sse targets without mutating the originals", () => {
    const auth = { Authorization: "Bearer x" };
    const [outHttp, outSse] = applyAuthHeaders([http, sse], auth);
    expect(outHttp?.authHeaders).toEqual(auth);
    expect(outSse?.authHeaders).toEqual(auth);
    expect(http.authHeaders).toBeUndefined();
    expect(sse.authHeaders).toBeUndefined();
  });

  it("gives each target its own copy of the auth headers (no shared reference)", () => {
    const auth = { Authorization: "Bearer x" };
    const [outHttp, outSse] = applyAuthHeaders([http, sse], auth);
    expect(outHttp?.authHeaders).not.toBe(auth);
    expect(outHttp?.authHeaders).not.toBe(outSse?.authHeaders);
  });

  it("leaves stdio targets untouched (headers are meaningless for stdio)", () => {
    const [out] = applyAuthHeaders([stdio], { Authorization: "Bearer x" });
    expect(out?.authHeaders).toBeUndefined();
    expect(out).toEqual(stdio);
  });
});
