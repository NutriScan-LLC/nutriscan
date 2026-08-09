import { MockScannerService } from "./MockScannerService";
import type { ScannerService } from "./ScannerService";

// The single scanner service instance used throughout the app. Every page
// imports `scannerService` from here rather than reaching into
// MockScannerService/WebUsbScannerService directly. Swap the line below
// for `new WebUsbScannerService()` once the real WebUSB integration is
// ready — no other file needs to change.
export const scannerService: ScannerService = new MockScannerService();

export type {
  HistoryEntry,
  ScanResult,
  ScannerService,
  SystemCheckDefinition,
  SystemCheckId,
  SystemCheckStatus,
} from "./ScannerService";
