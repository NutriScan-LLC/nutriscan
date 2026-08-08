# Unresolved Protocol Questions

Tracks behavior that is not yet confirmed against real hardware. Per
`CLAUDE.md`, nothing here should be treated as fact until it's verified and
promoted into `docs/protocol.md`. Add to this list rather than guessing.

Milestone 1 (transport) and Milestone 2 (V2 protocol framing/parsing/
detection) are implemented; see `docs/protocol.md` for what's confirmed.
Everything below is either still open from `BIOZOOM_PROTOCOL_AND_IMPLEMENTATION.md`
or a new assumption introduced while implementing Milestone 2.

## Protocol detection

- Is `get_status` always the correct first probe for both legacy and
  modern scanners, or can it fail silently (no response) rather than
  returning an error to retry against? `ProtocolClient.detectV2()` will
  simply time out (`ProtocolResponseTimeoutError`) in the silent-failure
  case — untested against real hardware.
- What distinguishes a legacy (`5W` prefix, V1) device at the transport
  level before any command is sent — is serial prefix visible without
  querying, or only after a response is parsed? V1 is not implemented;
  `detectV2()` only fails with `ProtocolDetectionError` if V2 evidence is
  absent, it does not attempt to identify V1.
- Whether a malformed/non-JSON `get_status` response (decode-error,
  parse-error, unexpected-shape) should also trigger the `status` retry is
  unconfirmed. The spec's retry rule is specifically "if get_status
  returns a JSON error response" — the current implementation retries only
  on a confirmed JSON `kind: 'error'` result, treating anything malformed
  as an immediate detection failure instead of guessing a retry policy.

## `0x80` prefix stripping

- Is the number of leading `0x80` bytes fixed per firmware version, or can
  it vary response-to-response on the same device?
- Are `0x80` bytes ever legitimate payload (not a prefix artifact) in any
  known response type, or is stripping always safe?

## call-index handling

- **Resolved (confirmed on hardware):** a response can omit call-index
  entirely — the `get_status` error example has none, anywhere. The
  protocol layer treats a call-index-less response as an automatic match
  for whatever command is currently in flight. See `docs/protocol.md`.
- The exact embedding format when call-index is inside `"command"` is
  still an assumption, not confirmed by a concrete example: the
  implementation (`extractCallIndex`) parses it as a standard
  `?call-index=...` query-string fragment appended to the command name.
  If real firmware embeds it differently (different key, different
  position, non-query-string format), extraction will silently fail
  (return `undefined`) rather than error — worth revisiting once a real
  embedded example is captured.
- The firmware's expected call-index **format** (length, charset) is
  unconfirmed. `generateCallIndex()` produces an 8-character hex token as
  a placeholder — UNVERIFIED, marked in code.
- Whether a call-index-bearing response that doesn't match the
  outstanding request should be treated as an error
  (`CallIndexMismatchError`, current behavior) versus an unrelated/
  unsolicited message to be skipped while continuing to wait is
  unconfirmed — there's no evidence yet that the device ever sends
  unsolicited messages. The current policy assumes strictly sequential,
  single-in-flight request/response.

## V2 command/response framing (introduced in Milestone 2)

- **Command query encoding:** `formatCommandLine()` builds
  `name?key=value&...&call-index=<idx>` using standard `URLSearchParams`
  encoding. The spec only shows `?call-index=<random>` and
  `measure?type=aox` as examples — whether firmware tolerates
  percent-encoding of special characters in parameter values is
  unconfirmed.
- **Line terminator:** the spec says responses are JSON lines split by LF.
  `FrameReader` splits on `0x0A` only and does **not** strip a trailing
  `0x0D` (CR). If firmware actually sends CRLF, a trailing CR would land
  inside the JSON text and `JSON.parse` would fail (surfacing as
  `kind: 'parse-error'`) rather than being silently corrected — this is
  deliberate (no guessing), but means CRLF firmware would currently look
  like "everything is malformed" until this is confirmed and handled.
- **FrameReader's `maxBufferSize` guard** (default 64 KiB) is an
  engineering safety limit we chose, not a confirmed real maximum response
  size. It only bounds *unterminated* buffered bytes (protects against a
  stream that never sends an LF) — it does not cap the size of a single
  complete frame delivered within one chunk. The real maximum V2 response
  size (including future `read-flash` block batches) is unconfirmed.

## Firmware block-index quirk

- The spec notes the first *and* second physical block both report
  internal index 1, with only the first normalized to logical index 0.
  Is the second block's raw index 1 a duplicate that should be dropped,
  renumbered, or kept as-is? Unconfirmed beyond the single device tested.
- Does this quirk hold across firmware versions, or is it specific to
  `2N2400A5B70F5E3C9251`?

## AOX measurement payload

- The decoded byte layout of an AOX measurement (beyond the 33-byte block
  framing: length, internal index, CRC) is entirely unreversed. No field
  boundaries, units, or encoding are known.

## Legacy (V1) command set

- Only `I` and `W` are named as legacy commands so far. Their full
  request/response shapes, and whether they share the block/CRC framing
  used by V2, are unknown.

## Retry semantics

- "Retry missing ranges up to 3 times" is specified for flash download,
  but the backoff strategy (if any) and what constitutes a "missing"
  vs. "failed" range are not defined.
