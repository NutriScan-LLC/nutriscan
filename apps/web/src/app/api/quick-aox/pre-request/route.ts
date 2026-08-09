import { NextResponse } from "next/server";
import { quickAoxRouteError } from "@/lib/quick-aox/route-response";
import { createQuickAoxServerGateway } from "@/lib/quick-aox/server-gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = await request.json() as { scannerSerial?: unknown };
    if (typeof body.scannerSerial !== "string" || body.scannerSerial.length === 0) {
      throw new TypeError("scannerSerial is required");
    }
    const response = await gateway().preRequest({
      scannerSerial: body.scannerSerial,
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
