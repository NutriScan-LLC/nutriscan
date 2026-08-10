import type { ParsedResponse } from './response.js';

export const EXPERIMENTAL_AOX_LOGICAL_BLOCK_COUNT = 5_773;
export const EXPERIMENTAL_AOX_READ_RANGE = 150;

export interface ExperimentalAoxBlock {
  readonly logicalIndex: number;
  readonly internalIndex: number;
  readonly base64: string;
  readonly decodedBytes: readonly number[];
  readonly hex: string;
  readonly byteLength: number;
  readonly declaredLength: number;
  readonly crcResidual: number;
  readonly firstObservedAt: string;
}

export interface ExperimentalAoxAnomaly {
  readonly kind: 'response' | 'transport-error' | 'malformed' | 'not-yet-produced' | 'filler' | 'invalid-block' | 'unexpected-index' | 'duplicate' | 'conflicting-duplicate';
  readonly requestStart: number;
  readonly requestRange: number;
  readonly arrayIndex?: number;
  readonly detail: string;
  readonly base64?: string;
}

export interface ExperimentalAoxReadRecord {
  readonly startedAt: string;
  readonly completedAt: string;
  readonly start: number;
  readonly range: number;
  readonly responseKind: ParsedResponse['kind'] | 'transport-error';
  readonly returnedElementCount: number | null;
}

export interface ExperimentalAoxMeasurementArtifact {
  readonly experimental: true;
  readonly measurementNumber: number;
  readonly expectedLogicalBlockCount: 5773;
  readonly initialRange: 150;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly complete: boolean;
  readonly blocks: readonly ExperimentalAoxBlock[];
  readonly originalBase64Blocks: readonly string[];
  readonly measurementBlocks: string;
  readonly missingLogicalIndexes: readonly number[];
  readonly reads: readonly ExperimentalAoxReadRecord[];
  readonly anomalies: readonly ExperimentalAoxAnomaly[];
  readonly retryRounds: number;
}

export type ExperimentalReadFlashRange = (start: number, range: number) => Promise<ParsedResponse>;

export interface ExperimentalAoxDownloadOptions {
  readonly maxRetryRounds?: number;
  readonly acquisitionStartedAtMs?: number;
  readonly blocksPerSecond?: number;
  readonly beforeRead?: (start: number, range: number) => Promise<void>;
  readonly onReadComplete?: (record: ExperimentalAoxReadRecord, validBlockCount: number) => void;
}

/**
 * UNVERIFIED — complete measurement-21 retrieval experiment.
 *
 * Reproduces only the APK-observed block validation/reassembly algorithm.
 * It performs bounded read-flash calls supplied by the scanner layer and
 * never starts, deletes, erases, polls, or writes a measurement.
 */
export async function downloadExperimentalAoxMeasurement(
  measurementNumber: number,
  readRange: ExperimentalReadFlashRange,
  now: () => Date = () => new Date(),
  options: ExperimentalAoxDownloadOptions = {},
): Promise<ExperimentalAoxMeasurementArtifact> {
  const maxRetryRounds = options.maxRetryRounds ?? 3;
  const startedAt = now().toISOString();
  const blocks = new Map<number, ExperimentalAoxBlock>();
  const anomalies: ExperimentalAoxAnomaly[] = [];
  const reads: ExperimentalAoxReadRecord[] = [];
  const allFfLogicalIndexes = new Set<number>();

  const ingest = async (start: number, range: number): Promise<void> => {
    await options.beforeRead?.(start, range);
    const readStartedAt = now().toISOString();
    let response: ParsedResponse;
    try {
      response = await readRange(start, range);
    } catch (error) {
      const readCompletedAt = now().toISOString();
      const record = { startedAt: readStartedAt, completedAt: readCompletedAt, start, range, responseKind: 'transport-error' as const, returnedElementCount: null };
      reads.push(record);
      anomalies.push({ kind: 'transport-error', requestStart: start, requestRange: range, detail: error instanceof Error ? `${error.name}: ${error.message}` : String(error) });
      options.onReadComplete?.(record, blocks.size);
      return;
    }
    const readCompletedAt = now().toISOString();
    const data = response.kind === 'ok' && Array.isArray(response.json.data) ? response.json.data : null;
    const record = {
      startedAt: readStartedAt,
      completedAt: readCompletedAt,
      start,
      range,
      responseKind: response.kind,
      returnedElementCount: data?.length ?? null,
    };
    reads.push(record);
    if (data === null) {
      anomalies.push({ kind: 'response', requestStart: start, requestRange: range, detail: `Response kind/shape was ${response.kind}` });
      options.onReadComplete?.(record, blocks.size);
      return;
    }

    let first = true;
    for (let arrayIndex = 0; arrayIndex < data.length; arrayIndex++) {
      const value = data[arrayIndex];
      if (typeof value !== 'string') {
        anomalies.push({ kind: 'malformed', requestStart: start, requestRange: range, arrayIndex, detail: 'Data element was not a Base64 string' });
        first = false;
        continue;
      }
      let decoded: Uint8Array;
      try {
        decoded = decodeBase64(value);
      } catch (error) {
        anomalies.push({ kind: 'malformed', requestStart: start, requestRange: range, arrayIndex, base64: value, detail: error instanceof Error ? error.message : String(error) });
        first = false;
        continue;
      }
      const declaredLength = decoded.length >= 2 ? (decoded[0]! << 8) | decoded[1]! : -1;
      const internalIndex = decoded.length >= 4 ? decoded[2]! | (decoded[3]! << 8) : -1;
      const crcResidual = decoded.length >= 4 ? crc16CcittResidual(decoded.subarray(2)) : -1;
      if (decoded.length !== 33 || declaredLength !== decoded.length - 2 || crcResidual !== 0) {
        const allFf = decoded.length > 0 && decoded.every((byte) => byte === 0xff);
        const logicalPosition = start + arrayIndex;
        const estimatedProduced = options.acquisitionStartedAtMs === undefined
          ? Number.POSITIVE_INFINITY
          : Math.floor(((now().getTime() - options.acquisitionStartedAtMs) / 1000) * (options.blocksPerSecond ?? 400));
        if (allFf) allFfLogicalIndexes.add(logicalPosition);
        const kind = allFf ? 'not-yet-produced' : 'invalid-block';
        anomalies.push({
          kind, requestStart: start, requestRange: range, arrayIndex, base64: value,
          detail: `byteLength=${decoded.length}, declaredLength=${declaredLength}, internalIndex=${internalIndex}, crcResidual=${crcResidual}, estimatedProduced=${estimatedProduced}`,
        });
        first = false;
        continue;
      }

      let logicalIndex = internalIndex === 1 && first ? 0 : internalIndex;
      if (logicalIndex === 0 && internalIndex === 1 && blocks.has(0) && !blocks.has(1)) logicalIndex = 1;
      if (logicalIndex < 0 || logicalIndex >= EXPERIMENTAL_AOX_LOGICAL_BLOCK_COUNT) {
        anomalies.push({ kind: 'unexpected-index', requestStart: start, requestRange: range, arrayIndex, base64: value, detail: `Internal/logical index ${internalIndex}/${logicalIndex} is outside 0..5772` });
        first = false;
        continue;
      }
      const block: ExperimentalAoxBlock = {
        logicalIndex,
        internalIndex,
        base64: value,
        decodedBytes: Array.from(decoded),
        hex: Array.from(decoded, (byte) => byte.toString(16).padStart(2, '0')).join(' '),
        byteLength: decoded.length,
        declaredLength,
        crcResidual,
        firstObservedAt: readCompletedAt,
      };
      const prior = blocks.get(logicalIndex);
      if (prior !== undefined) {
        const same = prior.base64 === value && arraysEqual(prior.decodedBytes, block.decodedBytes);
        anomalies.push({
          kind: same ? 'duplicate' : 'conflicting-duplicate', requestStart: start, requestRange: range, arrayIndex,
          base64: value, detail: `Logical index ${logicalIndex} was already stored; preserved the first valid block`,
        });
      } else {
        blocks.set(logicalIndex, block);
      }
      first = false;
    }
    options.onReadComplete?.(record, blocks.size);
  };

  for (let start = 0; start < EXPERIMENTAL_AOX_LOGICAL_BLOCK_COUNT; start += EXPERIMENTAL_AOX_READ_RANGE) {
    await ingest(start, Math.min(EXPERIMENTAL_AOX_READ_RANGE, EXPERIMENTAL_AOX_LOGICAL_BLOCK_COUNT - start));
  }

  let retryRounds = 0;
  while (blocks.size < EXPERIMENTAL_AOX_LOGICAL_BLOCK_COUNT && retryRounds < maxRetryRounds) {
    retryRounds++;
    for (const [start, range] of missingRanges(blocks, EXPERIMENTAL_AOX_READ_RANGE)) await ingest(start, range);
  }

  const missingLogicalIndexes = missingIndexes(blocks);
  for (const logicalIndex of missingLogicalIndexes) {
    if (allFfLogicalIndexes.has(logicalIndex)) {
      anomalies.push({
        kind: 'filler', requestStart: logicalIndex, requestRange: 1,
        detail: `Logical index ${logicalIndex} remained all-FF after bounded missing-range retries`,
      });
    }
  }
  const orderedBlocks = Array.from({ length: EXPERIMENTAL_AOX_LOGICAL_BLOCK_COUNT }, (_, index) => blocks.get(index)).filter(
    (block): block is ExperimentalAoxBlock => block !== undefined,
  );
  const originalBase64Blocks = orderedBlocks.map((block) => block.base64);
  return {
    experimental: true,
    measurementNumber,
    expectedLogicalBlockCount: EXPERIMENTAL_AOX_LOGICAL_BLOCK_COUNT,
    initialRange: EXPERIMENTAL_AOX_READ_RANGE,
    startedAt,
    completedAt: now().toISOString(),
    complete: missingLogicalIndexes.length === 0 && orderedBlocks.length === EXPERIMENTAL_AOX_LOGICAL_BLOCK_COUNT,
    blocks: orderedBlocks,
    originalBase64Blocks,
    measurementBlocks: originalBase64Blocks.join(''),
    missingLogicalIndexes,
    reads,
    anomalies,
    retryRounds,
  };
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function crc16CcittResidual(bytes: Uint8Array): number {
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

function missingIndexes(blocks: ReadonlyMap<number, ExperimentalAoxBlock>): number[] {
  const result: number[] = [];
  for (let index = 0; index < EXPERIMENTAL_AOX_LOGICAL_BLOCK_COUNT; index++) if (!blocks.has(index)) result.push(index);
  return result;
}

function missingRanges(blocks: ReadonlyMap<number, ExperimentalAoxBlock>, maxRange: number): Array<[number, number]> {
  const missing = missingIndexes(blocks);
  const result: Array<[number, number]> = [];
  for (let cursor = 0; cursor < missing.length;) {
    const start = missing[cursor]!;
    let range = 1;
    while (cursor + range < missing.length && missing[cursor + range] === start + range && range < maxRange) range++;
    result.push([start, range]);
    cursor += range;
  }
  return result;
}
