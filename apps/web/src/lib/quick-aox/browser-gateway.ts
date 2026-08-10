import type { QuickAoxScoringGateway } from "@nutriscan/workflows";

type FetchImplementation = typeof fetch;

export class NutriScanScoringGatewayError extends Error {
  constructor(
    readonly operation: "pre-request" | "submission",
    readonly status: number,
  ) {
    super(`NutriScan scoring ${operation} failed with HTTP ${status}`);
    this.name = "NutriScanScoringGatewayError";
  }
}

export class NutriScanBrowserScoringGateway implements QuickAoxScoringGateway {
  readonly #fetch: FetchImplementation;

  constructor(fetchImplementation: FetchImplementation = fetch) {
    this.#fetch = fetchImplementation;
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
    const response = await this.#fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      throw new NutriScanScoringGatewayError(operation, response.status);
    }
    try {
      return await response.json();
    } catch {
      throw new NutriScanScoringGatewayError(operation, response.status);
    }
  }
}
