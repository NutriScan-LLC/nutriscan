import { describe, expect, it } from 'vitest';
import {
  downloadExperimentalAoxMeasurement,
  EXPERIMENTAL_AOX_LOGICAL_BLOCK_COUNT,
} from '../../src/protocol/experimentalMeasurementDownload.js';
import type { ParsedResponse } from '../../src/protocol/response.js';

function crc(bytes: Uint8Array): number {
  let value = 0xffff;
  for (const byte of bytes) {
    value ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) value = value & 0x8000 ? ((value << 1) ^ 0x1021) & 0xffff : (value << 1) & 0xffff;
  }
  return value;
}

function block(internalIndex: number): string {
  const bytes = new Uint8Array(33);
  bytes[0] = 0;
  bytes[1] = 31;
  bytes[2] = internalIndex & 0xff;
  bytes[3] = internalIndex >> 8;
  for (let index = 4; index < 31; index++) bytes[index] = (internalIndex + index) & 0xff;
  const residual = crc(bytes.subarray(2, 31));
  bytes[31] = residual >> 8;
  bytes[32] = residual & 0xff;
  return btoa(String.fromCharCode(...bytes));
}

function response(data: unknown[]): ParsedResponse {
  return {
    kind: 'ok', rawBytes: new Uint8Array(), strippedLeadingByteCount: 0, text: '{}',
    json: { data }, command: 'read-flash', serial: 'scanner', callIndex: 'call',
  };
}

describe('experimental complete AOX downloader', () => {
  it('reconstructs 5773 logical blocks using fixed ranges and the duplicate initial-index rule', async () => {
    const calls: Array<[number, number]> = [];
    const artifact = await downloadExperimentalAoxMeasurement(21, async (start, range) => {
      calls.push([start, range]);
      const data = Array.from({ length: range }, (_, offset) => {
        const logical = start + offset;
        return block(logical === 0 ? 1 : logical);
      });
      return response(data);
    });

    expect(artifact.complete).toBe(true);
    expect(artifact.blocks).toHaveLength(EXPERIMENTAL_AOX_LOGICAL_BLOCK_COUNT);
    expect(artifact.blocks[0]).toMatchObject({ logicalIndex: 0, internalIndex: 1, crcResidual: 0 });
    expect(artifact.blocks[1]).toMatchObject({ logicalIndex: 1, internalIndex: 1, crcResidual: 0 });
    expect(calls[0]).toEqual([0, 150]);
    expect(calls.at(-1)).toEqual([5700, 73]);
    expect(calls.every(([, range]) => range <= 150)).toBe(true);
    expect(artifact.measurementBlocks).toBe(artifact.originalBase64Blocks.join(''));
  });

  it('records malformed data and retries only the missing logical range', async () => {
    const calls: Array<[number, number]> = [];
    let omitted = false;
    const artifact = await downloadExperimentalAoxMeasurement(21, async (start, range) => {
      calls.push([start, range]);
      const data = Array.from({ length: range }, (_, offset) => {
        const logical = start + offset;
        if (logical === 200 && !omitted) {
          omitted = true;
          return '////////////////////////////////////////////';
        }
        return block(logical === 0 ? 1 : logical);
      });
      return response(data);
    });

    expect(artifact.complete).toBe(true);
    expect(artifact.retryRounds).toBe(1);
    expect(calls.at(-1)).toEqual([200, 1]);
    expect(artifact.anomalies).toContainEqual(expect.objectContaining({ kind: 'not-yet-produced', requestStart: 150, arrayIndex: 50 }));
  });
});
