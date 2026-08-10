import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BioZoomMeasureJson } from './index.js';

export const BIOZOOM_M35_MEASURE_URL =
  'https://de2.biozoom.net/measure/?serial_id=2N2400A5B70F5E3C9251&measure_type=0' as const;
export const FIXED_M35_OFFLINE_ARTIFACT_PATH = fileURLToPath(new URL(
  '../../../apps/scanner-cli/diagnostics/2026-08-09T13-47-52.825Z-offline-scoring.json',
  import.meta.url,
));

export interface PreparedM35Submission {
  readonly url: string;
  readonly method: 'POST';
  readonly headers: Readonly<Record<'Content-Type' | 'Content-Length', string>>;
  readonly body: Uint8Array;
  readonly measureJson: BioZoomMeasureJson;
  readonly multipart: {
    readonly boundary: string;
    readonly partCount: 1;
    readonly fieldName: 'measure_json';
    readonly filename: 'measure.json';
    readonly contentType: 'application/json';
    readonly bodyByteLength: number;
  };
  readonly measurementBlocksLength: number;
  readonly measurementBlocksSha256: string;
}

export interface MeasurementSubmissionHttpObservation {
  readonly finalUrl: string;
  readonly status: number;
  readonly requestHeaders: Readonly<Record<string, string | readonly string[]>>;
  readonly responseHeaders: Readonly<Record<string, string | readonly string[]>>;
  readonly body: string;
}

export type MeasurementSubmissionHttpExecutor = (
  submission: PreparedM35Submission,
) => Promise<MeasurementSubmissionHttpObservation>;

export interface BioZoomMeasurementSubmissionArtifact {
  readonly schemaVersion: 1;
  readonly experimental: true;
  readonly action: 'biozoom-measurement-35-single-submission';
  readonly sourceArtifactPath: string;
  readonly startedAt: string;
  readonly requestStartedAt: string | null;
  readonly responseReceivedAt: string | null;
  readonly completedAt: string;
  readonly request: {
    readonly method: 'POST';
    readonly url: string;
    readonly retryCount: 0;
    readonly multipart: PreparedM35Submission['multipart'];
    readonly measurementBlocksLength: number;
    readonly measurementBlocksSha256: string;
    readonly measureJson: BioZoomMeasureJson;
  } | null;
  readonly observation: {
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

export interface MeasurementSubmissionDependencies {
  readonly loadSourceArtifact: () => Promise<unknown>;
  readonly executeHttp: MeasurementSubmissionHttpExecutor;
  readonly writeArtifact: (artifact: BioZoomMeasurementSubmissionArtifact) => Promise<string>;
  readonly createBoundary?: () => string;
  readonly now?: () => Date;
}

export async function runM35MeasurementSubmissionDiagnostic(
  dependencies: MeasurementSubmissionDependencies,
): Promise<{ artifact: BioZoomMeasurementSubmissionArtifact; file: string }> {
  const now = dependencies.now ?? (() => new Date());
  const startedAt = now().toISOString();
  let requestStartedAt: string | null = null;
  let responseReceivedAt: string | null = null;
  let request: BioZoomMeasurementSubmissionArtifact['request'] = null;
  let observation: BioZoomMeasurementSubmissionArtifact['observation'] = null;
  let error: BioZoomMeasurementSubmissionArtifact['error'] = null;

  try {
    const source = await dependencies.loadSourceArtifact();
    const prepared = prepareM35Submission(source, dependencies.createBoundary?.());
    request = {
      method: prepared.method,
      url: prepared.url,
      retryCount: 0,
      multipart: prepared.multipart,
      measurementBlocksLength: prepared.measurementBlocksLength,
      measurementBlocksSha256: prepared.measurementBlocksSha256,
      measureJson: prepared.measureJson,
    };
    requestStartedAt = now().toISOString();
    const result = await dependencies.executeHttp(prepared);
    responseReceivedAt = now().toISOString();
    const parsedJson = parseJson(result.body);
    observation = {
      finalUrl: result.finalUrl,
      status: result.status,
      requestHeaders: redactHeaders(result.requestHeaders),
      cookieHeaderPresent: hasHeader(result.requestHeaders, 'cookie'),
      authorizationHeaderPresent: hasHeader(result.requestHeaders, 'authorization'),
      responseHeaders: redactHeaders(result.responseHeaders),
      setsCookies: hasHeader(result.responseHeaders, 'set-cookie'),
      body: result.body,
      parsedJson,
      aox: fieldFromJson(parsedJson, 'aox'),
      aoxQ: fieldFromJson(parsedJson, 'aox_q'),
      qualityAndErrorFields: collectQualityAndErrorFields(parsedJson),
    };
  } catch (cause) {
    error = serializeError(cause);
  }

  const artifact: BioZoomMeasurementSubmissionArtifact = {
    schemaVersion: 1,
    experimental: true,
    action: 'biozoom-measurement-35-single-submission',
    sourceArtifactPath: FIXED_M35_OFFLINE_ARTIFACT_PATH,
    startedAt,
    requestStartedAt,
    responseReceivedAt,
    completedAt: now().toISOString(),
    request,
    observation,
    error,
  };
  const file = await dependencies.writeArtifact(artifact);
  if (error !== null) throw Object.assign(new Error(error.message), { name: error.name, diagnosticArtifact: file });
  return { artifact, file };
}

export function prepareM35Submission(source: unknown, boundary = createMultipartBoundary()): PreparedM35Submission {
  const root = requireRecord(source, 'offline scoring artifact');
  if (root.action !== 'OFFLINE-SCORING' || root.error !== null) throw new Error('Source must be a successful OFFLINE-SCORING artifact');
  const rawArtifact = requireRecord(root.rawAoxMeasurementArtifact, 'rawAoxMeasurementArtifact');
  const summary = requireRecord(rawArtifact.summary, 'rawAoxMeasurementArtifact.summary');
  if (rawArtifact.measurementNumber !== 35 || rawArtifact.scannerSerial !== '2N2400A5B70F5E3C9251') {
    throw new Error('Source artifact must be scanner 2N2400A5B70F5E3C9251 measurement 35');
  }
  if (summary.complete !== true || summary.validBlockCount !== 5_773 || summary.anomalyCount !== 0) {
    throw new Error('Source measurement must contain 5,773 valid blocks and zero anomalies');
  }
  const proposal = requireRecord(root.offlineScoringProposal, 'offlineScoringProposal');
  const measureRequest = requireRecord(proposal.measureRequest, 'offlineScoringProposal.measureRequest');
  const measureJsonEvidence = requireRecord(measureRequest.measureJson, 'offlineScoringProposal.measureRequest.measureJson');
  const candidate = requireRecord(measureJsonEvidence.value, 'measureJson');
  const exactKeys = ['AdditionalData', 'MeasurementBlocks', 'Serial', 'UserID', 'lang'];
  if (Object.keys(candidate).sort().join('|') !== exactKeys.sort().join('|')) {
    throw new Error('measure_json must contain exactly Serial, MeasurementBlocks, UserID, lang, and AdditionalData');
  }
  if (
    candidate.Serial !== '2N2400A5B70F5E3C9251'
    || candidate.UserID !== 'ffffffffffffffffffffffffffffffff'
    || typeof candidate.MeasurementBlocks !== 'string'
    || typeof candidate.lang !== 'string'
    || typeof candidate.AdditionalData !== 'string'
  ) throw new Error('Source measure_json does not match the fixed measurement-35 contract');
  if (rawArtifact.measurementBlocks !== candidate.MeasurementBlocks) {
    throw new Error('Proposed MeasurementBlocks does not exactly match the raw measurement artifact');
  }

  const measurementBlocksSha256 = sha256(candidate.MeasurementBlocks);
  const savedAcquisition = requireRecord(proposal.acquisition, 'offlineScoringProposal.acquisition');
  const savedHash = requireRecord(savedAcquisition.measurementBlocksSha256, 'measurementBlocksSha256').value;
  const savedLength = requireRecord(savedAcquisition.measurementBlocksLength, 'measurementBlocksLength').value;
  if (savedHash !== measurementBlocksSha256 || savedLength !== candidate.MeasurementBlocks.length) {
    throw new Error('MeasurementBlocks length or SHA-256 does not match the offline artifact evidence');
  }
  if (!/^[A-Za-z0-9'-]{8,70}$/.test(boundary)) throw new Error('Generated multipart boundary is invalid');

  const measureJson = candidate as unknown as BioZoomMeasureJson;
  const json = JSON.stringify(measureJson);
  const body = Buffer.from([
    `--${boundary}\r\n`,
    'Content-Disposition: form-data; name="measure_json"; filename="measure.json"\r\n',
    'Content-Type: application/json\r\n',
    '\r\n',
    json,
    `\r\n--${boundary}--\r\n`,
  ].join(''), 'utf8');
  return {
    url: BIOZOOM_M35_MEASURE_URL,
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': String(body.byteLength),
    },
    body,
    measureJson,
    multipart: {
      boundary,
      partCount: 1,
      fieldName: 'measure_json',
      filename: 'measure.json',
      contentType: 'application/json',
      bodyByteLength: body.byteLength,
    },
    measurementBlocksLength: candidate.MeasurementBlocks.length,
    measurementBlocksSha256,
  };
}

export async function loadFixedM35OfflineArtifact(): Promise<unknown> {
  return JSON.parse(await readFile(FIXED_M35_OFFLINE_ARTIFACT_PATH, 'utf8')) as unknown;
}

export function createMeasurementSubmissionArtifactWriter(directory = path.resolve('diagnostics')) {
  return async (artifact: BioZoomMeasurementSubmissionArtifact): Promise<string> => {
    await mkdir(directory, { recursive: true });
    const destination = path.join(directory, `${artifact.startedAt.replaceAll(':', '-')}-biozoom-measurement-35-submission.json`);
    await writeFile(destination, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    return destination;
  };
}

/** Sends one fixed POST and deliberately does not follow redirects or retry. */
export const executeM35SubmissionWithNode: MeasurementSubmissionHttpExecutor = (submission) => new Promise((resolve, reject) => {
  const request = https.request(submission.url, {
    method: submission.method,
    headers: submission.headers,
  }, (response) => {
    const chunks: Buffer[] = [];
    response.on('data', (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    response.on('error', reject);
    response.on('end', () => resolve({
      finalUrl: submission.url,
      status: response.statusCode ?? 0,
      requestHeaders: normalizeOutgoingHeaders(request.getHeaders()),
      responseHeaders: normalizeIncomingHeaders(response.headers),
      body: Buffer.concat(chunks).toString('utf8'),
    }));
  });
  request.on('error', reject);
  request.end(submission.body);
});

function createMultipartBoundary(): string {
  return `--------------------------${randomBytes(12).toString('hex')}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function requireRecord(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}

function normalizeOutgoingHeaders(headers: Record<string, string | string[] | number | undefined>): Record<string, string | readonly string[]> {
  return Object.fromEntries(Object.entries(headers).flatMap(([key, value]) => value === undefined
    ? []
    : [[key.toLowerCase(), Array.isArray(value) ? value.map(String) : String(value)]]));
}

function normalizeIncomingHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string | readonly string[]> {
  return Object.fromEntries(Object.entries(headers).flatMap(([key, value]) => value === undefined ? [] : [[key.toLowerCase(), value]]));
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

function parseJson(body: string): unknown {
  try { return JSON.parse(body) as unknown; } catch { return null; }
}

function fieldFromJson(value: unknown, field: string): unknown {
  return typeof value === 'object' && value !== null && field in value ? (value as Record<string, unknown>)[field] : null;
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
