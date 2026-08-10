import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  FIXED_M35_OFFLINE_ARTIFACT_PATH,
  prepareM35Submission,
  type MeasurementSubmissionHttpExecutor,
  type PreparedM35Submission,
} from './measurementSubmissionDiagnostic.js';
import {
  BIOZOOM_PRE_REQUEST_DIAGNOSTIC_URL,
  type PreRequestHttpExecutor,
} from './preRequestDiagnostic.js';

export interface PairedScoringDiagnosticArtifact {
  readonly schemaVersion: 1;
  readonly experimental: true;
  readonly action: 'biozoom-paired-pre-request-measurement-35';
  readonly sourceArtifactPath: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly preRequest: {
    readonly startedAt: string;
    readonly completedAt: string;
    readonly initialUrl: string;
    readonly finalUrl: string;
    readonly status: number;
    readonly requestHeaders: Readonly<Record<string, string | readonly string[]>>;
    readonly cookieHeaderPresent: boolean;
    readonly authorizationHeaderPresent: boolean;
    readonly responseHeaders: Readonly<Record<string, string | readonly string[]>>;
    readonly setsCookies: boolean;
    readonly redirects: readonly unknown[];
    readonly body: string;
    readonly parsedJson: unknown;
    readonly recommendedServer: string;
    readonly waitingTimeMs: number;
    readonly newPreRequestReq: unknown;
    readonly newPreRequestDelayMs: unknown;
  } | null;
  readonly timing: {
    readonly requiredWaitMs: number;
    readonly actualPreRequestCompletionToMeasurementStartMs: number;
    readonly measurementStartedAt: string;
  } | null;
  readonly measurementRequest: {
    readonly method: 'POST';
    readonly url: string;
    readonly retryCount: 0;
    readonly redirectsFollowed: false;
    readonly multipart: PreparedM35Submission['multipart'];
    readonly measurementBlocksLength: number;
    readonly measurementBlocksSha256: string;
    readonly measureJson: PreparedM35Submission['measureJson'];
  } | null;
  readonly measurementResponse: {
    readonly receivedAt: string;
    readonly finalUrl: string;
    readonly status: number;
    readonly requestHeaders: Readonly<Record<string, string | readonly string[]>>;
    readonly cookieHeaderPresent: boolean;
    readonly authorizationHeaderPresent: boolean;
    readonly responseHeaders: Readonly<Record<string, string | readonly string[]>>;
    readonly setsCookies: boolean;
    readonly body: string;
    readonly parsedJson: unknown;
    readonly aox: unknown;
    readonly aoxQ: unknown;
    readonly qualityAndErrorFields: Readonly<Record<string, unknown>>;
  } | null;
  readonly error: { readonly name: string; readonly message: string; readonly stack?: string } | null;
}

export interface PairedScoringDependencies {
  readonly loadSourceArtifact: () => Promise<unknown>;
  readonly executePreRequest: PreRequestHttpExecutor;
  readonly executeMeasurement: MeasurementSubmissionHttpExecutor;
  readonly writeArtifact: (artifact: PairedScoringDiagnosticArtifact) => Promise<string>;
  readonly sleep: (milliseconds: number) => Promise<void>;
  readonly createBoundary?: () => string;
  readonly now?: () => Date;
  readonly monotonicNow?: () => number;
}

export async function runPairedScoringDiagnostic(
  dependencies: PairedScoringDependencies,
): Promise<{ artifact: PairedScoringDiagnosticArtifact; file: string }> {
  const now = dependencies.now ?? (() => new Date());
  const monotonicNow = dependencies.monotonicNow ?? (() => performance.now());
  const startedAt = now().toISOString();
  let preRequest: PairedScoringDiagnosticArtifact['preRequest'] = null;
  let timing: PairedScoringDiagnosticArtifact['timing'] = null;
  let measurementRequest: PairedScoringDiagnosticArtifact['measurementRequest'] = null;
  let measurementResponse: PairedScoringDiagnosticArtifact['measurementResponse'] = null;
  let error: PairedScoringDiagnosticArtifact['error'] = null;

  try {
    const source = await dependencies.loadSourceArtifact();
    const prepared = prepareM35Submission(source, dependencies.createBoundary?.());

    const preStartedAt = now().toISOString();
    const preResult = await dependencies.executePreRequest(BIOZOOM_PRE_REQUEST_DIAGNOSTIC_URL);
    const preCompletedAt = now().toISOString();
    const preCompletedMonotonic = monotonicNow();
    const parsedPre = parseJson(preResult.body);
    if (preResult.status < 200 || preResult.status >= 300) throw new Error(`Pre-request returned HTTP ${preResult.status}`);
    const recommendedServer = requiredStringField(parsedPre, 'recommended_server');
    const waitingTimeMs = requiredNonNegativeNumberField(parsedPre, 'waiting_time_ms');
    if (fieldFromJson(parsedPre, 'new_pre_request_req') === true) {
      throw new Error('Pre-request requires another pre-request, but this diagnostic permits exactly one');
    }
    const measureUrl = constructMeasureUrl(recommendedServer);
    preRequest = {
      startedAt: preStartedAt,
      completedAt: preCompletedAt,
      initialUrl: preResult.initialUrl,
      finalUrl: preResult.finalUrl,
      status: preResult.status,
      requestHeaders: redactHeaders(preResult.requestHeaders),
      cookieHeaderPresent: hasHeader(preResult.requestHeaders, 'cookie'),
      authorizationHeaderPresent: hasHeader(preResult.requestHeaders, 'authorization'),
      responseHeaders: redactHeaders(preResult.responseHeaders),
      setsCookies: hasHeader(preResult.responseHeaders, 'set-cookie'),
      redirects: preResult.redirects,
      body: preResult.body,
      parsedJson: parsedPre,
      recommendedServer,
      waitingTimeMs,
      newPreRequestReq: fieldFromJson(parsedPre, 'new_pre_request_req'),
      newPreRequestDelayMs: fieldFromJson(parsedPre, 'new_pre_request_delay_ms'),
    };

    await waitAtLeast(waitingTimeMs, preCompletedMonotonic, monotonicNow, dependencies.sleep);
    const measurementStartedMonotonic = monotonicNow();
    const measurementStartedAt = now().toISOString();
    timing = {
      requiredWaitMs: waitingTimeMs,
      actualPreRequestCompletionToMeasurementStartMs: measurementStartedMonotonic - preCompletedMonotonic,
      measurementStartedAt,
    };
    const pairedSubmission: PreparedM35Submission = { ...prepared, url: measureUrl };
    measurementRequest = {
      method: 'POST',
      url: measureUrl,
      retryCount: 0,
      redirectsFollowed: false,
      multipart: pairedSubmission.multipart,
      measurementBlocksLength: pairedSubmission.measurementBlocksLength,
      measurementBlocksSha256: pairedSubmission.measurementBlocksSha256,
      measureJson: pairedSubmission.measureJson,
    };
    const result = await dependencies.executeMeasurement(pairedSubmission);
    const receivedAt = now().toISOString();
    const parsedMeasurement = parseJson(result.body);
    measurementResponse = {
      receivedAt,
      finalUrl: result.finalUrl,
      status: result.status,
      requestHeaders: redactHeaders(result.requestHeaders),
      cookieHeaderPresent: hasHeader(result.requestHeaders, 'cookie'),
      authorizationHeaderPresent: hasHeader(result.requestHeaders, 'authorization'),
      responseHeaders: redactHeaders(result.responseHeaders),
      setsCookies: hasHeader(result.responseHeaders, 'set-cookie'),
      body: result.body,
      parsedJson: parsedMeasurement,
      aox: fieldFromJson(parsedMeasurement, 'aox'),
      aoxQ: fieldFromJson(parsedMeasurement, 'aox_q'),
      qualityAndErrorFields: collectQualityAndErrorFields(parsedMeasurement),
    };
  } catch (cause) {
    error = serializeError(cause);
  }

  const artifact: PairedScoringDiagnosticArtifact = {
    schemaVersion: 1,
    experimental: true,
    action: 'biozoom-paired-pre-request-measurement-35',
    sourceArtifactPath: FIXED_M35_OFFLINE_ARTIFACT_PATH,
    startedAt,
    completedAt: now().toISOString(),
    preRequest,
    timing,
    measurementRequest,
    measurementResponse,
    error,
  };
  const file = await dependencies.writeArtifact(artifact);
  if (error !== null) throw Object.assign(new Error(error.message), { name: error.name, diagnosticArtifact: file });
  return { artifact, file };
}

export function createPairedScoringArtifactWriter(directory = path.resolve('diagnostics')) {
  return async (artifact: PairedScoringDiagnosticArtifact): Promise<string> => {
    await mkdir(directory, { recursive: true });
    const destination = path.join(directory, `${artifact.startedAt.replaceAll(':', '-')}-biozoom-paired-measurement-35.json`);
    await writeFile(destination, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    return destination;
  };
}

function constructMeasureUrl(recommendedServer: string): string {
  const base = new URL(recommendedServer);
  if (base.protocol !== 'https:') throw new Error('recommended_server must use HTTPS');
  return `${recommendedServer.replace(/\/+$/, '')}/measure/?serial_id=2N2400A5B70F5E3C9251&measure_type=0`;
}

async function waitAtLeast(
  requiredMs: number,
  beganAt: number,
  monotonicNow: () => number,
  sleep: (milliseconds: number) => Promise<void>,
): Promise<void> {
  let remaining = requiredMs - (monotonicNow() - beganAt);
  while (remaining > 0) {
    await sleep(remaining);
    const nextRemaining = requiredMs - (monotonicNow() - beganAt);
    if (nextRemaining >= remaining) throw new Error('Wait clock did not advance; measurement POST was not sent');
    remaining = nextRemaining;
  }
}

function parseJson(body: string): unknown {
  try { return JSON.parse(body) as unknown; } catch { return null; }
}

function requiredStringField(value: unknown, field: string): string {
  const result = fieldFromJson(value, field);
  if (typeof result !== 'string' || result.length === 0) throw new Error(`Pre-request response requires string ${field}`);
  return result;
}

function requiredNonNegativeNumberField(value: unknown, field: string): number {
  const result = fieldFromJson(value, field);
  if (typeof result !== 'number' || !Number.isFinite(result) || result < 0) throw new Error(`Pre-request response requires non-negative number ${field}`);
  return result;
}

function fieldFromJson(value: unknown, field: string): unknown {
  return typeof value === 'object' && value !== null && field in value ? (value as Record<string, unknown>)[field] : null;
}

function redactHeaders(headers: Readonly<Record<string, string | readonly string[]>>): Record<string, string | readonly string[]> {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [
    key,
    /authorization|cookie|token|api[-_]?key|secret/i.test(key)
      ? Array.isArray(value) ? value.map(() => '[REDACTED]') : '[REDACTED]'
      : value,
  ]));
}

function hasHeader(headers: Readonly<Record<string, unknown>>, target: string): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === target);
}

function collectQualityAndErrorFields(value: unknown): Record<string, unknown> {
  const found: Record<string, unknown> = {};
  const visit = (entry: unknown, parts: string[]) => {
    if (Array.isArray(entry)) return entry.forEach((child, index) => visit(child, [...parts, String(index)]));
    if (typeof entry !== 'object' || entry === null) return;
    for (const [key, child] of Object.entries(entry)) {
      const childPath = [...parts, key];
      if (/quality|error/i.test(key)) found[childPath.join('.')] = child;
      visit(child, childPath);
    }
  };
  visit(value, []);
  return found;
}

function serializeError(value: unknown): { name: string; message: string; stack?: string } {
  if (value instanceof Error) return { name: value.name, message: value.message, ...(value.stack === undefined ? {} : { stack: value.stack }) };
  return { name: 'Error', message: String(value) };
}
