import { describe, expect, it } from 'vitest';
import type { RawAoxMeasurementArtifact } from '@nutriscan/scanner';
import {
  buildQuickAoxScoringRequest,
  buildQuickAoxMeasureUrl,
  buildQuickAoxPreRequestUrl,
  parseQuickAoxPreRequest,
  QUICK_AOX_MULTIPART_CONTRACT,
} from '../src/quick-aox.js';

function artifact(overrides: Partial<RawAoxMeasurementArtifact> = {}): RawAoxMeasurementArtifact {
  const originalBase64Blocks = ['AAAA', 'BBBB'];
  return {
    scannerSerial: '2N2400A5B70F5E3C9251',
    measurementNumber: 42,
    type: 'aox',
    profile: { type: 'aox', logicalBlockCount: 2, blockByteLength: 33 },
    blocks: [
      { logicalIndex: 0, internalIndex: 1, base64: 'AAAA', decodedBytes: [], byteLength: 33, declaredLength: 31, crcResidual: 0, firstObservedAt: null },
      { logicalIndex: 1, internalIndex: 1, base64: 'BBBB', decodedBytes: [], byteLength: 33, declaredLength: 31, crcResidual: 0, firstObservedAt: null },
    ],
    originalBase64Blocks,
    measurementBlocks: originalBase64Blocks.join(''),
    missingLogicalIndexes: [],
    missingRanges: [],
    anomalies: [],
    summary: { expectedBlockCount: 2, validBlockCount: 2, missingBlockCount: 0, anomalyCount: 0, complete: true },
    startedAt: '2026-08-09T00:00:00.000Z',
    completedAt: '2026-08-09T00:00:30.000Z',
    reads: [],
    retryRounds: 0,
    failure: null,
    ...overrides,
  };
}

describe('browser-safe Quick AOX scoring contract', () => {
  it('builds the general runtime-confirmed request and preserves exact MeasurementBlocks', () => {
    const source = artifact();
    const request = buildQuickAoxScoringRequest(source, {
      language: 'EN',
      uuid: '11111111-1111-4111-8111-111111111111',
    });

    expect(request).toMatchObject({ scannerSerial: source.scannerSerial, measurementNumber: 42 });
    expect(request.measurementBlocks).toBe('AAAABBBB');
    expect(request.measureJson).toEqual({
      Serial: '2N2400A5B70F5E3C9251',
      MeasurementBlocks: 'AAAABBBB',
      UserID: 'ffffffffffffffffffffffffffffffff',
      lang: 'EN',
      AdditionalData: JSON.stringify({
        model: 'MRSRRS_SCN06',
        veggie_04: true,
        uuid: '11111111-1111-4111-8111-111111111111',
        measurement_type: 'aox',
      }),
    });
  });

  it('exposes the confirmed endpoint and multipart contract without performing HTTP', () => {
    expect(buildQuickAoxPreRequestUrl('https://de2.biozoom.net/', '2N A/B')).toBe(
      'https://de2.biozoom.net/pre-request/?serial_id=2N%20A%2FB&measure_type=0',
    );
    expect(buildQuickAoxMeasureUrl('https://de2.biozoom.net/', '2N A/B')).toBe(
      'https://de2.biozoom.net/measure/?serial_id=2N%20A%2FB&measure_type=0',
    );
    expect(QUICK_AOX_MULTIPART_CONTRACT).toEqual({
      fieldName: 'measure_json', filename: 'measure.json', contentType: 'application/json',
    });
    expect(() => buildQuickAoxMeasureUrl('http://example.com', 'serial')).toThrow('HTTPS');
  });

  it('rejects incomplete, inconsistent, unsupported, and malformed inputs', () => {
    expect(() => buildQuickAoxScoringRequest(artifact({
      summary: { expectedBlockCount: 2, validBlockCount: 1, missingBlockCount: 1, anomalyCount: 0, complete: false },
      failure: { kind: 'incomplete', message: 'missing' },
    }), { language: 'EN', uuid: '11111111-1111-4111-8111-111111111111' })).toThrow('complete');
    expect(() => buildQuickAoxScoringRequest(artifact({ measurementBlocks: 'changed' }), {
      language: 'EN', uuid: '11111111-1111-4111-8111-111111111111',
    })).toThrow('ordered Base64');
    expect(() => buildQuickAoxScoringRequest(artifact({ scannerSerial: '1X123' }), {
      language: 'EN', uuid: '11111111-1111-4111-8111-111111111111',
    })).toThrow('2E/2N');
    expect(() => buildQuickAoxScoringRequest(artifact(), { language: 'english', uuid: 'bad' })).toThrow('language');
    expect(() => buildQuickAoxScoringRequest(artifact(), { language: 'EN', uuid: 'bad' })).toThrow('UUID v4');
  });

  it('parses and preserves the runtime-confirmed pre-request shape', () => {
    const raw = {
      new_pre_request_req: false,
      waiting_time_ms: 109,
      new_pre_request_delay_ms: 0,
      recommended_server: 'https://de2.biozoom.net/',
      future: { value: true },
    };
    const result = parseQuickAoxPreRequest(raw);
    expect(result).toEqual({
      ok: true,
      value: {
        recommendedServer: 'https://de2.biozoom.net',
        waitingTimeMs: 109,
        newPreRequestReq: false,
        newPreRequestDelayMs: 0,
        rawResponse: raw,
      },
    });
  });

  it('returns a typed unsupported result for new_pre_request_req true', () => {
    const raw = { new_pre_request_req: true, waiting_time_ms: 10, recommended_server: 'https://de2.biozoom.net' };
    const result = parseQuickAoxPreRequest(raw);
    expect(result).toMatchObject({ ok: false, error: { code: 'unsupported-repeat-pre-request', rawResponse: raw } });
  });

  it.each([
    [null, 'response-not-object'],
    [{ waiting_time_ms: 0 }, 'missing-recommended-server'],
    [{ recommended_server: 'http://example.com', waiting_time_ms: 0 }, 'invalid-recommended-server'],
    [{ recommended_server: 'https://user:pass@example.com', waiting_time_ms: 0 }, 'invalid-recommended-server'],
    [{ recommended_server: 'https://example.com' }, 'missing-waiting-time'],
    [{ recommended_server: 'https://example.com', waiting_time_ms: -1 }, 'invalid-waiting-time'],
    [{ recommended_server: 'https://example.com', waiting_time_ms: Number.NaN }, 'invalid-waiting-time'],
  ])('rejects malformed pre-request %#', (raw, code) => {
    expect(parseQuickAoxPreRequest(raw)).toMatchObject({ ok: false, error: { code } });
  });
});
