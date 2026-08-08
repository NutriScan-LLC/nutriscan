const CALL_INDEX_FIELD = 'call-index';

/**
 * Builds a V2 command line (without a trailing LF — callers terminate on
 * write, since termination is a wire-level concern of sending, not of
 * formatting).
 *
 * UNVERIFIED: assumes standard `key=value&key=value` query-string encoding
 * (via URLSearchParams) is what firmware expects. The spec only shows
 * `?call-index=<random>` and `measure?type=aox` as examples — whether
 * firmware tolerates percent-encoding of special characters in values is
 * not confirmed. See docs/unknowns.md.
 */
export function formatCommandLine(name: string, params: Record<string, string> | undefined, callIndex: string): string {
  const query = new URLSearchParams({ ...params, [CALL_INDEX_FIELD]: callIndex });
  return `${name}?${query.toString()}`;
}
