import { describe, expect, it } from 'vitest';
import {
  AoxAcquisitionTimeoutError,
  downloadAndReassembleAoxMeasurement,
  InvalidAoxFlashResponseError,
  validateAndReassembleAoxBlocks,
  type AoxMeasurementProfile,
  type RawAoxBlockObservation,
} from '../../src/protocol/aoxMeasurement.js';
import type { ParsedResponse } from '../../src/protocol/response.js';

const profile = (logicalBlockCount: number): AoxMeasurementProfile => ({ type: 'aox', logicalBlockCount, blockByteLength: 33 });

function crc(bytes: Uint8Array): number {
  let value = 0xffff;
  for (const byte of bytes) {
    value ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) value = value & 0x8000 ? ((value << 1) ^ 0x1021) & 0xffff : (value << 1) & 0xffff;
  }
  return value;
}

function block(logicalIndex: number, mutate?: (bytes: Uint8Array) => void): string {
  const internalIndex = logicalIndex === 0 ? 1 : logicalIndex;
  const bytes = new Uint8Array(33);
  bytes[1] = 31;
  bytes[2] = internalIndex & 0xff;
  bytes[3] = internalIndex >> 8;
  for (let index = 4; index < 31; index++) bytes[index] = (logicalIndex + index) & 0xff;
  const checksum = crc(bytes.subarray(2, 31));
  bytes[31] = checksum >> 8;
  bytes[32] = checksum & 0xff;
  mutate?.(bytes);
  return btoa(String.fromCharCode(...bytes));
}

function observations(values: readonly string[], start = 0): RawAoxBlockObservation[] {
  return values.map((base64, arrayIndex) => ({ base64, requestStart: start, requestRange: values.length, arrayIndex }));
}

function response(data: unknown[]): ParsedResponse {
  return { kind: 'ok', rawBytes: new Uint8Array(), strippedLeadingByteCount: 0, text: '{}', json: { data }, command: 'read-flash', serial: 'scanner', callIndex: 'call' };
}

describe('validateAndReassembleAoxBlocks', () => {
  it('reconstructs all 5,773 blocks in logical order and concatenates exact Base64', () => {
    const values = Array.from({ length: 5_773 }, (_, index) => block(index));
    const result = validateAndReassembleAoxBlocks(observations(values));
    expect(result.summary).toMatchObject({ complete: true, validBlockCount: 5_773, missingBlockCount: 0 });
    expect(result.blocks[0]).toMatchObject({ logicalIndex: 0, internalIndex: 1 });
    expect(result.blocks[1]).toMatchObject({ logicalIndex: 1, internalIndex: 1 });
    expect(result.measurementBlocks).toBe(values.join(''));
  });

  it('classifies malformed Base64, framing, CRC, all-FF, missing ranges, and conflicts without accepting them', () => {
    const validZero = block(0);
    const conflictingZero = block(0, (bytes) => { bytes[4] ^= 1; const checksum = crc(bytes.subarray(2, 31)); bytes[31] = checksum >> 8; bytes[32] = checksum & 0xff; });
    const badCrc = block(2, (bytes) => { bytes[4] ^= 1; });
    const badDeclaredLength = block(2, (bytes) => { bytes[1] = 30; });
    const result = validateAndReassembleAoxBlocks([
      ...observations([validZero]),
      ...observations([conflictingZero]),
      ...observations(['not base64'], 1),
      ...observations([btoa(String.fromCharCode(...new Uint8Array(33).fill(0xff)))], 1),
      ...observations([badCrc], 2),
      ...observations([badDeclaredLength], 2),
      ...observations([btoa('short')], 2),
    ], { profile: profile(3) });
    expect(result.summary.complete).toBe(false);
    expect(result.missingLogicalIndexes).toEqual([1, 2]);
    expect(result.missingRanges).toEqual([{ start: 1, count: 2 }]);
    expect(result.anomalies.map(({ kind }) => kind)).toEqual(expect.arrayContaining([
      'conflicting-duplicate', 'invalid-base64', 'all-ff', 'crc-failure', 'invalid-declared-length', 'invalid-length',
    ]));
  });
});

describe('downloadAndReassembleAoxMeasurement', () => {
  it('waits until each requested range is behind the production frontier', async () => {
    let nowMs = 0;
    const waits: number[] = [];
    const calls: Array<[number, number, number]> = [];
    const artifact = await downloadAndReassembleAoxMeasurement('scanner', 1, async (start, range) => {
      calls.push([start, range, nowMs]);
      return response(Array.from({ length: range }, (_, offset) => block(start + offset)));
    }, {
      profile: profile(4), range: 2, measurementAcknowledgedAt: new Date(0).toISOString(),
      now: () => new Date(nowMs), productionBlocksPerSecond: 2, productionSafetyMarginMs: 750,
      wait: async (ms) => { waits.push(ms); nowMs += ms; },
    });
    expect(calls).toEqual([[0, 2, 1_750], [2, 2, 2_750]]);
    expect(waits).toEqual([1_750, 1_000]);
    expect(artifact.summary.complete).toBe(true);
  });

  it('retries only missing ranges and returns an explicit complete artifact', async () => {
    const calls: Array<[number, number]> = [];
    let withheldTwo = false;
    const artifact = await downloadAndReassembleAoxMeasurement('scanner', 23, async (start, range) => {
      calls.push([start, range]);
      const data = Array.from({ length: range }, (_, offset) => {
        const logical = start + offset;
        if (!withheldTwo && logical === 2) {
          withheldTwo = true;
          return btoa(String.fromCharCode(...new Uint8Array(33).fill(0xff)));
        }
        return block(logical);
      });
      return response(data);
    }, { profile: profile(4), range: 2, maxMissingRangeRetries: 1 });
    expect(calls).toEqual([[0, 2], [2, 2], [2, 1]]);
    expect(artifact.summary.complete).toBe(true);
    expect(artifact.failure).toBeNull();
    expect(artifact.retryRounds).toBe(1);
  });

  it('returns explicit incomplete state after bounded retries', async () => {
    const artifact = await downloadAndReassembleAoxMeasurement(undefined, 23, async (start, range) => response(
      Array.from({ length: range }, (_, offset) => start + offset === 2 ? '////' : block(start + offset)),
    ), { profile: profile(3), range: 3, maxMissingRangeRetries: 1 });
    expect(artifact.summary.complete).toBe(false);
    expect(artifact.missingLogicalIndexes).toEqual([2]);
    expect(artifact.failure).toMatchObject({ kind: 'incomplete' });
  });

  it('propagates transport failures unchanged and throws typed acquisition timeouts', async () => {
    const transportError = new Error('serial disconnected');
    await expect(downloadAndReassembleAoxMeasurement(undefined, 23, async () => { throw transportError; }, { profile: profile(2) })).rejects.toBe(transportError);
    let tick = 0;
    await expect(downloadAndReassembleAoxMeasurement(undefined, 23, async () => response([]), {
      profile: profile(2), timeoutMs: 1, now: () => new Date(tick++ * 2),
    })).rejects.toBeInstanceOf(AoxAcquisitionTimeoutError);
  });

  it('throws a typed error for an invalid flash response shape', async () => {
    const invalid: ParsedResponse = { kind: 'parse-error', rawBytes: new Uint8Array([1]), strippedLeadingByteCount: 0, text: 'x', error: new SyntaxError('bad') };
    await expect(downloadAndReassembleAoxMeasurement(undefined, 23, async () => invalid, {
      profile: profile(2),
    })).rejects.toBeInstanceOf(InvalidAoxFlashResponseError);
  });
});
