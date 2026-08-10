import "server-only";
import { parseQuickAoxPreRequest } from "@nutriscan/scoring/quick-aox";
import { QuickAoxPreRequestDiagnosticError } from "@/lib/quick-aox/pre-request-errors";
import {
  classifyFetchFailure,
  fetchPreRequestWithTimeout,
} from "@/lib/quick-aox/server-gateway";

type FetchImplementation = typeof fetch;

export function createPrecisionAoxPreRequestGateway(options: {
  preRequestBaseUrl: string;
  requestId?: string;
  fetchImplementation?: FetchImplementation;
}) {
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const requestId = options.requestId ?? crypto.randomUUID();

  return {
    async preRequest({ scannerSerial, signal }: { scannerSerial: string; signal?: AbortSignal }): Promise<unknown> {
      let response: Response;
      try {
        response = await fetchPreRequestWithTimeout(
          fetchImplementation,
          buildPrecisionAoxPreRequestUrl(options.preRequestBaseUrl, scannerSerial),
          signal,
          requestId,
        );
      } catch (error) {
        if (error instanceof QuickAoxPreRequestDiagnosticError || signal?.aborted) throw error;
        throw classifyFetchFailure(error, requestId);
      }
      if (!response.ok) {
        throw new QuickAoxPreRequestDiagnosticError("UPSTREAM_HTTP_ERROR", 502, requestId, response.status);
      }
      let raw: unknown;
      try {
        raw = await response.json();
      } catch {
        throw new QuickAoxPreRequestDiagnosticError("UPSTREAM_NON_JSON", 502, requestId, response.status);
      }
      const parsed = parseQuickAoxPreRequest(raw);
      if (!parsed.ok) {
        throw new QuickAoxPreRequestDiagnosticError(
          parsed.error.code === "unsupported-repeat-pre-request"
            ? "UPSTREAM_REPEAT_REQUIRED"
            : "UPSTREAM_INVALID_PRE_REQUEST",
          502,
          requestId,
          response.status,
        );
      }
      if (
        typeof raw !== "object" || raw === null || Array.isArray(raw) ||
        (raw as Record<string, unknown>).new_pre_request_req !== false ||
        typeof (raw as Record<string, unknown>).new_pre_request_delay_ms !== "number" ||
        !Number.isFinite((raw as Record<string, unknown>).new_pre_request_delay_ms) ||
        ((raw as Record<string, unknown>).new_pre_request_delay_ms as number) < 0
      ) {
        throw new QuickAoxPreRequestDiagnosticError(
          "UPSTREAM_INVALID_PRE_REQUEST",
          502,
          requestId,
          response.status,
        );
      }
      return {
        new_pre_request_req: false,
        waiting_time_ms: parsed.value.waitingTimeMs,
        new_pre_request_delay_ms: (raw as Record<string, unknown>).new_pre_request_delay_ms as number,
        recommended_server: parsed.value.recommendedServer,
      };
    },
  };
}

export function buildPrecisionAoxPreRequestUrl(baseUrl: string, scannerSerial: string): string {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new RangeError("pre-request base URL must be valid");
  }
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "") {
    throw new RangeError("pre-request base URL must be HTTPS without credentials");
  }
  return `${baseUrl.replace(/\/+$/, "")}/pre-request/?serial_id=${encodeURIComponent(scannerSerial)}&measure_type=1`;
}
