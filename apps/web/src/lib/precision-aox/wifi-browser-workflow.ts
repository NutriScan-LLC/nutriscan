import { CapacitorHttpTransport, WifiBioZoomScanner, WIFI_ACCESS_POINT_BASE_URL } from "@nutriscan/scanner";
import { PrecisionAoxWorkflow, QuickAoxWorkflow, type QuickAoxScanner } from "@nutriscan/workflows";
import { NutriScanBrowserScoringGateway } from "@/lib/quick-aox/browser-gateway";
import { NutriScanPrecisionPreRequestGateway } from "./browser-pre-request";

/**
 * Precision AOX over the Biozoom Wi-Fi scanner (NutriScan app only). Same
 * shape as BrowserPrecisionAoxSession: one scanner session shared by every
 * constituent Quick AOX measurement.
 */
export class BrowserPrecisionAoxWifiSession {
  readonly workflow: PrecisionAoxWorkflow;
  readonly #scanner: WifiBioZoomScanner;

  constructor(baseUrl: string = WIFI_ACCESS_POINT_BASE_URL) {
    this.#scanner = new WifiBioZoomScanner(new CapacitorHttpTransport({ baseUrl }));
    const scanner: QuickAoxScanner = this.#scanner;
    const quick = new QuickAoxWorkflow({ scanner, scoring: new NutriScanBrowserScoringGateway() });
    this.workflow = new PrecisionAoxWorkflow({ quick, scoring: new NutriScanPrecisionPreRequestGateway() });
  }

  startDiagnosticRun(): string {
    return crypto.randomUUID();
  }

  async disconnect(): Promise<void> {
    await this.#scanner.disconnect();
  }

  async recoverConnection(): Promise<void> {
    await this.#scanner.disconnect();
  }
}
