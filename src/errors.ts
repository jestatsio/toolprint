/**
 * Operational failures — couldn't connect, parse, or reach a server. These map
 * to CLI exit code 1, deliberately distinct from a *security* failure (exit 2)
 * so CI can tell "the scan broke" from "the scan found drift/findings".
 */
export class OperationalError extends Error {
  override readonly name = "OperationalError";
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
  }
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
