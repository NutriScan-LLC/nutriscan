import { NextResponse } from "next/server";
import { QuickAoxUpstreamError } from "./server-gateway";
import { QuickAoxPreRequestDiagnosticError } from "./pre-request-errors";

export function quickAoxRouteError(error: unknown): NextResponse {
  if (error instanceof QuickAoxPreRequestDiagnosticError) {
    return NextResponse.json({ error: error.sanitized() }, { status: error.status });
  }
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

export function logQuickAoxDiagnostic(error: unknown, durationMs: number, clientRequestId?: string): void {
  if (!(error instanceof QuickAoxPreRequestDiagnosticError)) return;
  // Intentionally excludes serial, URL/query, bodies, credentials, and raw errors.
  console.error(JSON.stringify({
    event: "quick_aox_pre_request_failed",
    requestId: error.requestId,
    diagnosticCode: error.diagnosticCode,
    status: error.status,
    ...(clientRequestId === undefined ? {} : { clientRequestId }),
    ...(error.upstreamStatus === undefined ? {} : { upstreamStatus: error.upstreamStatus }),
    durationMs,
  }));
}

export function logQuickAoxPreRequestSuccess(
  requestId: string,
  durationMs: number,
  clientRequestId?: string,
): void {
  // Intentionally excludes serial, URL/query, bodies, credentials, and response fields.
  console.info(JSON.stringify({
    event: "quick_aox_pre_request_succeeded",
    requestId,
    ...(clientRequestId === undefined ? {} : { clientRequestId }),
    status: 200,
    durationMs,
  }));
}

export function logPrecisionAoxDiagnostic(error: unknown, durationMs: number, clientRequestId?: string): void {
  if (!(error instanceof QuickAoxPreRequestDiagnosticError)) return;
  console.error(JSON.stringify({
    event: "precision_aox_pre_request_failed",
    requestId: error.requestId,
    diagnosticCode: error.diagnosticCode,
    status: error.status,
    ...(clientRequestId === undefined ? {} : { clientRequestId }),
    ...(error.upstreamStatus === undefined ? {} : { upstreamStatus: error.upstreamStatus }),
    durationMs,
  }));
}

export function logPrecisionAoxPreRequestSuccess(
  requestId: string,
  durationMs: number,
  clientRequestId?: string,
): void {
  console.info(JSON.stringify({
    event: "precision_aox_pre_request_succeeded",
    requestId,
    ...(clientRequestId === undefined ? {} : { clientRequestId }),
    status: 200,
    durationMs,
  }));
}

export function safeClientRequestId(request: Request): string | undefined {
  const value = request.headers.get("x-nutriscan-client-request-id");
  return value !== null && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : undefined;
}
