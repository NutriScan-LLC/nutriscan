/**
 * Pure parsing and quality interpretation for a BioZoom Quick AOX response.
 * This module performs no scanner, HTTP, retry, navigation, or deletion work.
 */

export type QuickAoxAction =
  | 'accept'
  | 'rescan'
  | 'resolve-device-condition'
  | 'stop'
  | 'unable-to-decide';

export type QuickAoxQualityReason =
  | 'surrounding-light-or-incomplete-coverage'
  | 'handling-coverage-or-movement'
  | 'transmission-or-integrity'
  | 'low-led-voltage'
  | 'low-scanner-battery'
  | 'prototype-data-received'
  | 'generic-quality-rejection'
  | 'missing-quality-code'
  | 'null-quality-code'
  | 'invalid-quality-code';

export type QuickAoxQualityCodeState = 'valid' | 'missing' | 'null' | 'invalid';

export interface ParsedQuickAoxResponse {
  readonly score: number;
  readonly qualityCode: number | null;
  readonly qualityCodeState: QuickAoxQualityCodeState;
  /** Exact value supplied as aox_q, including an invalid value. */
  readonly rawQualityCode: unknown;
  /** Exact error_prediction value. No metric meaning or threshold is inferred. */
  readonly diagnostics: unknown;
  readonly diagnosticsPresent: boolean;
  /** The complete input object, including all server fields unknown to NutriScan. */
  readonly rawResponse: Readonly<Record<string, unknown>>;
}

export type QuickAoxParseErrorCode =
  | 'response-not-object'
  | 'missing-score'
  | 'invalid-score';

export interface QuickAoxParseError {
  readonly code: QuickAoxParseErrorCode;
  readonly message: string;
  readonly rawResponse: unknown;
}

export type QuickAoxParseResult =
  | { readonly ok: true; readonly value: ParsedQuickAoxResponse }
  | { readonly ok: false; readonly error: QuickAoxParseError };

export interface QuickAoxPolicyClassification {
  readonly accepted: boolean;
  readonly action: Exclude<QuickAoxAction, 'unable-to-decide'>;
  readonly reason: Exclude<QuickAoxQualityReason, 'missing-quality-code' | 'null-quality-code' | 'invalid-quality-code'> | null;
}

/** Injectable because APK 0.50.107 behavior is not a universal scanner rule. */
export interface QuickAoxQualityPolicy {
  readonly name: string;
  isRecognizedCode(qualityCode: number): boolean;
  classify(qualityCode: number): QuickAoxPolicyClassification;
}

export interface QuickAoxQualityDecision {
  readonly qualityCode: number | null;
  readonly qualityCodeState: QuickAoxQualityCodeState;
  readonly accepted: boolean;
  readonly action: QuickAoxAction;
  readonly reason: QuickAoxQualityReason | null;
  /** Semantic recognition is independent from threshold-based routing. */
  readonly recognizedCode: boolean;
  readonly policyName: string;
}

export interface QuickAoxResult extends ParsedQuickAoxResponse {
  readonly decision: QuickAoxQualityDecision;
}

const APK_RECOGNIZED_CODES = new Set([40, 50, 60, 70, 80, 90, 100]);

/**
 * Reproduces the active Quick AOX quality gate found in VitalityCheck 0.50.107.
 * A routed value is not necessarily recognized: for example 37, 44, and 45
 * are accepted by the `< 50` comparison but have no established active meaning.
 */
export const APK_0_50_107_QUICK_AOX_POLICY: QuickAoxQualityPolicy = Object.freeze({
  name: 'vitalitycheck-0.50.107-apk-compatible',
  isRecognizedCode: (qualityCode: number) => APK_RECOGNIZED_CODES.has(qualityCode),
  classify: classifyWithApkGate,
});

export function parseQuickAoxResponse(input: unknown): QuickAoxParseResult {
  if (!isRecord(input)) {
    return parseFailure('response-not-object', 'Quick AOX response must be a non-array object', input);
  }
  if (!Object.prototype.hasOwnProperty.call(input, 'aox')) {
    return parseFailure('missing-score', 'Quick AOX response is missing aox', input);
  }
  if (typeof input.aox !== 'number' || !Number.isFinite(input.aox)) {
    return parseFailure('invalid-score', 'Quick AOX response aox must be a finite number', input);
  }

  const hasQualityCode = Object.prototype.hasOwnProperty.call(input, 'aox_q');
  const rawQualityCode = hasQualityCode ? input.aox_q : undefined;
  const qualityCodeState: QuickAoxQualityCodeState = !hasQualityCode
    ? 'missing'
    : rawQualityCode === null
      ? 'null'
      : typeof rawQualityCode === 'number' && Number.isFinite(rawQualityCode)
        ? 'valid'
        : 'invalid';
  const diagnosticsPresent = Object.prototype.hasOwnProperty.call(input, 'error_prediction');

  return {
    ok: true,
    value: {
      score: input.aox,
      qualityCode: qualityCodeState === 'valid' ? rawQualityCode as number : null,
      qualityCodeState,
      rawQualityCode,
      diagnostics: diagnosticsPresent ? input.error_prediction : undefined,
      diagnosticsPresent,
      rawResponse: input,
    },
  };
}

export function interpretQuickAoxQuality(
  parsed: ParsedQuickAoxResponse,
  policy: QuickAoxQualityPolicy = APK_0_50_107_QUICK_AOX_POLICY,
): QuickAoxResult {
  const decision = parsed.qualityCodeState === 'valid' && parsed.qualityCode !== null
    ? decisionForNumericCode(parsed.qualityCode, policy)
    : indeterminateDecision(parsed, policy.name);
  return { ...parsed, decision };
}

/**
 * APK-derived reference meanings, kept separate from NutriScan presentation.
 * These are evidence notes, not a localization catalogue or medical advice.
 */
export const APK_QUICK_AOX_PRESENTATION_REFERENCE: Readonly<Partial<Record<QuickAoxQualityReason, {
  readonly localizationKey: string;
  readonly meaning: string;
}>>> = Object.freeze({
  'surrounding-light-or-incomplete-coverage': { localizationKey: 'ERROR.LIGHT_50', meaning: 'Surrounding light reached the sensor or the hand did not fully cover it.' },
  'handling-coverage-or-movement': { localizationKey: 'ERROR.LIGHT_60', meaning: 'Handling, incomplete sensor coverage, or movement caused a quality rejection.' },
  'transmission-or-integrity': { localizationKey: 'ERROR.ERROR_70', meaning: 'The APK describes transmission or checksum corruption and asks for repetition.' },
  'low-led-voltage': { localizationKey: 'ERROR.ERROR_80', meaning: 'The APK describes low battery or LED voltage and asks for recharging.' },
  'low-scanner-battery': { localizationKey: 'ERROR.ERROR_90', meaning: 'The APK describes scanner battery as too low for a reliable measurement.' },
  'prototype-data-received': { localizationKey: 'ERROR.ERROR_100', meaning: 'The APK shows a prototype/data-received acknowledgment instead of normal result flow.' },
});

/** Default NutriScan-owned English copy; applications may replace/localize it. */
export const DEFAULT_QUICK_AOX_PRESENTATION: Readonly<Partial<Record<QuickAoxQualityReason, string>>> = Object.freeze({
  'surrounding-light-or-incomplete-coverage': 'Cover the sensor completely and try again away from bright light.',
  'handling-coverage-or-movement': 'Keep your hand still and cover the sensor completely, then try again.',
  'transmission-or-integrity': 'The measurement data could not be validated. Please try again.',
  'low-led-voltage': 'The scanner needs attention before another measurement.',
  'low-scanner-battery': 'Charge the scanner before taking another measurement.',
  'prototype-data-received': 'The data was received, but no normal Quick AOX result is available.',
  'generic-quality-rejection': 'The measurement did not pass its quality check. Please try again.',
  'missing-quality-code': 'The scoring response did not include a quality code.',
  'null-quality-code': 'The scoring response did not provide a quality code.',
  'invalid-quality-code': 'The scoring response contained an invalid quality code.',
});

function classifyWithApkGate(qualityCode: number): QuickAoxPolicyClassification {
  if (qualityCode < 50) return { accepted: true, action: 'accept', reason: null };
  switch (qualityCode) {
    case 50: return { accepted: false, action: 'rescan', reason: 'surrounding-light-or-incomplete-coverage' };
    case 60: return { accepted: false, action: 'rescan', reason: 'handling-coverage-or-movement' };
    case 70: return { accepted: false, action: 'rescan', reason: 'transmission-or-integrity' };
    case 80: return { accepted: false, action: 'resolve-device-condition', reason: 'low-led-voltage' };
    case 90: return { accepted: false, action: 'resolve-device-condition', reason: 'low-scanner-battery' };
    case 100: return { accepted: false, action: 'stop', reason: 'prototype-data-received' };
    default: return { accepted: false, action: 'rescan', reason: 'generic-quality-rejection' };
  }
}

function decisionForNumericCode(qualityCode: number, policy: QuickAoxQualityPolicy): QuickAoxQualityDecision {
  const classification = policy.classify(qualityCode);
  return {
    qualityCode,
    qualityCodeState: 'valid',
    ...classification,
    recognizedCode: policy.isRecognizedCode(qualityCode),
    policyName: policy.name,
  };
}

function indeterminateDecision(parsed: ParsedQuickAoxResponse, policyName: string): QuickAoxQualityDecision {
  const reason: QuickAoxQualityReason = parsed.qualityCodeState === 'missing'
    ? 'missing-quality-code'
    : parsed.qualityCodeState === 'null'
      ? 'null-quality-code'
      : 'invalid-quality-code';
  return {
    qualityCode: null,
    qualityCodeState: parsed.qualityCodeState,
    accepted: false,
    action: 'unable-to-decide',
    reason,
    recognizedCode: false,
    policyName,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseFailure(code: QuickAoxParseErrorCode, message: string, rawResponse: unknown): QuickAoxParseResult {
  return { ok: false, error: { code, message, rawResponse } };
}
