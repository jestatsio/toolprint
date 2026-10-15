import { describe, expect, it } from "vitest";
import { scanValueForSecrets } from "./secrets.js";

// Fake credentials for detection tests are assembled from fragments so no
// credential-shaped literal is ever committed — the same reason gitleaks'
// own fixtures are built this way. The assembled values are inert (a cyclic
// alphabet), but they match the provider formats under test.
const CHARS = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
function body(n: number): string {
  return Array.from({ length: n }, (_, i) => CHARS[i % CHARS.length]).join("");
}
function fake(...parts: string[]): string {
  return parts.join("");
}

const FAKE_ANTHROPIC = fake("sk-", "ant-", "api03-", body(36));

function ids(value: string, entropy = false): string[] {
  return scanValueForSecrets(value, "env.X", { entropy }).map((h) => h.id);
}

describe("scanValueForSecrets — new provider formats", () => {
  const cases: Array<[string, string]> = [
    ["anthropic", FAKE_ANTHROPIC],
    ["huggingface", fake("hf_", body(36))],
    ["gcp-oauth", fake("GOCSPX-", body(28))],
    ["npm", fake("npm_", body(36))],
    ["sendgrid", fake("SG.", body(22), ".", body(43))],
    [
      "azure-conn",
      fake(
        "DefaultEndpointsProtocol=https;AccountName=foo;AccountKey=",
        body(48),
        "==;EndpointSuffix=core.windows.net",
      ),
    ],
    ["db-uri", fake("postgres://app", "user:", "hunter2", "hunter2", "@db.internal:5432/app")],
  ];

  it.each(cases)("flags a %s secret as high", (id, value) => {
    expect(ids(value)).toContain(id);
    expect(scanValueForSecrets(value, "env.X", { entropy: false })[0]?.severity).toBe("high");
  });
});

describe("scanValueForSecrets — private keys (non-RSA regression)", () => {
  it.each(["RSA ", "EC ", "OPENSSH ", ""])("flags a %sprivate key header", (kind) => {
    expect(ids(fake("-----BEGIN ", kind, "PRIVATE KEY-----"))).toContain("private-key");
  });
});

describe("scanValueForSecrets — precision", () => {
  it("ignores placeholders", () => {
    expect(ids("${OPENAI_API_KEY}")).toHaveLength(0);
    expect(ids("<your-token-here>")).toHaveLength(0);
  });

  it("only runs the entropy heuristic when asked", () => {
    const random = ["Zx9K", "q2Lm", "8Wp4", "Rt6Y", "v0Bn", "3Cd5", "Ef7G", "h1Jk"].join("");
    expect(ids(random, false)).toHaveLength(0);
    expect(ids(random, true)).toContain("entropy");
  });

  it("never emits the raw secret in evidence", () => {
    const secret = FAKE_ANTHROPIC;
    for (const hit of scanValueForSecrets(secret, "env.X", { entropy: false })) {
      expect(hit.evidence).toContain("redacted");
      expect(hit.evidence).not.toContain(secret);
    }
  });
});
