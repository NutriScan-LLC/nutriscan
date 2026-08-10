import { NextResponse } from 'next/server';
import type { PrecisionAoxScoringRequest } from '@nutriscan/scoring/quick-aox';
import { loadQuickAoxServerConfig } from '@/lib/quick-aox/server-config';
import {
  logPrecisionAoxSubmissionDiagnostic,
  logPrecisionAoxSubmissionSuccess,
  precisionAoxRouteError,
  safeClientRequestId,
} from '@/lib/quick-aox/route-response';
import { createPrecisionAoxServerGateway } from '@/lib/precision-aox/server-gateway';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<NextResponse> {
  const requestId = crypto.randomUUID();
  const clientRequestId = safeClientRequestId(request);
  const startedAt = Date.now();
  try {
    const body = await request.json() as { scannerSerial?: unknown; recommendedServer?: unknown; scoringRequest?: unknown };
    if (typeof body.scannerSerial !== 'string' || typeof body.recommendedServer !== 'string') {
      throw new TypeError('Invalid Precision AOX submission request');
    }
    const config = loadQuickAoxServerConfig(requestId);
    const raw = await createPrecisionAoxServerGateway({
      preRequestBaseUrl: config.preRequestBaseUrl,
      requestId,
    }).submit({
      scannerSerial: body.scannerSerial,
      recommendedServer: body.recommendedServer,
      scoringRequest: body.scoringRequest as PrecisionAoxScoringRequest,
      signal: request.signal,
    });
    logPrecisionAoxSubmissionSuccess(requestId, Date.now() - startedAt, clientRequestId);
    return NextResponse.json(raw);
  } catch (error) {
    logPrecisionAoxSubmissionDiagnostic(error, Date.now() - startedAt, clientRequestId);
    return precisionAoxRouteError(error);
  }
}
