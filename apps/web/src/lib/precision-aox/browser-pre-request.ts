import {
  NutriScanScoringGatewayError,
  type NutriScanBrowserDiagnosticCode,
} from "@/lib/quick-aox/browser-gateway";
import {
  isQuickAoxDiagnosticEnvelope,
  type QuickAoxPreRequestDiagnosticCode,
} from "@/lib/quick-aox/diagnostic-contract";

type FetchImplementation = typeof fetch;

export class NutriScanPrecisionPreRequestGateway {
  readonly #fetch: FetchImplementation;

  constructor(fetchImplementation: FetchImplementation = globalThis.fetch) {
    this.#fetch = fetchImplementation.bind(globalThis);
  }

  async preRequest(request: { scannerSerial: string; signal?: AbortSignal }): Promise<unknown> {
    const clientRequestId = crypto.randomUUID();
    let response: Response;
    try {
      response = await this.#fetch("/api/precision-aox/pre-request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-NutriScan-Client-Request-Id": clientRequestId,
        },
        body: JSON.stringify({ scannerSerial: request.scannerSerial }),
        signal: request.signal,
      });
    } catch (cause) {
      if (request.signal?.aborted) throw cause;
      throw diagnosticError("BROWSER_FETCH_REJECTED", 0, clientRequestId);
    }
    if (!response.ok) {
      let body: unknown;
      try { body = await response.json(); } catch { /* sanitized envelope unavailable */ }
      if (isQuickAoxDiagnosticEnvelope(body)) {
        throw new NutriScanScoringGatewayError(
          "pre-request",
          response.status,
          body.error.diagnosticCode,
          body.error.requestId,
          body.error.upstreamStatus,
        );
      }
      throw diagnosticError("NUTRISCAN_NON_DIAGNOSTIC_HTTP_ERROR", response.status, clientRequestId);
    }
    try {
      return await response.json();
    } catch {
      throw diagnosticError("NUTRISCAN_SUCCESS_NON_JSON", response.status, clientRequestId);
    }
  }
}

function diagnosticError(
  code: NutriScanBrowserDiagnosticCode | QuickAoxPreRequestDiagnosticCode,
  status: number,
  requestId: string,
) {
  return new NutriScanScoringGatewayError("pre-request", status, code, requestId);
}
