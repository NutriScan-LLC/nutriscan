import type { ProtocolDiagnosticEvent } from '@nutriscan/scanner';

export type ScannerWorkflowKind = 'quick-aox' | 'precision-aox';

export type SafeScannerDiagnosticEvent =
  | ({ readonly workflowRunId: string; readonly scannerSessionId: string } & ProtocolDiagnosticEvent)
  | { readonly kind: 'run-started'; readonly timestamp: string; readonly workflowRunId: string; readonly scannerSessionId: string; readonly workflow: ScannerWorkflowKind; readonly anotherScannerSessionActive: boolean }
  | { readonly kind: 'recovery-started' | 'recovery-completed' | 'disconnect-started' | 'disconnect-completed'; readonly timestamp: string; readonly workflowRunId: string; readonly scannerSessionId: string; readonly anotherScannerSessionActive: boolean };

export interface SafeScannerDiagnosticReport {
  readonly workflowRunId: string;
  readonly scannerSessionId: string;
  readonly workflow: ScannerWorkflowKind;
  readonly events: readonly SafeScannerDiagnosticEvent[];
}

export class ScannerSessionDiagnostic {
  readonly sessionId = crypto.randomUUID();
  #report: SafeScannerDiagnosticReport | null = null;
  constructor(private readonly onChange?: (report: SafeScannerDiagnosticReport) => void) {}

  startRun(workflow: ScannerWorkflowKind): string {
    const runId = crypto.randomUUID();
    this.#report = { workflowRunId: runId, scannerSessionId: this.sessionId, workflow, events: [] };
    this.record({
      kind: 'run-started', timestamp: new Date().toISOString(), workflowRunId: runId,
      scannerSessionId: this.sessionId, workflow, anotherScannerSessionActive: scannerSessionOwnership.isAnotherActive(this.sessionId),
    });
    return runId;
  }

  observeProtocol = (event: ProtocolDiagnosticEvent): void => {
    const report = this.#report;
    if (!report) return;
    this.record({ ...event, workflowRunId: report.workflowRunId, scannerSessionId: this.sessionId });
  };

  lifecycle(kind: 'recovery-started' | 'recovery-completed' | 'disconnect-started' | 'disconnect-completed'): void {
    const report = this.#report;
    if (!report) return;
    this.record({
      kind, timestamp: new Date().toISOString(), workflowRunId: report.workflowRunId,
      scannerSessionId: this.sessionId, anotherScannerSessionActive: scannerSessionOwnership.isAnotherActive(this.sessionId),
    });
  }

  snapshot(): SafeScannerDiagnosticReport | null {
    return this.#report === null ? null : { ...this.#report, events: [...this.#report.events] };
  }

  private record(event: SafeScannerDiagnosticEvent): void {
    if (!this.#report) return;
    this.#report = { ...this.#report, events: [...this.#report.events, event] };
    this.onChange?.(this.snapshot()!);
  }
}

class ScannerSessionOwnership {
  #owner: string | null = null;
  claim(sessionId: string): void {
    if (this.#owner !== null && this.#owner !== sessionId) throw new Error('Another NutriScan scanner session is active');
    this.#owner = sessionId;
  }
  release(sessionId: string): void { if (this.#owner === sessionId) this.#owner = null; }
  isAnotherActive(sessionId: string): boolean { return this.#owner !== null && this.#owner !== sessionId; }
  activeSessionId(): string | null { return this.#owner; }
  resetForTest(): void { this.#owner = null; }
}

export const scannerSessionOwnership = new ScannerSessionOwnership();

/** Synchronous guard: React state is intentionally not used to prevent double starts. */
export class ScannerRunGuard {
  #activeRunId: string | null = null;
  #settlement: Promise<unknown> | null = null;
  tryStart(runId: string): boolean {
    if (this.#activeRunId !== null) return false;
    this.#activeRunId = runId;
    return true;
  }
  attach(runId: string, settlement: Promise<unknown>): void { if (this.#activeRunId === runId) this.#settlement = settlement; }
  isCurrent(runId: string): boolean { return this.#activeRunId === runId; }
  async awaitCurrentSettlement(): Promise<void> { await this.#settlement?.catch(() => {}); }
  finish(runId: string): void {
    if (this.#activeRunId !== runId) return;
    this.#activeRunId = null;
    this.#settlement = null;
  }
}

export function formatSafeScannerDiagnostic(report: SafeScannerDiagnosticReport): string {
  return JSON.stringify(report, null, 2);
}
