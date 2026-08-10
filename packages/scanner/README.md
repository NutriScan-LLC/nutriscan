# NutriScan scanner SDK

`@nutriscan/scanner` owns local scanner transport, BioZoom V2 protocol, and
validated raw AOX acquisition. It does not calculate an AOX score or communicate
with BioZoom services.

## Complete AOX measurement

```ts
import { BioZoomScanner, WebSerialTransport } from '@nutriscan/scanner';

const scanner = new BioZoomScanner(new WebSerialTransport({
  baudRate: 2_000_000,
  dataBits: 8,
  stopBits: 1,
  parity: 'none',
}));

await scanner.connect();
try {
  await scanner.identify();
  const started = await scanner.startAoxMeasurement();

  const artifact = await scanner.downloadAoxMeasurement(started.measurementNumber, {
    range: 150,
    maxMissingRangeRetries: 12,
    // Optional strategy hook. Choose pacing for the integration and hardware;
    // no universal production rate is assumed by the SDK.
    beforeRead: async (start, range, attempt) => {
      void start; void range; void attempt;
    },
  });

  if (!artifact.summary.complete) {
    throw new Error(artifact.failure?.message ?? 'AOX measurement incomplete');
  }

  // Pass artifact.measurementBlocks to a separate, authorized scoring service.
} finally {
  await scanner.disconnect();
}
```

`startAoxMeasurement()` requires an active scanner already identified as V2,
sends exactly one APK-style bare `delete`, waits for its strictly correlated
acknowledgment (at most 10 seconds), then sends exactly one
`measure?type=aox`. It validates the confirmed measurement acknowledgment and
preserves the complete parsed response. The firmware-side scope of `delete`
remains unknown. This path never retries preparation, performs a full-flash
erase, polls, downloads, or contacts a server.

`downloadAoxMeasurement()` uses bounded `read-flash` requests, validates and
orders blocks, retries only missing ranges, and returns an explicit incomplete
result if its retry budget is exhausted. Protocol and transport errors propagate
unchanged. The normal artifact contains validated block evidence and timing, not
the diagnostic CLI's multi-megabyte raw TX/RX transcript.

## Confirmed on tested hardware

Scanner `2N2400A5B70F5E3C9251` with sensor firmware 608 and Nuvoton firmware
0.5.4 confirmed:

- one full AOX profile contains 5,773 logical blocks;
- range 150 supports complete bounded retrieval;
- valid blocks use 33-byte framing, declared length 31, little-endian internal
  index, and CRC16-CCITT residual zero over bytes 2 through end;
- the first two logical blocks both carry internal index 1;
- temporary or boundary all-FF values are not valid measurement blocks;
- one APK-style bare `delete` restored physical AOX acquisition after the
  scanner acknowledged `measure?type=aox` without beginning acquisition;
- full-flash operations were not required.

## Configurable; not proven universal

The expected profile, logical block count, bounded range (maximum 600), retry
budget, timeout, abort signal, progress callback, and `beforeRead` pacing hook
are configurable. The default full profile and range are hardware-confirmed on
the tested scanner but are not claimed for every scanner, firmware, or future
AOX variant. Completion is based on obtaining the complete valid logical block
set—not `busy`, `last_measurement_nr`, visible bars, or a fixed production rate.

`validateAndReassembleAoxBlocks()` is the pure protocol utility for validating
stored observations without transport, scanner, clock, or network access.
