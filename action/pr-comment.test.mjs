import { describe, expect, it } from "vitest";
import { pullRequestNumber, renderComment, repoSlug } from "./pr-comment.mjs";

const MARKER = "<!-- toolprint-report -->";

function report(overrides = {}) {
  return {
    toolprintVersion: "0.2.0",
    schemaVersion: 1,
    generatedAt: "2026-06-13T00:00:00.000Z",
    summary: { servers: 1, findings: 0, bySeverity: {}, operationalErrors: 0 },
    servers: [{ id: "s", transport: "stdio", source: "x", findings: [] }],
    ...overrides,
  };
}

describe("renderComment", () => {
  it("always starts with the sticky marker", () => {
    expect(renderComment(report()).startsWith(MARKER)).toBe(true);
  });

  it("renders a clean result", () => {
    expect(renderComment(report())).toContain("No findings");
  });

  it("renders a findings table sorted with criticals first", () => {
    const findings = [
      { checkId: "rug-pull", severity: "info", serverId: "s", title: "unpinned" },
      {
        checkId: "tool-poisoning",
        severity: "critical",
        serverId: "s",
        capability: { kind: "tool", name: "helper" },
        title: "Multiple injection vectors",
      },
    ];
    const md = renderComment(
      report({
        summary: {
          servers: 1,
          findings: 2,
          bySeverity: { critical: 1, info: 1 },
          operationalErrors: 0,
        },
        servers: [{ id: "s", findings }],
      }),
    );
    expect(md).toContain("| Severity | Check | Location | Finding |");
    expect(md).toContain('tool "helper"');
    // critical row appears before the info row
    expect(md.indexOf("Multiple injection vectors")).toBeLessThan(md.indexOf("unpinned"));
  });

  it("neutralizes HTML and @mentions from untrusted tool names", () => {
    const md = renderComment(
      report({
        summary: { servers: 1, findings: 1, bySeverity: { high: 1 }, operationalErrors: 0 },
        servers: [
          {
            id: "s",
            findings: [
              {
                checkId: "c",
                severity: "high",
                serverId: "s",
                capability: { kind: "tool", name: "<img> @octocat" },
                title: "t",
              },
            ],
          },
        ],
      }),
    );
    expect(md).not.toContain("<img>");
    expect(md).toContain("&lt;img&gt;");
    expect(md).not.toContain("@octocat");
  });

  it("escapes pipe characters in titles so the table can't break", () => {
    const md = renderComment(
      report({
        summary: { servers: 1, findings: 1, bySeverity: { high: 1 }, operationalErrors: 0 },
        servers: [
          {
            id: "s",
            findings: [{ checkId: "c", severity: "high", serverId: "s", title: "a | b" }],
          },
        ],
      }),
    );
    expect(md).toContain("a \\| b");
  });

  it("surfaces a baseline delta when present", () => {
    const md = renderComment(
      report({ baseline: { path: "b.json", new: [{}, {}], resolved: [{}] } }),
    );
    expect(md).toContain("Since baseline:** 2 new, 1 resolved");
  });

  it("warns about operational errors", () => {
    const md = renderComment(
      report({ summary: { servers: 2, findings: 0, bySeverity: {}, operationalErrors: 1 } }),
    );
    expect(md).toContain("could not be scanned");
  });
});

describe("escaping server-controlled text (CodeQL js/incomplete-sanitization)", () => {
  /** Build a report whose only finding carries an attacker-chosen tool name. */
  function withToolName(name) {
    return report({
      summary: { servers: 1, findings: 1, bySeverity: { high: 1 }, operationalErrors: 0 },
      servers: [
        {
          id: "s",
          transport: "stdio",
          source: "x",
          findings: [
            {
              checkId: "tool-poisoning",
              severity: "high",
              serverId: "s",
              capability: { kind: "tool", name },
              title: "t",
            },
          ],
        },
      ],
    });
  }

  it("escapes a backslash before the pipe, so `\\|` cannot break out of a cell", () => {
    // Without escaping backslashes first, `\|` becomes `\\|` — markdown renders
    // that as a literal backslash plus an *unescaped* pipe, letting a hostile
    // tool name forge the remaining columns of the row.
    const md = renderComment(withToolName("evil\\|**OWNED**|x"));
    expect(md).not.toMatch(/[^\\]\\\\\|/);
    expect(md).toContain("\\\\");
  });

  it("still escapes plain pipes", () => {
    expect(renderComment(withToolName("a|b"))).toContain("a\\|b");
  });

  it("neutralizes HTML and @mentions", () => {
    const md = renderComment(withToolName("<img src=x> @octocat"));
    expect(md).not.toContain("<img");
    expect(md).not.toContain("@octocat");
  });

  it("collapses newlines that would end the table row", () => {
    expect(renderComment(withToolName("a\nb"))).toContain("a b");
  });
});

describe("URL inputs (CodeQL js/file-access-to-http)", () => {
  it("accepts a real pull-request number", () => {
    expect(pullRequestNumber({ pull_request: { number: 42 } })).toBe(42);
    expect(pullRequestNumber({ number: 7 })).toBe(7);
  });

  it("rejects anything that could carry extra path segments into a URL", () => {
    // These come from a file on disk and are interpolated into a request path.
    for (const bad of ["1/../../orgs/evil", "1", 0, -3, 1.5, null, undefined, {}]) {
      expect(pullRequestNumber({ number: bad })).toBeUndefined();
    }
  });

  it("accepts a well-formed owner/name slug", () => {
    expect(repoSlug("jestatsio/toolprint")).toBe("jestatsio/toolprint");
  });

  it("rejects a slug carrying extra path segments", () => {
    for (const bad of ["a/b/c", "../../evil", "owner", "a/b?x=1", "a b/c", ""]) {
      expect(repoSlug(bad)).toBeUndefined();
    }
  });
});
