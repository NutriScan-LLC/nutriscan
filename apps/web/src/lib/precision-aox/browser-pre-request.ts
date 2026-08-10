import {
  NutriScanScoringGatewayError,
  type NutriScanBrowserDiagnosticCode,
} from "@/lib/quick-aox/browser-gateway";
import {
  isQuickAoxDiagnosticEnvelope,
  type QuickAoxPreRequestDiagnosticCode,
} from "@/lib/quick-aox/diagnostic-contract";
import type { PrecisionAoxScoringRequest } from "@nutriscan/scoring/quick-aox";
import type { PrecisionAoxScoringGateway } from "@nutriscan/workflows";

type FetchImplementation = typeof fetch;

export class NutriScanPrecisionPreRequestGateway implements PrecisionAoxScoringGateway {
  readonly #fetch: FetchImplementation;

  constructor(fetchImplementation: FetchImplementation = globalThis.fetch) {
    this.#fetch = fetchImplementation.bind(globalThis);
  }

  async preRequest(request: { scannerSerial: string; signal?: AbortSignal }): Promise<unknown> {
    return this.#post('/api/precision-aox/pre-request', { scannerSerial: request.scannerSerial }, 'pre-request', request.signal);
  }

  async submit(request: { scannerSerial: string; recommendedServer: string; scoringRequest: PrecisionAoxScoringRequest; signal?: AbortSignal }): Promise<unknown> {
    return this.#post('/api/precision-aox/submit', {
      scannerSerial: request.scannerSerial,
      recommendedServer: request.recommendedServer,
      scoringRequest: request.scoringRequest,
    }, 'submission', request.signal);
  }

  async #post(path: string, body: unknown, operation: 'pre-request' | 'submission', signal?: AbortSignal): Promise<unknown> {
    const clientRequestId = crypto.randomUUID();
    let response: Response;
    try {
      response = await this.#fetch(path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-NutriScan-Client-Request-Id": clientRequestId,
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (cause) {
      if (signal?.aborted) throw cause;
      throw diagnosticError("BROWSER_FETCH_REJECTED", 0, clientRequestId, operation);
    }
    if (!response.ok) {
      let body: unknown;
      try { body = await response.json(); } catch { /* sanitized envelope unavailable */ }
      if (isQuickAoxDiagnosticEnvelope(body)) {
        throw new NutriScanScoringGatewayError(
          operation,
          response.status,
          body.error.diagnosticCode,
          body.error.requestId,
          body.error.upstreamStatus,
        );
      }
      throw diagnosticError("NUTRISCAN_NON_DIAGNOSTIC_HTTP_ERROR", response.status, clientRequestId, operation);
    }
    try {
      return await response.json();
    } catch {
      throw diagnosticError("NUTRISCAN_SUCCESS_NON_JSON", response.status, clientRequestId, operation);
    }
  }
}

function diagnosticError(
  code: NutriScanBrowserDiagnosticCode | QuickAoxPreRequestDiagnosticCode,
  status: number,
  requestId: string,
  operation: 'pre-request' | 'submission' = 'pre-request',
) {
  return new NutriScanScoringGatewayError(operation, status, code, requestId);
}
