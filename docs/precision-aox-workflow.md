# NutriScan Precision AOX workflow

## Evidence boundary

This implementation is based on original TypeScript recovered from VitalityCheck
0.50.107's `main.js.map`, the bundled application configuration, the
hardware-validated NutriScan Quick AOX lifecycle, and the separately successful
live `measure_type=1` pre-request diagnostic. No live Precision `/measure/`
submission has been performed by NutriScan.

## Implemented lifecycle

The configured default is `DEFAULT_PRECISION_AOX_MEASUREMENT_COUNT = 4`, matching
the APK-bundled fallback. It is an explicit workflow option.

For each planned series position, NutriScan invokes the existing Quick AOX
workflow unchanged:

1. reuse/connect and identify the Web Serial scanner;
2. wait for an explicit user Begin action for the first measurement or an
   explicitly authorized replacement; planned measurements 2–4 proceed directly
   to the place-hand prompt;
3. detect hand presence;
4. start exactly one ordinary `measure?type=aox` operation;
5. acquire and validate all 5,773 blocks using the production pacing;
6. detect hand removal;
7. Quick pre-request and submission with `measure_type=0`;
8. apply the existing `aox_q` interpreter;
9. retain an accepted normalized AOX, `aox_q`, response UUID, and
   `error_prediction` when present.

A rejected constituent never advances the planned series position. The workflow
waits for explicit replacement authorization. Only then is the rejected UUID,
when present, added to `deleted_uuid`, and a replacement attempt planned. No
scanner delete command is sent. Failure and cancellation terminate the series;
neither triggers an automatic retry or physical stop command.

## Final APK-confirmed merge contract

After the configured number of accepted results, NutriScan performs the existing
Precision pre-request (`measure_type=1`), waits the returned `waiting_time_ms`,
and submits one multipart `measure_json` to the returned HTTPS server using
`measure_type=1`.

Confirmed final fields:

- `MeasurementBlocks: ""` (raw blocks never enter the final merge request);
- a new UUID for this merge request;
- `model: "MRSRRS_SCN06"` for the confirmed 2E/2N mapping;
- `measurement_type: "aox_precise"`;
- `AOX_extended_final: "yes"`;
- index-aligned `series_results`, `series_q`, `series_uuid`, and `series_errors`;
- `deleted_uuid` containing only explicitly replaced response UUIDs.

The server and browser both validate the response. `precise_aox` is required and
finite. `precise_aox_floor_result`, `precise_aox_std`, and
`precise_measurements_std` are validated as finite numbers when present.
`precise_quality_hand` and `precise_quality_result` are preserved exactly without
NutriScan acceptance thresholds because no universal threshold is confirmed.
The complete response remains in memory only.

## Deliberately omitted uncertain metadata

The APK can add `app_version`, downloaded design `config`, local timestamps,
`localLog`, configured `additionalData`, `burn_the_evidence`, scanner status
snapshots, and license-accounting state. NutriScan does not impersonate or invent
those values. They remain optional/unknown until a controlled runtime observation
proves they are required by the production Precision endpoint.

## Safety and persistence

- React components issue no scanner commands.
- Precision introduces no physical scanner command; it composes ordinary Quick
  AOX runs.
- There are no delete, erase, reset, restart, firmware, stop, or preparation
  commands in the workflow.
- The authorized port, transport, scanner, and Quick workflow instance are reused
  across healthy constituent scans and deliberate quality replacements.
- Raw MeasurementBlocks, raw Quick responses, and the raw Precision response are
  never placed in URLs, logs, analytics, or browser persistence.
- Series and final evidence are held in memory only. Precision history persistence
  is intentionally deferred.
