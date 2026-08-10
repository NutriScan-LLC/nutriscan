import { APK_BARE_DELETE_RESPONSE_TIMEOUT_MS, BioZoomScanner, ProtocolResponseTimeoutError, WebSerialTransport, type ParsedResponse, type ScannerIdentity } from '@nutriscan/scanner';
import { BIOZOOM_WEB_SERIAL_BAUD_RATE } from './quick-aox/browser-workflow';
import { scannerSessionOwnership } from './scanner-session-diagnostic';
import { sanitizeStatusObject } from './scanner-status-diagnostic';

export const SCANNER_DELETE_ONCE_EXECUTION_PHRASE = 'DELETE SCOPE UNKNOWN ONCE';
export const APK_DELETE_RESPONSE_TIMEOUT_MS = APK_BARE_DELETE_RESPONSE_TIMEOUT_MS;

export interface ScannerDeleteOnceDiagnosticScanner {
  connect(): Promise<void>;
  identify(): Promise<ScannerIdentity>;
  readStatusSnapshot(): Promise<ParsedResponse>;
  deleteMeasurementStorageOnceDiagnostic(): Promise<ParsedResponse>;
  disconnect(): Promise<void>;
}

export interface SanitizedDeleteAcknowledgment {
  readonly command: 'delete';
  readonly sentAt: string;
  readonly responseAt?: string;
  readonly responseReceived: boolean;
  readonly strictlyCorrelated: boolean;
  readonly responseKind?: 'ok' | 'error';
  readonly responseCommandMatches?: boolean;
  readonly diagnostic?: 'DELETE_RESPONSE_TIMEOUT' | 'DELETE_RESPONSE_FAILED';
}

export interface SanitizedScannerDeleteOnceResult {
  readonly completedAt: string;
  readonly protocol: 'v2';
  readonly identificationCommand: 'get_status' | 'status';
  readonly beforeStatus: Readonly<Record<string, unknown>>;
  readonly deleteAcknowledgment: SanitizedDeleteAcknowledgment;
  readonly afterStatus: Readonly<Record<string, unknown>>;
}

export class ScannerDeleteOnceDiagnosticRunner {
  constructor(
    private readonly scanner: ScannerDeleteOnceDiagnosticScanner,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(executionPhrase: string): Promise<SanitizedScannerDeleteOnceResult> {
    if (executionPhrase !== SCANNER_DELETE_ONCE_EXECUTION_PHRASE) {
      throw new Error('Bare-delete diagnostic execution was not explicitly authorized');
    }
    try {
      await this.scanner.connect();
      const identity = await this.scanner.identify();
      const before = requireParsedStatus(await this.scanner.readStatusSnapshot());
      const sentAt = this.now().toISOString();
      let acknowledgment: SanitizedDeleteAcknowledgment;
      try {
        const response = await this.scanner.deleteMeasurementStorageOnceDiagnostic();
        const responseAt = this.now().toISOString();
        if (response.kind !== 'ok' && response.kind !== 'error') {
          acknowledgment = {
            command: 'delete', sentAt, responseAt, responseReceived: true,
            strictlyCorrelated: true, diagnostic: 'DELETE_RESPONSE_FAILED',
          };
        } else {
          acknowledgment = {
            command: 'delete', sentAt, responseAt, responseReceived: true,
            strictlyCorrelated: true, responseKind: response.kind,
            responseCommandMatches: commandName(response.command) === 'delete',
          };
        }
      } catch (cause) {
        acknowledgment = {
          command: 'delete', sentAt, responseReceived: false, strictlyCorrelated: false,
          diagnostic: cause instanceof ProtocolResponseTimeoutError
            ? 'DELETE_RESPONSE_TIMEOUT'
            : 'DELETE_RESPONSE_FAILED',
        };
      }
      const after = requireParsedStatus(await this.scanner.readStatusSnapshot());
      return {
        completedAt: this.now().toISOString(),
        protocol: identity.protocolVersion,
        identificationCommand: identity.commandUsed,
        beforeStatus: sanitizeStatusObject(before.json),
        deleteAcknowledgment: acknowledgment,
        afterStatus: sanitizeStatusObject(after.json),
      };
    } finally {
      await this.scanner.disconnect().catch(() => {});
    }
  }
}

export class BrowserScannerDeleteOnceDiagnostic {
  readonly runner: ScannerDeleteOnceDiagnosticRunner;
  readonly #sessionId = crypto.randomUUID();

  constructor() {
    const transport = new WebSerialTransport({
      baudRate: BIOZOOM_WEB_SERIAL_BAUD_RATE,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      requestPort: async () => {
        scannerSessionOwnership.claim(this.#sessionId);
        try { return await navigator.serial.requestPort(); }
        catch (cause) { scannerSessionOwnership.release(this.#sessionId); throw cause; }
      },
    });
    const scanner = new BioZoomScanner(transport, {
      protocol: { responseTimeoutMs: APK_DELETE_RESPONSE_TIMEOUT_MS },
    });
    this.runner = new ScannerDeleteOnceDiagnosticRunner({
      connect: () => scanner.connect(),
      identify: () => scanner.identify(),
      readStatusSnapshot: () => scanner.readStatusSnapshot(),
      deleteMeasurementStorageOnceDiagnostic: () => scanner.deleteMeasurementStorageOnceDiagnostic(),
      disconnect: async () => {
        try { await scanner.disconnect(); }
        finally { scannerSessionOwnership.release(this.#sessionId); }
      },
    });
  }
}

function requireParsedStatus(response: ParsedResponse): Extract<ParsedResponse, { kind: 'ok' | 'error' }> {
  if (response.kind !== 'ok' && response.kind !== 'error') throw new Error('Scanner status response could not be parsed');
  return response;
}

function commandName(command: string | undefined): string | undefined {
  return command?.split('?')[0];
}
