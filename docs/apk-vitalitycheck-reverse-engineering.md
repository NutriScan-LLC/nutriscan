# VitalityCheck Android APK reverse-engineering report

## Scope and evidence

Analyzed artifact: `reverse-engineering/VitalityCheck-develop-0.50.107.apk`

- SHA-256: `a48ef80ef1263ce3e33e59536df049d0fa80013fe02de49b5bfbc36dbbb7b463`
- Tool: locally installed jadx
- Generated output: `reverse-engineering/work/vitalitycheck-jadx/` (ignored)
- jadx completed with 84 decompilation warnings/errors, but extracted the web
  bundle, its source map, and the native Cordova serial plugin. The source map
  contains the application's original TypeScript source names and contents.

The citations below use those original source-map paths and line numbers.
They are evidence from this APK version, not claims about every app version,
scanner, or firmware.

## Apparent AOX measurement sequence

1. **APK CONFIRMED — route to the V2 scanner implementation.**
   `ScannerVersionApiService.measure()` selects the Electron, Web Serial,
   Cordova USB V2, or Wi-Fi adapter based on runtime connection state.
   (`src/app/services/scanner/scanner-version-api.service.ts:131-164`)

2. **APK CONFIRMED — destructive preparation exists in the official flow.**
   The Cordova V2 path sends `delete` before measuring on the ordinary branch.
   Another firmware-dependent branch sends `erase-chip`, then polls `status`
   every 1,000 ms until `busy` is false. Electron and Web Serial paths also
   send `delete`. These actions were not and must not be reproduced under the
   current read-only hardware authorization.
   (`src/app/services/scanner/usb-api2.service.ts:476-506`;
   `electron-usb-api.service.ts:731-741`;
   `web-usb-api.service.ts:871-879`)

3. **APK CONFIRMED — start command.** Full/default AOX sends
   `measure?type=aox`; the alternate front-half mode sends
   `measure?type=aox-half`. A default initializer mentions `aox-prod`, but the
   switch's default overwrites it with `aox`. The Cordova plugin appends the
   generated `call-index` and LF terminator for V2.
   (`usb-api2.service.ts:439-469,506-508`;
   `com/biozoom/serial/Serial.java:190-207`)

4. **APK CONFIRMED — start response consumption.** After 250 ms, the flow
   waits for the command response, parses JSON, and consumes only
   `measurement_nr` as the flash-record number. No completion/success/type
   field from that response is used in this path.
   (`usb-api2.service.ts:513-529`)

5. **APK CONFIRMED — no status completion polling in the ordinary AOX path.**
   Flash retrieval begins after the acknowledgment. The app estimates produced
   blocks as `floor(elapsedSeconds * 400)`, defers a read if that estimate has
   not passed the next missing start, and limits the requested range to the
   estimate. The repeated observable is the progress/download loop.
   (`usb-api2.service.ts:531-572`)

6. **APK CONFIRMED — fixed expected totals.** Full AOX expects 5,773 logical
   blocks; front-half expects 2,887. HRV constants in the same implementation
   are 45,000 and 5,000. The AOX total is not derived from `start_block`,
   `data_blocks`, `data_blocks_index`, status, or a terminator.
   (`usb-api2.service.ts:439-470`)

7. **APK CONFIRMED — flash request loop.** It starts with missing range
   `[0,150]`, sends
   `read-flash?nr=<measurement_nr>&block=<missingStart>&range=<range>`, and
   repeats. Cordova V2 caps a request at 600 blocks. Failed/invalid responses
   leave the missing set for a later repeat; there is no small fixed retry
   count in this loop. Serial response wait is `250 + 2 * requestedBlocks` ms.
   (`usb-api2.service.ts:470-475,537-569`;
   `serial-dispatcher.ts:153-176`)

8. **APK CONFIRMED — block validation.** Each JSON `data` string is unquoted,
   Base64-decoded with `atob`, and interpreted as:
   two-byte big-endian length; two-byte little-endian internal index; payload;
   trailing CRC bytes. Length is valid when bytes 0-1 equal `byteLength - 2`.
   CRC uses polynomial `0x1021`, initial `0xFFFF`, over bytes 2 through end;
   a valid complete block has residual zero.
   (`src/app/methods/blockFormat.ts:41-59,142-175`)

9. **APK CONFIRMED — duplicate index 1 special case.** For non-HRV data, the
   first valid block whose internal index is 1 is assigned logical index 0.
   If logical 0 already exists and logical 1 does not, another first-in-response
   index 1 is assigned logical 1. This exactly explains the observed first two
   measurement blocks both carrying internal index 1.
   (`blockFormat.ts:71-87`)

10. **APK CONFIRMED — repair, order, and end condition.** Valid blocks are
    stored by logical index in a dictionary and marked in a boolean array.
    Missing indexes are coalesced into ranges, allowing gaps of up to 600
    present blocks inside a repair range. Completion is exactly the dictionary
    containing the hard-coded expected block count. Entries are numerically
    sorted, their original Base64 strings are returned, and the caller joins
    them into one string.
    (`blockFormat.ts:88-137`; `usb-api2.service.ts:558-566`)

11. **APK CONFIRMED — score is server-produced.** The joined Base64 block
    string is stored as measurement data and passed as `MeasurementBlocks` to
    BioZoom's VWS or legacy measurement endpoint. The server response supplies
    fields including `aox` and `aox_q`; client code then merges secondary
    results and computes display/error aggregates. No raw-block-to-AOX formula,
    calibration table, or biological scaling algorithm is present in the
    traced client path.
    (`scan-nutrition-singles.ts:90-120,161-230`;
    `src/app/services/api/utils.service.ts:49-123`;
    `api-basic.service.ts:147-210`;
    `src/app/methods/measurement.ts:50-90`)

## Field and behavior findings

- **APK CONFIRMED:** `measurement_nr` from the start acknowledgment selects
  the subsequent flash record.
- **APK CONFIRMED:** `last_measurement_nr` is not used by the traced V2 AOX
  acquisition path.
- **APK CONFIRMED:** `start_block`, `data_blocks`, and `data_blocks_index` are
  not read by the download algorithm; integrity and progress are based on the
  decoded internal indexes and the fixed expected total.
- **APK CONFIRMED:** no unsolicited scanner-message mechanism participates in
  the traced Cordova V2 flow. The native plugin writes a command, emits an
  interim acknowledgment to JavaScript, and later completes the callback with
  the received response. This does not prove the firmware never emits data.
- **APK CONFIRMED:** ordinary measurement completion is not established by
  polling `status`. The only status/busy loop near this code belongs to the
  destructive `erase-chip` preparation branch.
- **INFERRED:** the 400-block/s estimate is a pacing model for flash becoming
  readable during measurement, allowing download to overlap acquisition.
- **UNKNOWN:** semantic layout of the 27 payload bytes inside each 33-byte
  transport block. The APK treats them as opaque measurement material.
- **UNKNOWN:** why a full AOX measurement is exactly 5,773 blocks, and whether
  that constant varies with firmware not represented by this APK.

## Comparison with hardware experiments

- Exact match: M1 observed `measure?type=aox` and a response carrying
  `measurement_nr`; that is the APK's full/default V2 start contract.
- Exact match: M4-M12 Base64 blocks are 33 bytes, bytes 0-1 declare 31,
  bytes 2-3 are little-endian indexes, and CRC residual over bytes 2-end is
  zero, matching `checkBlock()`.
- Exact match: M8's duplicate initial raw indexes 1,1 are explicitly handled
  by the APK as logical indexes 0 and 1.
- Exact match: multi-block reads and range 150 are the APK's initial retrieval
  strategy. The APK can request up to 600 in its Cordova V2 implementation.
- Explanation: M8-M12 showed `data_blocks` tracking each request's exclusive
  end. The APK ignores that field, consistent with it not being the total used
  by official client logic.
- Discrepancy/variant: our M2/M3 status captures investigated `busy`; the APK's
  ordinary AOX flow does not use status to decide completion and instead reads
  flash while measurement data is expected to become available.
- Still unexplained by APK: response `start_block: 58`, response-side
  `data_blocks*` semantics, CRLF framing choice, and the 27-byte payload schema.

## Newly identified commands (APK evidence only)

Measurement-adjacent commands include `measure?type=aox-half`,
`measure?type=aox-prod` (initializer/default candidate), `measure?type=hrv`,
`measure?type=hrv-test`, and hand-recognition commands. The APK also contains
state-changing `delete`, `erase-chip`, mode/AP, update, and restart-related
commands. Their presence is not authorization to execute them.

## Subsequent hardware validation

Experiments M13/M14 and the complete measurement-21 retrieval validated the
APK-derived boundary on scanner `2N2400A5B70F5E3C9251`. Block 5772 was valid;
block 5773 was an invalid all-`FF` element; and 39 bounded reads reconstructed
all 5,773 logical blocks with no anomaly or retry. The concatenated output was
254,012 characters—the exact full-measurement length used by the APK's own
full-versus-half check (`scan-nutrition-singles.ts:108-114`). Its SHA-256 is
`4e278d59b883e78d1100a89385f618e6bb3061421b83b4664b5a0a093a51ee5a`.

## BioZoom server boundary (static APK evidence only)

The expanded scoring transaction, field classification, runtime-only header
questions, license/session analysis, and safe official-app observation plan are
maintained in `docs/biozoom-scoring-transaction.md`.

### VWS path used first

- **APK CONFIRMED:** the app first sends an unauthenticated HTTP GET to one of
  its configured VWS base URLs at
  `/pre-request/?serial_id=<scannerSerial>&measure_type=0`. The typed response
  supplies at least `recommended_server`, `waiting_time_ms`, and optional
  pre-request timing fields. The request has a 2,000 ms timeout and the
  high-level flow retries with backoff up to five times.
  (`api-basic.service.ts:110-144`; `api-top.service.ts:29-58`;
  `environment.ts:45-52`)
- **APK CONFIRMED:** it then POSTs to
  `<recommended_server>/measure/?serial_id=<scannerSerial>&measure_type=0`.
  The body is browser-generated `multipart/form-data`; no manual Content-Type
  is set, allowing the runtime to add its boundary. No Authorization, API-key,
  cookie, or other authentication header is added by this measurement path.
  (`connection.service.ts:59-90`)
- **APK CONFIRMED:** the multipart field is named `measure_json` and contains
  a JSON file named `measure.json`. Its exact top-level shape is:
  `{ "Serial": string, "MeasurementBlocks": string,
  "UserID": "ffffffffffffffffffffffffffffffff", "lang": string,
  "AdditionalData": string }`. `AdditionalData` is itself JSON serialized
  into a string.
  `MeasurementBlocks` is the exact concatenation of ordered original Base64
  block strings. For a `2N` scanner, generated additional data includes model
  `MRSRRS_SCN06`, `veggie_04: true`, a per-request UUID, and
  `measurement_type: "aox"`; the caller also supplies status-before/after,
  application/config metadata, local time/log data, and AOX subtype.
  (`utils.service.ts:49-100`; `scan-nutrition-singles.ts:176-200`)

### Legacy fallback path

- **APK CONFIRMED:** on failure, the app falls back to HTTP POST
  `https://server.biozoom.org/measurement_derma/service/measurement.html`
  with `Content-Type: application/x-www-form-urlencoded; charset=utf-8`.
  Its form body contains the same `Serial`, URL-encoded `MeasurementBlocks`,
  fixed application `UserID`, language, and JSON `AdditionalData` fields.
  This path also adds no measurement-specific authentication header and is
  retried up to five times.
  (`environment.ts:42-46`; `api-basic.service.ts:183-210`;
  `utils.service.ts:87-123`; `connection.service.ts:127-149`)

### Response and authorization conclusions

- **APK CONFIRMED:** the response is treated as an `AoxMeasurementResult` and
  client code consumes at least `aox`, `aox_q`, optional `secondary_aox`,
  `error_prediction`, and measurement-error fields. Transport or HTTP failures
  enter RxJS retry/fallback handling; the APK does not define a distinct
  scanner-protocol error schema for this server boundary.
  (`connection.service.ts:82-90,135-149`;
  `scan-nutrition-singles.ts:194-230`; `measurement.ts:50-90`)
- **APK CONFIRMED:** other unrelated application/configuration flows contain
  authentication support. No such token is attached by the traced quick-AOX
  measurement request. Credentials found elsewhere in the APK were neither
  extracted into project artifacts nor reproduced here.
- **APK CONFIRMED:** the UI checks locally loaded license/flatrate counters
  before starting measurement, and separate license-management requests can
  use a bearer JWT. The traced VWS pre-request and quick-AOX measurement POST
  do not attach that JWT. This suggests licensing is an application workflow
  dependency, but does not reveal whether the scoring service independently
  authorizes the scanner serial.
  (`measurement.ts:228-270`; `license.ts:5-55,60-82`)
- **UNKNOWN:** whether the deployed service applies network-side, scanner
  serial, license, rate, or other authorization not visible in this client.
- **UNKNOWN:** no code or documentation in the APK states that either endpoint
  is a public or third-party SDK API. Static evidence therefore does not
  support treating it as one.

No request was sent to any BioZoom server during this investigation.

## Production SDK proposal

Keep acquisition and server processing separate:

- `startAoxMeasurement(): Promise<AoxMeasurementStart>` sends the confirmed
  start command and exposes the complete response plus `measurementNumber`.
  Any destructive cleanup must be a separate, explicit policy outside this
  method—not an implicit SDK side effect.
- `observeAoxAcquisition(...)` should model progress conservatively. The APK's
  400-block/s pacing can inform an experimental strategy, but production code
  should tolerate blocks not yet available and should not equate status
  `busy` with the sole completion criterion.
- `downloadAoxMeasurement(measurementNumber, options)` performs bounded reads,
  validates every block, stores by logical index, retries only missing ranges,
  and returns a typed raw artifact or an explicit incomplete result.
- `validateAndReassembleAoxBlocks(...)` is a pure protocol utility implementing
  Base64 preservation, framing/CRC validation, duplicate-index handling,
  anomaly reporting, ordering, and exact `MeasurementBlocks` generation.
- `RawAoxMeasurementArtifact` exposes scanner identity, measurement number,
  timestamps, ordered original Base64, decoded bytes, validation metadata,
  raw transcript references, retries/anomalies, and `measurementBlocks`.

AOX scoring, server endpoint selection, authentication, upload, and result
interpretation should remain outside the scanner package.
