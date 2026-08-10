import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRECISION_AOX_MEASUREMENT_COUNT,
  buildPrecisionAoxMeasureUrl,
  buildPrecisionAoxScoringRequest,
  normalizedConstituentAox,
  parsePrecisionAoxResponse,
} from '../src/precisionAox.js';

const uuids = [
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000004',
];

describe('Precision AOX scoring contract', () => {
  it('uses the APK default of four as an explicit exported configuration value', () => {
    expect(DEFAULT_PRECISION_AOX_MEASUREMENT_COUNT).toBe(4);
  });

  it('builds the exact aligned series request with no MeasurementBlocks', () => {
    const request = buildPrecisionAoxScoringRequest({
      scannerSerial: '2NTEST', language: 'EN', requestUuid: '20000000-0000-4000-8000-000000000000',
      expectedMeasurementCount: 4,
      series: uuids.map((responseUuid, index) => ({
        normalizedAox: index + 1.1, aoxQ: index * 10, responseUuid,
        ...(index === 1 ? { errorPrediction: { positional_error_scaled: 0.1 } } : {}),
      })),
      discardedUuids: ['30000000-0000-4000-8000-000000000000'],
    });
    expect(request.measureType).toBe(1);
    expect(request.measureJson.MeasurementBlocks).toBe('');
    const additional = JSON.parse(request.measureJson.AdditionalData);
    expect(additional).toEqual({
      model: 'MRSRRS_SCN06', uuid: '20000000-0000-4000-8000-000000000000',
      AOX_extended_final: 'yes', measurement_type: 'aox_precise',
      series_results: [1.1, 2.1, 3.1, 4.1], series_q: [0, 10, 20, 30], series_uuid: uuids,
      series_errors: [null, { positional_error_scaled: 0.1 }, null, null],
      deleted_uuid: ['30000000-0000-4000-8000-000000000000'],
    });
    expect(JSON.stringify(request)).not.toContain('MeasurementBlocks":"payload');
  });

  it('rejects incomplete, duplicate, or misaligned series evidence', () => {
    const base = { scannerSerial: '2NTEST', language: 'EN', requestUuid: '20000000-0000-4000-8000-000000000000', expectedMeasurementCount: 4 };
    expect(() => buildPrecisionAoxScoringRequest({ ...base, series: [] })).toThrow(/configured number/);
    expect(() => buildPrecisionAoxScoringRequest({ ...base, expectedMeasurementCount: 2, series: [
      { normalizedAox: 1, aoxQ: 0, responseUuid: uuids[0]! },
      { normalizedAox: 2, aoxQ: 0, responseUuid: uuids[0]! },
    ] })).toThrow(/unique/);
  });

  it('constructs only the measure_type=1 final URL', () => {
    expect(buildPrecisionAoxMeasureUrl('https://de2.biozoom.net/', '2N A/B')).toBe(
      'https://de2.biozoom.net/measure/?serial_id=2N%20A%2FB&measure_type=1',
    );
  });

  it('parses confirmed response fields while preserving unknown quality values without interpretation', () => {
    const raw = {
      precise_aox: 4.3, precise_aox_floor_result: 4, precise_aox_std: 0.27,
      precise_measurements_std: 0, precise_quality_hand: 937, precise_quality_result: 'new-server-value', extra: true,
    };
    const parsed = parsePrecisionAoxResponse(raw);
    expect(parsed).toEqual({ ok: true, value: {
      preciseAox: 4.3, preciseAoxFloorResult: 4, preciseAoxStd: 0.27, preciseMeasurementsStd: 0,
      preciseQualityHand: 937, preciseQualityResult: 'new-server-value', rawResponse: raw,
    } });
  });

  it('strictly rejects missing/invalid score and invalid confirmed numeric fields', () => {
    expect(parsePrecisionAoxResponse({}).ok).toBe(false);
    expect(parsePrecisionAoxResponse({ precise_aox: '4.3' }).ok).toBe(false);
    expect(parsePrecisionAoxResponse({ precise_aox: 4.3, precise_aox_std: null }).ok).toBe(false);
  });

  it('uses the APK-confirmed secondary_aox normalization without changing the input', () => {
    expect(normalizedConstituentAox({ secondary_aox: { aox: 5.26 } }, 4.14)).toBe(4.6);
    expect(normalizedConstituentAox({}, 4.14)).toBe(4.14);
  });
});
