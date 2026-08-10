import {
  QUICK_AOX_MULTIPART_CONTRACT,
  buildQuickAoxMeasureUrl,
  buildQuickAoxPreRequestUrl,
  parseQuickAoxPreRequest,
  type QuickAoxScoringRequest,
} from "@nutriscan/scoring/quick-aox";
import type { QuickAoxScoringGateway } from "@nutriscan/workflows";
import { QuickAoxPreRequestDiagnosticError } from "./pre-request-errors";

export const QUICK_AOX_PRE_REQUEST_TIMEOUT_MS = 2_000;

export class QuickAoxUpstreamError extends Error {
  constructor(
    readonly operation: "pre-request" | "submission",
    readonly status: number,
  ) {
    super(`BioZoom ${operation} failed with HTTP ${status}`);
    this.name = "QuickAoxUpstreamError";
  }
}

type FetchImplementation = typeof fetch;

export function createQuickAoxServerGateway(options: {
  preRequestBaseUrl: string;
  requestId?: string;
  fetchImplementation?: FetchImplementation;
}): QuickAoxScoringGateway {
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const requestId = options.requestId ?? crypto.randomUUID();

  return {
    async preRequest({ scannerSerial, signal }) {
      let response: Response;
      try {
        response = await fetchPreRequestWithTimeout(
          fetchImplementation,
          buildQuickAoxPreRequestUrl(options.preRequestBaseUrl, scannerSerial),
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
      try { raw = await response.json(); } catch {
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
      return raw;
    },

    async submit({ scannerSerial, recommendedServer, scoringRequest, signal }) {
      assertConsistentScoringRequest(scannerSerial, scoringRequest);
      const formData = new FormData();
      formData.append(
        QUICK_AOX_MULTIPART_CONTRACT.fieldName,
        new Blob([JSON.stringify(scoringRequest.measureJson)], {
          type: QUICK_AOX_MULTIPART_CONTRACT.contentType,
        }),
        QUICK_AOX_MULTIPART_CONTRACT.filename,
      );
      const response = await fetchImplementation(
        buildQuickAoxMeasureUrl(recommendedServer, scannerSerial),
        {
          method: "POST",
          body: formData,
          signal,
          cache: "no-store",
        },
      );
      if (!response.ok) {
        throw new QuickAoxUpstreamError("submission", response.status);
      }
      return readUpstreamJson(response, "submission");
    },
  };
}

export async function fetchPreRequestWithTimeout(
  fetchImplementation: FetchImplementation,
  url: string,
  callerSignal: AbortSignal | undefined,
  requestId: string,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, QUICK_AOX_PRE_REQUEST_TIMEOUT_MS);
  const cancel = () => controller.abort(callerSignal?.reason);
  callerSignal?.addEventListener("abort", cancel, { once: true });
  try {
    return await fetchImplementation(url, { method: "GET", signal: controller.signal, cache: "no-store" });
  } catch (error) {
    if (callerSignal?.aborted) throw callerSignal.reason ?? new DOMException("Aborted", "AbortError");
    if (timedOut) throw new QuickAoxPreRequestDiagnosticError("UPSTREAM_TIMEOUT", 504, requestId);
    throw error;
  } finally {
    clearTimeout(timeout);
    callerSignal?.removeEventListener("abort", cancel);
  }
}

export function classifyFetchFailure(error: unknown, requestId: string): QuickAoxPreRequestDiagnosticError {
  const code = nestedErrorCode(error);
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return new QuickAoxPreRequestDiagnosticError("UPSTREAM_DNS_FAILURE", 502, requestId);
  }
  if (code && (code.startsWith("CERT_") || code.includes("TLS") || code.includes("SSL") || code === "DEPTH_ZERO_SELF_SIGNED_CERT" || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE")) {
    return new QuickAoxPreRequestDiagnosticError("UPSTREAM_TLS_FAILURE", 502, requestId);
  }
  return new QuickAoxPreRequestDiagnosticError("UPSTREAM_NETWORK_FAILURE", 502, requestId);
}

function nestedErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const direct = (error as { code?: unknown }).code;
  if (typeof direct === "string") return direct;
  const cause = (error as { cause?: unknown }).cause;
  return typeof cause === "object" && cause !== null && typeof (cause as { code?: unknown }).code === "string"
    ? (cause as { code: string }).code
    : undefined;
}

async function readUpstreamJson(
  response: Response,
  operation: "pre-request" | "submission",
): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new QuickAoxUpstreamError(operation, response.status);
  }
}

function assertConsistentScoringRequest(
  scannerSerial: string,
  scoringRequest: QuickAoxScoringRequest,
): void {
  if (
    scannerSerial.length === 0 ||
    scoringRequest.scannerSerial !== scannerSerial ||
    scoringRequest.measureJson.Serial !== scannerSerial
  ) {
    throw new TypeError("Scanner serials in the scoring request do not match");
  }
  if (
    !Number.isSafeInteger(scoringRequest.measurementNumber) ||
    scoringRequest.measurementNumber < 1
  ) {
    throw new TypeError("Measurement number must be a positive safe integer");
  }
  if (
    scoringRequest.measurementBlocks.length === 0 ||
    scoringRequest.measureJson.MeasurementBlocks !== scoringRequest.measurementBlocks
  ) {
    throw new TypeError("MeasurementBlocks in the scoring request do not match");
  }
}
