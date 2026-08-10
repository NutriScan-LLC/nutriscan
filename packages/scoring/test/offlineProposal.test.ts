import { describe, expect, it } from 'vitest';
import type { RawAoxMeasurementArtifact } from '@nutriscan/scanner';
import { buildOfflineBioZoomScoringProposal } from '../src/index.js';

function completeArtifact(): RawAoxMeasurementArtifact {
  const blocks = Array.from({ length: 5_773 }, (_, logicalIndex) => ({
    logicalIndex, internalIndex: Math.max(1, logicalIndex), base64: 'AAAA', decodedBytes: [],
    byteLength: 33, declaredLength: 31, crcResidual: 0, firstObservedAt: null,
  }));
  return {
    profile: { type: 'aox', logicalBlockCount: 5_773, blockByteLength: 33 },
    blocks, originalBase64Blocks: blocks.map((block) => block.base64),
    measurementBlocks: blocks.map((block) => block.base64).join(''),
    missingLogicalIndexes: [], missingRanges: [], anomalies: [],
    summary: { expectedBlockCount: 5_773, validBlockCount: 5_773, missingBlockCount: 0, anomalyCount: 0, complete: true },
    scannerSerial: '2N2400A5B70F5E3C9251', measurementNumber: 22, type: 'aox',
    startedAt: '2026-08-09T00:00:00.000Z', completedAt: '2026-08-09T00:01:00.000Z',
    reads: [], retryRounds: 0, failure: null,
  };
}

describe('offline BioZoom scoring proposal', () => {
  it('constructs the APK-confirmed request shape and hashes exact MeasurementBlocks without networking', () => {
    const proposal = buildOfflineBioZoomScoringProposal(completeArtifact(), {
      language: 'EN', now: () => new Date('2026-08-09T01:00:00.000Z'),
      uuid: () => '11111111-1111-4111-8111-111111111111',
    });

    expect(proposal.offlineOnly).toBe(true);
    expect(proposal.preRequest.url.value).toBe('https://de2.biozoom.net/pre-request/?serial_id=2N2400A5B70F5E3C9251&measure_type=0');
    expect(proposal.measureRequest.multipartFieldName.value).toBe('measure_json');
    expect(proposal.measureRequest.filename.value).toBe('measure.json');
    expect(proposal.measureRequest.measureJson.value).toMatchObject({
      Serial: '2N2400A5B70F5E3C9251', UserID: 'ffffffffffffffffffffffffffffffff', lang: 'EN',
    });
    expect(JSON.parse(proposal.measureRequest.measureJson.value.AdditionalData)).toEqual({
      model: 'MRSRRS_SCN06', veggie_04: true, uuid: '11111111-1111-4111-8111-111111111111', measurement_type: 'aox',
    });
    expect(proposal.acquisition.blockCount.value).toBe(5_773);
    expect(proposal.acquisition.measurementBlocksLength.value).toBe(23_092);
    expect(proposal.acquisition.measurementBlocksSha256.value).toMatch(/^[0-9a-f]{64}$/);
    expect(proposal.networkTransmission.value).toBe(false);
  });

  it('rejects incomplete acquisition and unsupported scanner mappings', () => {
    const incomplete = completeArtifact();
    const badSummary = { ...incomplete, summary: { ...incomplete.summary, complete: false }, failure: { kind: 'incomplete' as const, message: 'missing' } };
    expect(() => buildOfflineBioZoomScoringProposal(badSummary, { language: 'EN' })).toThrow('complete');
    expect(() => buildOfflineBioZoomScoringProposal({ ...completeArtifact(), scannerSerial: '1E123' }, { language: 'EN' })).toThrow('2E/2N');
  });
});
