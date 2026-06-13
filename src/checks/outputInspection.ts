import type { ToolProbe } from "../connect/probe.js";
import { scanTextForPoisoning } from "./patterns/poisoning.js";
import { scanValueForSecrets } from "./patterns/secrets.js";
import type { Check, CheckInput, Finding } from "./types.js";

export const TOOL_OUTPUT_CHECK_ID = "tool-output";

/**
 * Inspects the *outputs* of tools executed under `--probe` for the same
 * poisoning and secret signals as the static checks. An instruction or
 * credential in live output is at least as dangerous as one in a description —
 * an agent acts on what a tool returns. Produces nothing unless probing ran.
 */
export const outputInspectionCheck: Check = {
  id: TOOL_OUTPUT_CHECK_ID,
  run({ probes, server }: CheckInput): Finding[] {
    if (!probes || probes.length === 0) return [];
    const findings: Finding[] = [];
    for (const probe of probes) {
      findings.push(...inspect(probe, server.id));
    }
    return findings;
  },
};

function inspect(probe: ToolProbe, serverId: string): Finding[] {
  if (probe.status !== "ok" || !probe.outputText) return [];
  const where = `output of tool "${probe.name}"`;
  const findings: Finding[] = [];
  const highVectors = new Set<string>();

  for (const hit of scanTextForPoisoning(probe.outputText, where)) {
    if (hit.severity === "high") highVectors.add(hit.id);
    findings.push({
      checkId: TOOL_OUTPUT_CHECK_ID,
      severity: hit.severity,
      serverId,
      capability: { kind: "tool", name: probe.name },
      title: `${hit.label} in the output of tool "${probe.name}"`,
      detail:
        "This text was returned by the tool when toolprint executed it (--probe). An agent that " +
        "reads tool output can be hijacked by instructions embedded in it (prompt injection / tool poisoning).",
      evidence: hit.evidence,
      remediation:
        "Treat the output as untrusted; if the instruction is real, stop using this server.",
    });
  }

  let hadSecret = false;
  for (const hit of scanValueForSecrets(probe.outputText, where, { entropy: false })) {
    hadSecret = true;
    findings.push({
      checkId: TOOL_OUTPUT_CHECK_ID,
      severity: hit.severity,
      serverId,
      capability: { kind: "tool", name: probe.name },
      title: `Possible ${hit.label} in the output of tool "${probe.name}"`,
      detail: "A live-looking credential was returned in this tool's output.",
      evidence: hit.evidence,
      remediation: "If this is a real secret, rotate it and stop trusting this server's output.",
    });
  }

  // Two independent high signals in *live output* — or an instruction plus a
  // leaked secret — is the critical combined-attack case.
  if (highVectors.size >= 2 || (highVectors.size >= 1 && hadSecret)) {
    findings.push({
      checkId: TOOL_OUTPUT_CHECK_ID,
      severity: "critical",
      serverId,
      capability: { kind: "tool", name: probe.name },
      title: `Multiple injection signals in the output of tool "${probe.name}"`,
      detail:
        "The tool's live output combines two or more independent high-severity signals " +
        "(injected instructions and/or a leaked credential). This is an active attack, not a stale description.",
      evidence: `vectors: ${[...highVectors, ...(hadSecret ? ["leaked secret"] : [])].join(", ")}`,
      remediation: "Treat this server as malicious and stop using it.",
    });
  }

  return findings;
}
