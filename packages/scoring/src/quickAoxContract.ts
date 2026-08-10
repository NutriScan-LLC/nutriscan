import type { RawAoxMeasurementArtifact } from '@nutriscan/scanner';

export interface QuickAoxMeasureJson {
  readonly Serial: string;
  readonly MeasurementBlocks: string;
  readonly UserID: 'ffffffffffffffffffffffffffffffff';
  readonly lang: string;
  readonly AdditionalData: string;
}

export interface QuickAoxScoringRequest {
  readonly scannerSerial: string;
  readonly measurementNumber: number;
  readonly measurementBlocks: string;
  readonly measureJson: QuickAoxMeasureJson;
}

export const QUICK_AOX_MULTIPART_CONTRACT = Object.freeze({
  fieldName: 'measure_json',
  filename: 'measure.json',
  contentType: 'application/json',
} as const);

export function buildQuickAoxPreRequestUrl(baseUrl: string, scannerSerial: string): string {
  const base = validatedHttpsBaseUrl(baseUrl, 'pre-request base URL');
  return `${base}/pre-request/?serial_id=${encodeURIComponent(scannerSerial)}&measure_type=0`;
}

export function buildQuickAoxMeasureUrl(recommendedServer: string, scannerSerial: string): string {
  const base = validatedHttpsBaseUrl(recommendedServer, 'recommended server');
  return `${base}/measure/?serial_id=${encodeURIComponent(scannerSerial)}&measure_type=0`;
}

export interface BuildQuickAoxScoringRequestOptions {
  readonly language: string;
  /** Caller-generated per-request UUID. Kept injectable so this module stays browser-safe and deterministic. */
  readonly uuid: string;
}

export type QuickAoxPreRequestParseErrorCode =
  | 'response-not-object'
  | 'missing-recommended-server'
  | 'invalid-recommended-server'
  | 'missing-waiting-time'
  | 'invalid-waiting-time'
  | 'unsupported-repeat-pre-request';

export interface QuickAoxPreRequestParseError {
  readonly code: QuickAoxPreRequestParseErrorCode;
  readonly message: string;
  readonly rawResponse: unknown;
}

export interface ParsedQuickAoxPreRequest {
  readonly recommendedServer: string;
  readonly waitingTimeMs: number;
  readonly newPreRequestReq: false | null;
  readonly newPreRequestDelayMs: unknown;
  readonly rawResponse: Readonly<Record<string, unknown>>;
}

export type QuickAoxPreRequestParseResult =
  | { readonly ok: true; readonly value: ParsedQuickAoxPreRequest }
  | { readonly ok: false; readonly error: QuickAoxPreRequestParseError };

/**
 * Pure construction of the runtime-confirmed quick-AOX measure_json contract.
 * It performs no hashing, random generation, scanner access, or networking.
 */
export function buildQuickAoxScoringRequest(
  artifact: RawAoxMeasurementArtifact,
  options: BuildQuickAoxScoringRequestOptions,
): QuickAoxScoringRequest {
  if (!artifact.summary.complete || artifact.failure !== null) {
    throw new Error('A complete, valid RawAoxMeasurementArtifact is required');
  }
  if (artifact.scannerSerial === undefined || artifact.scannerSerial.length === 0) {
    throw new Error('RawAoxMeasurementArtifact must include the scanner serial');
  }
  if (artifact.blocks.length !== artifact.profile.logicalBlockCount) {
    throw new Error('RawAoxMeasurementArtifact block count does not match its profile');
  }
  if (artifact.originalBase64Blocks.join('') !== artifact.measurementBlocks) {
    throw new Error('RawAoxMeasurementArtifact MeasurementBlocks does not match its ordered Base64 blocks');
  }
  if (!/^[A-Za-z]{2}$/.test(options.language)) {
    throw new RangeError('language must be an exact two-letter value');
  }
  if (!isUuidV4(options.uuid)) {
    throw new RangeError('uuid must be a canonical UUID v4');
  }

  const additionalData = {
    model: modelForSerial(artifact.scannerSerial),
    veggie_04: true,
    uuid: options.uuid,
    measurement_type: 'aox',
  } as const;
  const measureJson: QuickAoxMeasureJson = {
    Serial: artifact.scannerSerial,
    MeasurementBlocks: artifact.measurementBlocks,
    UserID: 'ffffffffffffffffffffffffffffffff',
    lang: options.language,
    AdditionalData: JSON.stringify(additionalData),
  };
  return {
    scannerSerial: artifact.scannerSerial,
    measurementNumber: artifact.measurementNumber,
    measurementBlocks: artifact.measurementBlocks,
    measureJson,
  };
}

/** Validates the fields used by the confirmed pre-request/measure ordering. */
export function parseQuickAoxPreRequest(input: unknown): QuickAoxPreRequestParseResult {
  if (!isRecord(input)) return preRequestFailure('response-not-object', 'Pre-request response must be a non-array object', input);
  if (input.new_pre_request_req === true) {
    return preRequestFailure(
      'unsupported-repeat-pre-request',
      'BioZoom requested another pre-request; repeat behavior is not established',
      input,
    );
  }
  if (!Object.prototype.hasOwnProperty.call(input, 'recommended_server')) {
    return preRequestFailure('missing-recommended-server', 'Pre-request response is missing recommended_server', input);
  }
  if (typeof input.recommended_server !== 'string' || input.recommended_server.length === 0) {
    return preRequestFailure('invalid-recommended-server', 'recommended_server must be a non-empty HTTPS URL', input);
  }
  let serverUrl: URL;
  try {
    serverUrl = new URL(input.recommended_server);
  } catch {
    return preRequestFailure('invalid-recommended-server', 'recommended_server must be a valid HTTPS URL', input);
  }
  if (serverUrl.protocol !== 'https:' || serverUrl.username !== '' || serverUrl.password !== '') {
    return preRequestFailure('invalid-recommended-server', 'recommended_server must be an HTTPS URL without credentials', input);
  }
  if (!Object.prototype.hasOwnProperty.call(input, 'waiting_time_ms')) {
    return preRequestFailure('missing-waiting-time', 'Pre-request response is missing waiting_time_ms', input);
  }
  if (typeof input.waiting_time_ms !== 'number' || !Number.isFinite(input.waiting_time_ms) || input.waiting_time_ms < 0) {
    return preRequestFailure('invalid-waiting-time', 'waiting_time_ms must be a finite non-negative number', input);
  }
  return {
    ok: true,
    value: {
      recommendedServer: input.recommended_server.replace(/\/+$/, ''),
      waitingTimeMs: input.waiting_time_ms,
      newPreRequestReq: input.new_pre_request_req === false ? false : null,
      newPreRequestDelayMs: input.new_pre_request_delay_ms,
      rawResponse: input,
    },
  };
}

function modelForSerial(serial: string): 'MRSRRS_SCN06' {
  if (!serial.startsWith('2E') && !serial.startsWith('2N')) {
    throw new Error(`Quick AOX scoring currently supports only the APK-confirmed 2E/2N SCN06 mapping; received ${serial}`);
  }
  return 'MRSRRS_SCN06';
}

function isUuidV4(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validatedHttpsBaseUrl(value: string, name: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new RangeError(`${name} must be a valid HTTPS URL`); }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
    throw new RangeError(`${name} must be an HTTPS URL without credentials`);
  }
  return value.replace(/\/+$/, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function preRequestFailure(
  code: QuickAoxPreRequestParseErrorCode,
  message: string,
  rawResponse: unknown,
): QuickAoxPreRequestParseResult {
  return { ok: false, error: { code, message, rawResponse } };
}
