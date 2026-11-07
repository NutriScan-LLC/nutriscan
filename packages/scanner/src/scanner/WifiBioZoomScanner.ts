import type { HttpTransport } from '../transport/HttpTransport.js';
import { HttpTransportError } from '../transport/HttpTransport.js';
import type { ParsedResponse } from '../protocol/response.js';
import {
  downloadAndReassembleAoxMeasurement,
  type DownloadAoxMeasurementOptions,
  type RawAoxMeasurementArtifact,
} from '../protocol/aoxMeasurement.js';
import {
  computeSampledHandMetrics,
  interpretSampledHandMetrics,
  UnsupportedHandRecognitionFirmwareError,
  type SampledHandMetrics,
  type HandRecognitionTarget,
} from '../protocol/handRecognition.js';
import {
  isHttpSuccess,
  parseWifiJsonBody,
  wifiHandPath,
  wifiReadFlashPath,
  wifiReadFlashTimeoutMs,
  WIFI_AOX_MEASURE_PATH,
  WIFI_DELETE_PATH,
  WIFI_DELETE_TIMEOUT_MS,
  WIFI_HAND_TIMEOUT_MS,
  WIFI_MEASURE_TIMEOUT_MS,
  WIFI_POST_MEASURE_DELAY_MS,
  WIFI_READY_RETRY_DELAY_MS,
  WIFI_READY_TIMEOUT_MS,
  WIFI_SAMPLED_HAND_MIN_SENSOR_FIRMWARE,
  WIFI_SAMPLED_HAND_MIN_WIFI_MAJOR,
  WIFI_STATUS_PATH,
  WIFI_STATUS_TIMEOUT_MS,
} from '../protocol/wifiHttp.js';
import type { AoxMeasurementStart, ScannerIdentity } from './BioZoomScanner.js';
import {
  AoxMeasurementStartRejectedError,
  MalformedAoxMeasurementAcknowledgmentError,
  ScannerError,
  ScannerNotConnectedError,
  ScannerNotIdentifiedError,
} from './errors.js';

/**
 * UNVERIFIED tuning from a single capture (2026-11-06): the last of 5,773
 * blocks became readable ~15.7 s after /m answered, ~1.3 s later than the
 * APK's 400 blocks/s estimate. The USB default margin is 750 ms; Wi-Fi uses a
 * wider margin so the first pass rarely meets unwritten (0xFF) blocks.
 */
export const WIFI_DEFAULT_PRODUCTION_SAFETY_MARGIN_MS = 2_000;
/** Pause before re-reading a still-missing range (UNVERIFIED; APK simply re-polls every loop). */
export const WIFI_MISSING_RANGE_RETRY_DELAY_MS = 500;
/** Attempts for the status read before hand recognition. */
export const WIFI_STATUS_ATTEMPTS = 4;
/** Attempts per read-flash request on transport failure (APK retries indefinitely; we bound it). */
export const WIFI_READ_FLASH_ATTEMPTS = 3;

export class WifiScannerNotReadyError extends ScannerError {
  constructor(readonly lastError: unknown) {
    super('Wi-Fi scanner did not return a valid status. Is this phone joined to the scanner’s Wi-Fi?');
    this.name = 'WifiScannerNotReadyError';
  }
}

export class WifiScannerHttpStatusError extends ScannerError {
  constructor(readonly path: string, readonly status: number, readonly bodyText: string) {
    super(`Wi-Fi scanner answered ${path} with HTTP ${status}`);
    this.name = 'WifiScannerHttpStatusError';
  }
}

export interface WifiBioZoomScannerOptions {
  /** Injectable for deterministic tests. */
  readonly wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  readonly now?: () => Date;
  /** Diagnostic hook: path, HTTP status, duration. Never receives bodies. */
  readonly onRequest?: (event: { readonly path: string; readonly status: number | null; readonly durationMs: number; readonly error?: string }) => void;
  /** Diagnostic hook: averaged channel metrics behind each hand decision (null = malformed sample). */
  readonly onHandSample?: (event: { readonly target: HandRecognitionTarget; readonly metrics: SampledHandMetrics | null; readonly recognized: boolean }) => void;
}

/**
 * Wi-Fi counterpart of BioZoomScanner. Implements the same surface the Quick
 * AOX workflow needs (QuickAoxScanner in @nutriscan/workflows) over the
 * scanner's HTTP API, reproducing the Biozoom app's request sequence exactly:
 *
 *   /status (until ready) → /status → /h (hand on) … → /d → /m?type=aox
 *   → /read-flash … → /status → /h (hand off) …
 *
 * Commands the Biozoom app does not send in this flow (erase-chip, signal,
 * firmware update, file reads) are deliberately not implemented.
 */
export class WifiBioZoomScanner {
  readonly #http: HttpTransport;
  readonly #wait: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  readonly #now: () => Date;
  readonly #onRequest: WifiBioZoomScannerOptions['onRequest'];
  readonly #onHandSample: WifiBioZoomScannerOptions['onHandSample'];

  #connected = false;
  #identity: ScannerIdentity | null = null;
  readonly #measurementAcknowledgments = new Map<number, string>();
  readonly #preparedHandTargets = new Set<HandRecognitionTarget>();

  constructor(http: HttpTransport, options: WifiBioZoomScannerOptions = {}) {
    this.#http = http;
    this.#wait = options.wait ?? abortableWait;
    this.#now = options.now ?? (() => new Date());
    this.#onRequest = options.onRequest;
    this.#onHandSample = options.onHandSample;
  }

  get isConnected(): boolean { return this.#connected; }
  get identity(): ScannerIdentity | null { return this.#identity; }

  /**
   * APK waitForScannerReady() (wifi.service.ts:66-93): poll GET /status
   * (2.5 s timeout each, 500 ms apart) for up to 15 s until a non-empty JSON
   * object arrives. There is no socket to open; "connected" means reachable.
   */
  async connect(): Promise<void> {
    if (this.#connected) return;
    const started = this.#now().getTime();
    let lastError: unknown = null;
    while (this.#now().getTime() - started < WIFI_READY_TIMEOUT_MS) {
      try {
        const status = await this.#getJson(WIFI_STATUS_PATH, WIFI_STATUS_TIMEOUT_MS);
        if (status.kind === 'ok' && Object.keys(status.json).length > 0) {
          this.#connected = true;
          return;
        }
        lastError = new ScannerError('Scanner returned an empty or non-JSON status');
      } catch (cause) {
        lastError = cause;
      }
      await this.#wait(WIFI_READY_RETRY_DELAY_MS);
    }
    throw new WifiScannerNotReadyError(lastError);
  }

  /** No connection to close over HTTP; clears per-session state. */
  async disconnect(): Promise<void> {
    this.#connected = false;
    this.#identity = null;
    this.#measurementAcknowledgments.clear();
    this.#preparedHandTargets.clear();
  }

  /**
   * Reads /status and reports the scanner as V2.
   * UNVERIFIED for other units: V2 is inferred because scanner
   * 2E249C6AFCEA6BE8D5FF was driven by the Biozoom app with the V2 path
   * (m?type=aox + read-flash) in the 2026-11-06 capture. How the APK decides
   * V2 for Wi-Fi scanners is not yet extracted (docs/unknowns.md).
   */
  async identify(): Promise<ScannerIdentity> {
    if (!this.#connected) throw new ScannerNotConnectedError();
    const response = await this.#getJson(WIFI_STATUS_PATH, WIFI_STATUS_TIMEOUT_MS);
    if (response.kind !== 'ok') throw new ScannerError(`Wi-Fi status was not a JSON object (${response.kind})`);
    const serial = typeof response.json.serial === 'string' && response.json.serial.length > 0 ? response.json.serial : undefined;
    const identity: ScannerIdentity = { serial, protocolVersion: 'v2', commandUsed: 'status', response };
    this.#identity = identity;
    return identity;
  }

  /** One non-destructive GET /status. */
  async readStatusSnapshot(): Promise<ParsedResponse> {
    this.#requireIdentified();
    return this.#getJson(WIFI_STATUS_PATH, WIFI_STATUS_TIMEOUT_MS);
  }

  /**
   * APK initFunc (wifi.service.ts:173-188): GET /d, then GET /m?type=aox,
   * read measurement_nr, wait 250 ms. /d's deletion scope is UNKNOWN; it is
   * what the Biozoom app sends before every scan. Unlike the APK, a failed /d
   * stops the scan instead of measuring anyway.
   */
  async startAoxMeasurement(options: {
    readonly signal?: AbortSignal;
    readonly onMeasurementCommandSent?: () => void;
  } = {}): Promise<AoxMeasurementStart> {
    this.#requireIdentified();
    throwIfAborted(options.signal);
    await this.#getRaw(WIFI_DELETE_PATH, WIFI_DELETE_TIMEOUT_MS, options.signal);
    // A delete the scanner already performed cannot be undone; never proceed
    // into a physical measurement after cancellation.
    throwIfAborted(options.signal);
    try { options.onMeasurementCommandSent?.(); } catch { /* observers cannot alter sequencing */ }
    const acknowledgment = await this.#getJson(WIFI_AOX_MEASURE_PATH, WIFI_MEASURE_TIMEOUT_MS, options.signal);
    if (acknowledgment.kind === 'error') throw new AoxMeasurementStartRejectedError(acknowledgment);
    if (acknowledgment.kind !== 'ok') throw new MalformedAoxMeasurementAcknowledgmentError(acknowledgment);
    const measurementNumber = acknowledgment.json.measurement_nr;
    // Capture: {"measurement_nr":133,"success":true,"type":"aox", ...}
    if (acknowledgment.json.type !== 'aox' || acknowledgment.json.success === false || typeof measurementNumber !== 'number' || !Number.isSafeInteger(measurementNumber) || measurementNumber < 1) {
      throw new MalformedAoxMeasurementAcknowledgmentError(acknowledgment);
    }
    // The APK starts its block clock 250 ms after the acknowledgment.
    const acknowledgedAt = new Date(this.#now().getTime() + WIFI_POST_MEASURE_DELAY_MS).toISOString();
    this.#measurementAcknowledgments.set(measurementNumber, acknowledgedAt);
    return {
      measurementNumber,
      acknowledgedAt,
      acknowledgment,
      commandName: 'measure',
      // HTTP pairs each response with its request; there is no call-index.
      correlated: true,
    };
  }

  /**
   * Streams the measurement with the shared, CRC-validating downloader. The
   * production-frontier scheduler (400 blocks/s, APK wifi.service.ts:199)
   * waits until each range should be written; missing or still-0xFF blocks
   * are re-read in retry rounds.
   */
  async downloadAoxMeasurement(
    measurementNumber: number,
    options: DownloadAoxMeasurementOptions = {},
  ): Promise<RawAoxMeasurementArtifact> {
    this.#requireIdentified();
    const acknowledgedAt = options.measurementAcknowledgedAt ?? this.#measurementAcknowledgments.get(measurementNumber);
    const callerBeforeRead = options.beforeRead;
    const merged: DownloadAoxMeasurementOptions = {
      productionSafetyMarginMs: WIFI_DEFAULT_PRODUCTION_SAFETY_MARGIN_MS,
      ...options,
      ...(acknowledgedAt === undefined ? {} : { measurementAcknowledgedAt: acknowledgedAt }),
      beforeRead: async (start, range, attempt) => {
        if (attempt > 0) await this.#wait(WIFI_MISSING_RANGE_RETRY_DELAY_MS, options.signal);
        await callerBeforeRead?.(start, range, attempt);
      },
    };
    return downloadAndReassembleAoxMeasurement(
      this.#identity?.serial,
      measurementNumber,
      (start, range) => this.#readFlash(measurementNumber, start, range, options.signal),
      merged,
    );
  }

  /**
   * APK doHandRecognitionObservable (wifi.service.ts:294-323): firmware with
   * Wi-Fi major < 10 or sensor_firmware < 604 uses a legacy path this SDK
   * does not implement; everything newer uses sampled /h.
   */
  async prepareHandRecognition(target: HandRecognitionTarget): Promise<void> {
    this.#requireIdentified();
    const status = await this.#statusWithRetry();
    if (status.kind !== 'ok') throw new UnsupportedHandRecognitionFirmwareError('A valid Wi-Fi status response is required for hand recognition');
    const wifiFirmware = typeof status.json.wifi_firmware === 'string' ? status.json.wifi_firmware : '';
    const major = Number(wifiFirmware.split('.')[0] ?? '0');
    const sensorFirmware = typeof status.json.sensor_firmware === 'number' ? status.json.sensor_firmware : 1;
    if (!(major >= WIFI_SAMPLED_HAND_MIN_WIFI_MAJOR) || sensorFirmware < WIFI_SAMPLED_HAND_MIN_SENSOR_FIRMWARE) {
      throw new UnsupportedHandRecognitionFirmwareError(`Wi-Fi firmware ${wifiFirmware || 'unknown'} / sensor ${sensorFirmware} requires the legacy hand-recognition path, which is not implemented`);
    }
    this.#preparedHandTargets.add(target);
  }

  /** APK doHandRecognitionObservable2 (wifi.service.ts:325-360): one sampled /h; failures count as "not yet". */
  async recognizeHand(target: HandRecognitionTarget): Promise<boolean> {
    this.#requireIdentified();
    if (!this.#preparedHandTargets.has(target)) throw new ScannerError(`Hand ${target} recognition was not prepared`);
    const path = wifiHandPath(target);
    let response: { status: number; bodyText: string };
    try {
      response = await this.#request(path, WIFI_HAND_TIMEOUT_MS);
    } catch {
      return false; // APK: fetch error/abort → false
    }
    if (!isHttpSuccess(response.status)) return false;
    const parsed = parseWifiJsonBody(response.bodyText);
    if (parsed.kind !== 'ok') return false;
    const metrics = computeSampledHandMetrics(parsed.json.data, target);
    const recognized = metrics === null ? false : interpretSampledHandMetrics(metrics, target);
    try { this.#onHandSample?.({ target, metrics, recognized }); } catch { /* diagnostics never affect sequencing */ }
    return recognized;
  }

  /**
   * GET /status with a few retries. The hand-off check follows ~16 s of
   * read-flash traffic; a single dropped request there would otherwise throw
   * away a complete measurement. The APK has no equivalent retry (its status
   * call precedes the scan), so this is a NutriScan robustness choice.
   */
  async #statusWithRetry(): Promise<ParsedResponse> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= WIFI_STATUS_ATTEMPTS; attempt++) {
      try {
        return await this.#getJson(WIFI_STATUS_PATH, WIFI_STATUS_TIMEOUT_MS);
      } catch (cause) {
        lastError = cause;
        if (attempt < WIFI_STATUS_ATTEMPTS) await this.#wait(WIFI_READY_RETRY_DELAY_MS);
      }
    }
    throw lastError;
  }

  async #readFlash(measurementNumber: number, start: number, range: number, signal?: AbortSignal): Promise<ParsedResponse> {
    const path = wifiReadFlashPath(measurementNumber, start, range);
    let lastError: unknown;
    for (let attempt = 1; attempt <= WIFI_READ_FLASH_ATTEMPTS; attempt++) {
      throwIfAborted(signal);
      try {
        return await this.#getJson(path, wifiReadFlashTimeoutMs(range), signal);
      } catch (cause) {
        if (signal?.aborted) throw cause;
        lastError = cause;
        if (attempt < WIFI_READ_FLASH_ATTEMPTS) await this.#wait(250, signal);
      }
    }
    throw lastError;
  }

  async #getRaw(path: string, timeoutMs: number, signal?: AbortSignal): Promise<{ status: number; bodyText: string }> {
    const response = await this.#request(path, timeoutMs, signal);
    if (!isHttpSuccess(response.status)) throw new WifiScannerHttpStatusError(path, response.status, response.bodyText);
    return response;
  }

  async #getJson(path: string, timeoutMs: number, signal?: AbortSignal): Promise<ParsedResponse> {
    const response = await this.#getRaw(path, timeoutMs, signal);
    return parseWifiJsonBody(response.bodyText);
  }

  async #request(path: string, timeoutMs: number, signal?: AbortSignal): Promise<{ status: number; bodyText: string }> {
    const started = this.#now().getTime();
    try {
      const response = await this.#http.get(path, { timeoutMs, ...(signal === undefined ? {} : { signal }) });
      this.#observe({ path, status: response.status, durationMs: this.#now().getTime() - started });
      return response;
    } catch (cause) {
      this.#observe({ path, status: null, durationMs: this.#now().getTime() - started, error: cause instanceof Error ? cause.name : 'Error' });
      throw cause instanceof Error ? cause : new HttpTransportError(String(cause), path);
    }
  }

  #observe(event: { path: string; status: number | null; durationMs: number; error?: string }): void {
    try { this.#onRequest?.(event); } catch { /* diagnostics never affect sequencing */ }
  }

  #requireIdentified(): void {
    if (!this.#connected) throw new ScannerNotConnectedError();
    if (!this.#identity || this.#identity.protocolVersion !== 'v2') throw new ScannerNotIdentifiedError();
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
}

async function abortableWait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason ?? new DOMException('Aborted', 'AbortError')); }, { once: true });
  });
}
