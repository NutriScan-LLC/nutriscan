import type { QuickAoxScoringGateway } from "@nutriscan/workflows";
import { isQuickAoxDiagnosticEnvelope, type QuickAoxPreRequestDiagnosticCode } from "./diagnostic-contract";

type FetchImplementation = typeof fetch;

export type NutriScanBrowserDiagnosticCode =
  | "BROWSER_FETCH_REJECTED"
  | "NUTRISCAN_NON_DIAGNOSTIC_HTTP_ERROR"
  | "NUTRISCAN_SUCCESS_NON_JSON";

export class NutriScanScoringGatewayError extends Error {
  constructor(
    readonly operation: "pre-request" | "submission",
    readonly status: number,
    readonly diagnosticCode?: QuickAoxPreRequestDiagnosticCode | NutriScanBrowserDiagnosticCode,
    readonly requestId?: string,
    readonly upstreamStatus?: number,
  ) {
    super(`NutriScan scoring ${operation} failed with HTTP ${status}`);
    this.name = "NutriScanScoringGatewayError";
  }
}

export class NutriScanBrowserScoringGateway implements QuickAoxScoringGateway {
  readonly #fetch: FetchImplementation;

  constructor(fetchImplementation: FetchImplementation = globalThis.fetch) {
    this.#fetch = fetchImplementation.bind(globalThis);
  }

  async preRequest(request: Parameters<QuickAoxScoringGateway["preRequest"]>[0]): Promise<unknown> {
    return this.#post(
      "/api/quick-aox/pre-request",
      { scannerSerial: request.scannerSerial },
      "pre-request",
      request.signal,
    );
  }

  async submit(request: Parameters<QuickAoxScoringGateway["submit"]>[0]): Promise<unknown> {
    return this.#post(
      "/api/quick-aox/submit",
      {
        scannerSerial: request.scannerSerial,
        recommendedServer: request.recommendedServer,
        scoringRequest: request.scoringRequest,
      },
      "submission",
      request.signal,
    );
  }

  async #post(
    path: string,
    body: unknown,
    operation: "pre-request" | "submission",
    signal?: AbortSignal,
  ): Promise<unknown> {
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
      // The workflow owns cancellation. Do not relabel it as a network failure.
      if (signal?.aborted) throw cause;
      throw new NutriScanScoringGatewayError(
        operation,
        0,
        "BROWSER_FETCH_REJECTED",
        clientRequestId,
      );
    }
    if (!response.ok) {
      let body: unknown;
      try { body = await response.json(); } catch { /* sanitized envelope unavailable */ }
      if (operation === "pre-request" && isQuickAoxDiagnosticEnvelope(body)) {
        throw new NutriScanScoringGatewayError(
          operation,
          response.status,
          body.error.diagnosticCode,
          body.error.requestId,
          body.error.upstreamStatus,
        );
      }
      throw new NutriScanScoringGatewayError(
        operation,
        response.status,
        "NUTRISCAN_NON_DIAGNOSTIC_HTTP_ERROR",
        clientRequestId,
      );
    }
    try {
      return await response.json();
    } catch {
      throw new NutriScanScoringGatewayError(
        operation,
        response.status,
        "NUTRISCAN_SUCCESS_NON_JSON",
        clientRequestId,
      );
    }
  }
}
