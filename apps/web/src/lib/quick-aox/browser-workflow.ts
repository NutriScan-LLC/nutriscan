import { BioZoomScanner, WebSerialTransport } from "@nutriscan/scanner";
import { QuickAoxWorkflow } from "@nutriscan/workflows";
import { NutriScanBrowserScoringGateway } from "./browser-gateway";
import { ScannerSessionDiagnostic, scannerSessionOwnership, type SafeScannerDiagnosticReport } from "../scanner-session-diagnostic";

export const BIOZOOM_WEB_SERIAL_BAUD_RATE = 2_000_000;

export class AuthorizedSerialPortProvider {
  #selectedPort: SerialPort | null = null;
  constructor(private readonly serial: Serial = navigator.serial, private readonly sessionId?: string) {}
  async obtain(): Promise<SerialPort> {
    if (this.sessionId) scannerSessionOwnership.claim(this.sessionId);
    if (this.#selectedPort) return this.#selectedPort;
    try {
      const authorized = await this.serial.getPorts();
      this.#selectedPort = authorized.length === 1 ? authorized[0]! : await this.serial.requestPort();
      return this.#selectedPort;
    } catch (cause) {
      if (this.sessionId) scannerSessionOwnership.release(this.sessionId);
      throw cause;
    }
  }
  clear(): void { this.#selectedPort = null; }
}

export class BrowserQuickAoxSession {
  readonly workflow: QuickAoxWorkflow;
  readonly #scanner: BioZoomScanner;
  readonly #ports: AuthorizedSerialPortProvider;
  readonly #diagnostic: ScannerSessionDiagnostic;

  constructor(fetchImplementation?: typeof fetch, onDiagnostic?: (report: SafeScannerDiagnosticReport) => void) {
    this.#diagnostic = new ScannerSessionDiagnostic(onDiagnostic);
    this.#ports = new AuthorizedSerialPortProvider(navigator.serial, this.#diagnostic.sessionId);
    const transport = new WebSerialTransport({
      baudRate: BIOZOOM_WEB_SERIAL_BAUD_RATE,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      requestPort: () => this.#ports.obtain(),
    });
    this.#scanner = new BioZoomScanner(transport, { protocol: { diagnosticObserver: this.#diagnostic.observeProtocol } });
    this.workflow = new QuickAoxWorkflow({
      scanner: this.#scanner,
      scoring: new NutriScanBrowserScoringGateway(fetchImplementation),
    });
  }

  startDiagnosticRun(): string { return this.#diagnostic.startRun('quick-aox'); }

  async disconnect(): Promise<void> {
    this.#diagnostic.lifecycle('disconnect-started');
    try { await this.#scanner.disconnect(); } finally {
      scannerSessionOwnership.release(this.#diagnostic.sessionId);
      this.#ports.clear();
      this.#diagnostic.lifecycle('disconnect-completed');
    }
  }

  /** Non-destructive recovery: close serial/protocol state, retain authorization. */
  async recoverConnection(): Promise<void> {
    this.#diagnostic.lifecycle('recovery-started');
    try { await this.#scanner.disconnect(); } finally {
      scannerSessionOwnership.release(this.#diagnostic.sessionId);
      this.#diagnostic.lifecycle('recovery-completed');
    }
  }
}

export function isWebSerialSupported(): boolean {
  return typeof navigator !== "undefined" && "serial" in navigator;
}

export function createBrowserQuickAoxWorkflow(options?: {
  fetchImplementation?: typeof fetch;
}): QuickAoxWorkflow {
  return new BrowserQuickAoxSession(options?.fetchImplementation).workflow;
}
