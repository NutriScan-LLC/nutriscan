import { NextResponse } from "next/server";
import { loadQuickAoxServerConfig } from "@/lib/quick-aox/server-config";
import {
  logPrecisionAoxDiagnostic,
  logPrecisionAoxPreRequestSuccess,
  quickAoxRouteError,
  safeClientRequestId,
} from "@/lib/quick-aox/route-response";
import { createPrecisionAoxPreRequestGateway } from "@/lib/precision-aox/server-pre-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const requestId = crypto.randomUUID();
  const clientRequestId = safeClientRequestId(request);
  const startedAt = Date.now();
  try {
    const body = await request.json() as { scannerSerial?: unknown };
    if (typeof body.scannerSerial !== "string" || body.scannerSerial.length === 0) {
      throw new TypeError("scannerSerial is required");
    }
    const config = loadQuickAoxServerConfig(requestId);
    const response = await createPrecisionAoxPreRequestGateway({
      preRequestBaseUrl: config.preRequestBaseUrl,
      requestId,
    }).preRequest({ scannerSerial: body.scannerSerial, signal: request.signal });
    logPrecisionAoxPreRequestSuccess(requestId, Date.now() - startedAt, clientRequestId);
    return NextResponse.json(response);
  } catch (error) {
    logPrecisionAoxDiagnostic(error, Date.now() - startedAt, clientRequestId);
    return quickAoxRouteError(error);
  }
}
