import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  APK_0_50_107_QUICK_AOX_POLICY,
  interpretQuickAoxQuality,
  parseQuickAoxResponse,
  type ParsedQuickAoxResponse,
  type QuickAoxQualityPolicy,
} from '../src/index.js';

function parse(input: unknown): ParsedQuickAoxResponse {
  const result = parseQuickAoxResponse(input);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function decide(qualityCode: unknown) {
  return interpretQuickAoxQuality(parse({ aox: 5.6, aox_q: qualityCode })).decision;
}

describe('Quick AOX response parsing', () => {
  it('parses the actual saved runtime measurement-35 response and preserves it completely', () => {
    const artifactUrl = new URL('../diagnostics/2026-08-09T14-11-55.775Z-biozoom-paired-measurement-35.json', import.meta.url);
    const artifact = JSON.parse(readFileSync(artifactUrl, 'utf8')) as { measurementResponse: { parsedJson: unknown } };
    const response = artifact.measurementResponse.parsedJson;
    const parsed = parse(response);
    const interpreted = interpretQuickAoxQuality(parsed);

    expect(interpreted.score).toBe(5.6);
    expect(interpreted.qualityCode).toBe(40);
    expect(interpreted.decision).toMatchObject({ accepted: true, action: 'accept', recognizedCode: true });
    expect(interpreted.rawResponse).toBe(response);
    expect(interpreted.rawResponse).toMatchObject({
      aox_int_result: 6,
      veggie_result: 473.02,
      uuid: '8222c147-7f84-431c-b61a-0e94c0532284',
    });
    expect(interpreted.diagnostics).toBe(interpreted.rawResponse.error_prediction);
    expect(interpreted.diagnostics).toMatchObject({
      qnn_error: { error: 0.014590911567211151 },
      total_error: 0.06053598630767265,
    });
  });

  it('preserves error_prediction and unknown fields without interpreting their shape', () => {
    const diagnostics = { future_metric: { arbitrary: ['value'] } };
    const response = { aox: 4.2, aox_q: 40, error_prediction: diagnostics, future_server_field: { nested: true } };
    const parsed = parse(response);

    expect(parsed.diagnosticsPresent).toBe(true);
    expect(parsed.diagnostics).toBe(diagnostics);
    expect(parsed.rawResponse).toBe(response);
    expect(parsed.rawResponse.future_server_field).toEqual({ nested: true });
  });

  it('distinguishes absent diagnostics from a present null value', () => {
    expect(parse({ aox: 5, aox_q: 40 })).toMatchObject({ diagnosticsPresent: false, diagnostics: undefined });
    expect(parse({ aox: 5, aox_q: 40, error_prediction: null })).toMatchObject({ diagnosticsPresent: true, diagnostics: null });
  });

  it.each([
    [{}, 'missing-score'],
    [{ aox_q: 40 }, 'missing-score'],
    [{ aox: null, aox_q: 40 }, 'invalid-score'],
    [{ aox: '5.6', aox_q: 40 }, 'invalid-score'],
    [{ aox: Number.NaN, aox_q: 40 }, 'invalid-score'],
    [{ aox: Number.POSITIVE_INFINITY, aox_q: 40 }, 'invalid-score'],
    [null, 'response-not-object'],
    [[], 'response-not-object'],
  ])('rejects malformed score response %#', (input, code) => {
    const result = parseQuickAoxResponse(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(code);
      expect(result.error.rawResponse).toBe(input);
    }
  });

  it('does not mutate the input while parsing or interpreting', () => {
    const input = { aox: 5.6, aox_q: 50, error_prediction: { qnn_error: { error: 0.1 } }, unknown: [1, 2] };
    const before = structuredClone(input);
    interpretQuickAoxQuality(parse(input));
    expect(input).toEqual(before);
  });
});

describe('APK-compatible Quick AOX policy', () => {
  it.each([
    [50, 'rescan', 'surrounding-light-or-incomplete-coverage'],
    [60, 'rescan', 'handling-coverage-or-movement'],
    [70, 'rescan', 'transmission-or-integrity'],
    [80, 'resolve-device-condition', 'low-led-voltage'],
    [90, 'resolve-device-condition', 'low-scanner-battery'],
    [100, 'stop', 'prototype-data-received'],
  ] as const)('routes synthetic explicit code %i independently of UI copy', (qualityCode, action, reason) => {
    expect(decide(qualityCode)).toMatchObject({ qualityCode, accepted: false, action, reason, recognizedCode: true });
  });

  it.each([37, 44, 45, -1])('accepts unknown synthetic value %i by the APK threshold without recognizing it', (qualityCode) => {
    expect(decide(qualityCode)).toMatchObject({ qualityCode, accepted: true, action: 'accept', reason: null, recognizedCode: false });
  });

  it.each([55, 101, 150])('generically rejects unknown synthetic value %i without recognizing it', (qualityCode) => {
    expect(decide(qualityCode)).toMatchObject({
      qualityCode,
      accepted: false,
      action: 'rescan',
      reason: 'generic-quality-rejection',
      recognizedCode: false,
    });
  });

  it.each([
    [{ aox: 5.6 }, 'missing', 'missing-quality-code'],
    [{ aox: 5.6, aox_q: null }, 'null', 'null-quality-code'],
    [{ aox: 5.6, aox_q: '40' }, 'invalid', 'invalid-quality-code'],
    [{ aox: 5.6, aox_q: Number.NaN }, 'invalid', 'invalid-quality-code'],
    [{ aox: 5.6, aox_q: Number.NEGATIVE_INFINITY }, 'invalid', 'invalid-quality-code'],
  ] as const)('does not make an acceptance decision for invalid quality input %#', (response, state, reason) => {
    const result = interpretQuickAoxQuality(parse(response));
    expect(result.decision).toMatchObject({
      qualityCode: null,
      qualityCodeState: state,
      accepted: false,
      action: 'unable-to-decide',
      reason,
      recognizedCode: false,
    });
    expect(result.rawQualityCode).toBe('aox_q' in response ? response.aox_q : undefined);
  });

  it('supports injected routing and recognition policy without changing parsing', () => {
    const policy: QuickAoxQualityPolicy = {
      name: 'customer-reviewed-policy',
      isRecognizedCode: (qualityCode) => qualityCode === 37,
      classify: (qualityCode) => qualityCode === 37
        ? { accepted: false, action: 'stop', reason: 'generic-quality-rejection' }
        : APK_0_50_107_QUICK_AOX_POLICY.classify(qualityCode),
    };
    const result = interpretQuickAoxQuality(parse({ aox: 5.6, aox_q: 37 }), policy);

    expect(result.decision).toEqual({
      qualityCode: 37,
      qualityCodeState: 'valid',
      accepted: false,
      action: 'stop',
      reason: 'generic-quality-rejection',
      recognizedCode: true,
      policyName: 'customer-reviewed-policy',
    });
  });
});
