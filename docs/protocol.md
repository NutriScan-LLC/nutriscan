# BioZoom Protocol — Confirmed Behavior

This document tracks protocol behavior that has been confirmed, in the
sense described by `CLAUDE.md`: verified against real hardware or stated
authoritatively in `BIOZOOM_PROTOCOL_AND_IMPLEMENTATION.md`. Update it
*before* changing any confirmed behavior in code, not after.

## Status: no protocol layer implemented yet

Milestone 1 built the transport layer only
(`packages/biozoom-sdk/src/transport`), which is intentionally protocol-
agnostic — it moves raw bytes and has no knowledge of JSON, commands, or
BioZoom framing.

For the confirmed protocol-level facts already established (serial
configuration, scanner family prefixes, JSON `0x80` stripping rule,
call-index handling, block format, CRC parameters), see the canonical
source: `BIOZOOM_PROTOCOL_AND_IMPLEMENTATION.md` at the repo root.

This file will accumulate protocol-layer-specific confirmations once that
layer is implemented in a later milestone. Open questions that block
turning spec text into confirmed behavior are tracked in
`docs/unknowns.md`.
