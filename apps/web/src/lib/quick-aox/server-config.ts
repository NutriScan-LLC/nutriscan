import "server-only";
import { QuickAoxPreRequestDiagnosticError } from "./pre-request-errors";

export interface QuickAoxServerConfig {
  readonly preRequestBaseUrl: string;
}

export function loadQuickAoxServerConfig(
  requestId: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): QuickAoxServerConfig {
  const value = environment.BIOZOOM_QUICK_AOX_BASE_URL;
  if (!value) throw new QuickAoxPreRequestDiagnosticError("CONFIG_MISSING", 500, requestId);
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new QuickAoxPreRequestDiagnosticError("CONFIG_INVALID", 500, requestId); }
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "") {
    throw new QuickAoxPreRequestDiagnosticError("CONFIG_INVALID", 500, requestId);
  }
  return { preRequestBaseUrl: value.replace(/\/+$/, "") };
}
