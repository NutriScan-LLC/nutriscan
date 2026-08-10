# VitalityCheck 0.50.107 measurement workflows

## Scope and evidence

This document records a second static-analysis pass over `VitalityCheck-develop-0.50.107.apk`. No scanner command or BioZoom network request was made. These findings are not hardware confirmation and must not be promoted to `protocol.md` without a corresponding hardware observation.

Evidence labels used below:

- **APK-confirmed** — directly present in decompiled Java or in original TypeScript recovered from the APK's `assets/www/main.js.map`.
- **Strongly inferred** — the conclusion follows from several APK-confirmed paths, but the complete runtime configuration or server implementation is unavailable.
- **Unknown** — the APK does not resolve the question.

Source citations of the form `src/...` refer to original TypeScript paths embedded in `assets/www/main.js.map`. Native citations refer to files under the JADX output in `reverse-engineering/work/vitalitycheck-jadx`.

### Configuration limitation

**APK-confirmed:** `src/environments/environment.ts:17-20` initializes `appDesignConfigs`, `appDesignSettings`, `appDesignLanguages`, and `appDesignName` as undefined. The app restores/downloads an application-design configuration that supplies the page/stage graph and may override settings and messages. `src/app/services/gen-config.service.ts:175-244` maps configured stage names such as `measureAOX`, `measureHeart`, `measureHeartTest`, `uploadDataAOX`, and `uploadDataHeart` to implementation methods.

Consequently, this document can state what each implementation method does. Exact page ordering, which configured error page follows a rejected measurement, and customer-specific copy remain **unknown** unless the successful runtime configuration is also captured. The English strings bundled in `assets/www/assets/i18n/en-US.json` are confirmed fallbacks/resources, not proof that every one is shown by the current downloaded design.

## AOX quality-control state machine

### Active quick-AOX decision

**APK-confirmed:** after each AOX block set is uploaded, `src/app/services/scanNutrition/scan-nutrition-singles.ts:194-230` stores the complete server response, calls `processMeasurementAox`, merges error data, and appends the result before applying the client quality decision.

The active decision in `scan-nutrition-singles.ts:231-400` is:

```text
server response
  |
  +-- aox_q >= 50?
  |     |
  |     +-- 100 -> prototype/data-received stage; reject current step
  |     +-- 90  -> battery stage; reject current step
  |     +-- 80  -> low-LED-voltage stage; reject current step
  |     +-- 70  -> transmission/checksum stage; reject current step
  |     +-- 60  -> severe light/handling stage; reject current step
  |     +-- 50  -> surrounding-light stage; reject current step
  |     +-- other >= 50 -> generic error stage; reject current step
  |
  +-- aox_q < 50
        |
        +-- scanner battery passes prewarning check -> accept
        +-- otherwise -> battery stage; reject current step
```

The `switch` also contains cases 45 and 44, but they are nested under `if (res.aox_q >= 50)` and are therefore unreachable. This is dead code, not an operative threshold.

The app's `BiozoomError` mapping and configured `onErrorNN` stages determine the final page. The code returns a rejection result for every handled `aox_q >= 50`; it does not merely warn and continue.

### Field-to-behavior table

| Server/result field | Exact client comparison or calculation | Active app behavior | User-facing meaning in bundled English resources | Evidence |
|---|---|---|---|---|
| `aox_q` | `< 50` | Accept, subject to scanner battery prewarning | No quality warning selected by this branch | APK-confirmed |
| `aox_q` | `== 50` | Reject; execute `onError50` or `LIGHT_50` | Surrounding light entered sensor; thenar did not fully cover it, or bright light passed through hand | APK-confirmed |
| `aox_q` | `== 60` | Reject; execute `onError60` or `LIGHT_60` | Handling error; hand did not cover sensor perfectly or moved | APK-confirmed |
| `aox_q` | `== 70` | Reject; execute `onError70` or `ERROR_70` | Data corrupted during internet transmission/checksum; repeat | APK-confirmed |
| `aox_q` | `== 80` | Reject; execute `onError80` or `ERROR_80` | Low battery/LED voltage; recharge | APK-confirmed |
| `aox_q` | `== 90` | Reject; execute `onError90` or battery error | Low scanner battery/unreliable measurement; recharge | APK-confirmed |
| `aox_q` | `== 100` | Reject normal flow; execute `onError100` or `ERROR_100` | Prototype/data-received thank-you message | APK-confirmed |
| `aox_q` | any other value `>= 50` | Generic error/rejection | Configuration-dependent | APK-confirmed |
| `error_prediction.qnn_error` | Copied without thresholding into `measurement_errors` | Available to generic configured error ranking | No field-specific bundled message found | APK-confirmed |
| `error_prediction.positional_error_scaled` | Copied without thresholding | Generic ranking may label it as relevant when `> measurementErrorThreshold` | Hand-position interpretation is strongly inferred from its name; exact message unknown | APK-confirmed / strongly inferred |
| `error_prediction.individual_brightness_error` | Copied without thresholding | Generic ranking may use it; deprecated mapper also associates it with three categories | Brightness/motion/individual brightness in deprecated mapper | APK-confirmed |
| `error_prediction.brightness_to_median_error` | Copied without thresholding | Generic ranking only | Exact UI meaning unknown | APK-confirmed |
| `error_prediction.brightness_leakage` | Copied without thresholding | Generic ranking only | Light leakage is strongly inferred; exact UI message unknown | APK-confirmed / strongly inferred |
| `error_prediction.pressure_too_low` | Copied without thresholding | Generic ranking only | Pressure too low is strongly inferred; no direct active branch found | APK-confirmed / strongly inferred |
| `error_prediction.pressure_too_high` | Copied without thresholding | Generic ranking only | Pressure too high is strongly inferred; no direct active branch found | APK-confirmed / strongly inferred |
| `error_prediction.brightness_jitter` | Copied without thresholding | Generic ranking only | Brightness instability is strongly inferred; exact UI message unknown | APK-confirmed / strongly inferred |
| `measurement_errors.repetition_error` | Locally calculated for the latest result in a series | Generic series ranking | Repeatability/outlier meaning | APK-confirmed |
| `measurement_errors.motion_error` | Locally calculated only when `secondary_aox` exists | Generic series ranking | Motion meaning is inferred from the field and deprecated mapping | APK-confirmed / strongly inferred |
| `total_error` | Explicitly excluded from generic per-error aggregation | Does not independently cross the generic threshold | None found | APK-confirmed |
| `self_check` | No consumer found in original TypeScript or relevant native code | None identified | A self-test image resource exists, but no result-field decision was found | Unknown |

### Error-prediction processing

**APK-confirmed:** `src/app/methods/measurement.ts:56-91` copies these server values into `measurement_errors`: `qnn_error`, `positional_error_scaled`, `individual_brightness_error`, `brightness_to_median_error`, `brightness_leakage`, `pressure_too_low`, `pressure_too_high`, and `brightness_jitter`. This method currently returns `true`; a TODO notes that critical handling logic has not been implemented there.

The other consumer is `src/app/methods/error.ts:56-124`. `mergeErrors` recursively combines `measurement_errors`, `secondary_aox`, and `error_prediction`; an existing numeric value is retained with weight `0.97` and a new value contributes `0.03`. The same smoothing is applied to top-level `aox`, `aox_q`, `pressure`, `veggie_result`, and `aox_decimal`. Null/undefined new values are ignored, and a previously absent value is copied directly. `scan-nutrition-singles.ts` invokes this merger while accumulating results. This is aggregation, not a quality threshold.

`src/app/services/scanGeneric/scan-generic-singles.ts:452-455` extracts each stored response's complete `error_prediction` into the precision request's `series_errors`. `aox_q` is additionally consumed by the active decision, secondary-response averaging, result/export formatting, CSV/file storage lists, demo fixtures, and precision `series_q`. No further field-specific acceptance comparisons were found.

`src/app/services/genericStages/generic-stages.service.ts:1221-1253` provides a configurable presentation/ranking operation:

- threshold is `measurementErrorThreshold ?? 0.2`;
- numeric values and object values under `.error` are supported;
- only values strictly greater than the threshold are retained;
- retained errors are sorted descending and exposed as `error1`, `error1Value`, and so on.

For a series (`generic-stages.service.ts:1256-1370`), `total_error` is ignored, each measurement is compared with the same strict `>` threshold, positive values are summed and divided by the full series length, and errors are ranked by descending average. This operation prepares state for configured pages; it is not by itself an unconditional rescan decision.

An older mapper, `src/app/methods/measurement.ts:21-47`, treats an error as present at `>= 0.5` and maps:

- `repetition_error` to repetition;
- `motion_error` or `individual_brightness_error` to motion;
- `individual_brightness_error` to brightness;
- `positional_error_scaled` to position;
- `individual_brightness_error` again to individual brightness.

However, the caller in `scan-nutrition-singles.ts:231-233` comments out `getErrorCountAox(res)` and replaces it with `const errorTypes = []`. These `0.5` classifications therefore do not drive the active quick-AOX decision in this build. The repeated use of `individual_brightness_error` may be legacy behavior or a defect.

### Secondary and repeated-measurement errors

**APK-confirmed:** when a server response includes `secondary_aox`, `processMeasurementAox` calculates:

```text
motion_raw    = max(0.1, abs(secondary_aox.aox - aox) / 2) * 0.5
motion_scaled = round2(motion_raw / 0.15)
motion_error  = round2((motion_raw - 0.15) / 0.15)
aox           = floor(((primary aox + secondary aox) / 2) * 10) / 10
aox_q         = round(((primary aox_q + secondary aox_q) / 2) / 10) * 10
```

For the latest result in a series, `src/app/methods/measurement.ts:100-137` computes repetition error from both the closest prior AOX and the deviation from the overall mean:

```text
raw    = 0.25 * abs(latest - series_mean)
       + 0.75 * min(abs(latest - each_prior)) * 0.5
scaled = round2(raw / 0.15)
error  = round2((raw - 0.15) / 0.15)
```

Only the latest result receives this locally calculated `repetition_error`.

### User-facing rescan/error messages

The bundled English resource `assets/www/assets/i18n/en-US.json` contains:

| Localization key | English meaning |
|---|---|
| `ERROR.LIGHT_50.heading/text` | Error code 50. Surrounding light reached the sensor because the thenar did not cover it or bright light passed through the hand. |
| `ERROR.LIGHT_60.heading/text` | Error code 60. Internal quality check indicates incorrect handling; incomplete coverage or movement. |
| `ERROR.ERROR_70.heading/text` | Error code 70. Data corruption/checksum during internet transmission; repeat measurement. |
| `ERROR.ERROR_80.heading/text` | Error code 80. Measurement incorrect due to low battery; recharge. |
| `ERROR.ERROR_90.heading/text` | Error code 90. Measurement incorrect due to low battery; recharge. |
| `ERROR.ERROR_100.heading/text` | “Many Thanks!” and confirmation that data was received. |
| `ERROR.PULSE.heading/text` | Pulse could not be determined. |
| `MEASUREMENT.INSTRUCTIONS.H3_WARNING_TEXT` | Bright light or premature hand removal; the last measurement will be repeated. |
| `MEASUREMENT.INSTRUCTIONS.H3_OK_TEXT` | Align the hand, cover the sensor completely, and ensure no light or white space is visible. |

**APK-confirmed:** the active `aox_q` switch is exclusive, so its numeric cases have no multi-error priority problem. Generic error-prediction ranking sorts by descending value. **Unknown:** the exact priority between configured scanner, battery, network, and quality pages in the current downloaded application design.

`aox_q` is not used to numerically alter a quick score except when it is averaged with `secondary_aox.aox_q`. It is included in exports/result URLs (`src/app/methods/result.ts:6-82`) and is sent as `series_q` for precision processing. It therefore affects both rescan acceptance and downstream server input/display metadata.

## Precision AOX state machine

### Reconstructed workflow

**APK-confirmed**, except where marked:

```text
initialize precision series
  target scans = appDesignSettings.numMeasurementsAox, default 4

repeat until enough raw scans:
  acquire one AOX block set
  POST that scan independently to quick /measure/ (measure_type=0)
  store the returned AOX response and UUID
  apply the quick aox_q/error stage
  configured rejection path may delete the latest raw scan/result

when raw scans and quick results reach the configured target:
  build precision series request
    series_results = each accepted response.aox
    series_q       = each accepted response.aox_q
    series_uuid    = each response.uuid
    series_errors  = each response.error_prediction
    deleted_uuid   = UUIDs explicitly removed by a configured rejection path
  pre-request with measure_type=1
  POST one precision /measure/ request with MeasurementBlocks=""
  use server precise_aox and precision/quality fields
  optionally proceed into HRV for a Vitality workflow
```

### Scan count and rejection behavior

- **APK-confirmed:** default is four scans: `src/app/pages/home/home.helpers.ts:500-502` uses `appDesignSettings?.numMeasurementsAox ?? 4`. A configured step can override the number (`home.helpers.ts:742-744`).
- **APK-confirmed:** `src/app/services/scanGeneric/scan-generic-singles.ts:317-328` repeats acquisition while the raw-measurement count is below the target. Lines 393-423 repeat uploads until each acquired scan has a result, then route insufficient-count or success.
- **APK-confirmed:** `scan-generic-singles.ts:431-449` can delete the latest AOX result and corresponding raw measurement and records its UUID in `AOX_DATA_DELETED`.
- **Strongly inferred:** a scan rejected through that configured delete-and-repeat path does not count toward the required number. The precise condition that selects that path is configuration-dependent, and a rejected response is initially appended before the quality stage, so this cannot be generalized to every deployed design.
- **Unknown:** whether the currently deployed VitalityCheck design always uses four, or overrides the default.

### Submission and merge behavior

- **APK-confirmed:** every physical scan is submitted independently to the quick AOX endpoint. Multiple raw `MeasurementBlocks` strings are never concatenated or submitted together.
- **APK-confirmed:** the final precision request contains series values and UUIDs, not the raw blocks. `src/app/services/api/utils.service.ts:49-100` constructs multipart field `measure_json`; `src/app/services/api/api-basic.service.ts:223-245` uses an empty `MeasurementBlocks`, adds `AOX_extended_final: "yes"` and `measurement_type: "aox_precise"`, and includes the series data.
- **APK-confirmed:** `src/app/services/api/api-top.service.ts:97-118` performs a VWS pre-request with `measure_type=1` and then the precision request. The official implementation has retry/backoff (maximum five), though that behavior has not been adopted by NutriScan.
- **APK-confirmed:** precision POST target is `<recommended_server>/measure/?serial_id=<serial>&measure_type=1` (`src/app/services/api/connection.service.ts:102-124`).

Representative precision `AdditionalData` members are:

```json
{
  "AOX_extended_final": "yes",
  "measurement_type": "aox_precise",
  "series_results": ["one AOX value per accepted scan"],
  "series_q": ["one aox_q per accepted scan"],
  "series_uuid": ["one server UUID per accepted scan"],
  "series_errors": ["one error_prediction object per accepted scan"],
  "deleted_uuid": ["UUIDs explicitly discarded by the workflow"]
}
```

The request also carries app/config/timing/log metadata and configured additional data.

### `secondary_aox`, averaging, and final score

- **APK-confirmed:** `secondary_aox` belongs to an individual server response and is averaged with that response's primary `aox` using the floor-to-one-decimal formula documented above. It is not a second physical scan in the precision-series state machine.
- **APK-confirmed:** the client calculates repetition/motion diagnostics, but it does not calculate the final precision AOX by averaging or rejecting outliers.
- **APK-confirmed:** after the precision response, `scan-generic-singles.ts:783-803` sets displayed `aox` from server `precise_aox`, integer result from `precise_aox_floor_result`, and a one-decimal convenience value. `precise_aox_std`, `precise_quality_hand`, and `precise_quality_result` are server values.
- **APK-confirmed:** `processMeasurementPreciseAox` (`src/app/methods/measurement.ts:164-225`) normalizes error arrays and fills missing vegetable averages/categories, but does not derive the final AOX.
- **Unknown:** the server's averaging, weighting, outlier exclusion, and precise-quality formulas.

The client does fill a missing `veggie_01_avg` with the rounded mean of the series values and maps that average into legacy intake buckets: `<=150 -> 150`, `<=225 -> 175`, `<=275 -> 250`, `<=350 -> 300`, `<=400 -> 350`, otherwise `500`. This is ancillary result compatibility, not the precision AOX formula.

## Vitality workflow

### High-level flow

**Strongly inferred:** Vitality combines a precision AOX series with an HRV acquisition. This follows from:

- the common configurable stage engine exposing AOX, HRV test, HRV measurement, and upload operations;
- `src/app/services/scanHeart/scan-heart-observables.service.ts:388-533`, which adds a prior precision result as `use_aox` and `use_aox_q_precise` to the HRV request;
- `src/app/services/scanGeneric/scan-generic-singles.ts:697-722`, which treats a result containing both HRV and AOX data as a Vitality license/result and applies precision-series error information to it;
- bundled Home entries “Heart” (2 min) and “Vitality” (4 min).

The exact current page order is **unknown** because it resides in downloaded app-design configuration. A reasonable reconstruction is:

```text
collect/select demographic profile
  -> perform precision AOX series
  -> optional HRV pulse/pressure feasibility test
  -> acquire full HRV measurement
  -> upload HRV blocks + demographics + prior precise AOX
  -> receive server-calculated cardiovascular/Vitality result
  -> display in configured page or external vitality report
```

### HRV/scanner commands

All commands and counts in this section are **APK-confirmed but not hardware-confirmed**.

`src/app/services/scanHeart/scan-heart.service.ts:20-37` selects scanner measurement types:

| App operation | V2 measurement command/type | Expected logical blocks | Purpose in app |
|---|---|---:|---|
| HRV feasibility test | `measure?type=hrv-test` | 5,000 | Verify that a pulse can be measured/hand pressure is usable |
| Full HRV | `measure?type=hrv` | 45,000 | Acquire the HRV/Vitality raw signal |
| Legacy offline HRV | `hrvOfflineDo`, `hrvOfflineGet` abstractions | Device/API dependent | Older/offline scanner flow |

The V2 USB implementation is in `src/app/services/scanner/usb-api2.service.ts:439-572`; the Electron implementation is in `electron-usb-api.service.ts:691-790`. It starts the selected measurement, reads the acknowledged `measurement_nr`, and retrieves flash ranges using the shared block parser. The APK implementation also contains destructive preparation commands in this path; those commands are not endorsed here and have not been executed by this analysis.

For Wi-Fi scanners, `src/app/services/scanner/wifi.service.ts:114-245` uses legacy `hrv`, `hrvTest`, or offline operations for older devices and V2 `m?type=hrv` / `m?type=hrv-test` plus flash reads for newer devices.

`src/app/methods/blockFormat.ts:51-59` validates every decoded block using a big-endian declared length in bytes 0-1, little-endian internal index in bytes 2-3, and a zero CRC residual over bytes 2 through end. Lines 62-137 show a key HRV distinction: AOX applies the duplicate-initial-index remapping rule, while HRV does not; HRV marks logical presence using `internalIndex - 1`. The code does not impose an explicit 33-byte length here—declared length and CRC are authoritative in this parser. Exact observed HRV block size/content remains **unknown** pending hardware validation.

The native Cordova serial class does not implement AOX/HRV semantics. `sources/com/biozoom/serial/Serial.java:199-201` adds a `call-index` query parameter and later correlates responses (`Serial.java:849-850`); workflow/framing decisions remain in the Angular/TypeScript layer.

### HRV test and quality decisions

**APK-confirmed:** `scan-heart-observables.service.ts:55-164` gives `hrv-test` a 15-second client timeout, uploads it through the legacy HRV service, and interprets:

- `nextPage === "error_novalidlicense"` as no valid license;
- `hand_drauf === "1"` as success;
- any other `hand_drauf` as a bad measurement.

`src/app/services/api/api-top.service.ts:150-174` describes the test as determining whether pulse can be measured; excessive pressure can leave too little blood. The static implementation permits up to three retries after the initial attempt. The demo response is `hand_drauf: "1"`, `hand_score: "100"` (`demo-utils.service.ts:153-162`). The numeric meaning/threshold of `hand_score` is **unknown**; no client comparison was found.

For the full HRV response, `scan-heart-observables.service.ts:457-507` applies this exact, somewhat irregular logic:

| `hrv_q` | Behavior |
|---|---|
| `< 50` | Accept. A battery condition is written as `true || ...`, so the alternate battery rejection is unreachable. |
| `== 70` | Reject with `ERROR_70`. |
| `50 <= hrv_q < 70` | Reject with `LIGHT_60`. |
| `< 60` later branch | Unreachable because the preceding `< 70` branch already matched. |
| `>= 71` | Generic rejection/error. |

The lack of an explicit `hrv_q == 80/90/100` branch means those values reach the generic path in this method.

### Demographic data model

**APK-confirmed:** when a temporary profile is present, `scan-heart-observables.service.ts:388-533` adds:

```json
{
  "age": "profile age value",
  "weight": "profile weight value",
  "height": "profile height value",
  "male": "profile sex equals 'male'",
  "female": "profile sex equals 'female'",
  "me": "profile self/me flag"
}
```

The bundled English UI identifies the inputs as Age, Height in `cm`, Weight in `kg`, and Female/Male (`assets/www/assets/i18n/en-US.json`). No height or weight conversion was found in the submission path. Sex is encoded as two booleans derived from the strings `male` and `female`.

| Item | Conclusion |
|---|---|
| Age input | Value is sent as `age`; UI labels it Age. Exact allowed range/date-to-age derivation is configuration-dependent and unknown. |
| Height | Sent without conversion; bundled UI uses centimeters. |
| Weight | Sent without conversion; bundled UI uses kilograms. |
| Sex/gender | Profile string is tested against `male` and `female`; request contains corresponding booleans. Other encodings are unknown. |
| BMI | No local BMI calculation was found; response includes `bmi`. Server calculation is strongly inferred. |
| “Me” flag | Sent as `me`/self-profile metadata. Exact server role is unknown. |

### HRV and Vitality server contracts

**APK-confirmed:** unlike current VWS AOX scoring, HRV uses the legacy endpoint configured at:

```text
POST https://server.biozoom.org/measurement_derma/service/measurement_hrv.html
Content-Type: application/x-www-form-urlencoded; charset=utf-8
```

`src/app/services/api/api-basic.service.ts:258-281` and `src/app/services/api/utils.service.ts:49-100` build fields:

| Field | Content |
|---|---|
| `Serial` | Scanner serial |
| `MeasurementBlocks` | URL-encoded HRV block representation |
| `UserID` | Application's fixed/user identifier source |
| `lang` | Selected two-letter language |
| `AdditionalData` | JSON containing profile, scanner status, app/config/timing/log metadata, UUID, and HRV markers |

Full HRV adds an `hrv: "true"` marker; test adds `hrv_test: "true"`. If a precision AOX result is available, the HRV upload includes `use_aox = precise_aox` and `use_aox_q_precise = precise_quality_result`. Every HRV measurement is sent separately; no evidence was found that AOX raw blocks and HRV raw blocks are combined into one `MeasurementBlocks` field.

The static official app wraps HRV requests in retry behavior. This documents the APK; it does not define a recommended NutriScan policy.

### Response and displayed result fields

The client consumes or exports these HRV/Vitality response fields (`src/app/methods/result.ts:36-82`, `scan-heart-observables.service.ts`, and demo fixtures):

- pulse/variability: `mean_hr`, `hr_raw`, `std_nn`, `std_nn_raw`, `hrv_q`;
- derived cardiovascular classification: `hrv_bio_age`, HRV categories, `hr_age_gender_category`;
- body metrics: `bmi`, `bmi_age_gender_category`;
- combined result: `aox`, `aox_q`, `aox_int_result`, and precision AOX metadata when present;
- opaque/model fields: `product_j2bf`, `x`, `x2`, `x3`, `x4`, `x6`, `y`, `y2`, `y3`, `y4`, `y6`;
- navigation/reporting: `nextPage`, `url`, `hrv_report_url`.

**Strongly inferred:** heart rate, HRV metrics, BMI, biological age, and the categorical/model outputs are calculated by BioZoom's server. The client submits raw scanner blocks and demographics and contains routing/formatting logic, but no signal-processing or BMI formula was found.

The bundled UI instructs the user to sit with elbow and arm supported, relax the hand/arm, breathe in a ten-second rhythm, avoid speaking, and avoid movement (`MEASUREMENT.HEART.*`). Results can be routed to a server-supplied report URL or the configured Vitality report base URL (`src/environments/environment.ts:35`, `src/app/methods/result.ts`). Exact current result-page content remains configuration/server dependent.

## What NutriScan can reproduce now

Based on hardware work documented elsewhere and this APK-only analysis:

- **Hardware-confirmed elsewhere:** NutriScan can start and completely retrieve a V2 AOX measurement, validate all 5,773 logical blocks, and reconstruct the exact AOX `MeasurementBlocks` representation.
- **APK-confirmed contract, partly runtime-confirmed elsewhere:** NutriScan can construct the quick-AOX scoring proposal and permissioned scoring diagnostics without putting server scoring into `packages/scanner`.
- **APK-confirmed only:** the client-side `aox_q` decision, secondary-AOX normalization, local repetition diagnostics, precision-series request shape, HRV command names/counts, demographics encoding, and legacy HRV request shape can be independently implemented if and when authorized.
- **Not currently reproducible locally:** BioZoom's precision merge, quick-AOX score calculation, HRV signal processing, BMI/biological-age derivation, and categorical/model results are server-side or otherwise absent from the APK.

## What requires hardware experiments

No experiment is authorized or proposed for immediate execution by this document. Future narrowly scoped, human-gated work would be needed to confirm:

1. `measure?type=hrv-test` acknowledgment, duration, status behavior, actual block count, block size, and index range.
2. `measure?type=hrv` acknowledgment, duration, production rate, actual 45,000-block boundary, framing, and completion behavior.
3. Whether HRV uses the parser's apparent one-based internal indexing on this scanner/firmware.
4. Whether either HRV operation can run safely without the APK's destructive preparation commands.
5. Actual `hrv-test` response fields and the relationship of hand pressure, `hand_drauf`, and `hand_score`.
6. Whether a deployed precision workflow requires four scans and how its live configuration handles rejected scans.
7. Correlation of official and NutriScan-reconstructed payload hashes for the same precision/HRV measurement, if obtainable through legitimate diagnostics.

## Remaining unknowns

- The active downloaded app-design stage graph, per-customer threshold overrides, and exact currently displayed messages.
- Server-side meaning and scale of every `error_prediction` member, including `qnn_error` and brightness/pressure diagnostics.
- Any operative `self_check` response field; none was found in the client source.
- Why inactive cases 44/45 and unreachable HRV branches remain in the code.
- Whether `aox_q` values outside the enumerated cases occur in production and their full server semantics.
- BioZoom's precision averaging, weighting, outlier handling, and quality formulas.
- Whether rejected precision scans are always deleted, or can remain in a series under some downloaded design.
- Actual HRV flash framing/size/index behavior and whether 5,000/45,000 are invariant across firmware.
- Exact demographic validation ranges and any locale-specific unit conversion supplied by downloaded pages.
- The algorithms producing heart rate, HRV metrics, BMI, biological age, AOX/HRV combined results, and opaque model fields.
- Licensing rules and supported third-party access for the legacy HRV/Vitality endpoint.
- Whether the current deployed application uses the legacy HRV endpoint unchanged or overrides it through downloaded configuration.

## Implementation boundary

These findings remain reverse-engineering evidence. They do not establish production scanner protocol behavior, supported BioZoom API access, or a safe rescan policy. In particular, the APK's destructive preparation commands, retries, and client defects/unreachable branches should not be copied into NutriScan merely because they exist in the official application.
