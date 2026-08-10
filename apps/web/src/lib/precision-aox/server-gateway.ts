import 'server-only';
import {
  QUICK_AOX_MULTIPART_CONTRACT,
  assertPrecisionAoxScoringRequest,
  buildPrecisionAoxMeasureUrl,
  parsePrecisionAoxResponse,
  type PrecisionAoxScoringRequest,
} from '@nutriscan/scoring/quick-aox';
import type { PrecisionAoxScoringGateway } from '@nutriscan/workflows';
import { QuickAoxPreRequestDiagnosticError } from '@/lib/quick-aox/pre-request-errors';
import { classifyFetchFailure } from '@/lib/quick-aox/server-gateway';
import { createPrecisionAoxPreRequestGateway } from './server-pre-request';

type FetchImplementation = typeof fetch;

export function createPrecisionAoxServerGateway(options: {
  preRequestBaseUrl: string;
  requestId?: string;
  fetchImplementation?: FetchImplementation;
}): PrecisionAoxScoringGateway {
  const requestId = options.requestId ?? crypto.randomUUID();
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const preRequest = createPrecisionAoxPreRequestGateway({
    preRequestBaseUrl: options.preRequestBaseUrl,
    requestId,
    fetchImplementation,
  });
  return {
    preRequest: preRequest.preRequest,
    async submit({ scannerSerial, recommendedServer, scoringRequest, signal }) {
      assertServerSubmission(scannerSerial, scoringRequest);
      const formData = new FormData();
      formData.append(
        QUICK_AOX_MULTIPART_CONTRACT.fieldName,
        new Blob([JSON.stringify(scoringRequest.measureJson)], { type: QUICK_AOX_MULTIPART_CONTRACT.contentType }),
        QUICK_AOX_MULTIPART_CONTRACT.filename,
      );
      let response: Response;
      try {
        response = await fetchImplementation(buildPrecisionAoxMeasureUrl(recommendedServer, scannerSerial), {
          method: 'POST', body: formData, signal, cache: 'no-store',
        });
      } catch (cause) {
        if (signal?.aborted) throw cause;
        throw classifyFetchFailure(cause, requestId);
      }
      if (!response.ok) {
        throw new QuickAoxPreRequestDiagnosticError('UPSTREAM_HTTP_ERROR', 502, requestId, response.status);
      }
      let raw: unknown;
      try { raw = await response.json(); } catch {
        throw new QuickAoxPreRequestDiagnosticError('UPSTREAM_NON_JSON', 502, requestId, response.status);
      }
      if (!parsePrecisionAoxResponse(raw).ok) {
        throw new QuickAoxPreRequestDiagnosticError('UPSTREAM_INVALID_PRECISION_RESPONSE', 502, requestId, response.status);
      }
      return raw;
    },
  };
}

function assertServerSubmission(scannerSerial: string, request: PrecisionAoxScoringRequest): void {
  assertPrecisionAoxScoringRequest(request);
  if (request.scannerSerial !== scannerSerial || request.measureJson.Serial !== scannerSerial) {
    throw new TypeError('Precision AOX scanner serials do not match');
  }
}
