const CALL_INDEX_FIELD = 'call-index';

/**
 * Resolves a response's call-index, per BIOZOOM_PROTOCOL_AND_IMPLEMENTATION.md:
 * "Responses may either return call-index directly, or embed it inside
 * command." Checks the top-level field first, then a `?call-index=...`
 * query string embedded in `command`. Returns undefined if neither is
 * present — this is a confirmed possibility (get_status's error response
 * for 2N2400A5B70F5E3C9251 has no call-index anywhere).
 */
export function extractCallIndex(json: Record<string, unknown>): string | undefined {
  const topLevel = json[CALL_INDEX_FIELD];
  if (typeof topLevel === 'string' && topLevel.length > 0) return topLevel;

  const command = json.command;
  if (typeof command === 'string') {
    const queryStart = command.indexOf('?');
    if (queryStart !== -1) {
      const embedded = new URLSearchParams(command.slice(queryStart + 1)).get(CALL_INDEX_FIELD);
      if (embedded !== null) return embedded;
    }
  }

  return undefined;
}

/**
 * UNVERIFIED: the firmware's expected call-index format/length/charset is
 * not confirmed — BIOZOOM_PROTOCOL_AND_IMPLEMENTATION.md only says
 * "?call-index=<random>". Generates a random 8-character hex token;
 * revisit if firmware is found to validate the format more strictly. See
 * docs/unknowns.md.
 */
export function generateCallIndex(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 8);
}
