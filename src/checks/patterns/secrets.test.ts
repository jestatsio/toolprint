import { describe, expect, it } from "vitest";
import { scanValueForSecrets } from "./secrets.js";

function ids(value: string, entropy = false): string[] {
  return scanValueForSecrets(value, "env.X", { entropy }).map((h) => h.id);
}

describe("scanValueForSecrets — new provider formats", () => {
  const cases: Array<[string, string]> = [
    ["anthropic", "sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWx0123456789"],
    ["huggingface", "hf_AbCdEfGhIjKlMnOpQrStUvWxYz01234567890a"],
    ["gcp-oauth", "GOCSPX-AbCdEfGhIjKlMnOpQrStUvWx"],
    ["npm", "npm_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789"],
    ["sendgrid", "SG.AbCdEfGhIjKlMnOpQrStUv.AbCdEfGhIjKlMnOpQrStUvWxYz0123456789012345678"],
    [
      "azure-conn",
      "DefaultEndpointsProtocol=https;AccountName=foo;AccountKey=YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXowMTIzNDU2Nzg5QUI==;EndpointSuffix=core.windows.net",
    ],
    ["db-uri", "postgres://appuser:hunter2hunter2@db.internal:5432/app"],
  ];

  it.each(cases)("flags a %s secret as high", (id, value) => {
    expect(ids(value)).toContain(id);
    expect(scanValueForSecrets(value, "env.X", { entropy: false })[0]?.severity).toBe("high");
  });
});

describe("scanValueForSecrets — private keys (non-RSA regression)", () => {
  it.each([
    "-----BEGIN RSA PRIVATE KEY-----",
    "-----BEGIN EC PRIVATE KEY-----",
    "-----BEGIN OPENSSH PRIVATE KEY-----",
    "-----BEGIN PRIVATE KEY-----",
  ])("flags %s", (value) => {
    expect(ids(value)).toContain("private-key");
  });
});

describe("scanValueForSecrets — precision", () => {
  it("ignores placeholders", () => {
    expect(ids("${OPENAI_API_KEY}")).toHaveLength(0);
    expect(ids("<your-token-here>")).toHaveLength(0);
  });

  it("only runs the entropy heuristic when asked", () => {
    const random = "Zx9Kq2Lm8Wp4Rt6Yv0Bn3Cd5Ef7Gh1Jk";
    expect(ids(random, false)).toHaveLength(0);
    expect(ids(random, true)).toContain("entropy");
  });

  it("never emits the raw secret in evidence", () => {
    const secret = "sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWx0123456789";
    for (const hit of scanValueForSecrets(secret, "env.X", { entropy: false })) {
      expect(hit.evidence).toContain("redacted");
      expect(hit.evidence).not.toContain(secret);
    }
  });
});
