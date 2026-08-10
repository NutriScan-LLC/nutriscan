import { describe, expect, it } from 'vitest';
import {
  analyzeM7FlashResponse,
  analyzeM8FlashResponse,
  analyzeM9FlashResponse,
} from '../../src/protocol/experimentalM7.js';
import { parseResponseFrame } from '../../src/protocol/response.js';

const SAVED_BLOCKS = [
  'AB8BAACYHQCAFS0PgLsFAAQAIAAAAABgAv//AAAAADTZ',
  'AB8BAADE3hbWT2KunRwkhDGlIorTUzYp+mXOXOq+fTsw',
  'AB8CAACmclbU1G4wLk6frUkzE9eFLJSYsS8OobHvlzJo',
];

function responseWithData(data: unknown) {
  return parseResponseFrame(new TextEncoder().encode(JSON.stringify({ command: 'read-flash', data })));
}

describe('analyzeM7FlashResponse', () => {
  it('decodes every returned element and compares it exactly with saved M4-M6 blocks', () => {
    const result = analyzeM7FlashResponse(responseWithData(SAVED_BLOCKS));

    expect(result.kind).toBe('analyzed');
    if (result.kind !== 'analyzed') return;
    expect(result.returnedElementCount).toBe(3);
    expect(result.blocks).toHaveLength(3);
    expect(result.blocks.map((block) => block.matchesSavedIndividualBlock)).toEqual(['M4', 'M5', 'M6']);
    expect(result.blocks.map((block) => block.byteLength)).toEqual([33, 33, 33]);
    expect(result.blocks.map((block) => block.bigEndianLength)).toEqual([31, 31, 31]);
    expect(result.blocks.map((block) => block.littleEndianInternalIndex)).toEqual([1, 1, 2]);
    expect(result.blocks.map((block) => block.crcResidual)).toEqual([0, 0, 0]);
    expect(result.blocks[0]!.hex).toBe(
      '00 1f 01 00 00 98 1d 00 80 15 2d 0f 80 bb 05 00 04 00 20 00 00 00 00 60 02 ff ff 00 00 00 00 34 d9',
    );
  });

  it('uses the same complete per-element analysis for M8 without inferring a total count', () => {
    const result = analyzeM8FlashResponse(responseWithData(SAVED_BLOCKS));
    expect(result.kind).toBe('analyzed');
    if (result.kind !== 'analyzed') return;
    expect(result.returnedElementCount).toBe(3);
    expect(result.blocks.map((block) => block.matchesSavedIndividualBlock)).toEqual(['M4', 'M5', 'M6']);
  });

  it('uses the same complete per-element analysis for the non-overlapping M9 range', () => {
    const result = analyzeM9FlashResponse(responseWithData(['AA==', 'AQ==']));
    expect(result.kind).toBe('analyzed');
    if (result.kind !== 'analyzed') return;
    expect(result.returnedElementCount).toBe(2);
    expect(result.blocks.map((block) => block.hex)).toEqual(['00', '01']);
  });

  it('reports a distinct valid block as unmatched without normalizing it', () => {
    const result = analyzeM7FlashResponse(responseWithData(['AA==']));

    expect(result.kind).toBe('analyzed');
    if (result.kind !== 'analyzed') return;
    expect(result.blocks[0]).toMatchObject({
      byteLength: 1,
      hex: '00',
      bigEndianLength: undefined,
      littleEndianInternalIndex: undefined,
      matchesSavedIndividualBlock: null,
    });
  });

  it('reports analysis unavailable when data is not an array of strings', () => {
    expect(analyzeM7FlashResponse(responseWithData('not-an-array')).kind).toBe('unavailable');
    expect(analyzeM7FlashResponse(responseWithData([123])).kind).toBe('unavailable');
  });

  it('reports analysis unavailable for a non-ok ParsedResponse', () => {
    const error = parseResponseFrame(new TextEncoder().encode('{"command":"read-flash","type":"error"}'));
    expect(analyzeM7FlashResponse(error)).toEqual({
      kind: 'unavailable',
      reason: 'ParsedResponse kind was error, not ok',
    });
  });
});
