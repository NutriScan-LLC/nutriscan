export const QUICK_AOX_PRE_REQUEST_DIAGNOSTIC_CODES = [
  "CONFIG_MISSING",
  "CONFIG_INVALID",
  "UPSTREAM_DNS_FAILURE",
  "UPSTREAM_TLS_FAILURE",
  "UPSTREAM_NETWORK_FAILURE",
  "UPSTREAM_TIMEOUT",
  "UPSTREAM_HTTP_ERROR",
  "UPSTREAM_NON_JSON",
  "UPSTREAM_INVALID_PRE_REQUEST",
  "UPSTREAM_REPEAT_REQUIRED",
] as const;

export type QuickAoxPreRequestDiagnosticCode = typeof QUICK_AOX_PRE_REQUEST_DIAGNOSTIC_CODES[number];

export interface QuickAoxSanitizedDiagnostic {
  readonly diagnosticCode: QuickAoxPreRequestDiagnosticCode;
  readonly status: number;
  readonly requestId: string;
  readonly upstreamStatus?: number;
}

export interface QuickAoxDiagnosticEnvelope {
  readonly error: QuickAoxSanitizedDiagnostic;
}

export function isQuickAoxDiagnosticEnvelope(value: unknown): value is QuickAoxDiagnosticEnvelope {
  if (typeof value !== "object" || value === null || !("error" in value)) return false;
  const error = (value as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as Record<string, unknown>;
  return typeof candidate.diagnosticCode === "string"
    && (QUICK_AOX_PRE_REQUEST_DIAGNOSTIC_CODES as readonly string[]).includes(candidate.diagnosticCode)
    && typeof candidate.status === "number"
    && typeof candidate.requestId === "string"
    && (candidate.upstreamStatus === undefined || typeof candidate.upstreamStatus === "number");
}
