/** APK-bundled default. Deployments may explicitly configure another count. */
export const DEFAULT_PRECISION_AOX_MEASUREMENT_COUNT = 4;

export interface PrecisionAoxSeriesEntry {
  readonly normalizedAox: number;
  readonly aoxQ: number;
  readonly responseUuid: string;
  /** Exact quick-response error_prediction; absence is encoded as null in series_errors. */
  readonly errorPrediction?: unknown;
}

export interface PrecisionAoxAdditionalData {
  readonly model: 'MRSRRS_SCN06';
  readonly uuid: string;
  readonly AOX_extended_final: 'yes';
  readonly measurement_type: 'aox_precise';
  readonly series_results: readonly number[];
  readonly series_q: readonly number[];
  readonly series_uuid: readonly string[];
  readonly series_errors: readonly unknown[];
  readonly deleted_uuid: readonly string[];
}

export interface PrecisionAoxMeasureJson {
  readonly Serial: string;
  readonly MeasurementBlocks: '';
  readonly UserID: 'ffffffffffffffffffffffffffffffff';
  readonly lang: string;
  readonly AdditionalData: string;
}

export interface PrecisionAoxScoringRequest {
  readonly scannerSerial: string;
  readonly measureType: 1;
  readonly measureJson: PrecisionAoxMeasureJson;
}

/** Strict validation for the untrusted browser-to-server boundary. */
export function assertPrecisionAoxScoringRequest(input: unknown): asserts input is PrecisionAoxScoringRequest {
  if (!isRecord(input) || input.measureType !== 1 || !isRecord(input.measureJson)) {
    throw new TypeError('Invalid Precision AOX scoring request');
  }
  const measureJson = input.measureJson;
  if (
    typeof input.scannerSerial !== 'string' || input.scannerSerial.length === 0 ||
    measureJson.Serial !== input.scannerSerial || measureJson.MeasurementBlocks !== '' ||
    measureJson.UserID !== 'ffffffffffffffffffffffffffffffff' ||
    typeof measureJson.lang !== 'string' || !/^[A-Za-z]{2}$/.test(measureJson.lang) ||
    typeof measureJson.AdditionalData !== 'string'
  ) {
    throw new TypeError('Invalid Precision AOX measure_json');
  }
  let additional: unknown;
  try { additional = JSON.parse(measureJson.AdditionalData); } catch { throw new TypeError('Precision AOX AdditionalData must be JSON'); }
  if (!isRecord(additional)) throw new TypeError('Precision AOX AdditionalData must be an object');
  const results = additional.series_results;
  const qualities = additional.series_q;
  const uuids = additional.series_uuid;
  const errors = additional.series_errors;
  const discarded = additional.deleted_uuid;
  if (
    additional.model !== 'MRSRRS_SCN06' || !isUuidV4(String(additional.uuid ?? '')) ||
    additional.AOX_extended_final !== 'yes' || additional.measurement_type !== 'aox_precise' ||
    !Array.isArray(results) || !Array.isArray(qualities) || !Array.isArray(uuids) || !Array.isArray(errors) || !Array.isArray(discarded) ||
    results.length < 2 || qualities.length !== results.length || uuids.length !== results.length || errors.length !== results.length ||
    !results.every(isFiniteNumber) || !qualities.every(isFiniteNumber) || !uuids.every(isNonEmptyString) || !discarded.every(isNonEmptyString) ||
    new Set(uuids).size !== uuids.length || uuids.some((uuid) => discarded.includes(uuid))
  ) {
    throw new TypeError('Invalid or misaligned Precision AOX series evidence');
  }
}

export function buildPrecisionAoxScoringRequest(options: {
  scannerSerial: string;
  language: string;
  requestUuid: string;
  series: readonly PrecisionAoxSeriesEntry[];
  discardedUuids?: readonly string[];
  expectedMeasurementCount: number;
}): PrecisionAoxScoringRequest {
  if (!options.scannerSerial.startsWith('2E') && !options.scannerSerial.startsWith('2N')) {
    throw new Error('Precision AOX currently supports only the APK-confirmed 2E/2N SCN06 mapping');
  }
  if (!/^[A-Za-z]{2}$/.test(options.language)) throw new RangeError('language must be an exact two-letter value');
  if (!isUuidV4(options.requestUuid)) throw new RangeError('requestUuid must be a canonical UUID v4');
  if (!Number.isSafeInteger(options.expectedMeasurementCount) || options.expectedMeasurementCount < 2) {
    throw new RangeError('expectedMeasurementCount must be a safe integer of at least 2');
  }
  if (options.series.length !== options.expectedMeasurementCount) {
    throw new RangeError('Precision AOX series does not contain the configured number of accepted measurements');
  }
  const seen = new Set<string>();
  for (const entry of options.series) {
    if (!Number.isFinite(entry.normalizedAox) || !Number.isFinite(entry.aoxQ)) {
      throw new TypeError('Precision AOX series values and quality values must be finite numbers');
    }
    if (!isNonEmptyString(entry.responseUuid) || seen.has(entry.responseUuid)) {
      throw new TypeError('Precision AOX series UUIDs must be non-empty and unique');
    }
    seen.add(entry.responseUuid);
  }
  const discardedUuids = options.discardedUuids ?? [];
  if (discardedUuids.some((uuid) => !isNonEmptyString(uuid) || seen.has(uuid))) {
    throw new TypeError('Discarded UUIDs must be non-empty and distinct from retained UUIDs');
  }

  const additionalData: PrecisionAoxAdditionalData = {
    model: 'MRSRRS_SCN06',
    uuid: options.requestUuid,
    AOX_extended_final: 'yes',
    measurement_type: 'aox_precise',
    series_results: options.series.map((entry) => entry.normalizedAox),
    series_q: options.series.map((entry) => entry.aoxQ),
    series_uuid: options.series.map((entry) => entry.responseUuid),
    series_errors: options.series.map((entry) => entry.errorPrediction ?? null),
    deleted_uuid: [...discardedUuids],
  };
  return {
    scannerSerial: options.scannerSerial,
    measureType: 1,
    measureJson: {
      Serial: options.scannerSerial,
      MeasurementBlocks: '',
      UserID: 'ffffffffffffffffffffffffffffffff',
      lang: options.language,
      AdditionalData: JSON.stringify(additionalData),
    },
  };
}

export function buildPrecisionAoxMeasureUrl(recommendedServer: string, scannerSerial: string): string {
  let url: URL;
  try { url = new URL(recommendedServer); } catch { throw new RangeError('recommended server must be a valid HTTPS URL'); }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
    throw new RangeError('recommended server must be an HTTPS URL without credentials');
  }
  return `${recommendedServer.replace(/\/+$/, '')}/measure/?serial_id=${encodeURIComponent(scannerSerial)}&measure_type=1`;
}

export interface ParsedPrecisionAoxResponse {
  readonly preciseAox: number;
  readonly preciseAoxFloorResult?: number;
  readonly preciseAoxStd?: number;
  readonly preciseMeasurementsStd?: number;
  /** Preserved server values. No acceptance meaning or threshold is inferred. */
  readonly preciseQualityHand?: unknown;
  readonly preciseQualityResult?: unknown;
  readonly rawResponse: Readonly<Record<string, unknown>>;
}

export type PrecisionAoxParseErrorCode =
  | 'response-not-object'
  | 'missing-precise-aox'
  | 'invalid-precise-aox'
  | 'invalid-confirmed-numeric-field';

export type PrecisionAoxParseResult =
  | { readonly ok: true; readonly value: ParsedPrecisionAoxResponse }
  | { readonly ok: false; readonly error: { code: PrecisionAoxParseErrorCode; message: string; rawResponse: unknown } };

export function parsePrecisionAoxResponse(input: unknown): PrecisionAoxParseResult {
  if (!isRecord(input)) return parseFailure('response-not-object', 'Precision AOX response must be a non-array object', input);
  if (!Object.prototype.hasOwnProperty.call(input, 'precise_aox')) {
    return parseFailure('missing-precise-aox', 'Precision AOX response is missing precise_aox', input);
  }
  if (!isFiniteNumber(input.precise_aox)) {
    return parseFailure('invalid-precise-aox', 'precise_aox must be a finite number', input);
  }
  for (const key of ['precise_aox_floor_result', 'precise_aox_std', 'precise_measurements_std'] as const) {
    if (Object.prototype.hasOwnProperty.call(input, key) && !isFiniteNumber(input[key])) {
      return parseFailure('invalid-confirmed-numeric-field', `${key} must be a finite number when present`, input);
    }
  }
  return {
    ok: true,
    value: {
      preciseAox: input.precise_aox,
      ...(isFiniteNumber(input.precise_aox_floor_result) ? { preciseAoxFloorResult: input.precise_aox_floor_result } : {}),
      ...(isFiniteNumber(input.precise_aox_std) ? { preciseAoxStd: input.precise_aox_std } : {}),
      ...(isFiniteNumber(input.precise_measurements_std) ? { preciseMeasurementsStd: input.precise_measurements_std } : {}),
      ...(Object.prototype.hasOwnProperty.call(input, 'precise_quality_hand') ? { preciseQualityHand: input.precise_quality_hand } : {}),
      ...(Object.prototype.hasOwnProperty.call(input, 'precise_quality_result') ? { preciseQualityResult: input.precise_quality_result } : {}),
      rawResponse: input,
    },
  };
}

/** APK-confirmed normalization when an individual quick response includes secondary_aox. */
export function normalizedConstituentAox(rawResponse: Readonly<Record<string, unknown>>, primaryAox: number): number {
  const secondary = rawResponse.secondary_aox;
  if (!isRecord(secondary) || !isFiniteNumber(secondary.aox)) return primaryAox;
  return Math.floor(((primaryAox + secondary.aox) / 2) * 10) / 10;
}

function isUuidV4(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseFailure(code: PrecisionAoxParseErrorCode, message: string, rawResponse: unknown): PrecisionAoxParseResult {
  return { ok: false, error: { code, message, rawResponse } };
}
