import type { ServerTarget } from "../model.js";

/**
 * Turn a raw connection/transport failure into an actionable next step. The
 * mapping is heuristic (it pattern-matches the error text the MCP SDK and the
 * runtime surface), so it only ever *adds* guidance — it never changes the
 * underlying error or the exit code. Returns undefined when nothing useful can
 * be said.
 */
export function connectionHint(message: string, target: ServerTarget): string | undefined {
  if (/\b401\b|\b403\b|unauthor|forbidden/i.test(message)) {
    return (
      "The server rejected the request as unauthorized. Provide credentials with --bearer <token>, " +
      '--header "Name: Value", or the TOOLPRINT_BEARER / TOOLPRINT_HEADER_* environment variables.'
    );
  }
  if (/econnrefused/i.test(message)) {
    return `Connection refused${target.url ? ` at ${target.url}` : ""} — is the server running and reachable?`;
  }
  if (target.transport === "stdio" && /enoent/i.test(message)) {
    return `Could not start the command${
      target.command ? ` "${target.command}"` : ""
    }. Check it is installed and on your PATH.`;
  }
  if (/timed out/i.test(message)) {
    return "Raise --timeout if the server is slow to start or respond.";
  }
  return undefined;
}
