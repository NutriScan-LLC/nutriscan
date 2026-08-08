// Hardware diagnostic harness for the SDK's Scanner API. Talks only to
// BioZoomScanner for the connect/identify/disconnect flow (per CLAUDE.md
// rule 4: UI must never send raw serial commands or import
// transport/protocol internals directly). The one documented exception is
// the raw-byte logger hook below, which observes bytes crossing the
// transport boundary for diagnostics only — it never sends anything and
// carries no protocol knowledge. See docs/protocol.md's "Read Consumption
// Model" section.
import {
  BioZoomScanner,
  CallIndexMismatchError,
  ProtocolDetectionError,
  ProtocolError,
  ProtocolResponseTimeoutError,
  ScannerError,
  ScannerNotConnectedError,
  TransportDisconnectedError,
  TransportError,
  TransportTimeoutError,
  WebSerialTransport,
  toHex,
  type ParsedResponse,
  type ScannerIdentity,
} from '@nutriscan/scanner-sdk';

const statusEl = document.querySelector<HTMLSpanElement>('#status')!;
const errorBannerEl = document.querySelector<HTMLDivElement>('#error-banner')!;
const logEl = document.querySelector<HTMLDivElement>('#log')!;
const connectBtn = document.querySelector<HTMLButtonElement>('#connect')!;
const identifyBtn = document.querySelector<HTMLButtonElement>('#identify')!;
const disconnectBtn = document.querySelector<HTMLButtonElement>('#disconnect')!;
const clearLogBtn = document.querySelector<HTMLButtonElement>('#clear-log')!;

const protocolVersionEl = document.querySelector<HTMLElement>('#protocol-version')!;
const firmwareVersionEl = document.querySelector<HTMLElement>('#firmware-version')!;
const serialNumberEl = document.querySelector<HTMLElement>('#serial-number')!;
const commandUsedEl = document.querySelector<HTMLElement>('#command-used')!;
const rawResponseEl = document.querySelector<HTMLElement>('#raw-response')!;

function log(line: string): void {
  const timestamp = new Date().toISOString().slice(11, 23);
  logEl.textContent += `[${timestamp}] ${line}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

function showError(message: string): void {
  errorBannerEl.textContent = message;
  errorBannerEl.classList.add('visible');
}

function clearError(): void {
  errorBannerEl.textContent = '';
  errorBannerEl.classList.remove('visible');
}

type ConnectionState = 'disconnected' | 'connected' | 'failed';

function setState(state: ConnectionState): void {
  statusEl.dataset.state = state;
  statusEl.textContent = state === 'failed' ? 'Connection Failed' : state;
  connectBtn.disabled = state === 'connected';
  identifyBtn.disabled = state !== 'connected';
  disconnectBtn.disabled = state !== 'connected';
}

function clearIdentity(): void {
  protocolVersionEl.textContent = '—';
  firmwareVersionEl.textContent = '—';
  serialNumberEl.textContent = '—';
  commandUsedEl.textContent = '—';
  rawResponseEl.textContent = 'Not yet identified.';
}

function renderIdentity(identity: ScannerIdentity): void {
  protocolVersionEl.textContent = identity.protocolVersion.toUpperCase();
  // The protocol has no confirmed firmware-version field (see
  // docs/unknowns.md) — ScannerIdentity does not surface one, so this is
  // always "Unknown" rather than guessing a field name out of the raw JSON.
  firmwareVersionEl.textContent = 'Unknown';
  serialNumberEl.textContent = identity.serial ?? 'Unknown';
  commandUsedEl.textContent = identity.commandUsed;
  rawResponseEl.textContent = formatRawResponse(identity.response);
}

/** Renders whatever the parsed response actually carries — no interpretation beyond what response.ts already confirmed. */
function formatRawResponse(response: ParsedResponse): string {
  switch (response.kind) {
    case 'ok':
    case 'error':
    case 'unexpected-shape':
      return JSON.stringify(response.json, null, 2);
    case 'parse-error':
      return `<response was not valid JSON>\n${response.text}`;
    case 'decode-error':
      return `<response was not valid UTF-8>\n${toHex(response.rawBytes)}`;
  }
}

/** Maps SDK error types to a message worth showing a human — always the real message, never swallowed. */
function errorMessage(err: unknown): string {
  if (err instanceof ScannerNotConnectedError) return err.message;
  if (err instanceof ProtocolResponseTimeoutError) return `Scanner did not respond in time: ${err.message}`;
  if (err instanceof ProtocolDetectionError) return `Could not confirm protocol version: ${err.message}`;
  if (err instanceof CallIndexMismatchError) return `Unexpected response from scanner: ${err.message}`;
  if (err instanceof TransportTimeoutError) return `Serial timeout: ${err.message}`;
  if (err instanceof TransportDisconnectedError) return `Device disconnected: ${err.message}`;
  if (err instanceof ProtocolError) return `${err.name}: ${err.message}`;
  if (err instanceof ScannerError) return `${err.name}: ${err.message}`;
  if (err instanceof TransportError) return `${err.name}: ${err.message}`;
  if (err instanceof Error) return err.message;
  return String(err);
}

// Confirmed serial configuration from BIOZOOM_PROTOCOL_AND_IMPLEMENTATION.md.
// App-level config, not baked into the transport itself.
const BIOZOOM_SERIAL_OPTIONS = {
  baudRate: 2_000_000,
  dataBits: 8 as const,
  stopBits: 1 as const,
  parity: 'none' as const,
};

let scanner: BioZoomScanner | null = null;

connectBtn.addEventListener('click', async () => {
  clearError();
  connectBtn.disabled = true;

  const transport = new WebSerialTransport({
    ...BIOZOOM_SERIAL_OPTIONS,
    logger: {
      onRawBytes(direction, bytes) {
        log(`${direction === 'write' ? '>>' : '<<'} (${bytes.length}B) ${toHex(bytes)}`);
      },
    },
  });

  try {
    scanner = new BioZoomScanner(transport);
    await scanner.connect();
    setState('connected');
    log('Connected.');
  } catch (err) {
    setState('failed');
    const message = errorMessage(err);
    showError(`Connect failed: ${message}`);
    log(`Connect failed: ${message}`);
    scanner = null;
    connectBtn.disabled = false;
  }
});

identifyBtn.addEventListener('click', async () => {
  if (!scanner) return;
  clearError();
  identifyBtn.disabled = true;
  log('Identifying scanner...');

  try {
    const identity = await scanner.identify();
    renderIdentity(identity);
    log(`Identified via "${identity.commandUsed}" — serial: ${identity.serial ?? 'Unknown'}, protocol: ${identity.protocolVersion}`);
  } catch (err) {
    const message = errorMessage(err);
    showError(`Identify failed: ${message}`);
    log(`Identify failed: ${message}`);
  } finally {
    identifyBtn.disabled = false;
  }
});

disconnectBtn.addEventListener('click', async () => {
  if (!scanner) return;
  disconnectBtn.disabled = true;
  identifyBtn.disabled = true;

  try {
    await scanner.disconnect();
    log('Disconnected.');
  } catch (err) {
    const message = errorMessage(err);
    showError(`Disconnect failed: ${message}`);
    log(`Disconnect failed: ${message}`);
  } finally {
    setState('disconnected');
    clearIdentity();
    scanner = null;
  }
});

clearLogBtn.addEventListener('click', () => {
  logEl.textContent = '';
});

if (!('serial' in navigator)) {
  log('Web Serial API is not available in this browser. Use Chrome/Edge over HTTPS or localhost.');
  showError('Web Serial API is not available in this browser. Use Chrome or Edge over HTTPS or localhost.');
  connectBtn.disabled = true;
}
