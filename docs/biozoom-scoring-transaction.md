# BioZoom official-app AOX scoring transaction

## NutriScan production pre-request diagnostics

NutriScan preserves the runtime-confirmed single GET contract and adds no
retry. The server applies the APK-confirmed 2,000 ms per-request timeout and
validates returned JSON before passing it to the browser. Failures are reduced
to a non-sensitive request ID, NutriScan HTTP status, diagnostic code, and
optional upstream HTTP status. Scanner serials, URL queries, response bodies,
credentials, MeasurementBlocks, and scoring payloads are neither returned nor
logged by this diagnostic path. Browser/user cancellation remains cancellation
and is not relabeled as an upstream timeout.

## Scope and evidence labels

This document describes static analysis of the official
`VitalityCheck-develop-0.50.107.apk` and its embedded TypeScript source map.
No BioZoom request was sent by NutriScan and no TLS validation was bypassed.

- **STATIC CONFIRMED** means the APK constructs or consumes the value in the
  traced quick-AOX path.
- **RUNTIME TO CAPTURE** means Android WebView or the deployed service decides
  the exact value.
- **SERVER REQUIREMENT UNKNOWN** means the official client always supplies a
  field, but static client code cannot prove the server rejects its omission.

## Transaction sequence

### 1. Configuration and license preparation

**STATIC CONFIRMED:** default VWS candidates are embedded in
`src/environments/environment.ts`. A downloaded application-design setting
named `calcURLs` can replace the candidate list at runtime. Application design
is fetched or restored from local storage by `loadAppConfig()`; the selected
design name and settings also contribute request metadata.

The same config-load flow calls the separate license service for the scanner
serial. That request may carry a bearer JWT sourced from persistent application
state. Credentials or token values are deliberately not reproduced here.

Before scanner measurement, `validateMeasurementAllowance()` checks locally
loaded license/flatrate/counter state. Curiously, absent or invalid local
license state does not itself block measurement; a valid limited license with
no remaining allowance does. Independently, a VWS pre-request HTTP 404 is
converted to the sentinel `license`, which stops scoring and does not enter the
legacy fallback.

### 2. VWS pre-request

The official quick-AOX path first tries:

```text
GET <candidate-base>/pre-request/?serial_id=<scanner-serial>&measure_type=0
```

**STATIC CONFIRMED request details:**

- `serial_id` is the connected scanner serial.
- `measure_type=0` denotes quick AOX.
- timeout: 2,000 ms per individual pre-request.
- no application-set Authorization, API-key, Content-Type, or cookie option.
- HTTPS candidates receive no custom request headers from this method.

Candidate failures rotate the configured list. The pre-request observable can
repeat when the response says `new_pre_request_req: true`, waiting at least 100
ms and otherwise using `new_pre_request_delay_ms`. The higher-level quick-AOX
chain also uses exponential retry with five retries.

The client reads these response fields:

```ts
interface ObservedPreRequestResult {
  recommended_server: string;
  waiting_time_ms: number;
  new_pre_request_req: boolean;
  new_pre_request_delay_ms: number;
}
```

The exact deployed response may contain additional fields. When
`new_pre_request_req` becomes false, `recommended_server` is passed directly to
measurement construction and `waiting_time_ms` is used only to emulate result
download progress. `recommended_server` is concatenated with `/measure/`; if
the resulting text does not begin with `http`, the client prefixes `http://`.
No allowlist or normalization is visible in this path.

### 3. VWS measurement request

```text
POST <recommended_server>/measure/?serial_id=<scanner-serial>&measure_type=0
Content-Type: multipart/form-data; boundary=<WebView-generated>
```

The body is browser-generated `FormData` with exactly one application-created
part:

```text
name="measure_json"
filename="measure.json"
Content-Type: application/json
```

The file contents are JSON:

```ts
interface OfficialMeasureJson {
  Serial: string;
  MeasurementBlocks: string;
  UserID: "ffffffffffffffffffffffffffffffff";
  lang: string;
  AdditionalData: string; // JSON serialized a second time
}
```

**STATIC CONFIRMED:** `MeasurementBlocks` is the exact concatenation of the
ordered original Base64 blocks. `lang` is the first two characters of the
selected application language; case is not normalized at this call site.
`UserID` is a fixed sentinel, not an application-login user ID. The scanner
serial occurs both in the URL query and JSON body.

The browser/WebView generates the multipart boundary and transport framing. The
application intentionally does not set multipart Content-Type manually.

### 4. AdditionalData

For the traced scanner/nutrition quick-AOX path, the caller creates:

```ts
{
  status_before: object,
  status_after: object,
  app_version: string,
  config: string | undefined,
  localTimestamp: number,
  localLog: unknown,
  aox_subtype: string,
  ...pipelineAdditionalData,
  model: "MRSRRS_SCN06",
  veggie_04: true,
  uuid: string,
  measurement_type: "aox"
}
```

Ordering/overrides matter:

1. status, version, config, an initial local timestamp, and local log are made;
2. pipeline-specific additional data is spread over them;
3. the upload call overwrites `localTimestamp` with `Date.now()` and adds
   `aox_subtype`;
4. metadata generation mutates the object to add scanner model flags, UUID v4,
   and `measurement_type`.

`AdditionalData` in `measure.json` is `JSON.stringify()` of this final object.
Properties whose values are `undefined` are omitted by JSON serialization.
The UUID is a new UUID v4 generated for the scoring request; it is not the
scanner protocol call-index, scanner serial, Android device ID, or license ID.

### 5. Headers, cookies, origin, and TLS

**STATIC CONFIRMED:** scoring uses Angular `HttpClient` through the Ionic
Cordova Android system WebView. No scoring-specific interceptor is present. The
POST does not set `Authorization`, an API key, `withCredentials`, or a manual
Content-Type. The pre-request likewise has no scoring authentication header.

The Cordova engine owns an Android `CookieManager`, but the scoring requests are
cross-origin and do not opt into credentials. Static evidence therefore
indicates application cookies are not intentionally sent with scoring. Runtime
DevTools should confirm the actual `Cookie` header is absent.

**RUNTIME TO CAPTURE:** exact default Android WebView User-Agent, `Origin`,
`Referer`, browser-added `Accept`/fetch headers, HTTP version, TLS version,
cipher, multipart boundary, and any ambient cookie behavior. No User-Agent
override is present in the packaged Cordova config. No certificate-pinning
implementation was found. Public HTTPS uses the Android system WebView network
stack and platform trust configuration.

### 6. Legacy fallback

For non-license failures in the VWS chain, the app falls back to its configured
legacy measurement URL. It POSTs
`application/x-www-form-urlencoded; charset=utf-8` with `Serial`, URL-encoded
`MeasurementBlocks`, fixed `UserID`, `lang`, and unescaped JSON
`AdditionalData`. This fallback has no explicit Authorization header. It is a
compatibility path, not evidence that NutriScan is authorized to call it.

### 7. Response handling

The VWS response body is treated as an AOX result. Runtime consumers establish
these known fields:

- `aox` and `aox_q`;
- optional `secondary_aox` with its own `aox` and `aox_q`;
- optional `error_prediction`, including `qnn_error`,
  `positional_error_scaled`, `individual_brightness_error`,
  `brightness_to_median_error`, `brightness_leakage`, `pressure_too_low`,
  `pressure_too_high`, and `brightness_jitter`;
- values used elsewhere such as `aox_int_result`, `pressure`, `veggie_result`,
  `veggie_01_avg`, `intake_category`, `demo`, `quality`, `result`, `nextPage`,
  `uuid`, and `url`.

The application synthesizes/updates `measurement_errors` after receipt and may
average `secondary_aox` into the displayed AOX result. `aox_q` values at or
above 50 are interpreted as scanner/measurement error categories by this UI.
Because the type-only interface is absent from the emitted source map and the
server can return additional JSON, the complete deployed response schema
remains a runtime-capture item.

Production parsing and the version-specific APK-compatible quality interpreter
are documented separately in `docs/quick-aox-quality.md`. The interpreter
preserves unknown response fields and keeps threshold routing independent from
whether NutriScan recognizes a code.

Transport/HTTP failures enter retry/fallback behavior. A pre-request 404 maps
to the application-level license outcome. Other server error-body schemas are
not fully specified by the static client.

## Required versus diagnostic classification

| Element | Client construction | Server requirement conclusion |
|---|---|---|
| HTTPS endpoint selected by pre-request | Required by code flow | Definitely operationally required |
| POST method and query `serial_id`, `measure_type=0` | Always sent | Strongly required; omission not tested |
| Multipart `measure_json` JSON file | Always sent | Strongly required |
| `Serial` | Always sent twice | Strongly required; likely authorization/routing input |
| `MeasurementBlocks` | Always sent | Definitely required for scoring |
| `UserID` sentinel | Always sent | Server necessity unknown; not login identity |
| `lang` | Always sent | Likely response localization; scoring necessity unknown |
| `AdditionalData` string | Always sent in VWS path | Container strongly expected; individual fields vary |
| `model`, `veggie_04`, `uuid`, `measurement_type` | Always added for this scanner/path | Likely backend routing/diagnostic inputs; exact necessity unknown |
| status before/after, app version, config, timestamps, local log, subtype | Always or normally supplied by this pipeline | Appear diagnostic/contextual; omission behavior unknown |
| Authorization header | Not sent by scoring path | Not a direct scoring requirement in this APK flow |
| Login cookie/session | Not opted into by scoring path | No static evidence of dependency |
| Scanner-side/app license | Checked separately; pre-request 404 means license failure | Legitimate workflow dependency; server-side serial authorization likely |

## Safe observation plan for the next official scan

The APK manifest is debuggable and the bundled Cordova engine enables Android
WebView remote debugging for debuggable applications. This makes WebView
DevTools the least invasive useful capture mechanism: it observes the app's own
decrypted request without a proxy or CA.

1. Enable Android Developer Options and USB or Wireless debugging on the tablet.
   Wireless debugging is preferable if the scanner occupies the USB port.
2. Pair/connect the tablet with `adb` using normal Android authorization.
3. Open the unmodified official app.
4. On the development Mac, open Chromium/Chrome `chrome://inspect/#devices` and
   inspect the WebView belonging to `net.biozoom.vitalitycheck2024`.
5. In Network, enable Preserve log. Record the page origin with
   `location.origin` and the runtime User-Agent with `navigator.userAgent`.
6. Perform one normal official AOX scan. Do not edit/replay any request.
7. Preserve the pre-request and measure request/response as a local HAR with
   content. Record the scanner measurement number separately from the scanner
   acknowledgment if the official UI/debug console exposes it.
8. Extract only locally: endpoint, request headers, multipart metadata,
   `measure.json`, response JSON, timing, and status. Do not publish cookies,
   tokens, local logs, or personal data.
9. Hash the official `MeasurementBlocks` locally and compare it with the SDK
   reconstruction of the same measurement number. Do not submit the SDK copy.

`adb logcat` is a lower-value fallback: the app logs high-level calculation and
errors but static code does not log the complete request body. A debugging
proxy is not currently recommended. The public-domain network security config
does not explicitly trust user-installed CAs, and there is no reason to rely on
debug-only SSL-error behavior when WebView DevTools is available. If DevTools
cannot inspect the request, stop and report that limitation; do not patch the
APK, defeat pinning, or alter TLS validation.

## Authorization conclusion

The official app's successful score proves the deployed service currently
accepts a legitimate transaction for this scanner. It does not prove the
endpoint is a public or third-party SDK API. No bundled documentation grants
such use, and static code shows scanner/license-specific workflow behavior.
NutriScan should obtain a documented BioZoom integration agreement covering
endpoint stability, scanner authorization, licensing/billing, permitted data,
privacy, credentials/session model, rate limits, and result schema before any
NutriScan-generated request is sent.

## Offline NutriScan request-construction diagnostic

`@nutriscan/scoring` now contains a pure local proposal builder. The permissioned
Node scanner CLI can feed it a newly completed `RawAoxMeasurementArtifact` via:

```text
npm run scanner:diag -- offline-score --port <explicit-port> --lang <two-letter-value> --execute
```

The action is dry-run unless `--execute` is present and pauses for explicit
ENTER before starting one measurement. Acquisition uses only the production
`BioZoomScanner.startAoxMeasurement()` and `downloadAoxMeasurement()` APIs.
The output transcript preserves the complete raw scanner artifact and proposed
multipart JSON, plus per-field classifications using the exact labels
`hardware confirmed`, `APK confirmed`, `runtime confirmed`, and
`still unverified`.

The proposed `measure_json` includes the hardware serial and reconstructed
`MeasurementBlocks`, APK sentinel `UserID`, explicit diagnostic language, and
an `AdditionalData` string containing the APK-confirmed minimum known for this
2N scanner path: `model`, `veggie_04`, a newly generated UUID v4, and
`measurement_type`. Official-app contextual fields that NutriScan cannot
truthfully reproduce—status snapshots, official app version/config/log, and
AOX subtype—are explicitly listed as omitted and still unverified. This means
the object is the closest evidence-supported proposal, not a claim that the
deployed server accepts the reduced metadata.

No `recommended_server` is invented: the expected pre-request URL is recorded,
while the measure URL remains a template until a legitimate pre-request result
exists. The offline builder and scanner CLI path do not invoke the separately
permissioned experimental HTTP diagnostics in `@nutriscan/scoring`.

## Runtime pre-request observation — 2026-08-09

An explicitly authorized NutriScan pre-request-only diagnostic made one GET for
scanner `2N2400A5B70F5E3C9251` to the APK-configured endpoint. It did not access
the scanner, send measurement data, or call `/measure/`.

Hardware/runtime-specific observation:

```text
Requested/final URL:
https://de2.biozoom.net/pre-request/?serial_id=2N2400A5B70F5E3C9251&measure_type=0
HTTP status: 200
Redirects: none
Cookie request header: absent
Authorization request header: absent
Set-Cookie response header: absent
```

The complete observed JSON response was:

```json
{
  "new_pre_request_req": false,
  "waiting_time_ms": 109,
  "new_pre_request_delay_ms": 0,
  "recommended_server": "https://de2.biozoom.net"
}
```

The only outgoing header recorded by Node's `ClientRequest` was
`Host: de2.biozoom.net`. The response contained no keys whose names indicated a
license or error. This confirms the recommended server and timing values for
this one runtime exchange only; it does not establish behavior for other
scanners, firmware, server configurations, dates, or official-app sessions.

## Runtime unpaired measurement observation — 2026-08-09

Approximately 7 minutes 57 seconds after the successful pre-request above, an
explicitly authorized NutriScan diagnostic submitted the unchanged reconstructed
payload for scanner `2N2400A5B70F5E3C9251`, measurement 35, directly to:

```text
POST https://de2.biozoom.net/measure/?serial_id=2N2400A5B70F5E3C9251&measure_type=0
```

The server returned HTTP 400 with JSON string body:

```text
0250: No pre-request was triggered for this serial_id before measurement call.
```

Runtime-confirmed conclusion: `/pre-request/` is not merely server discovery.
It establishes server-side state required by a subsequent `/measure/` call,
and the roughly eight-minute-old pre-request was no longer accepted for that
submission. There is no evidence that the service evaluated the measurement
payload, so this response does not support changing `MeasurementBlocks`,
`AdditionalData`, language, UUID, multipart structure, or any other payload
field.
