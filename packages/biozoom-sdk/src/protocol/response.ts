import { extractCallIndex } from './callIndex.js';

export interface ResponseFrameMeta {
  /**
   * Exact bytes of this line as received — LF excluded (FrameReader's
   * job), any leading 0x80 bytes still included. Kept for diagnostics
   * regardless of how parsing turned out (CLAUDE.md rule 5).
   */
  readonly rawBytes: Uint8Array;
  readonly strippedLeadingByteCount: number;
}

export interface DecodeErrorResponse extends ResponseFrameMeta {
  readonly kind: 'decode-error';
  readonly error: Error;
}

export interface JsonParseErrorResponse extends ResponseFrameMeta {
  readonly kind: 'parse-error';
  readonly text: string;
  readonly error: Error;
}

export interface JsonNonObjectResponse extends ResponseFrameMeta {
  readonly kind: 'unexpected-shape';
  readonly text: string;
  readonly json: unknown;
}

/**
 * A parsed JSON-object response.
 *
 * IMPORTANT: `kind` is `'error'` only when the response carries the one
 * confirmed error marker (`type === "error"`, seen on `get_status` against
 * serial 2N2400A5B70F5E3C9251). `kind: 'ok'` means ONLY "did not carry
 * that error marker" — it is NOT a validated success schema. No
 * success-case field layout is confirmed; `json` carries the full parsed
 * object so nothing observed is ever lost.
 */
export interface BioZoomJsonResponse extends ResponseFrameMeta {
  readonly kind: 'ok' | 'error';
  readonly text: string;
  /** Full parsed JSON object, unknown fields preserved verbatim. */
  readonly json: Record<string, unknown>;
  readonly command: string | undefined;
  readonly serial: string | undefined;
  readonly callIndex: string | undefined;
}

export type ParsedResponse = DecodeErrorResponse | JsonParseErrorResponse | JsonNonObjectResponse | BioZoomJsonResponse;

// fatal: true makes malformed byte sequences throw instead of silently
// substituting U+FFFD — we want a distinguishable decode-error result,
// not quietly corrupted text.
const decoder = new TextDecoder('utf-8', { fatal: true });

/**
 * Strips leading 0x80 bytes only — this is the sole place that happens
 * (never in the transport layer, per CLAUDE.md rule 4).
 */
export function stripLeading0x80(bytes: Uint8Array): { stripped: Uint8Array; count: number } {
  let i = 0;
  while (i < bytes.length && bytes[i] === 0x80) i++;
  return { stripped: bytes.subarray(i), count: i };
}

/**
 * Parses one complete raw frame (as produced by FrameReader — LF already
 * stripped) into a ParsedResponse. Every branch, including every error
 * branch, carries the original rawBytes unmodified.
 */
export function parseResponseFrame(rawBytes: Uint8Array): ParsedResponse {
  const { stripped, count } = stripLeading0x80(rawBytes);

  let text: string;
  try {
    text = decoder.decode(stripped);
  } catch (err) {
    return {
      kind: 'decode-error',
      rawBytes,
      strippedLeadingByteCount: count,
      error: toError(err),
    };
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    return {
      kind: 'parse-error',
      rawBytes,
      strippedLeadingByteCount: count,
      text,
      error: toError(err),
    };
  }

  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return {
      kind: 'unexpected-shape',
      rawBytes,
      strippedLeadingByteCount: count,
      text,
      json,
    };
  }

  const obj = json as Record<string, unknown>;
  const command = typeof obj.command === 'string' ? obj.command : undefined;
  const serial = typeof obj.serial === 'string' ? obj.serial : undefined;
  // The only confirmed error marker is a literal "type":"error". Anything
  // else is classified 'ok' — a placeholder for "not a confirmed error",
  // not a validated success schema. See the doc comment on BioZoomJsonResponse.
  const kind: 'ok' | 'error' = obj.type === 'error' ? 'error' : 'ok';

  return {
    kind,
    rawBytes,
    strippedLeadingByteCount: count,
    text,
    json: obj,
    command,
    serial,
    callIndex: extractCallIndex(obj),
  };
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}
