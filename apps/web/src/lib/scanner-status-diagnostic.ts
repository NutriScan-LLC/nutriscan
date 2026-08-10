import { BioZoomScanner, WebSerialTransport, type ParsedResponse, type ScannerIdentity } from '@nutriscan/scanner';
import { BIOZOOM_WEB_SERIAL_BAUD_RATE } from './quick-aox/browser-workflow';
import { scannerSessionOwnership } from './scanner-session-diagnostic';

export const SCANNER_STATUS_EXECUTION_PHRASE = 'READ STATUS ONLY';

export interface ScannerStatusDiagnosticScanner {
  connect(): Promise<void>;
  identify(): Promise<ScannerIdentity>;
  readStatusSnapshot(): Promise<ParsedResponse>;
  disconnect(): Promise<void>;
}

export interface SanitizedScannerStatusResult {
  readonly capturedAt: string;
  readonly protocol: 'v2';
  readonly identificationCommand: 'get_status' | 'status';
  readonly statusFields: Readonly<Record<string, unknown>>;
}

export class ScannerStatusDiagnosticRunner {
  #rawStatus: ParsedResponse | null = null;

  constructor(private readonly scanner: ScannerStatusDiagnosticScanner) {}

  /** Complete parsed status remains in memory only and is never logged or rendered directly. */
  get rawStatusForLocalInspection(): ParsedResponse | null { return this.#rawStatus; }

  async execute(executionPhrase: string): Promise<SanitizedScannerStatusResult> {
    if (executionPhrase !== SCANNER_STATUS_EXECUTION_PHRASE) throw new Error('Status diagnostic execution was not explicitly authorized');
    try {
      await this.scanner.connect();
      const identity = await this.scanner.identify();
      const status = await this.scanner.readStatusSnapshot();
      this.#rawStatus = status;
      if (status.kind !== 'ok' && status.kind !== 'error') throw new Error(`Scanner status response could not be parsed (${status.kind})`);
      return {
        capturedAt: new Date().toISOString(),
        protocol: identity.protocolVersion,
        identificationCommand: identity.commandUsed,
        statusFields: sanitizeStatusObject(status.json),
      };
    } finally {
      await this.scanner.disconnect().catch(() => {});
    }
  }
}

export class BrowserScannerStatusDiagnostic {
  readonly runner: ScannerStatusDiagnosticRunner;
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
    const scanner = new BioZoomScanner(transport);
    this.runner = new ScannerStatusDiagnosticRunner({
      connect: () => scanner.connect(),
      identify: () => scanner.identify(),
      readStatusSnapshot: () => scanner.readStatusSnapshot(),
      disconnect: async () => {
        try { await scanner.disconnect(); } finally {
          scannerSessionOwnership.release(this.#sessionId);
        }
      },
    });
  }
}

const SENSITIVE_KEY_PARTS = [
  'serial', 'host', 'ip', 'wifi_name', 'ssid', 'pass', 'password', 'token',
  'credential', 'secret', 'chip_id', 'mac', 'uuid', 'call-index', 'call_index',
  'unique', 'hardware_id', 'device_id', 'sensor_id', 'identifier', 'imei',
] as const;
const PROTOCOL_ONLY_KEYS = new Set(['command']);
const SENSITIVE_EXACT_KEYS = new Set(['id', 'sensor']);

export function sanitizeStatusObject(input: Record<string, unknown>): Readonly<Record<string, unknown>> {
  return sanitizeRecord(input);
}

function sanitizeRecord(input: Record<string, unknown>): Readonly<Record<string, unknown>> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    const normalized = key.toLowerCase();
    if (PROTOCOL_ONLY_KEYS.has(normalized) || SENSITIVE_EXACT_KEYS.has(normalized) || SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part))) continue;
    const safe = sanitizeValue(value);
    if (safe !== undefined) output[key] = safe;
  }
  return output;
}

function sanitizeValue(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(sanitizeValue).filter((item) => item !== undefined);
  if (typeof value === 'object') return sanitizeRecord(value as Record<string, unknown>);
  return undefined;
}
