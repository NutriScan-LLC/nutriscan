// The scanner contract the rest of the app depends on. Pages import
// `scannerService` from "@/services/scanner" and call these methods —
// never WebUSB/serial APIs, and never the mock functions in
// lib/mock-scanner.ts directly. Today `scannerService` resolves to
// MockScannerService; swapping in WebUsbScannerService later (see
// index.ts) should not require changing a single page.
//
// These types/methods describe scanner OPERATIONS (check the system, run a
// scan, fetch history) — nothing here mentions WebUSB, serial ports, or any
// specific hardware protocol. Implementation classes are named for HOW they
// communicate (e.g. WebUsbScannerService), not who manufactured the
// hardware — the scanner vendor is an internal implementation detail that
// lives entirely inside whichever implementation class is active; this
// interface never names it.

export type SystemCheckId = "browser" | "webusb" | "scanner";

export type SystemCheckStatus = "pending" | "checking" | "success" | "failure";

export type SystemCheckDefinition = {
  id: SystemCheckId;
  label: string;
  icon: "browser" | "usb" | "scanner";
  successDetail: string;
  failureTitle: string;
  failureDetail: string;
};

export type ScanResult = {
  score: number;
  delta: number;
  capturedAt: string;
};

export type HistoryEntry = {
  id: string;
  date: string;
  score: number;
};

export interface ScannerService {
  /** Static metadata for the pre-flight checklist (labels/copy/icons). */
  getSystemChecks(): SystemCheckDefinition[];

  /**
   * Runs the pre-flight checks in order, reporting each one's status via
   * `onUpdate` as it settles. Resolves to whether all checks passed.
   * `failing` is a dev/demo hook to simulate a specific check failing; a
   * real implementation is free to ignore it.
   */
  runSystemChecks(
    onUpdate: (id: SystemCheckId, status: SystemCheckStatus) => void,
    options?: { signal?: AbortSignal; failing?: SystemCheckId[] },
  ): Promise<boolean>;

  /** Establishes a connection to the scanner. */
  connect(): Promise<void>;

  /** Tears down the current scanner connection. */
  disconnect(): Promise<void>;

  /**
   * Starts a scan, reporting progress from 0-100 via `onProgress` until it
   * completes (or `options.signal` aborts it).
   */
  startScan(
    onProgress: (percent: number) => void,
    options?: { durationMs?: number; signal?: AbortSignal },
  ): Promise<void>;

  /** Cancels whatever scanner operation is currently in flight. */
  cancel(): Promise<void>;

  /** Turns a completed scan into a result (score/delta/timestamp). */
  analyzeScan(options?: { signal?: AbortSignal }): Promise<ScanResult>;

  /** Most-recent-first list of past scans, including any saved this session. */
  getHistory(): HistoryEntry[];

  /** Persists a completed scan result so it shows up in getHistory(). */
  saveResult(result: ScanResult): void;
}
