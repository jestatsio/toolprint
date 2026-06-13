import { describe, expect, it } from "vitest";
import { renderComment } from "./pr-comment.mjs";

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
