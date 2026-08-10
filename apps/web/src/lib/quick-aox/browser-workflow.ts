import { BioZoomScanner, WebSerialTransport } from "@nutriscan/scanner";
import { QuickAoxWorkflow } from "@nutriscan/workflows";
import { NutriScanBrowserScoringGateway } from "./browser-gateway";

export const BIOZOOM_WEB_SERIAL_BAUD_RATE = 2_000_000;

export class AuthorizedSerialPortProvider {
  #selectedPort: SerialPort | null = null;
  constructor(private readonly serial: Serial = navigator.serial) {}
  async obtain(): Promise<SerialPort> {
    if (this.#selectedPort) return this.#selectedPort;
    const authorized = await this.serial.getPorts();
    this.#selectedPort = authorized.length === 1 ? authorized[0]! : await this.serial.requestPort();
    return this.#selectedPort;
  }
  clear(): void { this.#selectedPort = null; }
}

export class BrowserQuickAoxSession {
  readonly workflow: QuickAoxWorkflow;
  readonly #scanner: BioZoomScanner;
  readonly #ports: AuthorizedSerialPortProvider;

  constructor(fetchImplementation?: typeof fetch) {
    this.#ports = new AuthorizedSerialPortProvider();
    const transport = new WebSerialTransport({
      baudRate: BIOZOOM_WEB_SERIAL_BAUD_RATE,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      requestPort: () => this.#ports.obtain(),
    });
    this.#scanner = new BioZoomScanner(transport);
    this.workflow = new QuickAoxWorkflow({
      scanner: this.#scanner,
      scoring: new NutriScanBrowserScoringGateway(fetchImplementation),
    });
  }

  async disconnect(): Promise<void> {
    await this.#scanner.disconnect();
    this.#ports.clear();
  }

  /** Non-destructive recovery: close serial/protocol state, retain authorization. */
  async recoverConnection(): Promise<void> {
    await this.#scanner.disconnect();
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
