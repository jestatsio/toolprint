import { execFileSync } from "node:child_process";
import { z } from "zod";

/**
 * Optional bridge to the SkillRoute CLI (https://github.com/erichare/skillroute).
 *
 * `skillroute harness detect --json` reports which agent harnesses are actually
 * installed on this machine and where each one keeps its config — the same data
 * toolprint vendors in `clients.ts`, but resolved live, so it also picks up
 * clients added to SkillRoute after this toolprint was published.
 *
 * Running it is **opt-in** (`--use-skillroute`). toolprint does not execute
 * third-party binaries on its own, for the same reason `--probe` is opt-in.
 */

const DetectionSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    config_path: z.string().nullable().optional(),
    detected: z.boolean().optional(),
  })
  .passthrough();

const DetectionsSchema = z.array(DetectionSchema);

export interface SkillrouteDetection {
  id: string;
  name: string;
  configPath: string;
}

export interface SkillrouteResult {
  detections: SkillrouteDetection[];
  /** Why the bridge produced nothing, when it did. Surfaced, never swallowed. */
  unavailable?: string;
}

/**
 * Ask SkillRoute which harnesses are installed. Never throws: a missing CLI or a
 * malformed response degrades to the built-in client table with a reason
 * attached, because losing an optional enrichment must not fail a scan.
 */
export function detectViaSkillroute(timeoutMs = 10_000): SkillrouteResult {
  let stdout: string;
  try {
    stdout = execFileSync("skillroute", ["harness", "detect", "--json"], {
      encoding: "utf8",
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch {
    return {
      detections: [],
      unavailable:
        "skillroute CLI not available (install it with `uv tool install skillroute`, or drop --use-skillroute)",
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { detections: [], unavailable: "skillroute harness detect did not return JSON" };
  }

  const result = DetectionsSchema.safeParse(parsed);
  if (!result.success) {
    return {
      detections: [],
      unavailable: "skillroute harness detect returned an unexpected shape",
    };
  }

  const detections = result.data
    .filter((row) => row.detected === true && typeof row.config_path === "string")
    .map((row) => ({
      id: row.id,
      name: row.name ?? row.id,
      configPath: row.config_path as string,
    }));

  return { detections };
}
