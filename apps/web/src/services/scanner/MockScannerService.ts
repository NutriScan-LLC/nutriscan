import {
  SYSTEM_CHECKS,
  getScanHistory,
  mockAnalyzeScan,
  mockRunScan,
  mockRunSystemChecks,
  mockSaveScanResult,
} from "@/lib/mock-scanner";
import type {
  HistoryEntry,
  ScanResult,
  ScannerService,
  SystemCheckDefinition,
  SystemCheckId,
  SystemCheckStatus,
} from "./ScannerService";

// Wraps the existing mock functions in lib/mock-scanner.ts behind the
// ScannerService contract. No behavior is rewritten here — every method is
// a direct pass-through to the function it replaces, so the app behaves
// exactly as it did before this service existed. See lib/mock-scanner.ts
// for the actual pacing/logic and its own "not real hardware" disclaimer.
export class MockScannerService implements ScannerService {
  getSystemChecks(): SystemCheckDefinition[] {
    return SYSTEM_CHECKS;
  }

  runSystemChecks(
    onUpdate: (id: SystemCheckId, status: SystemCheckStatus) => void,
    options?: { signal?: AbortSignal; failing?: SystemCheckId[] },
  ): Promise<boolean> {
    return mockRunSystemChecks(onUpdate, options);
  }

  async connect(): Promise<void> {
    // No separate "pairing" step exists in the current mock flow — the
    // "scanner" system check already stands in for scanner presence, and
    // no page calls connect() today. Resolves immediately so a future
    // caller can safely await it without any behavior changing now.
  }

  async disconnect(): Promise<void> {
    // See connect() above — nothing to tear down in the mock.
  }

  startScan(
    onProgress: (percent: number) => void,
    options?: { durationMs?: number; signal?: AbortSignal },
  ): Promise<void> {
    return mockRunScan(onProgress, options);
  }

  async cancel(): Promise<void> {
    // The mock's cancellation is per-operation, via the AbortSignal each
    // caller already passes into runSystemChecks()/startScan() (see
    // scan/system-check and scan/in-progress) — there's no persistent
    // connection state here for a standalone cancel() to tear down yet.
    // Kept as a no-op so the interface shape is ready for a real
    // implementation that DOES need to send a hardware abort command.
  }

  analyzeScan(options?: { signal?: AbortSignal }): Promise<ScanResult> {
    return mockAnalyzeScan(options);
  }

  getHistory(): HistoryEntry[] {
    return getScanHistory();
  }

  saveResult(result: ScanResult): void {
    mockSaveScanResult(result);
  }
}
