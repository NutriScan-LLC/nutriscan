import { BioZoomScanner, WebSerialTransport } from '@nutriscan/scanner';
import { PrecisionAoxWorkflow, QuickAoxWorkflow } from '@nutriscan/workflows';
import { AuthorizedSerialPortProvider, BIOZOOM_WEB_SERIAL_BAUD_RATE } from '@/lib/quick-aox/browser-workflow';
import { NutriScanBrowserScoringGateway } from '@/lib/quick-aox/browser-gateway';
import { NutriScanPrecisionPreRequestGateway } from './browser-pre-request';
import { ScannerSessionDiagnostic, scannerSessionOwnership, type SafeScannerDiagnosticReport } from '../scanner-session-diagnostic';

/** One retained Web Serial session shared by every constituent Quick AOX scan. */
export class BrowserPrecisionAoxSession {
  readonly workflow: PrecisionAoxWorkflow;
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
      parity: 'none',
      requestPort: () => this.#ports.obtain(),
    });
    this.#scanner = new BioZoomScanner(transport, { protocol: { diagnosticObserver: this.#diagnostic.observeProtocol } });
    const quick = new QuickAoxWorkflow({
      scanner: this.#scanner,
      scoring: new NutriScanBrowserScoringGateway(fetchImplementation),
    });
    this.workflow = new PrecisionAoxWorkflow({
      quick,
      scoring: new NutriScanPrecisionPreRequestGateway(fetchImplementation),
    });
  }

  startDiagnosticRun(): string { return this.#diagnostic.startRun('precision-aox'); }

  async disconnect(): Promise<void> {
    this.#diagnostic.lifecycle('disconnect-started');
    try { await this.#scanner.disconnect(); } finally {
      scannerSessionOwnership.release(this.#diagnostic.sessionId);
      this.#ports.clear();
      this.#diagnostic.lifecycle('disconnect-completed');
    }
  }

  async recoverConnection(): Promise<void> {
    this.#diagnostic.lifecycle('recovery-started');
    try { await this.#scanner.disconnect(); } finally {
      scannerSessionOwnership.release(this.#diagnostic.sessionId);
      this.#diagnostic.lifecycle('recovery-completed');
    }
  }
}
