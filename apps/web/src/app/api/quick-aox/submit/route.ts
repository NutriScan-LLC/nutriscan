import { NextResponse } from "next/server";
import type { QuickAoxScoringRequest } from "@nutriscan/scoring/quick-aox";
import { quickAoxRouteError } from "@/lib/quick-aox/route-response";
import { createQuickAoxServerGateway } from "@/lib/quick-aox/server-gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SubmissionBody = {
  scannerSerial?: unknown;
  recommendedServer?: unknown;
  scoringRequest?: unknown;
};

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = await request.json() as SubmissionBody;
    if (
      typeof body.scannerSerial !== "string" ||
      typeof body.recommendedServer !== "string" ||
      !isRecord(body.scoringRequest)
    ) {
      throw new TypeError("Invalid Quick AOX submission request");
    }
    const response = await gateway().submit({
      scannerSerial: body.scannerSerial,
      recommendedServer: body.recommendedServer,
      scoringRequest: body.scoringRequest as unknown as QuickAoxScoringRequest,
      signal: request.signal,
    });
    return NextResponse.json(response);
  } catch (error) {
    return quickAoxRouteError(error);
  }
}

function gateway() {
  const preRequestBaseUrl = process.env.BIOZOOM_QUICK_AOX_BASE_URL;
  if (!preRequestBaseUrl) {
    throw new Error("BIOZOOM_QUICK_AOX_BASE_URL is not configured");
  }
  return createQuickAoxServerGateway({ preRequestBaseUrl });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
