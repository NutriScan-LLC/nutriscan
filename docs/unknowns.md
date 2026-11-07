# Unresolved Protocol Questions

## Precision AOX production merge

- The NutriScan `measure_type=1` pre-request is runtime-confirmed, but the final
  Precision `/measure/` submission has not yet been performed live.
- It remains unknown whether the production service requires any APK optional
  metadata beyond the recovered minimum series contract. NutriScan currently
  omits app impersonation/config/log/license fields rather than inventing them.
- Server formulas and any acceptance meaning for `precise_aox_std`,
  `precise_measurements_std`, `precise_quality_hand`, and
  `precise_quality_result` remain unknown. Values are preserved without policy.
- The APK-bundled fallback is four measurements; downloaded customer design may
  configure another count. NutriScan exposes the count as workflow configuration
  and initially selects four.

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
  protocol layer permits this only on the `get_status` detection request.
  Strict production commands ignore call-index-less frames.
- **Resolved on this scanner:** measurement, status, and flash responses
  embedded call-index as a standard `?call-index=...` query parameter in
  `command`; status and flash also returned a matching top-level field.
  Whether other scanners or firmware embed it differently remains unknown.
- The firmware's expected call-index **format** (length, charset) is
  unconfirmed. `generateCallIndex()` produces an 8-character hex token as
  a placeholder — UNVERIFIED, marked in code.
- A call-index-bearing response that does not match the outstanding request is
  treated as stale/unrelated and skipped. Whether firmware emits unsolicited
  frames remains unknown; recovery still closes and resets failed sessions.

## V2 command/response framing (introduced in Milestone 2)

- **Command query encoding:** `formatCommandLine()` builds
  `name?key=value&...&call-index=<idx>` using standard `URLSearchParams`
  encoding. The spec only shows `?call-index=<random>` and
  `measure?type=aox` as examples — whether firmware tolerates
  percent-encoding of special characters in parameter values is
  unconfirmed.
- **Line terminator across devices/firmware:** confirmed scanner
  `2N2400A5B70F5E3C9251` returned CRLF (`0D 0A`) after both JSON responses
  observed during its real `get_status` / fallback `status` identification
  exchange (see `docs/protocol.md`). It is still unknown whether every
  response from this scanner uses CRLF or what other scanners and firmware
  versions use. `FrameReader` splits on LF and preserves the preceding CR;
  parsing succeeds because trailing CR is valid JSON whitespace. No CR is
  stripped or normalized.
- **FrameReader's `maxBufferSize` guard** (default 64 KiB) is an
  engineering safety limit we chose, not a confirmed real maximum response
  size. It only bounds *unterminated* buffered bytes (protects against a
  stream that never sends an LF) — it does not cap the size of a single
  complete frame delivered within one chunk. The real maximum V2 response
  size (including future `read-flash` block batches) is unconfirmed.

## Firmware block-index quirk

- **Resolved on this scanner:** individually retrieved request blocks 0
  and 1 were distinct but both reported raw internal index 1; request
  block 2 reported raw index 2. No normalization or deduplication is
  currently justified.
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

## Live measurement lifecycle

- The exact instant at which `busy` changes from `1` to `0` remains
  unknown; confirmed M2/M3 observations are in `docs/protocol.md`.
- Whether the scanner emits unsolicited completion traffic remains
  unknown. The exact completion transition timing beyond the discrete
  manual observations also remains unknown.
- `last_measurement_nr` alone was not a completion indicator in the
  observed run because it already matched the assigned measurement number
  while `busy` was still `1`.
- Experiment M15 confirmed one fresh AOX measurement could be completely
  acquired on this scanner without destructive preparation. Whether this is
  reliable across repeated scans, other scanners, or firmware remains unknown.
- M15 observed its first valid block about 1.008 seconds after acknowledgment
  and its final block about 27.093 seconds after acknowledgment, with no
  temporarily unwritten all-`FF` blocks or retries. The general production
  rate and behavior when reads outpace block production remain unknown.

## Remaining flash questions

- The meaning of response field `start_block: 58` is unknown. It must not
  be silently treated as the requested block index or a total block count.
- The general meanings of `start_block` and `data_blocks`, the semantic AOX
  payload layout and units, behavior for other measurement types, and
  cross-scanner/firmware consistency remain unknown. Confirmed M4–M14 block
  behavior is consolidated in `docs/protocol.md`.

## Official Android APK evidence (not hardware confirmation)

Static analysis of official APK `VitalityCheck-develop-0.50.107.apk`
(SHA-256 `a48ef80ef1263ce3e33e59536df049d0fa80013fe02de49b5bfbc36dbbb7b463`)
produced several high-confidence vendor-derived hypotheses. Full citations
and evidence labels are in `docs/apk-vitalitycheck-reverse-engineering.md`.

- The APK's V2 USB path hard-codes 5,773 blocks for full AOX; that count is
  now hardware-confirmed for measurement 21 on this scanner. The 2,887-block
  `aox-half` count remains APK-only.
- It starts full AOX with `measure?type=aox`, consumes `measurement_nr`, and
  retrieves flash immediately according to a time-derived availability
  estimate instead of polling status for completion.
- It begins with range 150, can cap ranges at 600 in the Android Cordova USB
  implementation, and repeatedly requests computed missing ranges until all
  expected internal indexes are present.
- It does not consume `start_block`, `data_blocks`, `data_blocks_index`,
  `last_measurement_nr`, or unsolicited messages to establish AOX length or
  completion in the traced V2 USB measurement flow.
- The duplicate first internal index is explicitly handled: the first index
  1 becomes logical block 0, while a later index 1 fills logical block 1.
- The APK validates Base64 blocks using the observed length/index/CRC rules,
  sorts them by logical index, concatenates the Base64 strings, and uploads
  the result to a BioZoom service. The client does not contain the biological
  AOX score formula; server-returned AOX fields are processed for display.
- The official flow includes destructive pre-measurement `delete` and, on a
  firmware-dependent branch, `erase-chip`. These are documentation evidence
  only and remain outside our autonomous hardware safety boundary.

## Quick AOX score quality

The APK-derived decision boundary and NutriScan interpreter are documented in
`docs/quick-aox-quality.md`. Remaining unknowns include whether unrecognized
finite `aox_q` values occur in production, the server-side meaning/calculation
of `aox_q` and `error_prediction`, the deployed configuration's exact routing,
ultimate retention/deletion of rejected Quick AOX results, and any workflow
retry limit. Literal routing by the APK threshold does not establish semantic
recognition: values such as 37, 44, and 45 remain unrecognized.

## Quick AOX workflow deployment

The workflow is documented in `docs/quick-aox-workflow.md`. The intended
production scoring route is browser to NutriScan backend to BioZoom, but the
backend gateway is not implemented yet. Remaining questions include backend
transaction/session affinity, supported authorization, privacy/retention,
retry policy, and documented behavior for `new_pre_request_req: true`. Until
that behavior is supplied, the workflow returns a typed unsupported condition.

## Experimental Node diagnostic runner

- `apps/scanner-cli` is tooling only and does not establish new protocol
  behavior. A CLI transcript becomes hardware evidence only after the user
  explicitly executes and reviews that named action.
- `scanner:ports` performs metadata enumeration only. It does not open,
  reserve, identify, or transmit to any listed port.
- `identify`, `status`, and named experiments `M7`/`M9` require an explicit port
  path and `--execute`. Without `--execute`, they are dry-runs and do not
  instantiate the scanner/transport execution path.
- Node serial access is confirmed on this Mac/scanner for identify and
  read-only flash diagnostics, including multi-chunk response reassembly and
  clean disconnect. Cross-platform/driver behavior remains unknown.
- The CLI M7 action reuses the existing unverified M7 scanner method and
  analysis. Merely preparing or dry-running the CLI must not promote or add
  any M7 protocol conclusion.
# Hand-recognition uncertainties

- Runtime status must establish whether the sampled V2 firmware branch applies. Otherwise NutriScan requires deployment-provided legacy thresholds and fails closed rather than treating bundled defaults as universal.
- The APK associates red illumination with its `hand` operation, but exact physical LED/channel behavior is not independently documented.
- Recovered recognition observables repeat every 500 ms without a local timeout. NutriScan applies an explicit cancellable workflow timeout; a possible APK global timeout remains unknown.
- It remains hardware-unconfirmed whether reproducing the APK's 100 ms initial,
  500 ms result, and 100 ms success-transition delays is sufficient to let this
  scanner enter physical AOX immediately after sampled hand recognition.

# Wi-Fi transport uncertainties (2026-11-06)

- **`/d` scope.** The app sends `/d` before every scan; the response is
  `Deleted`. What it deletes (previous measurement only? all stored data?) is
  unknown. `WifiBioZoomScanner` sends it exactly where the app does and stops
  if it fails.
- **V2 detection on Wi-Fi.** `WifiBioZoomScanner.identify()` reports V2
  because this unit was driven via `m?type=aox`; the APK's Wi-Fi V2 decision
  has not been extracted. Other units may differ.
- **Timeouts not set by the APK.** `/d` and `/m` have no APK timeout; NutriScan
  bounds both at 10 s.
- **Download pacing.** One capture shows the last block readable ~15.7 s after
  `/m`, ~1.3 s behind the APK's 400 blocks/s estimate. NutriScan uses a 2 s
  safety margin and 500 ms pause before re-reading missing ranges; tune from
  more captures.
- **Legacy hand path.** Firmware with Wi-Fi major < 10 or sensor firmware < 604
  uses `/signal` + parameterless `/h`; not implemented (fails closed).
- **Station mode** (`wifi_mode: APSTA`, scanner joining another network) and
  how to configure it.
- **Internet during scoring.** On the scanner AP the phone has no internet via
  Wi-Fi; whether iOS routes the scoring request over cellular is untested.
- **CapacitorHttp body re-serialization.** The plugin returned parsed JSON;
  NutriScan re-serializes it, so `ParsedResponse.text`/`rawBytes` are not
  byte-exact wire data on Wi-Fi.
