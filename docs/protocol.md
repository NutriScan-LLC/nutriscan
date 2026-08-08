# BioZoom Protocol — Confirmed Behavior

This document tracks protocol behavior that has been confirmed, in the
sense described by `CLAUDE.md`: verified against real hardware or stated
authoritatively in `BIOZOOM_PROTOCOL_AND_IMPLEMENTATION.md`. Update it
*before* changing any confirmed behavior in code, not after.

## Status: transport + V2 protocol + minimal scanner API implemented

Milestone 1 built the transport layer
(`packages/scanner/src/transport`). Milestone 2 added the V2 protocol
layer (`packages/scanner/src/protocol`): response framing, response
parsing, call-index correlation, command formatting, and version
detection. Milestone 3 added a thin scanner-facing API
(`packages/scanner/src/scanner`, `BioZoomScanner`) exposing only
`connect()`, `disconnect()`, and `identify()` — it introduces no new
protocol knowledge, just composes Transport + ProtocolClient per the
Phase 1 objective (discover/connect/disconnect/verify communication/
identify firmware). Measurement (`measureAOX`) and flash download are not
implemented yet — that's a later milestone.

## Layer boundaries

```
Transport   — raw bytes only. connect/disconnect/write/read/buffering/
              timeouts. No JSON, no command knowledge, no BioZoom framing.
              (packages/scanner/src/transport)

FrameReader — byte-oriented only. Splits a continuous stream on LF (0x0A).
              Does not touch content: no CR/0x80 stripping, no whitespace
              trimming, no UTF-8 decoding. Synchronous. Emits empty frames
              (adjacent LFs) unchanged.
              (packages/scanner/src/protocol/frame.ts)

response.ts — turns one complete raw frame into a ParsedResponse. This is
              the ONLY place 0x80 stripping happens, followed by UTF-8
              decoding and JSON parsing. Every outcome (including every
              error outcome) carries the original raw bytes.
              (packages/scanner/src/protocol/response.ts)

ProtocolClient — command formatting + LF termination, call-index
              generation/correlation, the read loop (pulls from Transport
              via transport.read(), never transport.onData()), and V2
              version detection. No serial/browser APIs.
              (packages/scanner/src/protocol/ProtocolClient.ts)

BioZoomScanner — the public API surface UI code calls: connect(),
              disconnect(), identify(). Owns a ProtocolClient internally;
              takes a Transport by constructor injection so it stays
              platform-agnostic (Web Serial today, Electron/Node later).
              No measurement commands yet.
              (packages/scanner/src/scanner/BioZoomScanner.ts)
```

Each layer only talks to the one below it. `ProtocolClient` depends on
`Transport` purely through its public interface — it does not know it's
Web Serial specifically.

## Serial Configuration

- 2,000,000 baud, 8N1 (confirmed; not hardcoded in the transport — the
  caller supplies it, see `apps/scanner-test/src/main.ts`).

## Scanner Families

- Modern scanners: serial prefix `2N`, Protocol V2.
- Confirmed test device: `2N2400A5B70F5E3C9251`.
- Legacy (`5W` prefix, Protocol V1) is out of scope — not implemented.

## V2 Command Framing

- Commands are ASCII/UTF-8 text terminated by a single LF (`0x0A`).
- `formatCommandLine(name, params, callIndex)` builds `name?key=value&...&call-index=<idx>`
  using standard `URLSearchParams` query encoding. The `\n` terminator is
  appended at write time, not by the formatter.

## V2 Response Framing

- Responses are JSON lines, one JSON value per LF-terminated frame.
- Some firmware prefixes a response with one or more leading `0x80` bytes.
  Stripping happens **only** in `response.ts`, never in the transport or
  in `FrameReader` (CLAUDE.md rule 4).
- After stripping, the remainder is decoded as UTF-8 and parsed as JSON.

## Response Classification

- `parseResponseFrame()` returns a discriminated union: `'decode-error'`
  (malformed UTF-8), `'parse-error'` (malformed JSON), `'unexpected-shape'`
  (valid JSON but not a plain object), or a `BioZoomJsonResponse` with
  `kind: 'ok' | 'error'`.
- **`kind: 'error'` is assigned only when the parsed object has the literal
  `"type":"error"` field** — the one confirmed error marker, seen on:
  ```json
  {"command":"get_status","serial":"2N2400A5B70F5E3C9251","type":"error"}
  ```
- **`kind: 'ok' means only "did not carry that error marker" — it is NOT a
  validated success schema.** No field layout for a successful response is
  confirmed beyond `command`/`serial`/`call-index` extraction. The full
  parsed object is always preserved verbatim in `json`, so no field is
  ever lost regardless of classification.
- Unknown/extra JSON fields are always preserved verbatim.

## call-index Handling

- Commands append `?call-index=<random>` (exact format/charset firmware
  requires is unconfirmed — see `docs/unknowns.md`).
- Responses may return it as a top-level `"call-index"` field, or embedded
  in `"command"` as a `?call-index=...` query fragment. `extractCallIndex()`
  checks both, preferring the top-level field if both are somehow present.
- **Confirmed:** a response can omit call-index entirely. The `get_status`
  error example above has no call-index anywhere (not top-level, not
  embedded — `command` is the bare string `"get_status"`).

## V2 Protocol Detection

Confirmed algorithm (`ProtocolClient.detectV2()`):

1. Send `get_status`.
2. If that response's `kind` is `'error'` (the confirmed JSON error
   marker), retry by sending `status`.
3. V2 is confirmed if *either* response has a `command` field — this is
   evidence-gathering independent of step 2's retry, since the confirmed
   `get_status` error example already carries `"command":"get_status"`
   despite being an error.
4. V1 is not attempted. If neither response has a `command` field,
   detection fails with `ProtocolDetectionError`.

## Read Consumption Model

`ProtocolClient`'s internal loop consumes bytes via `transport.read(pollTimeoutMs)`
in a loop (pull-based), not `transport.onData()`. This fully drains the
transport's internal buffer on every call, avoiding unbounded buffer
growth over a long session — a push-only (`onData`) consumer would leave
`Transport`'s buffer accumulating forever since nothing would ever call
`read()` to drain it. `apps/scanner-test` still talks to `Transport`
directly via `onData()` for raw diagnostic logging, independent of and
concurrent with `ProtocolClient`'s consumption.
