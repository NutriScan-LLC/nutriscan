import { mkdir, writeFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';

export const BIOZOOM_PRE_REQUEST_DIAGNOSTIC_URL =
  'https://de2.biozoom.net/pre-request/?serial_id=2N2400A5B70F5E3C9251&measure_type=0' as const;

export interface ObservableRedirect {
  readonly status: number;
  readonly fromUrl: string;
  readonly location: string;
  readonly resolvedUrl: string;
}

export interface PreRequestHttpObservation {
  readonly initialUrl: string;
  readonly finalUrl: string;
  readonly method: 'GET';
  readonly status: number;
  readonly requestHeaders: Readonly<Record<string, string | readonly string[]>>;
  readonly responseHeaders: Readonly<Record<string, string | readonly string[]>>;
  readonly redirects: readonly ObservableRedirect[];
  readonly body: string;
}

export type PreRequestHttpExecutor = (url: typeof BIOZOOM_PRE_REQUEST_DIAGNOSTIC_URL) => Promise<PreRequestHttpObservation>;

export interface BioZoomPreRequestDiagnosticArtifact {
  readonly schemaVersion: 1;
  readonly experimental: true;
  readonly action: 'biozoom-pre-request-only';
  readonly startedAt: string;
  readonly completedAt: string;
  readonly intendedRequest: {
    readonly method: 'GET';
    readonly url: typeof BIOZOOM_PRE_REQUEST_DIAGNOSTIC_URL;
    readonly body: null;
    readonly applicationHeaders: Readonly<Record<string, never>>;
    readonly retryCount: 0;
  };
  readonly observation: {
    readonly initialUrl: string;
    readonly finalUrl: string;
    readonly status: number;
    readonly requestHeaders: Readonly<Record<string, string | readonly string[]>>;
    readonly cookieHeaderPresent: boolean;
    readonly authorizationHeaderPresent: boolean;
    readonly responseHeaders: Readonly<Record<string, string | readonly string[]>>;
    readonly setsCookies: boolean;
    readonly redirects: readonly ObservableRedirect[];
    readonly body: string;
    readonly parsedJson: unknown;
    readonly recommendedServer: unknown;
    readonly waitingTimeMs: unknown;
    readonly newPreRequestReq: unknown;
    readonly newPreRequestDelayMs: unknown;
    readonly licenseAndErrorFields: Readonly<Record<string, unknown>>;
  } | null;
  readonly error: { readonly name: string; readonly message: string; readonly stack?: string } | null;
}

export interface PreRequestDiagnosticDependencies {
  readonly executeHttp: PreRequestHttpExecutor;
  readonly writeArtifact: (artifact: BioZoomPreRequestDiagnosticArtifact) => Promise<string>;
  readonly now?: () => Date;
}

export async function runBioZoomPreRequestDiagnostic(
  dependencies: PreRequestDiagnosticDependencies,
): Promise<{ artifact: BioZoomPreRequestDiagnosticArtifact; file: string }> {
  const now = dependencies.now ?? (() => new Date());
  const startedAt = now().toISOString();
  let observation: BioZoomPreRequestDiagnosticArtifact['observation'] = null;
  let error: BioZoomPreRequestDiagnosticArtifact['error'] = null;

  try {
    const result = await dependencies.executeHttp(BIOZOOM_PRE_REQUEST_DIAGNOSTIC_URL);
    const parsedJson = parseJson(result.body);
    const requestHeaders = redactHeaders(result.requestHeaders);
    const responseHeaders = redactHeaders(result.responseHeaders);
    observation = {
      initialUrl: result.initialUrl,
      finalUrl: result.finalUrl,
      status: result.status,
      requestHeaders,
      cookieHeaderPresent: hasHeader(result.requestHeaders, 'cookie'),
      authorizationHeaderPresent: hasHeader(result.requestHeaders, 'authorization'),
      responseHeaders,
      setsCookies: hasHeader(result.responseHeaders, 'set-cookie'),
      redirects: result.redirects,
      body: result.body,
      parsedJson,
      recommendedServer: fieldFromJson(parsedJson, 'recommended_server'),
      waitingTimeMs: fieldFromJson(parsedJson, 'waiting_time_ms'),
      newPreRequestReq: fieldFromJson(parsedJson, 'new_pre_request_req'),
      newPreRequestDelayMs: fieldFromJson(parsedJson, 'new_pre_request_delay_ms'),
      licenseAndErrorFields: collectLicenseAndErrorFields(parsedJson),
    };
  } catch (cause) {
    error = serializeError(cause);
  }

  const artifact: BioZoomPreRequestDiagnosticArtifact = {
    schemaVersion: 1,
    experimental: true,
    action: 'biozoom-pre-request-only',
    startedAt,
    completedAt: now().toISOString(),
    intendedRequest: {
      method: 'GET',
      url: BIOZOOM_PRE_REQUEST_DIAGNOSTIC_URL,
      body: null,
      applicationHeaders: {},
      retryCount: 0,
    },
    observation,
    error,
  };
  const file = await dependencies.writeArtifact(artifact);
  if (error !== null) throw Object.assign(new Error(error.message), { name: error.name, diagnosticArtifact: file });
  return { artifact, file };
}

export function createPreRequestArtifactWriter(directory = path.resolve('diagnostics')) {
  return async (artifact: BioZoomPreRequestDiagnosticArtifact): Promise<string> => {
    await mkdir(directory, { recursive: true });
    const filename = `${artifact.startedAt.replaceAll(':', '-')}-biozoom-pre-request-only.json`;
    const destination = path.join(directory, filename);
    await writeFile(destination, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    return destination;
  };
}

/**
 * Node-only GET executor. It sends no application headers or body, follows
 * ordinary redirects, records each visible redirect, and never retries.
 */
export const executeFixedBioZoomPreRequestWithNode: PreRequestHttpExecutor = async (url) => {
  const redirects: ObservableRedirect[] = [];
  const result = await requestFollowingRedirects(url, redirects, 0);
  return { initialUrl: url, method: 'GET', redirects, ...result };
};

/** Executes exactly one GET and exposes a redirect response without following it. */
export const executeFixedBioZoomPreRequestOnceWithNode: PreRequestHttpExecutor = async (url) => {
  const result = await requestOnce(url);
  return { initialUrl: url, finalUrl: url, method: 'GET', redirects: [], ...result };
};

async function requestFollowingRedirects(
  url: string,
  redirects: ObservableRedirect[],
  redirectCount: number,
): Promise<Omit<PreRequestHttpObservation, 'initialUrl' | 'method' | 'redirects'>> {
  if (redirectCount > 10) throw new Error('BioZoom pre-request exceeded 10 HTTP redirects');
  const response = await requestOnce(url);
  const location = headerValue(response.responseHeaders, 'location');
  if (response.status >= 300 && response.status < 400 && location !== undefined) {
    const resolvedUrl = new URL(location, url).toString();
    redirects.push({ status: response.status, fromUrl: url, location, resolvedUrl });
    return requestFollowingRedirects(resolvedUrl, redirects, redirectCount + 1);
  }
  return { ...response, finalUrl: url };
}

function requestOnce(url: string): Promise<{
  status: number;
  requestHeaders: Record<string, string | readonly string[]>;
  responseHeaders: Record<string, string | readonly string[]>;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    const protocol = new URL(url).protocol;
    const transport = protocol === 'https:' ? https : protocol === 'http:' ? http : null;
    if (transport === null) return reject(new Error(`Unsupported redirect protocol: ${protocol}`));
    const request = transport.request(url, { method: 'GET', headers: {} }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.on('end', () => resolve({
        status: response.statusCode ?? 0,
        requestHeaders: normalizeOutgoingHeaders(request.getHeaders()),
        responseHeaders: normalizeIncomingHeaders(response.headers),
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    request.on('error', reject);
    request.end();
  });
}

function normalizeOutgoingHeaders(headers: http.OutgoingHttpHeaders): Record<string, string | readonly string[]> {
  return Object.fromEntries(Object.entries(headers).flatMap(([key, value]) => {
    if (value === undefined) return [];
    return [[key.toLowerCase(), Array.isArray(value) ? value.map(String) : String(value)]];
  }));
}

function normalizeIncomingHeaders(headers: http.IncomingHttpHeaders): Record<string, string | readonly string[]> {
  return Object.fromEntries(Object.entries(headers).flatMap(([key, value]) => {
    if (value === undefined) return [];
    return [[key.toLowerCase(), Array.isArray(value) ? value : value]];
  }));
}

function redactHeaders(headers: Readonly<Record<string, string | readonly string[]>>): Record<string, string | readonly string[]> {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [
    key,
    isSensitiveHeader(key)
      ? Array.isArray(value) ? value.map(() => '[REDACTED]') : '[REDACTED]'
      : value,
  ]));
}

function isSensitiveHeader(name: string): boolean {
  return /authorization|cookie|token|api[-_]?key|secret/i.test(name);
}

function hasHeader(headers: Readonly<Record<string, unknown>>, target: string): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === target);
}

function headerValue(headers: Readonly<Record<string, string | readonly string[]>>, target: string): string | undefined {
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === target)?.[1];
  return typeof entry === 'string' ? entry : entry?.[0];
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

function fieldFromJson(value: unknown, field: string): unknown {
  return typeof value === 'object' && value !== null && field in value
    ? (value as Record<string, unknown>)[field]
    : null;
}

function collectLicenseAndErrorFields(value: unknown): Record<string, unknown> {
  const found: Record<string, unknown> = {};
  const visit = (entry: unknown, pathParts: string[]) => {
    if (Array.isArray(entry)) return entry.forEach((child, index) => visit(child, [...pathParts, String(index)]));
    if (typeof entry !== 'object' || entry === null) return;
    for (const [key, child] of Object.entries(entry)) {
      const childPath = [...pathParts, key];
      if (/license|error/i.test(key)) found[childPath.join('.')] = child;
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
