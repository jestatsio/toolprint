/**
 * Maximum nesting depth our recursive walkers traverse in untrusted server JSON.
 *
 * toolprint connects to servers it does not trust, so a response could be a
 * pathologically deep object crafted to overflow the call stack (a denial of
 * service against the scan). Real MCP tool/prompt/resource definitions are
 * shallow — well under 10 levels — so this is generous headroom that still keeps
 * the recursive walkers (hashing, content-compare, poisoning scan) far below the
 * stack limit. Input deeper than this is treated as hostile/malformed.
 */
export const MAX_JSON_DEPTH = 100;
