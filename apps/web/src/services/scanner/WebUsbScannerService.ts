import type {
  HistoryEntry,
  ScanResult,
  ScannerService,
  SystemCheckDefinition,
} from "./ScannerService";

// Placeholder for the real WebUSB scanner integration. No protocol logic
// lives here yet — every method throws so this can be built out
// incrementally and swapped in via index.ts once ready, without changing
// the ScannerService contract or any page that depends on it.
//
// This class describes HOW it talks to the scanner (WebUSB) — not WHO
// manufactured it. The scanner vendor/protocol is an internal
// implementation detail that belongs entirely inside this class (or a
// private protocol folder beneath it); nothing outside this file should
// ever need to know which hardware vendor or SDK is involved. A future
// transport (Bluetooth, Electron/native, etc.) gets its own sibling
// ScannerService implementation — e.g. BluetoothScannerService,
// ElectronScannerService, NativeScannerService — rather than branching
// inside this one.
//
// Per CLAUDE.md: never invent or modify scanner protocol behavior. Real
// implementations of these methods must be based on confirmed hardware SDK
// behavior, not guessed here.
export class WebUsbScannerService implements ScannerService {
  getSystemChecks(): SystemCheckDefinition[] {
    throw new Error("Not implemented");
  }

  runSystemChecks(): Promise<boolean> {
    throw new Error("Not implemented");
  }

  connect(): Promise<void> {
    throw new Error("Not implemented");
  }

  disconnect(): Promise<void> {
    throw new Error("Not implemented");
  }

  startScan(): Promise<void> {
    throw new Error("Not implemented");
  }

  cancel(): Promise<void> {
    throw new Error("Not implemented");
  }

  analyzeScan(): Promise<ScanResult> {
    throw new Error("Not implemented");
  }

  getHistory(): HistoryEntry[] {
    throw new Error("Not implemented");
  }

  saveResult(): void {
    throw new Error("Not implemented");
  }
}
