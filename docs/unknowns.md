# Unresolved Protocol Questions

Tracks behavior that is not yet confirmed against real hardware. Per
`CLAUDE.md`, nothing here should be treated as fact until it's verified and
promoted into `docs/protocol.md`. Add to this list rather than guessing.

Nothing below is implemented yet — Milestone 1 is transport-only. These are
carried over from `BIOZOOM_PROTOCOL_AND_IMPLEMENTATION.md` as the questions
the protocol layer will need to answer.

## Protocol detection

- Is `get_status` always the correct first probe for both legacy and
  modern scanners, or can it fail silently (no response) rather than
  returning an error to retry against?
- What distinguishes a legacy (`5W` prefix, V1) device at the transport
  level before any command is sent — is serial prefix visible without
  querying, or only after a response is parsed?

## `0x80` prefix stripping

- Is the number of leading `0x80` bytes fixed per firmware version, or can
  it vary response-to-response on the same device?
- Are `0x80` bytes ever legitimate payload (not a prefix artifact) in any
  known response type, or is stripping always safe?

## call-index handling

- When a response embeds `call-index` inside `"command"` rather than as a
  top-level field, what is the exact embedding format (query string
  fragment? nested object?)
- Can a response omit `call-index` entirely, and if so under what
  conditions should the protocol layer treat that as valid vs. an error?

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
