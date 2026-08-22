#!/usr/bin/env node
// Zero-dependency, Node 20+ (uses global fetch). Reads a toolprint `--json`
// report and upserts a single "sticky" comment on the current pull request
// summarizing the findings. Invoked by action.yml when `comment-on-pr: true`.
//
// It never changes the job's pass/fail — action.yml fails the job from the scan
// exit code separately. A missing token / non-PR event is a no-op (logged).
import { readFileSync } from "node:fs";

/** Hidden marker that identifies our comment so re-runs update it in place. */
const MARKER = "<!-- toolprint-report -->";

const SEVERITY_ORDER = ["critical", "high", "medium", "low", "info"];
const SEVERITY_EMOJI = {
  critical: "🟣",
  high: "🔴",
  medium: "🟠",
  low: "🔵",
  info: "⚪",
};
const KIND_LABEL = {
  tool: "tool",
  prompt: "prompt",
  resource: "resource",
  resourceTemplate: "resource template",
};
/** GitHub renders at most this many finding rows; the rest are summarized. */
const MAX_ROWS = 50;

// Findings come from an untrusted server (tool names, titles). Neutralize
// table-breaking pipes/newlines, raw HTML, and `@mentions` that would otherwise
// notify GitHub users when the comment renders.
function escapeCell(text) {
  return (
    String(text)
      .replace(/\r?\n/g, " ")
      // Backslashes MUST be escaped before the pipe below, or a server-supplied
      // `\|` becomes `\\|` — which markdown renders as a literal backslash
      // followed by an *unescaped* pipe, letting a hostile tool name break out
      // of its table cell and forge the rest of the row.
      .replace(/\\/g, "\\\\")
      .replace(/\|/g, "\\|")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/@/g, "&#64;")
  );
}

function location(finding) {
  if (!finding.capability) return finding.serverId;
  const kind = KIND_LABEL[finding.capability.kind] ?? finding.capability.kind;
  return `${finding.serverId} · ${kind} "${finding.capability.name}"`;
}

function summarizeBySeverity(bySeverity = {}) {
  const parts = SEVERITY_ORDER.filter((s) => (bySeverity[s] ?? 0) > 0).map(
    (s) => `${bySeverity[s]} ${s}`,
  );
  return parts.join(", ");
}

/** Pure: build the markdown body for a report. Exported for testing. */
export function renderComment(report) {
  const summary = report.summary ?? {
    servers: 0,
    findings: 0,
    bySeverity: {},
    operationalErrors: 0,
  };
  const findings = (report.servers ?? []).flatMap((s) => s.findings ?? []);
  const lines = [MARKER, "## 🛡️ toolprint — MCP security scan", ""];

  if (findings.length === 0) {
    lines.push(`✅ **No findings** across ${summary.servers} server(s).`);
  } else {
    const bucket = summarizeBySeverity(summary.bySeverity);
    lines.push(
      `**${summary.findings} finding(s)** across ${summary.servers} server(s)${
        bucket ? ` — ${bucket}` : ""
      }`,
      "",
      "| Severity | Check | Location | Finding |",
      "| --- | --- | --- | --- |",
    );
    const sorted = [...findings].sort(
      (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
    );
    for (const f of sorted.slice(0, MAX_ROWS)) {
      const sev = `${SEVERITY_EMOJI[f.severity] ?? ""} ${f.severity}`.trim();
      lines.push(
        `| ${sev} | ${escapeCell(f.checkId)} | ${escapeCell(location(f))} | ${escapeCell(f.title)} |`,
      );
    }
    if (sorted.length > MAX_ROWS) {
      lines.push("", `…and ${sorted.length - MAX_ROWS} more finding(s) (see the workflow log).`);
    }
  }

  if (summary.operationalErrors > 0) {
    lines.push("", `⚠️ ${summary.operationalErrors} server(s) could not be scanned.`);
  }

  if (report.baseline) {
    lines.push(
      "",
      `**Since baseline:** ${report.baseline.new?.length ?? 0} new, ${
        report.baseline.resolved?.length ?? 0
      } resolved.`,
    );
  }

  lines.push(
    "",
    `<sub>toolprint v${report.toolprintVersion ?? "?"}${
      report.generatedAt ? ` · ${report.generatedAt}` : ""
    }</sub>`,
  );
  return lines.join("\n");
}

/**
 * The PR number, read out of the runner's event payload and validated to be a
 * positive integer. It is interpolated into request paths, so anything else —
 * a string with slashes or dots, a float — must never reach a URL. Returns
 * undefined when the event is not a pull request.
 */
export function pullRequestNumber(event) {
  const raw = event?.pull_request?.number ?? event?.number;
  return Number.isSafeInteger(raw) && raw > 0 ? raw : undefined;
}

/**
 * The repository slug from the runner, validated as `owner/name`. Interpolated
 * into the API base URL, so a value carrying extra path segments must not pass.
 */
export function repoSlug(repo) {
  return /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repo) ? repo : undefined;
}

async function findExistingComment(api, prNumber, headers) {
  const res = await fetch(`${api}/issues/${prNumber}/comments?per_page=100`, { headers });
  if (!res.ok) throw new Error(`GitHub API ${res.status} listing comments`);
  const comments = await res.json();
  return comments.find((c) => typeof c.body === "string" && c.body.includes(MARKER));
}

async function upsert(report) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY; // "owner/name"
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!token || !repo || !eventPath) {
    console.error(
      "pr-comment: missing GITHUB_TOKEN / GITHUB_REPOSITORY / GITHUB_EVENT_PATH — skipping comment.",
    );
    return;
  }
  const event = JSON.parse(readFileSync(eventPath, "utf8"));
  const prNumber = pullRequestNumber(event);
  if (prNumber === undefined) {
    console.error("pr-comment: not a pull_request event — skipping comment.");
    return;
  }

  const slug = repoSlug(repo);
  if (!slug) {
    console.error(`pr-comment: GITHUB_REPOSITORY is not "owner/name" — skipping comment.`);
    return;
  }
  const api = `https://api.github.com/repos/${slug}`;
  const headers = {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "content-type": "application/json",
    "user-agent": "toolprint",
  };
  const body = renderComment(report);
  const existing = await findExistingComment(api, prNumber, headers);
  const existingId =
    Number.isSafeInteger(existing?.id) && existing.id > 0 ? existing.id : undefined;
  const target = existingId
    ? `${api}/issues/comments/${existingId}`
    : `${api}/issues/${prNumber}/comments`;
  const res = await fetch(target, {
    method: existingId ? "PATCH" : "POST",
    headers,
    body: JSON.stringify({ body }),
  });
  if (!res.ok)
    throw new Error(`GitHub API ${res.status} ${existingId ? "updating" : "creating"} comment`);
  console.error(`pr-comment: ${existingId ? "updated" : "created"} comment on PR #${prNumber}.`);
}

// Run only when executed directly (not when imported by a test).
if (process.argv[1] && process.argv[1].endsWith("pr-comment.mjs")) {
  const reportPath = process.argv[2];
  if (!reportPath) {
    console.error("usage: pr-comment.mjs <report.json>");
    process.exit(2);
  }
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  upsert(report).catch((error) => {
    // A comment failure must not break the build — the scan gate is separate.
    console.error(`pr-comment: ${error instanceof Error ? error.message : String(error)}`);
  });
}
