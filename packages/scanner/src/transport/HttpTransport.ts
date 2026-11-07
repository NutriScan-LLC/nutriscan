/**
 * HTTP transport for the BioZoom Wi-Fi scanner. Like Transport.ts, this layer
 * only moves requests and response bodies: no JSON interpretation, no
 * BioZoom command knowledge. See CLAUDE.md rule 4.
 *
 * Wi-Fi scanners serve plain HTTP on port 80 (confirmed 2026-10-20 on
 * 2E249C6AFCEA6BE8D5FF at http://192.168.4.1). Browsers on HTTPS pages cannot
 * reach it (mixed content, confirmed 2026-11-06), so the production
 * implementation is CapacitorHttpTransport, which runs the request in native
 * code inside the NutriScan app shell (mobile/).
 */

export interface HttpGetOptions {
  /** Per-request timeout. Every Wi-Fi command has an APK-derived timeout. */
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

export interface HttpGetResponse {
  readonly status: number;
  /**
   * Response body as text. CapacitorHttpTransport may have to re-serialize a
   * body the native plugin already parsed as JSON, so this is not guaranteed
   * to be byte-identical to the wire bytes (key order can differ).
   */
  readonly bodyText: string;
}

export interface HttpTransport {
  /** Scheme + host (+ port), e.g. `http://192.168.4.1`. No trailing slash. */
  readonly baseUrl: string;
  /** Sends one GET for `pathAndQuery` (must start with `/`). Never retries. */
  get(pathAndQuery: string, options: HttpGetOptions): Promise<HttpGetResponse>;
}

export class HttpTransportError extends Error {
  constructor(message: string, readonly path: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'HttpTransportError';
  }
}

export class HttpTransportTimeoutError extends HttpTransportError {
  constructor(path: string, readonly timeoutMs: number) {
    super(`HTTP GET ${path} timed out after ${timeoutMs} ms`, path);
    this.name = 'HttpTransportTimeoutError';
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  const parsed = new URL(trimmed);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new RangeError('baseUrl must be http(s)');
  return trimmed;
}

function assertPath(pathAndQuery: string): void {
  if (!pathAndQuery.startsWith('/')) throw new RangeError('pathAndQuery must start with "/"');
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
}

/**
 * Races `promise` against the timeout and the caller's abort signal. Used where
 * the underlying request cannot itself be cancelled (Capacitor native HTTP).
 */
async function withDeadline<T>(promise: Promise<T>, path: string, options: HttpGetOptions): Promise<T> {
  throwIfAborted(options.signal);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new HttpTransportTimeoutError(path, options.timeoutMs)), options.timeoutMs);
        if (options.signal) {
          onAbort = () => reject(options.signal?.reason ?? new DOMException('Aborted', 'AbortError'));
          options.signal.addEventListener('abort', onAbort, { once: true });
        }
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort) options.signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Standard `fetch` transport. Works from Node (e.g. a Mac joined to the
 * scanner's access point) and from plain-HTTP pages. It does NOT work from
 * app.yournutriscan.com in a browser (mixed content).
 */
export class FetchHttpTransport implements HttpTransport {
  readonly baseUrl: string;
  readonly #fetch: typeof fetch;

  constructor(options: { readonly baseUrl: string; readonly fetchImplementation?: typeof fetch }) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.#fetch = options.fetchImplementation ?? globalThis.fetch.bind(globalThis);
  }

  async get(pathAndQuery: string, options: HttpGetOptions): Promise<HttpGetResponse> {
    assertPath(pathAndQuery);
    throwIfAborted(options.signal);
    const controller = new AbortController();
    const relay = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener('abort', relay, { once: true });
    const timer = setTimeout(() => controller.abort(new HttpTransportTimeoutError(pathAndQuery, options.timeoutMs)), options.timeoutMs);
    try {
      const response = await this.#fetch(`${this.baseUrl}${pathAndQuery}`, { method: 'GET', signal: controller.signal, cache: 'no-store' });
      const bodyText = await response.text();
      return { status: response.status, bodyText };
    } catch (cause) {
      if (controller.signal.aborted) throw controller.signal.reason ?? cause;
      throw new HttpTransportError(`HTTP GET ${pathAndQuery} failed`, pathAndQuery, cause);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', relay);
    }
  }
}

/** Minimal duck type of the Capacitor global injected into the app WebView. */
interface CapacitorHttpPlugin {
  request(options: Record<string, unknown>): Promise<{ status: number; data: unknown }>;
}
interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  Plugins?: { CapacitorHttp?: CapacitorHttpPlugin };
}

function capacitorGlobal(): CapacitorGlobal | undefined {
  return (globalThis as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
}

/** True when running inside the NutriScan Capacitor shell with native HTTP available. */
export function isCapacitorNativeHttpAvailable(): boolean {
  const cap = capacitorGlobal();
  return cap?.isNativePlatform?.() === true && typeof cap.Plugins?.CapacitorHttp?.request === 'function';
}

/**
 * Native HTTP through Capacitor's built-in CapacitorHttp plugin (iOS
 * URLSession). Confirmed working against the scanner's GET /status from the
 * NutriScan iOS shell on 2026-11-06. Requires the shell's Info.plist ATS
 * exception for the scanner IP.
 */
export class CapacitorHttpTransport implements HttpTransport {
  readonly baseUrl: string;

  constructor(options: { readonly baseUrl: string }) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
  }

  async get(pathAndQuery: string, options: HttpGetOptions): Promise<HttpGetResponse> {
    assertPath(pathAndQuery);
    const plugin = capacitorGlobal()?.Plugins?.CapacitorHttp;
    if (!plugin || !isCapacitorNativeHttpAvailable()) {
      throw new HttpTransportError('Capacitor native HTTP is not available (not running inside the NutriScan app)', pathAndQuery);
    }
    let response: { status: number; data: unknown };
    try {
      response = await withDeadline(
        plugin.request({
          url: `${this.baseUrl}${pathAndQuery}`,
          method: 'GET',
          responseType: 'text',
          connectTimeout: options.timeoutMs,
          readTimeout: options.timeoutMs,
        }),
        pathAndQuery,
        options,
      );
    } catch (cause) {
      if (cause instanceof HttpTransportError || options.signal?.aborted) throw cause;
      throw new HttpTransportError(`HTTP GET ${pathAndQuery} failed`, pathAndQuery, cause);
    }
    // Observed 2026-11-06: CapacitorHttp returned the /status body already
    // parsed as an object despite responseType 'text'. Re-serialize so the
    // protocol layer always receives text.
    const bodyText = typeof response.data === 'string' ? response.data : JSON.stringify(response.data ?? '');
    return { status: response.status, bodyText };
  }
}
