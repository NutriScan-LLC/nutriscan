/**
 * BioZoom Wi-Fi scanner HTTP command set (V2 firmware path).
 *
 * Evidence for every constant below:
 *  - APK: VitalityCheck-develop-0.50.107, src/app/services/scanner/wifi.service.ts
 *    (extracted from the bundled main.js.map). Line numbers refer to that file.
 *  - Capture: rvictl/tcpdump of one full Biozoom-app AOX scan on scanner
 *    2E249C6AFCEA6BE8D5FF, 2026-11-06 (see BIOZOOM_PROTOCOL_AND_IMPLEMENTATION.md,
 *    "WiFi Scanner Transport").
 *
 * The Wi-Fi API uses short paths (/d, /m, /h) instead of the USB command
 * names (delete, measure, hand) and has no call-index. Response JSON and the
 * 33-byte Base64 flash blocks are identical to USB (all 6,450 captured blocks
 * pass the confirmed CRC).
 */
import { parseResponseFrame, type ParsedResponse } from './response.js';
import type { HandRecognitionTarget } from './handRecognition.js';

/** APK wifi.service.ts:24 — per-request timeout for GET /status. */
export const WIFI_STATUS_TIMEOUT_MS = 2_500;
/** APK wifi.service.ts:25 — total time waitForScannerReady() polls /status. */
export const WIFI_READY_TIMEOUT_MS = 15_000;
/** APK wifi.service.ts:26 — delay between /status attempts while waiting. */
export const WIFI_READY_RETRY_DELAY_MS = 500;
/**
 * APK sends /d with no timeout (plain fetch, wifi.service.ts:178). We bound
 * it with the same 10 s already used for the USB bare delete.
 */
export const WIFI_DELETE_TIMEOUT_MS = 10_000;
/** UNVERIFIED bound: APK /m fetch has no timeout. Capture: answered in ~40 ms. */
export const WIFI_MEASURE_TIMEOUT_MS = 10_000;
/** APK wifi.service.ts:186 — wait after /m before starting the block clock. */
export const WIFI_POST_MEASURE_DELAY_MS = 250;
/** APK wifi.service.ts:332 — GET /h abort timeout. Capture: ~1 s per call. */
export const WIFI_HAND_TIMEOUT_MS = 2_000;
/**
 * APK wifi.service.ts:296-297 — firmware below these uses the legacy
 * /signal + parameterless /h path, which this SDK does not implement.
 */
export const WIFI_SAMPLED_HAND_MIN_WIFI_MAJOR = 10;
export const WIFI_SAMPLED_HAND_MIN_SENSOR_FIRMWARE = 604;

/** APK helpers.ts: SCANNER_APMODE_URL = 'http://192.168.4.1' (access-point mode). */
export const WIFI_ACCESS_POINT_BASE_URL = 'http://192.168.4.1';
/** APK wifi.service.ts:45. */
export const WIFI_STATUS_PATH = '/status';
/**
 * APK wifi.service.ts:178 sends /d immediately before /m. Capture: returns
 * text/plain "Deleted". Scope of the deletion is UNKNOWN (docs/unknowns.md).
 */
export const WIFI_DELETE_PATH = '/d';
/** APK wifi.service.ts:141-145 ("full" profile, 5,773 blocks). Capture: HTTP 202 + measurement_nr. */
export const WIFI_AOX_MEASURE_PATH = '/m?type=aox';

/** APK wifi.service.ts:220 — read-flash path with the measurement number. */
export function wifiReadFlashPath(measurementNumber: number, start: number, range: number): string {
  return `/read-flash?nr=${measurementNumber}&block=${start}&range=${range}`;
}

/** APK wifi.service.ts:217 — read-flash abort timeout scales with range. */
export function wifiReadFlashTimeoutMs(range: number): number {
  return 3_000 + 10 * range;
}

/**
 * APK wifi.service.ts:326-330 (with abort at :332). Same LED parameters as the USB `hand` command,
 * so the existing parseSampledHandRecognition() applies (verified against the
 * five captured /h responses: present false,false,true; removed false,true —
 * matching when the Biozoom app advanced).
 */
export function wifiHandPath(target: HandRecognitionTarget): string {
  return target === 'removed' ? '/h?start=134&count=10&cycles=25' : '/h?start=110&count=13&cycles=5';
}

/** Parses an HTTP JSON body with the same parser used for USB frames. */
export function parseWifiJsonBody(bodyText: string): ParsedResponse {
  return parseResponseFrame(new TextEncoder().encode(bodyText));
}

export function isHttpSuccess(status: number): boolean {
  return status >= 200 && status < 300;
}
