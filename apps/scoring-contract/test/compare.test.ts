import { describe, expect, it } from 'vitest';
import { compareScoringContracts, type ScoringContractSnapshot } from '../src/compare.js';

const snapshot = (overrides: Partial<ScoringContractSnapshot> = {}): ScoringContractSnapshot => ({
  endpoint: 'https://vws.example/measure/', method: 'POST',
  query: { serial_id: 'scanner', measure_type: '0' },
  multipart: { fieldName: 'measure_json', filename: 'measure.json', contentType: 'application/json', boundary: 'runtime-only' },
  measureJson: {
    Serial: 'scanner', MeasurementBlocks: 'AQID', UserID: 'ffffffffffffffffffffffffffffffff', lang: 'en',
    AdditionalData: JSON.stringify({ uuid: 'id', measurement_type: 'aox' }),
  },
  headers: { 'Content-Type': 'multipart/form-data; boundary=random', Origin: 'https://localhost' },
  session: { sendsCookies: false, sendsAuthorization: false },
  ...overrides,
});

describe('offline scoring contract comparison', () => {
  it('compares payloads by length/hash without exposing MeasurementBlocks', () => {
    const comparison = compareScoringContracts(snapshot(), snapshot({
      multipart: { fieldName: 'measure_json', filename: 'measure.json', contentType: 'application/json', boundary: 'different' },
      headers: { 'Content-Type': 'multipart/form-data; boundary=other', Origin: 'https://localhost' },
    }));
    expect(comparison.matches).toBe(true);
    expect(comparison.officialMeasurementBlocks).toMatchObject({ length: 4, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(JSON.stringify(comparison)).not.toContain('AQID');
  });

  it('reports structural, metadata, and MeasurementBlocks identity differences', () => {
    const comparison = compareScoringContracts(snapshot(), snapshot({
      endpoint: 'https://other/measure/',
      measureJson: { ...snapshot().measureJson, MeasurementBlocks: 'different', lang: 'de', AdditionalData: { uuid: 'other' } },
    }));
    expect(comparison.matches).toBe(false);
    expect(comparison.differences.map(({ path }) => path)).toEqual(expect.arrayContaining([
      'endpoint', 'measureJson.lang', 'measureJson.AdditionalData', 'measureJson.MeasurementBlocks.sha256',
    ]));
  });
});
