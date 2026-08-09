import {
  QUICK_AOX_MULTIPART_CONTRACT,
  buildQuickAoxMeasureUrl,
  buildQuickAoxPreRequestUrl,
  type QuickAoxScoringRequest,
} from "@nutriscan/scoring/quick-aox";
import type { QuickAoxScoringGateway } from "@nutriscan/workflows";

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
  fetchImplementation?: FetchImplementation;
}): QuickAoxScoringGateway {
  const fetchImplementation = options.fetchImplementation ?? fetch;

  return {
    async preRequest({ scannerSerial, signal }) {
      const response = await fetchImplementation(
        buildQuickAoxPreRequestUrl(options.preRequestBaseUrl, scannerSerial),
        {
          method: "GET",
          signal,
          cache: "no-store",
        },
      );
      if (!response.ok) {
        throw new QuickAoxUpstreamError("pre-request", response.status);
      }
      return readUpstreamJson(response, "pre-request");
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
