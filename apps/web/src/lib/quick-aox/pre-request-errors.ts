import type { QuickAoxPreRequestDiagnosticCode, QuickAoxSanitizedDiagnostic } from "./diagnostic-contract";

export class QuickAoxPreRequestDiagnosticError extends Error {
  constructor(
    readonly diagnosticCode: QuickAoxPreRequestDiagnosticCode,
    readonly status: number,
    readonly requestId: string,
    readonly upstreamStatus?: number,
  ) {
    super(`Quick AOX pre-request failed (${diagnosticCode})`);
    this.name = "QuickAoxPreRequestDiagnosticError";
  }

  sanitized(): QuickAoxSanitizedDiagnostic {
    return {
      diagnosticCode: this.diagnosticCode,
      status: this.status,
      requestId: this.requestId,
      ...(this.upstreamStatus === undefined ? {} : { upstreamStatus: this.upstreamStatus }),
    };
  }
}
