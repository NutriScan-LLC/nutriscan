import { NextResponse } from "next/server";
import {
  logQuickAoxDiagnostic,
  logQuickAoxPreRequestSuccess,
  quickAoxRouteError,
  safeClientRequestId,
} from "@/lib/quick-aox/route-response";
import { createQuickAoxServerGateway } from "@/lib/quick-aox/server-gateway";
import { loadQuickAoxServerConfig } from "@/lib/quick-aox/server-config";

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
    const response = await gateway(requestId).preRequest({
      scannerSerial: body.scannerSerial,
      signal: request.signal,
    });
    logQuickAoxPreRequestSuccess(requestId, Date.now() - startedAt, clientRequestId);
    return NextResponse.json(response);
  } catch (error) {
    logQuickAoxDiagnostic(error, Date.now() - startedAt, clientRequestId);
    return quickAoxRouteError(error);
  }
}

function gateway(requestId: string) {
  const config = loadQuickAoxServerConfig(requestId);
  return createQuickAoxServerGateway({ preRequestBaseUrl: config.preRequestBaseUrl, requestId });
}
