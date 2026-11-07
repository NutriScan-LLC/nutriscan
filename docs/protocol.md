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
detection. Milestone 3 added the thin scanner-facing connection API.
Hardware experiments M1–M15 subsequently confirmed AOX start, bounded flash
reads, block validation/reassembly, and one complete 5,773-block measurement
on the scanner identified below. Those behaviors remain exposed through
explicitly experimental methods while the production interfaces proposed in
`docs/sdk-production-design.md` are reviewed. No scoring/server client exists
in `packages/scanner`.

## AOX Measurement Start — Experiment M1

The following behavior is confirmed only on scanner
`2N2400A5B70F5E3C9251`:

- Sending `measure?type=aox&call-index=5d116696` followed by LF caused the
  scanner to begin visible physical activity.
- The scanner returned this JSON response, terminated by CRLF:
  ```json
  {"command":"measure?type=aox&call-index=5d116696","serial":"2N2400A5B70F5E3C9251","type":"aox","measurement_nr":16}
  ```
- The response repeated the command parameters and call-index in its
  `command` field. Existing call-index extraction correlated it as
  `5d116696`.
- The response contained `type: "aox"` and `measurement_nr: 16`. These
  field names and values are preserved as observed; no broader response
  schema is inferred.
- The response appeared immediately after the manual action and before
  the scanner's visible activity. Afterward, three green bars illuminated
  sequentially.
- Consequently, this response is confirmed as an immediate acknowledgment
  associated with starting visible scanner activity. It is **not**
  evidence that measurement had completed.
- No leading `0x80` byte was present in this response frame.

Experiment M1 did not observe `busy`, completion signaling,
`last_measurement_nr`, or flash retrieval. Those remain separate questions.

## Measurement Busy State — Experiment M2

The following two manual status observations are confirmed only on scanner
`2N2400A5B70F5E3C9251`:

- In one run, a single `status` command was sent immediately after the M1
  acknowledgment and before any green bar illuminated. Its response
  reported `busy: 1` and `last_measurement_nr: 19`.
- In a subsequent run, a single `status?call-index=940b53d9` command was
  sent while the first green bar was illuminated. The first response bytes
  arrived approximately 35 ms after transmission and the complete response
  arrived approximately 40 ms after transmission. It reported `busy: 1`
  and `last_measurement_nr: 20`.
- The during-first-bar response repeated call-index `940b53d9`, was
  terminated by CRLF, and had no leading `0x80` byte.

These observations confirm that this scanner reported `busy: 1` both
immediately before visible bar activity and during the first green bar in
those runs. They do not establish when `busy` first becomes `1`, when it
returns to `0`, or how `last_measurement_nr` relates to completion. The
different measurement-number values came from different runs and are
preserved without further interpretation.

## Post-Bars Status — Experiment M3

The following same-run sequence is confirmed only on scanner
`2N2400A5B70F5E3C9251`:

1. The M1 acknowledgment returned `measurement_nr: 21` at `21:52:38.165`.
2. During the first green bar, a single status response returned
   `busy: 1` and `last_measurement_nr: 21` at `21:52:42.260`.
3. After the third green bar had completely finished, a single
   `status?call-index=678e3c4f` command was transmitted. The status response
   returned `busy: 0` and `last_measurement_nr: 21`.
4. For that post-bars status request, the first response bytes arrived
   approximately 30 ms after transmission and the complete response
   arrived approximately 45 ms after transmission. The response repeated
   call-index `678e3c4f`, was terminated by CRLF, and had no leading
   `0x80` byte.

For this run, `last_measurement_nr` already matched the M1-assigned
measurement number while `busy` was still `1`, and it remained unchanged
after `busy` became `0`. Therefore `last_measurement_nr` alone was not a
completion indicator in this observation. The observed post-bars state was
`busy: 0`; the exact instant at which `busy` changed was not measured.

## First Flash-Block Request — Experiment M4

The following behavior is confirmed only on scanner
`2N2400A5B70F5E3C9251` for completed AOX measurement `21`:

- Sending one
  `read-flash?nr=21&block=0&range=1&call-index=3a0160d6` command followed
  by LF returned a correlated JSON response approximately 30 ms later.
- The response was terminated by CRLF, had no leading `0x80` byte, and
  contained these observed fields:
  - `measurement_nr: 21`
  - `measurement_type: "aox"`
  - `start_block: 58`
  - `data_blocks: 1`
  - `data_blocks_index: 0`
  - `data_blocks_requested: 1`
  - `data: ["AB8BAACYHQCAFS0PgLsFAAQAIAAAAABgAv//AAAAADTZ"]`
- The single Base64 string decoded locally to exactly 33 bytes:
  ```text
  00 1f 01 00 00 98 1d 00 80 15 2d 0f 80 bb 05 00
  04 00 20 00 00 00 00 60 02 ff ff 00 00 00 00 34 d9
  ```
- As uninterpreted numeric observations, bytes 0–1 read as big-endian are
  `31` (the decoded byte length minus two), and bytes 2–3 read as
  little-endian are `1`.

M4 alone confirmed that this scanner accepted `block=0&range=1`
and returned one Base64 data element with `data_blocks_index: 0`. It does
not establish the meaning of `start_block: 58`, the semantic layout of the
decoded bytes, or behavior for subsequent block requests. Later CRC
evidence from M4 and M5 is recorded below.

## Second Flash-Block Request — Experiment M5

The following behavior is confirmed only on scanner
`2N2400A5B70F5E3C9251` for completed AOX measurement `21`:

- Sending one
  `read-flash?nr=21&block=1&range=1&call-index=766a2e93` command followed
  by LF returned a correlated JSON response approximately 30 ms later.
- The response was terminated by CRLF, had no leading `0x80` byte, and
  contained these observed fields:
  - `measurement_nr: 21`
  - `measurement_type: "aox"`
  - `start_block: 58`
  - `data_blocks: 2`
  - `data_blocks_index: 1`
  - `data_blocks_requested: 1`
  - `data: ["AB8BAADE3hbWT2KunRwkhDGlIorTUzYp+mXOXOq+fTsw"]`
- The single Base64 string decoded locally to exactly 33 bytes:
  ```text
  00 1f 01 00 00 c4 de 16 d6 4f 62 ae 9d 1c 24 84
  31 a5 22 8a d3 53 36 29 fa 65 ce 5c ea be 7d 3b 30
  ```
- As uninterpreted numeric observations, bytes 0–1 read as big-endian are
  `31`, and bytes 2–3 read as little-endian are `1`.
- The M4 and M5 decoded blocks are different, but both carry raw value `1`
  in bytes 2–3. `start_block` remained `58`; `data_blocks_index` followed
  the requested offsets (`0`, then `1`), while `data_blocks` changed from
  `1` to `2`.
- Applying the vendor-proposed CRC16-CCITT calculation (polynomial
  `0x1021`, initial value `0xFFFF`, over bytes 2 through the end) produced
  residual `0x0000` for both observed M4 and M5 blocks. This validates that
  calculation for these two blocks only.

M5 confirms the duplicate raw value `1` in decoded bytes 2–3 for the two
different blocks returned at request offsets 0 and 1 on this scanner. It
does not yet establish how later blocks are indexed or what `data_blocks`
means.

## Third Flash-Block Request — Experiment M6

The following behavior is confirmed only on scanner
`2N2400A5B70F5E3C9251` for completed AOX measurement `21`:

- One `read-flash` request using `block=2&range=1` returned one Base64
  element with `start_block: 58`, `data_blocks: 3`,
  `data_blocks_index: 2`, and `data_blocks_requested: 1`.
- The Base64 value `AB8CAACmclbU1G4wLk6frUkzE9eFLJSYsS8OobHvlzJo`
  decoded to exactly 33 bytes:
  ```text
  00 1f 02 00 00 a6 72 56 d4 d4 6e 30 2e 4e 9f ad
  49 33 13 d7 85 2c 94 98 b1 2f 0e a1 b1 ef 97 32 68
  ```
- Bytes 0–1 read as big-endian were `31`; bytes 2–3 read as little-endian
  were `2`. The block was distinct from the M4 and M5 blocks.
- The same vendor-proposed CRC16-CCITT calculation produced residual
  `0x0000`.

Across M4–M6, request offsets 0, 1, and 2 produced response
`data_blocks_index` values 0, 1, and 2 and distinct 33-byte blocks. Their
raw little-endian values in bytes 2–3 were 1, 1, and 2. This confirms on
this scanner that the first two retrieved physical blocks both reported
raw internal index 1; no normalization or deduplication is applied.
`start_block` remained 58 and `data_blocks` was observed as 1, 2, and 3,
but neither field is assigned semantics from those observations.

## M1–M6 Session Framing Observation

Across the captured measurement-start, status, and flash-read interactions
on this scanner/session, host commands were LF-terminated and scanner JSON
responses were CRLF-terminated. Call-index correlation succeeded, trailing
CR bytes remained in raw frames, JSON parsing succeeded without CR
normalization, and no leading `0x80` byte was observed. This is not a claim
about every response, scanner, or firmware version.

## Three-Block Range Request — Experiment M7

The following behavior is confirmed only on scanner
`2N2400A5B70F5E3C9251` for completed AOX measurement `21`:

- One `read-flash?nr=21&block=0&range=3&call-index=83959916` command
  followed by LF returned a correlated JSON response approximately 31 ms
  after transmission.
- The response was CRLF-terminated, had no leading `0x80` byte, and
  reported `start_block: 58`, `data_blocks: 3`,
  `data_blocks_index: 0`, and `data_blocks_requested: 3`.
- Its `data` array contained exactly three Base64 strings. In array order,
  they matched the saved M4, M5, and M6 individually retrieved blocks
  byte-for-byte.
- Each decoded element was 33 bytes, its bytes 0–1 read as big-endian were
  31, and its CRC residual under the observed calculation was `0x0000`.
  Raw little-endian values in bytes 2–3 were 1, 1, and 2.

This confirms for the first three blocks on this scanner that `range=3`
returns multiple elements in request-offset order and that the combined
response is byte-for-byte consistent with separate single-block requests.
The duplicate raw internal index is preserved without normalization or
deduplication. This observation does not establish that `data_blocks: 3`
means total measurement length.

## First 150-Block Range Request — Experiment M8

The following behavior is confirmed only on scanner
`2N2400A5B70F5E3C9251` for completed AOX measurement `21`:

- One `read-flash?nr=21&block=0&range=150&call-index=88144d98`
  command followed by LF returned a correlated complete response
  approximately 66 ms after transmission.
- The CRLF-terminated response had no leading `0x80` byte and reported
  `start_block: 58`, `data_blocks: 150`, `data_blocks_index: 0`, and
  `data_blocks_requested: 150`.
- Its `data` array contained exactly 150 Base64 elements. Every element
  decoded to 33 bytes, every bytes 0–1 big-endian value was 31, and every
  CRC residual under the observed calculation was `0x0000`.
- The first three elements matched the saved M4, M5, and M6 blocks
  byte-for-byte.
- Array elements 0 and 1 carried raw little-endian internal index 1.
  Elements 2 through 149 carried indexes matching their array/request
  offsets, ending at 149.

M8 confirms that measurement 21 has at least 150 retrievable blocks and
that one range request can return 150 ordered, framing-valid blocks on
this scanner. It did not cross the available-data boundary. Because
`data_blocks: 150` also equaled the requested and returned element counts,
that field is not established as a total measurement block count.

## Second 150-Block Range Request — Experiment M9

The following behavior is confirmed only on scanner
`2N2400A5B70F5E3C9251` (sensor firmware `608`, Nuvoton firmware `0.5.4`)
for completed AOX measurement `21`:

- One `read-flash?nr=21&block=150&range=150&call-index=bc988e36`
  command followed by LF returned a correlated CRLF-terminated response.
- The response reported `start_block: 58`, `data_blocks: 300`,
  `data_blocks_index: 150`, and `data_blocks_requested: 150`.
- Its `data` array contained exactly 150 Base64 elements. Every element
  decoded to 33 bytes, bytes 0–1 read big-endian as 31, and had CRC16-CCITT
  residual `0x0000` over bytes 2 through end.
- Raw little-endian internal indexes ran consecutively from 150 through
  299, matching request offset plus array position.
- The exact response arrived in eight transport read chunks, demonstrating
  that the Node transport and protocol framer reassemble a multi-chunk JSON
  response without altering its bytes.

M9 confirms that measurement 21 has at least 300 retrievable blocks. Across
M8 and M9, `data_blocks` changed from 150 to 300 and equaled the exclusive
end of each fully returned request. This disproves a fixed-total
interpretation for those observations. It does not yet prove the field's
general semantics or establish the measurement boundary.

## Third 150-Block Range Request — Experiment M10

Confirmed only on scanner `2N2400A5B70F5E3C9251` (sensor firmware `608`,
Nuvoton firmware `0.5.4`) for completed AOX measurement `21`:

- One `block=300&range=150` request returned exactly 150 elements and
  reported `start_block: 58`, `data_blocks: 450`,
  `data_blocks_index: 300`, and `data_blocks_requested: 150`.
- All elements decoded to 33 bytes with big-endian length 31 and CRC
  residual `0x0000`; raw internal indexes ran consecutively 300–449.

M10 confirms at least 450 retrievable blocks. It is the third consecutive
full batch where `data_blocks` equals the request's exclusive end, further
supporting that interpretation for full in-range reads without yet proving
general semantics or locating the boundary.

## Fourth 150-Block Range Request — Experiment M11

Confirmed only on scanner `2N2400A5B70F5E3C9251` for measurement 21:
`block=450&range=150` returned 150 valid elements with consecutive raw
indexes 450–599, `start_block: 58`, `data_blocks_index: 450`, and
`data_blocks: 600`. All decoded lengths were 33, declared lengths were 31,
and CRC residuals were zero. The boundary is beyond block 599.

## Fifth 150-Block Range Request — Experiment M12

Confirmed only on scanner `2N2400A5B70F5E3C9251` (sensor firmware `608`,
Nuvoton firmware `0.5.4`) for completed AOX measurement 21:
`block=600&range=150` returned exactly 150 elements. The response reported
`start_block: 58`, `data_blocks_index: 600`, `data_blocks_requested: 150`,
and `data_blocks: 750`. Decoded internal indexes were consecutive from 600
through 749. Every element was 33 bytes, declared a big-endian length of 31,
and had CRC16-CCITT residual `0x0000` over bytes 2 through end.

This establishes at least 750 retrievable blocks for this measurement. In a
fourth consecutive full-range observation, `data_blocks` again equaled the
exclusive request end; it still does not establish the measurement total or
general field semantics.

## Full AOX Boundary and Complete Retrieval — Experiments M13/M14

The following is hardware-confirmed only on scanner
`2N2400A5B70F5E3C9251` (sensor firmware `608`, Nuvoton firmware `0.5.4`)
for completed AOX measurement 21:

- M13 `block=5772&range=1` returned one 33-byte block with declared length
  31, internal index 5772, and CRC residual `0x0000`. The response reported
  `data_blocks: 5773` and `data_blocks_index: 5772`.
- M14 `block=5773&range=1` returned one Base64 element decoding to 33 bytes
  of `0xFF`. Its declared length and internal index were both 65535 and its
  CRC residual was 2282, so it is not a valid measurement block. The JSON
  response was still classified `kind: ok` and reported `data_blocks: 5774`.
- A complete retrieval using 39 sequential bounded requests (range 150,
  final range 73) recovered every logical block 0 through 5772. All 5,773
  stored blocks were 33 bytes, declared length 31, and CRC-valid. Logical
  block 0 and logical block 1 both carried internal index 1, using the
  duplicate-initial-index mapping observed previously. No blocks were
  missing, malformed, conflicting, or retried.

For this scanner/measurement, 5,773 is therefore the confirmed count of
valid logical AOX blocks. An immediately following flash location reads as
invalid all-`FF` data rather than an explicit protocol error. The complete
ordered concatenation contained 254,012 characters and had SHA-256
`4e278d59b883e78d1100a89385f618e6bb3061421b83b4664b5a0a093a51ee5a`.
The local diagnostic artifact preserves all blocks and raw transport bytes.

## Non-Destructive Live AOX Acquisition — Experiment M15

The following is hardware-confirmed only on scanner
`2N2400A5B70F5E3C9251` (sensor firmware `608`, Nuvoton firmware `0.5.4`):

- No `delete` or `erase-chip` preparation was used. Baseline status reported
  `busy: 0` and `last_measurement_nr: 22`.
- One `measure?type=aox` command acknowledged AOX measurement 23. The first
  valid flash block was observed about 1.008 seconds after acknowledgment.
- Progressive acquisition recovered all 5,773 logical blocks in 39 bounded
  reads with no missing blocks, malformed blocks, all-`FF` observations,
  transport errors, anomalies, or retry rounds.
- Every recovered block was 33 bytes with declared length 31 and CRC residual
  zero. Logical indexes were complete and unique from 0 through 5772 after
  applying the duplicate-initial-index rule.
- The final block was available about 27.093 seconds after acknowledgment.
  Final status reported `busy: 0` and `last_measurement_nr: 23`.
- The exact ordered `MeasurementBlocks` string contained 254,012 characters
  and had SHA-256
  `ab6ccdfa9ca673fe6758fee47e70942e9711dd680cacafabb4b831731bacee5e`.

This confirms that this scanner can produce and fully expose a fresh AOX
measurement without destructive scanner preparation. It does not establish
the same timing, block count, or lifecycle behavior across other scanners or
firmware.

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
- During a real identification/status exchange with confirmed scanner
  `2N2400A5B70F5E3C9251`, both the JSON error response to `get_status` and
  the successful JSON response to the fallback `status` command were
  observed ending in CRLF (`0D 0A`). This is evidence for those responses
  from this scanner only; terminator behavior across other responses,
  scanners, and firmware versions remains unconfirmed.
- `FrameReader` continues to split only on LF (`0A`). For an observed CRLF
  response, the CR (`0D`) therefore remains in the raw frame passed to
  `parseResponseFrame()`. JSON parsing succeeds because trailing CR is
  valid JSON whitespace, and the original raw frame bytes remain
  preserved. No CR stripping or normalization is performed.
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
- This exception is scoped to `get_status` detection. Production status,
  hand, measurement, and flash requests require matching correlation;
  call-index-less or stale mismatched frames cannot satisfy them.
- **Confirmed on this scanner:** measurement, status, and flash responses
  embedded call-index as a standard query parameter in `command`; status
  and flash responses also returned a matching top-level `"call-index"`.

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
# Production AOX availability scheduling

Production AOX flash acquisition is paced in `@nutriscan/scanner`, shared by browser and CLI callers. From the measurement acknowledgment timestamp, the SDK estimates availability at 400 logical blocks per second and waits until the end of each requested range is available, plus a documented 750 ms safety margin.

Completion still requires all 5,773 validated blocks. The scheduler is not a retry-count increase and does not infer completion from status or visible LEDs. The production Quick AOX path contains no delete, erase, reset, restart, update, or firmware commands.

## Production correlation and recovery

The hardware-confirmed call-index-less `get_status` error remains permitted only
for that detection request. Production `status`, `hand`, `measure`, and
`read-flash` requests require a matching call-index. A valid AOX measurement
acknowledgment must also identify `measure?type=aox`, return `type: "aox"`, and
contain a positive integer `measurement_nr`.

After a protocol or acquisition failure, browser recovery closes the serial
transport, stops the protocol loop, clears partial frame/byte buffers, and then
reopens the previously authorized port only after another explicit connection
attempt. This recovery sends no scanner command of its own.

# Wi-Fi HTTP transport (confirmed 2026-11-06)

Evidence: scanner `2E249C6AFCEA6BE8D5FF` (Wi-Fi firmware 20.6.8, sensor 608);
curl from a Mac on its access point; rvictl/tcpdump capture of one full
Biozoom-app AOX scan from iOS 18.7; APK `wifi.service.ts` (VitalityCheck
0.50.107, from `main.js.map`). Full write-up: `BIOZOOM_PROTOCOL_AND_IMPLEMENTATION.md`.

- Access point `biozoomAP_<last4>`, scanner at `http://192.168.4.1`, plain
  HTTP on port 80, `GET` only, `Access-Control-Allow-Origin: *`. No internet
  upstream. APK constant `SCANNER_APMODE_URL = 'http://192.168.4.1'`.
- Unknown paths receive no HTTP response at all.
- Sequence the Biozoom app sends for Quick AOX:
  `/status` → `/h?start=110&count=13&cycles=5` (repeat until hand on) → `/d`
  → `/m?type=aox` (HTTP 202, `measurement_nr`) → `/read-flash?nr=&block=&range=`
  (streamed during acquisition) → `/status` → `/h?start=134&count=10&cycles=25`
  (repeat until hand off).
- `/d` returns `text/plain` `Deleted`.
- `read-flash` JSON adds `measurement_type`, `data_blocks` (5,773 for full
  AOX), `data_blocks_index`, `data_blocks_requested`. Blocks not yet written
  read as 33 bytes of `0xFF`; the app re-polls them.
- Flash blocks are identical to USB: all 6,450 captured blocks are 33 bytes
  and pass CRC16-CCITT; the first-block index quirk is present.
- `/h` data parsed with the existing sampled hand algorithm reproduces the
  app's decisions on all five captured responses (fixture
  `packages/scanner/test/fixtures/wifi-hand-capture-2026-11-06.json`).
- iOS Safari blocks an HTTPS page from calling the scanner (mixed content).
  A Capacitor app using native HTTP (`CapacitorHttp`) can; `GET /status`
  confirmed from the NutriScan iOS shell.

Implementation: `HttpTransport` (`FetchHttpTransport`, `CapacitorHttpTransport`),
`protocol/wifiHttp.ts`, `scanner/WifiBioZoomScanner.ts`.
