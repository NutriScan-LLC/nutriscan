import { NextResponse } from "next/server";
import { QuickAoxUpstreamError } from "./server-gateway";

export function quickAoxRouteError(error: unknown): NextResponse {
  if (error instanceof SyntaxError || error instanceof TypeError || error instanceof RangeError) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: "The Quick AOX request is invalid." } },
      { status: 400 },
    );
  }
  if (error instanceof QuickAoxUpstreamError) {
    return NextResponse.json(
      {
        error: {
          code: error.operation === "pre-request"
            ? "BIOZOOM_PRE_REQUEST_FAILED"
            : "BIOZOOM_SUBMISSION_FAILED",
          message: "The scoring service did not accept the request.",
        },
      },
      { status: 502 },
    );
  }
  return NextResponse.json(
    { error: { code: "SCORING_GATEWAY_FAILED", message: "The scoring gateway could not complete the request." } },
    { status: 502 },
  );
}
