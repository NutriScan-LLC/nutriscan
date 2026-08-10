import type { QuickAoxWorkflowOutcome } from "@nutriscan/workflows";

export const FAILED_SCAN_RETRY_PATH = "/scan/system-check";

export function requiresSerialRecovery(outcome: QuickAoxWorkflowOutcome): boolean {
  return outcome.kind === "failed" && (
    outcome.failureKind === "scanner" ||
    outcome.failureKind === "hand-detection" ||
    outcome.failureKind === "acquisition"
  );
}
