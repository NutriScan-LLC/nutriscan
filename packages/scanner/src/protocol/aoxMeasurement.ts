import type { ParsedResponse } from './response.js';

/** Confirmed full-AOX profile on scanner 2N2400A5B70F5E3C9251; configurable for future profiles. */
export interface AoxMeasurementProfile {
  readonly type: 'aox';
  readonly logicalBlockCount: number;
  readonly blockByteLength: number;
}

export const CONFIRMED_FULL_AOX_PROFILE: AoxMeasurementProfile = Object.freeze({
  type: 'aox', logicalBlockCount: 5_773, blockByteLength: 33,
});

export interface RawAoxBlockObservation {
  readonly base64: string;
  readonly requestStart: number;
  readonly requestRange: number;
  readonly arrayIndex: number;
  readonly observedAt?: string;
}

export interface ValidatedAoxBlock {
  readonly logicalIndex: number;
  readonly internalIndex: number;
  readonly base64: string;
  readonly decodedBytes: readonly number[];
  readonly byteLength: number;
  readonly declaredLength: number;
  readonly crcResidual: number;
  readonly firstObservedAt: string | null;
}

export type AoxBlockAnomalyKind =
  | 'invalid-base64' | 'invalid-length' | 'invalid-declared-length' | 'crc-failure'
  | 'all-ff' | 'unexpected-index' | 'duplicate' | 'conflicting-duplicate';

export interface AoxBlockAnomaly {
  readonly kind: AoxBlockAnomalyKind;
  readonly requestStart: number;
  readonly requestRange: number;
  readonly arrayIndex: number;
  readonly base64: string;
  readonly detail: string;
  readonly logicalIndex?: number;
}

export interface LogicalBlockRange { readonly start: number; readonly count: number }

export interface AoxValidationSummary {
  readonly expectedBlockCount: number;
  readonly validBlockCount: number;
  readonly missingBlockCount: number;
  readonly anomalyCount: number;
  readonly complete: boolean;
}

export interface AoxReassemblyResult {
  readonly profile: AoxMeasurementProfile;
  readonly blocks: readonly ValidatedAoxBlock[];
  readonly originalBase64Blocks: readonly string[];
  readonly measurementBlocks: string;
  readonly missingLogicalIndexes: readonly number[];
  readonly missingRanges: readonly LogicalBlockRange[];
  readonly anomalies: readonly AoxBlockAnomaly[];
  readonly summary: AoxValidationSummary;
}

export interface AoxReassemblyOptions { readonly profile?: AoxMeasurementProfile }

/** Pure AOX block validation and reassembly. It performs no I/O of any kind. */
export function validateAndReassembleAoxBlocks(
  observations: readonly RawAoxBlockObservation[],
  options: AoxReassemblyOptions = {},
): AoxReassemblyResult {
  const profile = options.profile ?? CONFIRMED_FULL_AOX_PROFILE;
  validateProfile(profile);
  const stored = new Map<number, ValidatedAoxBlock>();
  const anomalies: AoxBlockAnomaly[] = [];

  for (const observation of observations) {
    let decoded: Uint8Array;
    try {
      decoded = decodeBase64Strict(observation.base64);
    } catch (error) {
      anomalies.push(anomaly('invalid-base64', observation, error instanceof Error ? error.message : String(error)));
      continue;
    }
    const allFf = decoded.length > 0 && decoded.every((byte) => byte === 0xff);
    if (allFf) {
      anomalies.push(anomaly('all-ff', observation, `Decoded ${decoded.length} all-FF bytes; not accepted as measurement data`));
      continue;
    }
    if (decoded.length !== profile.blockByteLength) {
      anomalies.push(anomaly('invalid-length', observation, `Expected ${profile.blockByteLength} bytes; received ${decoded.length}`));
      continue;
    }
    const declaredLength = (decoded[0]! << 8) | decoded[1]!;
    const internalIndex = decoded[2]! | (decoded[3]! << 8);
    if (declaredLength !== decoded.length - 2) {
      anomalies.push(anomaly('invalid-declared-length', observation, `Declared ${declaredLength}; expected ${decoded.length - 2}`));
      continue;
    }
    const crcResidual = crc16CcittResidual(decoded.subarray(2));
    if (crcResidual !== 0) {
      anomalies.push(anomaly('crc-failure', observation, `CRC16-CCITT residual was ${crcResidual}`));
      continue;
    }

    // Confirmed device rule: requested logical positions 0 and 1 both carry
    // internal index 1. Request position preserves which logical slot it fills.
    const requestedLogicalIndex = observation.requestStart + observation.arrayIndex;
    const logicalIndex = internalIndex === 1 && requestedLogicalIndex === 0 ? 0 : internalIndex;
    if (logicalIndex < 0 || logicalIndex >= profile.logicalBlockCount) {
      anomalies.push({ ...anomaly('unexpected-index', observation, `Internal/logical index ${internalIndex}/${logicalIndex} is outside the profile`), logicalIndex });
      continue;
    }
    const block: ValidatedAoxBlock = {
      logicalIndex, internalIndex, base64: observation.base64,
      decodedBytes: Array.from(decoded), byteLength: decoded.length,
      declaredLength, crcResidual, firstObservedAt: observation.observedAt ?? null,
    };
    const prior = stored.get(logicalIndex);
    if (prior !== undefined) {
      const same = prior.base64 === block.base64 && arraysEqual(prior.decodedBytes, block.decodedBytes);
      anomalies.push({
        ...anomaly(same ? 'duplicate' : 'conflicting-duplicate', observation, `Logical index ${logicalIndex} was already stored; preserved the first valid block`),
        logicalIndex,
      });
    } else {
      stored.set(logicalIndex, block);
    }
  }

  const missingLogicalIndexes = Array.from({ length: profile.logicalBlockCount }, (_, index) => index)
    .filter((index) => !stored.has(index));
  const blocks = [...stored.values()].sort((left, right) => left.logicalIndex - right.logicalIndex);
  const originalBase64Blocks = blocks.map((block) => block.base64);
  const complete = blocks.length === profile.logicalBlockCount && missingLogicalIndexes.length === 0;
  return {
    profile, blocks, originalBase64Blocks,
    measurementBlocks: originalBase64Blocks.join(''),
    missingLogicalIndexes,
    missingRanges: indexesToRanges(missingLogicalIndexes),
    anomalies,
    summary: {
      expectedBlockCount: profile.logicalBlockCount, validBlockCount: blocks.length,
      missingBlockCount: missingLogicalIndexes.length, anomalyCount: anomalies.length, complete,
    },
  };
}

export interface AoxFlashReadRecord {
  readonly startedAt: string;
  readonly completedAt: string;
  readonly start: number;
  readonly range: number;
  readonly returnedElementCount: number;
}

export interface AoxAcquisitionStrategy {
  readonly range?: number;
  readonly maxMissingRangeRetries?: number;
  readonly timeoutMs?: number;
  readonly beforeRead?: (start: number, range: number, attempt: number) => Promise<void>;
  /** Measurement acknowledgment time used by the production-frontier scheduler. */
  readonly measurementAcknowledgedAt?: string;
  /** APK-confirmed production rate. Override only for an independently confirmed profile. */
  readonly productionBlocksPerSecond?: number;
  /** Additional time after the estimated frontier. Production default: 750 ms. */
  readonly productionSafetyMarginMs?: number;
  /** Injectable abortable sleeper for deterministic tests. */
  readonly wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

export interface DownloadAoxMeasurementOptions extends AoxAcquisitionStrategy {
  readonly profile?: AoxMeasurementProfile;
  readonly now?: () => Date;
  readonly onProgress?: (result: AoxReassemblyResult, read: AoxFlashReadRecord) => void;
  readonly signal?: AbortSignal;
}

export interface RawAoxMeasurementArtifact extends AoxReassemblyResult {
  readonly scannerSerial: string | undefined;
  readonly measurementNumber: number;
  readonly type: 'aox';
  readonly startedAt: string;
  readonly completedAt: string;
  readonly reads: readonly AoxFlashReadRecord[];
  readonly retryRounds: number;
  readonly failure: { readonly kind: 'incomplete'; readonly message: string } | null;
}

export type ReadAoxFlashRange = (start: number, range: number) => Promise<ParsedResponse>;

export class AoxAcquisitionTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`AOX acquisition exceeded the configured ${timeoutMs} ms timeout`);
    this.name = 'AoxAcquisitionTimeoutError';
  }
}

export class InvalidAoxFlashResponseError extends Error {
  constructor(readonly response: ParsedResponse) {
    super(`AOX read-flash response did not contain a data array (kind: ${response.kind})`);
    this.name = 'InvalidAoxFlashResponseError';
  }
}

export async function downloadAndReassembleAoxMeasurement(
  scannerSerial: string | undefined,
  measurementNumber: number,
  readRange: ReadAoxFlashRange,
  options: DownloadAoxMeasurementOptions = {},
): Promise<RawAoxMeasurementArtifact> {
  if (!Number.isSafeInteger(measurementNumber) || measurementNumber < 1) throw new RangeError('measurementNumber must be a positive safe integer');
  const profile = options.profile ?? CONFIRMED_FULL_AOX_PROFILE;
  validateProfile(profile);
  const range = options.range ?? 150;
  if (!Number.isSafeInteger(range) || range < 1 || range > 600) throw new RangeError('range must be an integer from 1 through 600');
  const maxRetries = options.maxMissingRangeRetries ?? 3;
  if (!Number.isSafeInteger(maxRetries) || maxRetries < 0) throw new RangeError('maxMissingRangeRetries must be a non-negative safe integer');
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const startedMs = now().getTime();
  const observations: RawAoxBlockObservation[] = [];
  const reads: AoxFlashReadRecord[] = [];
  let result = validateAndReassembleAoxBlocks(observations, { profile });
  const acknowledgedMs = options.measurementAcknowledgedAt === undefined
    ? undefined
    : Date.parse(options.measurementAcknowledgedAt);
  if (acknowledgedMs !== undefined && !Number.isFinite(acknowledgedMs)) throw new RangeError('measurementAcknowledgedAt must be an ISO timestamp');
  const blocksPerSecond = options.productionBlocksPerSecond ?? 400;
  if (!(blocksPerSecond > 0)) throw new RangeError('productionBlocksPerSecond must be positive');
  const safetyMarginMs = options.productionSafetyMarginMs ?? 750;
  if (!(safetyMarginMs >= 0)) throw new RangeError('productionSafetyMarginMs must be non-negative');
  const wait = options.wait ?? abortableWait;

  const read = async (start: number, count: number, attempt: number) => {
    if (options.signal?.aborted) throw options.signal.reason ?? new DOMException('Aborted', 'AbortError');
    if (options.timeoutMs !== undefined && now().getTime() - startedMs >= options.timeoutMs) throw new AoxAcquisitionTimeoutError(options.timeoutMs);
    // APK-confirmed ordinary AOX behavior is availability-aware. Waiting for
    // the end of this range plus a conservative 750 ms margin guarantees that
    // production code never asks beyond the estimated ~400 block/s frontier.
    if (acknowledgedMs !== undefined) {
      const availableAt = acknowledgedMs + Math.ceil(((start + count) / blocksPerSecond) * 1_000) + safetyMarginMs;
      const remaining = availableAt - now().getTime();
      if (remaining > 0) await wait(remaining, options.signal);
    }
    await options.beforeRead?.(start, count, attempt);
    const readStartedAt = now().toISOString();
    const response = await readRange(start, count); // protocol/transport errors propagate unchanged
    const completedAt = now().toISOString();
    if (response.kind !== 'ok' || !Array.isArray(response.json.data)) throw new InvalidAoxFlashResponseError(response);
    const record: AoxFlashReadRecord = { startedAt: readStartedAt, completedAt, start, range: count, returnedElementCount: response.json.data.length };
    reads.push(record);
    response.json.data.forEach((base64, arrayIndex) => {
      if (typeof base64 === 'string') observations.push({ base64, requestStart: start, requestRange: count, arrayIndex, observedAt: completedAt });
      else observations.push({ base64: `invalid:${String(base64)}`, requestStart: start, requestRange: count, arrayIndex, observedAt: completedAt });
    });
    result = validateAndReassembleAoxBlocks(observations, { profile });
    options.onProgress?.(result, record);
  };

  for (let start = 0; start < profile.logicalBlockCount; start += range) await read(start, Math.min(range, profile.logicalBlockCount - start), 0);
  let retryRounds = 0;
  while (!result.summary.complete && retryRounds < maxRetries) {
    retryRounds++;
    for (const missing of result.missingRanges) {
      for (let offset = 0; offset < missing.count; offset += range) {
        await read(missing.start + offset, Math.min(range, missing.count - offset), retryRounds);
      }
    }
  }
  const completedAt = now().toISOString();
  return {
    ...result, scannerSerial, measurementNumber, type: profile.type, startedAt, completedAt,
    reads, retryRounds,
    failure: result.summary.complete ? null : { kind: 'incomplete', message: `Missing ${result.missingLogicalIndexes.length} of ${profile.logicalBlockCount} logical blocks after ${retryRounds} retry rounds` },
  };
}

async function abortableWait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    const abort = () => { clearTimeout(timer); reject(signal?.reason ?? new DOMException('Aborted', 'AbortError')); };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function validateProfile(profile: AoxMeasurementProfile): void {
  if (profile.type !== 'aox' || !Number.isSafeInteger(profile.logicalBlockCount) || profile.logicalBlockCount < 2 || !Number.isSafeInteger(profile.blockByteLength) || profile.blockByteLength < 4) {
    throw new RangeError('Invalid AOX measurement profile');
  }
}

function anomaly(kind: AoxBlockAnomalyKind, observation: RawAoxBlockObservation, detail: string): AoxBlockAnomaly {
  return { kind, requestStart: observation.requestStart, requestRange: observation.requestRange, arrayIndex: observation.arrayIndex, base64: observation.base64, detail };
}

function decodeBase64Strict(value: string): Uint8Array {
  if (value.length === 0 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error('Value is not canonical Base64');
  const binary = atob(value);
  const decoded = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const canonical = btoa(String.fromCharCode(...decoded));
  if (canonical !== value) throw new Error('Value is not canonical Base64');
  return decoded;
}

export function crc16CcittResidual(bytes: Uint8Array): number {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

function arraysEqual(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function indexesToRanges(indexes: readonly number[]): LogicalBlockRange[] {
  const ranges: LogicalBlockRange[] = [];
  for (let cursor = 0; cursor < indexes.length;) {
    const start = indexes[cursor]!;
    let count = 1;
    while (cursor + count < indexes.length && indexes[cursor + count] === start + count) count++;
    ranges.push({ start, count });
    cursor += count;
  }
  return ranges;
}
