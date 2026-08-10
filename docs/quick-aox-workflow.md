# Quick AOX application workflow

## Scope and topology

`@nutriscan/workflows` owns framework-independent sequencing for one complete
Quick AOX attempt. It composes the scanner acquisition API with browser-safe
scoring contracts and quality interpretation. It contains no React, Next.js,
UI copy, Web Serial construction, or HTTP implementation.

The intended production topology is:

```text
Browser -> NutriScan backend scoring gateway -> BioZoom
```

The workflow consumes an abstract `QuickAoxScoringGateway`; the backend adapter
is not implemented in this milestone. It does not depend on direct browser-to-
BioZoom access. This is application orchestration, not scanner-protocol
evidence, and is not promoted to `docs/protocol.md`.

## State and outcomes

The linear state sequence is:

```text
connecting -> identifying -> awaiting-hand-position
-> starting-measurement -> downloading -> building-scoring-request
-> pre-requesting -> waiting-to-submit -> submitting
-> parsing -> interpreting -> completed
```

Terminal outcomes are `accepted`, `rescan-required`,
`device-condition-required`, `stopped`, `unable-to-determine`, `cancelled`,
and `failed`. No terminal quality outcome loops back to measurement start. A
rescan is a new application-controlled run with a new hand confirmation.

## Human gate and physical start

Every run requires `waitForHandPositioned()`. It receives the identified
scanner and optional abort signal. `startAoxMeasurement()` occurs in exactly
one linear location after that promise resolves and cancellation is checked.
It is never retried. One workflow instance rejects concurrent runs.

The returned measurement number is passed unchanged to
`downloadAoxMeasurement()`. The workflow requires a complete artifact with no
incomplete failure and verifies its scanner serial and measurement number.
Only then may scoring begin.

## Scoring transaction

`buildQuickAoxScoringRequest()` is available from the browser-safe
`@nutriscan/scoring/quick-aox` entry point. It constructs the runtime-confirmed
`measure_json` with exact `MeasurementBlocks`; UUID generation is injected, and
the entry point imports no Node crypto, filesystem, HTTPS, or diagnostic code.

The contiguous post-acquisition scoring sequence is:

1. gateway pre-request for the identified serial;
2. validate `recommended_server` and `waiting_time_ms`;
3. wait at least `waiting_time_ms` using an abortable wait;
4. submit the exact scoring request through the gateway;
5. preserve the complete raw response;
6. parse it with `parseQuickAoxResponse()`;
7. interpret it with `interpretQuickAoxQuality()`.

`new_pre_request_req: true` produces typed failure
`unsupported-pre-request`. No repeat behavior is invented. The production
gateway must create the confirmed multipart part `measure_json`, filename
`measure.json`, content type `application/json`. Backend transport,
authorization, privacy, logging, and retry policy remain separate work.

## Evidence and progress

Completed evidence preserves the full scanner identity, start acknowledgment,
validated acquisition artifact, scoring request, parsed and raw pre-request,
raw scoring response, opaque diagnostics, unknown fields, and quality decision.
This package does not persist that evidence or place it in URLs.

Structured progress reports real states and validated acquisition counts. It
does not invent a linear physical-scanner percentage. Progress observers cannot
control sequencing by throwing; cancellation uses `AbortSignal`.

## Cancellation and safety

Cancellation checkpoints occur before and between scanner operations and
through acquisition, waiting, and scoring. A cancelled outcome records its
phase and `physicalMeasurementStarted`.

It records `physicalMeasurementMayHaveStarted` only when the measurement
command is about to be transmitted—not when routine bare-delete preparation
begins. This remains true if the measurement acknowledgment is lost, because
software cannot prove whether the scanner acted on a transmitted command.

When `physicalMeasurementStarted` is true, cancellation means software work
stopped. It does not claim physical acquisition stopped. No guessed stop command
exists. The workflow never automatically rescans. Its one normal
state-changing preparation operation is the APK-confirmed bare `delete` before
each physical AOX measurement. Its exact firmware-side scope is unknown. No
`erase-chip`, `e`, `flash_erase`, firmware, restart/reset, or mode-changing
command is reachable from this production path.

By default it disconnects in `finally`; disconnect closes communication and is
not represented as stopping physical activity. Long-lived connection owners may
set `disconnectOnFinish: false`.

## Failure boundaries

Typed failure categories distinguish scanner, hand confirmation, acquisition,
scoring contract, scoring transport, unsupported/invalid pre-request, and
quality failures. A malformed final score is `unable-to-determine` with its
parse error and raw response. Missing/null/invalid quality likewise maps to
`unable-to-determine` through the quality interpreter.

## Remaining work

- Implement the NutriScan backend gateway and supported authorization.
- Decide backend transaction/session affinity for the paired BioZoom calls.
- Consolidate the nested Next.js app into the monorepo workspace.
- Add UI composition and explicit hand-confirmation controls.
- Establish reviewed persistence, redaction, analytics, and retention policy.
- Adopt documented behavior if BioZoom defines `new_pre_request_req: true`.
# Production scanner lifecycle

The production workflow is deliberately non-destructive:

1. An explicit **Begin scan** action enables scanner hand polling.
2. The scanner must confirm hand presence before the workflow sends the single `measure?type=aox` command.
3. Acquisition accepts completion only after all 5,773 logical blocks validate.
4. The workflow then asks for hand removal and polls until removal is confirmed.
5. Only then does `preRequest() -> required wait -> submit()` begin.

The hand-recognition timing is reproduced from the recovered APK rather than
invented by NutriScan: read status once, wait 100 ms before the first hand
command, delay every recognition result by 500 ms, and after the first positive
result wait another 100 ms before transitioning to AOX measurement. Negative
results repeat only the hand command; they do not repeat status.

Production AOX acknowledgment now requires matching call-index correlation,
an acknowledged `measure?type=aox` command, `type: "aox"`, and a positive integer
`measurement_nr`. The acquisition frontier remains anchored to receipt of that
valid acknowledgment.

Cancellation stops software work only. NutriScan does not claim that a physical measurement stopped and sends no guessed stop command. Rejected quality never causes an automatic rescan.

## Evidence classification

- **APK-confirmed:** approximately 400 blocks/second production-frontier acquisition; sampled V2 hand commands `110/13/5` and `134/10/25`; strict sampled-hand ratios; 500 ms recognition polling; full block recovery before the next configured stage.
- **Hardware-confirmed:** `measure?type=aox`, 5,773 valid blocks, 33-byte block structure, and successful full acquisition without delete or erase commands.
- **Still uncertain:** the connected scanner's hand-recognition firmware branch, deployment overrides for legacy thresholds, the physical LED implementation, and the vendor application's external/global recognition timeout.
