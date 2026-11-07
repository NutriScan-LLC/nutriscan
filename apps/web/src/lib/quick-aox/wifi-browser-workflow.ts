import {
  CapacitorHttpTransport,
  isCapacitorNativeHttpAvailable,
  WifiBioZoomScanner,
  WIFI_ACCESS_POINT_BASE_URL,
  type WifiBioZoomScannerOptions,
} from "@nutriscan/scanner";
import { QuickAoxWorkflow, type QuickAoxScanner } from "@nutriscan/workflows";
import { NutriScanBrowserScoringGateway } from "./browser-gateway";

/**
 * Quick AOX over the Biozoom Wi-Fi scanner. Only works inside the NutriScan
 * app shell (mobile/), where scanner requests run through Capacitor native
 * HTTP; a browser on app.yournutriscan.com is blocked by mixed content.
 *
 * Scoring still goes browser → NutriScan backend → BioZoom over HTTPS, so the
 * phone needs internet at that step (cellular, or after leaving the scanner's
 * access point).
 */

/**
 * Off unless NEXT_PUBLIC_WIFI_FULL_SCAN_ENABLED === "true". A full scan sends
 * the scanner's /d (deletes stored data, scope unknown) and starts a physical
 * measurement, so it must be switched on deliberately per deployment.
 */
export const WIFI_FULL_SCAN_ENABLED = process.env.NEXT_PUBLIC_WIFI_FULL_SCAN_ENABLED === "true";

export function isWifiScannerAvailable(): boolean {
  return isCapacitorNativeHttpAvailable();
}

export interface WifiRequestEvent {
  readonly path: string;
  readonly status: number | null;
  readonly durationMs: number;
  readonly error?: string;
}

export class BrowserQuickAoxWifiSession {
  readonly workflow: QuickAoxWorkflow;
  readonly scanner: WifiBioZoomScanner;

  constructor(options: {
    readonly baseUrl?: string;
    readonly onRequest?: (event: WifiRequestEvent) => void;
    readonly onHandSample?: WifiBioZoomScannerOptions["onHandSample"];
  } = {}) {
    const transport = new CapacitorHttpTransport({ baseUrl: options.baseUrl ?? WIFI_ACCESS_POINT_BASE_URL });
    this.scanner = new WifiBioZoomScanner(transport, {
      ...(options.onRequest ? { onRequest: options.onRequest } : {}),
      ...(options.onHandSample ? { onHandSample: options.onHandSample } : {}),
    });
    // Compile-time check that the Wi-Fi scanner satisfies the workflow seam.
    const scanner: QuickAoxScanner = this.scanner;
    this.workflow = new QuickAoxWorkflow({ scanner, scoring: new NutriScanBrowserScoringGateway() });
  }

  /** Parity with BrowserQuickAoxSession; Wi-Fi has no serial protocol diagnostics yet. */
  startDiagnosticRun(): string {
    return crypto.randomUUID();
  }

  async disconnect(): Promise<void> {
    await this.scanner.disconnect();
  }

  /** Nothing to reopen over HTTP; clears scanner session state. */
  async recoverConnection(): Promise<void> {
    await this.scanner.disconnect();
  }
}
