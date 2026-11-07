import type { QuickAoxWorkflow } from "@nutriscan/workflows";
import { isWebSerialSupported } from "./browser-workflow";
import { isWifiScannerAvailable } from "./wifi-browser-workflow";

/**
 * How this device reaches the scanner:
 *  - "wifi": inside the NutriScan app shell (Capacitor native HTTP).
 *  - "usb":  desktop Chrome/Edge with Web Serial.
 * The app check comes first: the iOS WebView has no Web Serial anyway, and a
 * future Android shell might expose both.
 */
export type ScannerConnection = "usb" | "wifi";

export function detectScannerConnection(): ScannerConnection | null {
  if (isWifiScannerAvailable()) return "wifi";
  if (isWebSerialSupported()) return "usb";
  return null;
}

/** Lifecycle surface shared by BrowserQuickAoxSession and BrowserQuickAoxWifiSession. */
export interface QuickAoxBrowserSession {
  readonly workflow: QuickAoxWorkflow;
  startDiagnosticRun(): string;
  disconnect(): Promise<void>;
  recoverConnection(): Promise<void>;
}
