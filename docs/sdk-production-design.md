# Production AOX acquisition API

This design was implemented after the non-destructive M15 live acquisition
confirmed a fresh measurement could be fully reconstructed. Server scoring
remains outside `packages/scanner`; detailed hardware/APK evidence remains in
the separate protocol and reverse-engineering documents.

## Promotion assessment from M1–M15

Ready as scanner/protocol behavior, with scanner/firmware scope documented:

- `measure?type=aox` starts visible AOX activity and returns an immediate
  acknowledgment containing `measurement_nr` on the tested scanner.
- `read-flash` accepts measurement number, zero-based requested block, and
  bounded range. Range 150 reconstructed a complete measurement reliably.
- Base64 blocks can be validated using 33-byte observed framing, big-endian
  declared length, little-endian internal index, and CRC16-CCITT residual.
- The first two logical blocks require the confirmed duplicate index-1 rule.
- Valid blocks can be stored by logical index, missing ranges retried, and
  original Base64 concatenated without normalization.
- Full AOX measurement 21 contained 5,773 logical blocks; block 5773 returned
  invalid all-`FF` filler rather than an explicit error.
- M15 acquired fresh measurement 23 completely without destructive scanner
  preparation: 5,773 valid blocks, no missing blocks, and no retries.

Not ready for universal production assumptions:

- 5,773 blocks across other firmware/scanners or AOX variants.
- Live 400-block/s pacing and when a requested block becomes readable.
- Completion based on `busy`, `last_measurement_nr`, or unsolicited traffic.
- Automatic destructive preparation. Production APIs must never hide
  `delete` or `erase-chip` inside measurement start/download.

## Minimal public interfaces

```ts
interface AoxMeasurementStart {
  measurementNumber: number;
  acknowledgedAt: string;
  acknowledgment: ParsedResponse;
}

interface DownloadAoxMeasurementOptions {
  profile?: AoxMeasurementProfile;
  range?: number; // default 150; hard maximum 600
  maxMissingRangeRetries?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  beforeRead?: (start: number, range: number, attempt: number) => Promise<void>;
  onProgress?: (result: AoxReassemblyResult, read: AoxFlashReadRecord) => void;
}

interface RawAoxMeasurementArtifact {
  scannerSerial?: string;
  measurementNumber: number;
  profile: AoxMeasurementProfile;
  type: "aox";
  startedAt: string;
  completedAt: string;
  blocks: readonly ValidatedAoxBlock[];
  originalBase64Blocks: readonly string[];
  measurementBlocks: string;
  missingRanges: readonly LogicalRange[];
  anomalies: readonly AoxBlockAnomaly[];
  summary: AoxValidationSummary;
  reads: readonly AoxFlashReadRecord[];
  failure: { kind: "incomplete"; message: string } | null;
}

class BioZoomScanner {
  startAoxMeasurement(): Promise<AoxMeasurementStart>;
  downloadAoxMeasurement(
    measurementNumber: number,
    options?: DownloadAoxMeasurementOptions,
  ): Promise<RawAoxMeasurementArtifact>;
}

function validateAndReassembleAoxBlocks(
  observations: readonly RawFlashBlockObservation[],
  options: AoxReassemblyOptions,
): AoxReassemblyResult;
```

`validateAndReassembleAoxBlocks()` is pure: no transport, clock, retry,
or scanner dependency. It preserves malformed and duplicate observations as
anomalies, never silently overwrites a valid block, applies the explicit
duplicate-initial-index policy, and succeeds only when every required logical
index is present.

`downloadAoxMeasurement()` owns bounded reads and missing-only retry policy but
does not interpret sensor payloads or calculate AOX. `startAoxMeasurement()`
does exactly one start command and does not poll, delete, or erase. A separate
orchestration layer may combine start, pacing, download, and UI/human events.
The former M1 start, measurement-21 downloader, and M15 orchestration methods
remain available with deprecation annotations so the diagnostic CLI and
hardware evidence paths continue to work.

## Application workflow boundary

`@nutriscan/workflows` now owns Quick AOX orchestration. It requires explicit
hand-position confirmation, calls `startAoxMeasurement()` once, requires
complete acquisition, and only then performs the paired scoring sequence
through an abstract backend gateway. Quality outcomes never automatically
repeat measurement. See `docs/quick-aox-workflow.md`.

## Experiment M15 gate

The scanner-test application prepares a single-use M15 action available only
after successful V2 identification. Clicking its explicit “Hand Is Ready”
button is the human authorization that immediately begins one measurement. A
separate button records visible scanner completion while reads continue. Its
local JSON artifact includes baseline/final status, complete acknowledgment,
measurement number, range timing, first/final block timing, anomaly classes,
exact blocks and `MeasurementBlocks`, and raw TX/RX bytes.

The permissioned Node diagnostic CLI invokes the same scanner-layer M15 method.
It identifies and records baseline status first, then waits indefinitely at
`Position hand on scanner. Press ENTER when hand is ready.` Only ENTER releases
the scanner-layer gate before the single measurement command. Acquisition then
continues without another stdin prompt; visible completion can still be recorded
by the browser harness, while the Node transcript records the full live artifact,
raw transport evidence, exact `MeasurementBlocks`, and its SHA-256 digest.
