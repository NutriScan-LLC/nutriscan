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
  analyzeM7FlashResponse,
  analyzeM8FlashResponse,
  analyzeM9FlashResponse,
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
} from '@nutriscan/scanner';

const statusEl = document.querySelector<HTMLSpanElement>('#status')!;
const errorBannerEl = document.querySelector<HTMLDivElement>('#error-banner')!;
const logEl = document.querySelector<HTMLDivElement>('#log')!;
const connectBtn = document.querySelector<HTMLButtonElement>('#connect')!;
const identifyBtn = document.querySelector<HTMLButtonElement>('#identify')!;
const runM1Btn = document.querySelector<HTMLButtonElement>('#run-m1')!;
const captureM2Btn = document.querySelector<HTMLButtonElement>('#capture-m2')!;
const captureM3Btn = document.querySelector<HTMLButtonElement>('#capture-m3')!;
const m4MeasurementInput = document.querySelector<HTMLInputElement>('#m4-measurement')!;
const readM4Btn = document.querySelector<HTMLButtonElement>('#read-m4')!;
const m5MeasurementInput = document.querySelector<HTMLInputElement>('#m5-measurement')!;
const readM5Btn = document.querySelector<HTMLButtonElement>('#read-m5')!;
const m6MeasurementInput = document.querySelector<HTMLInputElement>('#m6-measurement')!;
const readM6Btn = document.querySelector<HTMLButtonElement>('#read-m6')!;
const m7MeasurementInput = document.querySelector<HTMLInputElement>('#m7-measurement')!;
const readM7Btn = document.querySelector<HTMLButtonElement>('#read-m7')!;
const m8MeasurementInput = document.querySelector<HTMLInputElement>('#m8-measurement')!;
const readM8Btn = document.querySelector<HTMLButtonElement>('#read-m8')!;
const m9MeasurementInput = document.querySelector<HTMLInputElement>('#m9-measurement')!;
const readM9Btn = document.querySelector<HTMLButtonElement>('#read-m9')!;
const runM15Btn = document.querySelector<HTMLButtonElement>('#run-m15')!;
const markM15VisibleCompleteBtn = document.querySelector<HTMLButtonElement>('#mark-m15-visible-complete')!;
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
  if (state !== 'connected') runM1Btn.disabled = true;
  if (state !== 'connected') runM15Btn.disabled = true;
  if (state !== 'connected') markM15VisibleCompleteBtn.disabled = true;
  if (state !== 'connected') captureM2Btn.disabled = true;
  if (state !== 'connected') captureM3Btn.disabled = true;
  if (state !== 'connected') {
    m4MeasurementInput.disabled = true;
    readM4Btn.disabled = true;
    m5MeasurementInput.disabled = true;
    readM5Btn.disabled = true;
    m6MeasurementInput.disabled = true;
    readM6Btn.disabled = true;
    m7MeasurementInput.disabled = true;
    readM7Btn.disabled = true;
    m8MeasurementInput.disabled = true;
    readM8Btn.disabled = true;
    m9MeasurementInput.disabled = true;
    readM9Btn.disabled = true;
  }
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
let m1UsedForConnection = false;
let m2UsedForConnection = false;
let m3UsedForConnection = false;
let m4UsedForConnection = false;
let m5UsedForConnection = false;
let m6UsedForConnection = false;
let m7UsedForConnection = false;
let m8UsedForConnection = false;
let m9UsedForConnection = false;
let m15UsedForConnection = false;
let m15VisibleCompletedAt: string | null = null;
let identifiedV2 = false;
let lastIdentity: ScannerIdentity | null = null;
let rawTranscript: Array<{ timestamp: string; direction: 'read' | 'write'; hex: string; bytes: number[] }> = [];

connectBtn.addEventListener('click', async () => {
  clearError();
  connectBtn.disabled = true;

  const transport = new WebSerialTransport({
    ...BIOZOOM_SERIAL_OPTIONS,
    logger: {
      onRawBytes(direction, bytes) {
        rawTranscript.push({ timestamp: new Date().toISOString(), direction, hex: toHex(bytes), bytes: Array.from(bytes) });
        log(`${direction === 'write' ? '>>' : '<<'} (${bytes.length}B) ${toHex(bytes)}`);
      },
    },
  });

  try {
    m1UsedForConnection = false;
    m2UsedForConnection = false;
    m3UsedForConnection = false;
    m4UsedForConnection = false;
    m5UsedForConnection = false;
    m6UsedForConnection = false;
    m7UsedForConnection = false;
    m8UsedForConnection = false;
    m9UsedForConnection = false;
    m15UsedForConnection = false;
    m15VisibleCompletedAt = null;
    identifiedV2 = false;
    lastIdentity = null;
    rawTranscript = [];
    runM1Btn.disabled = true;
    captureM2Btn.disabled = true;
    captureM3Btn.disabled = true;
    m4MeasurementInput.disabled = true;
    readM4Btn.disabled = true;
    m5MeasurementInput.disabled = true;
    readM5Btn.disabled = true;
    m6MeasurementInput.disabled = true;
    readM6Btn.disabled = true;
    m7MeasurementInput.disabled = true;
    readM7Btn.disabled = true;
    m8MeasurementInput.disabled = true;
    readM8Btn.disabled = true;
    m9MeasurementInput.disabled = true;
    readM9Btn.disabled = true;
    runM15Btn.disabled = true;
    markM15VisibleCompleteBtn.disabled = true;
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
    lastIdentity = identity;
    identifiedV2 = identity.protocolVersion === 'v2';
    renderIdentity(identity);
    if (identity.protocolVersion === 'v2' && !m1UsedForConnection) runM1Btn.disabled = false;
    if (identity.protocolVersion === 'v2' && !m4UsedForConnection) {
      m4MeasurementInput.disabled = false;
      readM4Btn.disabled = false;
    }
    if (identity.protocolVersion === 'v2' && !m5UsedForConnection) {
      m5MeasurementInput.disabled = false;
      readM5Btn.disabled = false;
    }
    if (identity.protocolVersion === 'v2' && !m6UsedForConnection) {
      m6MeasurementInput.disabled = false;
      readM6Btn.disabled = false;
    }
    if (identity.protocolVersion === 'v2' && !m7UsedForConnection) {
      m7MeasurementInput.disabled = false;
      readM7Btn.disabled = false;
    }
    if (identity.protocolVersion === 'v2' && !m8UsedForConnection) {
      m8MeasurementInput.disabled = false;
      readM8Btn.disabled = false;
    }
    if (identity.protocolVersion === 'v2' && !m9UsedForConnection) {
      m9MeasurementInput.disabled = false;
      readM9Btn.disabled = false;
    }
    if (identity.protocolVersion === 'v2' && !m15UsedForConnection) runM15Btn.disabled = false;
    log(`Identified via "${identity.commandUsed}" — serial: ${identity.serial ?? 'Unknown'}, protocol: ${identity.protocolVersion}`);
  } catch (err) {
    const message = errorMessage(err);
    showError(`Identify failed: ${message}`);
    log(`Identify failed: ${message}`);
  } finally {
    identifyBtn.disabled = false;
  }
});

readM4Btn.addEventListener('click', async () => {
  if (!scanner || m4UsedForConnection) return;

  const measurementNumber = Number(m4MeasurementInput.value);
  if (!Number.isSafeInteger(measurementNumber) || measurementNumber < 1) {
    showError('Experiment M4 requires a positive integer measurement number. No command was sent.');
    return;
  }

  // Experiment M4 is a single read-only flash request. Set this before
  // awaiting so rapid clicks cannot queue multiple requests.
  m4UsedForConnection = true;
  readM4Btn.disabled = true;
  m4MeasurementInput.disabled = true;
  clearError();
  log(
    `Experiment M4 beginning: sending exactly one read-flash request for measurement ${measurementNumber}, block=0, range=1.`,
  );

  try {
    const response = await scanner.readFirstFlashBlockExperimentM4(measurementNumber);
    log(`Experiment M4 complete ParsedResponse:\n${serializeParsedResponse(response)}`);
  } catch (err) {
    const message = errorMessage(err);
    showError(`Experiment M4 failed: ${message}`);
    log(`Experiment M4 error (unchanged):\n${serializeUnknownError(err)}`);
  }
});

readM5Btn.addEventListener('click', async () => {
  if (!scanner || m5UsedForConnection) return;

  const measurementNumber = Number(m5MeasurementInput.value);
  if (!Number.isSafeInteger(measurementNumber) || measurementNumber < 1) {
    showError('Experiment M5 requires a positive integer measurement number. No command was sent.');
    return;
  }

  // Experiment M5 is a single read-only flash request. Set this before
  // awaiting so rapid clicks cannot queue multiple requests.
  m5UsedForConnection = true;
  readM5Btn.disabled = true;
  m5MeasurementInput.disabled = true;
  clearError();
  log(
    `Experiment M5 beginning: sending exactly one read-flash request for measurement ${measurementNumber}, block=1, range=1.`,
  );

  try {
    const response = await scanner.readSecondFlashBlockExperimentM5(measurementNumber);
    log(`Experiment M5 complete ParsedResponse:\n${serializeParsedResponse(response)}`);
  } catch (err) {
    const message = errorMessage(err);
    showError(`Experiment M5 failed: ${message}`);
    log(`Experiment M5 error (unchanged):\n${serializeUnknownError(err)}`);
  }
});

readM6Btn.addEventListener('click', async () => {
  if (!scanner || m6UsedForConnection) return;

  const measurementNumber = Number(m6MeasurementInput.value);
  if (!Number.isSafeInteger(measurementNumber) || measurementNumber < 1) {
    showError('Experiment M6 requires a positive integer measurement number. No command was sent.');
    return;
  }

  // Experiment M6 is a single read-only flash request. Set this before
  // awaiting so rapid clicks cannot queue multiple requests.
  m6UsedForConnection = true;
  readM6Btn.disabled = true;
  m6MeasurementInput.disabled = true;
  clearError();
  log(
    `Experiment M6 beginning: sending exactly one read-flash request for measurement ${measurementNumber}, block=2, range=1.`,
  );

  try {
    const response = await scanner.readThirdFlashBlockExperimentM6(measurementNumber);
    log(`Experiment M6 complete ParsedResponse:\n${serializeParsedResponse(response)}`);
  } catch (err) {
    const message = errorMessage(err);
    showError(`Experiment M6 failed: ${message}`);
    log(`Experiment M6 error (unchanged):\n${serializeUnknownError(err)}`);
  }
});

readM7Btn.addEventListener('click', async () => {
  if (!scanner || m7UsedForConnection) return;

  const measurementNumber = Number(m7MeasurementInput.value);
  if (!Number.isSafeInteger(measurementNumber) || measurementNumber < 1) {
    showError('Experiment M7 requires a positive integer measurement number. No command was sent.');
    return;
  }

  // Experiment M7 is a single read-only flash request. Set this before
  // awaiting so rapid clicks cannot queue multiple requests.
  m7UsedForConnection = true;
  readM7Btn.disabled = true;
  m7MeasurementInput.disabled = true;
  clearError();
  log(
    `Experiment M7 beginning: sending exactly one read-flash request for measurement ${measurementNumber}, block=0, range=3.`,
  );

  try {
    const response = await scanner.readFirstThreeFlashBlocksExperimentM7(measurementNumber);
    log(`Experiment M7 complete ParsedResponse:\n${serializeParsedResponse(response)}`);
    log(`Experiment M7 decoded block analysis:\n${JSON.stringify(analyzeM7FlashResponse(response), null, 2)}`);
  } catch (err) {
    const message = errorMessage(err);
    showError(`Experiment M7 failed: ${message}`);
    log(`Experiment M7 error (unchanged):\n${serializeUnknownError(err)}`);
  }
});

readM8Btn.addEventListener('click', async () => {
  if (!scanner || m8UsedForConnection) return;

  const measurementNumber = Number(m8MeasurementInput.value);
  if (!Number.isSafeInteger(measurementNumber) || measurementNumber < 1) {
    showError('Experiment M8 requires a positive integer measurement number. No command was sent.');
    return;
  }

  // Experiment M8 is one bounded read-only request. Set this before
  // awaiting so rapid clicks cannot queue multiple requests.
  m8UsedForConnection = true;
  readM8Btn.disabled = true;
  m8MeasurementInput.disabled = true;
  clearError();
  log(
    `Experiment M8 beginning: sending exactly one read-flash request for measurement ${measurementNumber}, block=0, range=150.`,
  );

  try {
    const response = await scanner.readBoundedFlashRangeExperimentM8(measurementNumber);
    log(`Experiment M8 complete ParsedResponse:\n${serializeParsedResponse(response)}`);
    log(`Experiment M8 decoded block analysis:\n${JSON.stringify(analyzeM8FlashResponse(response), null, 2)}`);
  } catch (err) {
    const message = errorMessage(err);
    showError(`Experiment M8 failed: ${message}`);
    log(`Experiment M8 error (unchanged):\n${serializeUnknownError(err)}`);
  }
});

readM9Btn.addEventListener('click', async () => {
  if (!scanner || m9UsedForConnection) return;

  const measurementNumber = Number(m9MeasurementInput.value);
  if (!Number.isSafeInteger(measurementNumber) || measurementNumber < 1) {
    showError('Experiment M9 requires a positive integer measurement number. No command was sent.');
    return;
  }

  // Experiment M9 is one non-overlapping bounded read-only request. Set
  // this before awaiting so rapid clicks cannot queue multiple requests.
  m9UsedForConnection = true;
  readM9Btn.disabled = true;
  m9MeasurementInput.disabled = true;
  clearError();
  log(
    `Experiment M9 beginning: sending exactly one read-flash request for measurement ${measurementNumber}, block=150, range=150.`,
  );

  try {
    const response = await scanner.readSecondBoundedFlashRangeExperimentM9(measurementNumber);
    log(`Experiment M9 complete ParsedResponse:\n${serializeParsedResponse(response)}`);
    log(`Experiment M9 decoded block analysis:\n${JSON.stringify(analyzeM9FlashResponse(response), null, 2)}`);
  } catch (err) {
    const message = errorMessage(err);
    showError(`Experiment M9 failed: ${message}`);
    log(`Experiment M9 error (unchanged):\n${serializeUnknownError(err)}`);
  }
});

runM1Btn.addEventListener('click', async () => {
  if (!scanner || m1UsedForConnection) return;

  // Experiment M1 is deliberately single-use for each connection. Set
  // this before awaiting so rapid clicks cannot queue multiple commands.
  m1UsedForConnection = true;
  runM1Btn.disabled = true;
  clearError();
  log('Experiment M1 beginning: sending one vendor-proposed measure command with type=aox.');

  try {
    const response = await scanner.startAoxMeasurementExperiment();
    log(`Experiment M1 complete ParsedResponse:\n${serializeParsedResponse(response)}`);
    if (!m2UsedForConnection) captureM2Btn.disabled = false;
  } catch (err) {
    const message = errorMessage(err);
    showError(`Experiment M1 failed: ${message}`);
    log(`Experiment M1 error (unchanged):\n${serializeUnknownError(err)}`);
  }
});

captureM2Btn.addEventListener('click', async () => {
  if (!scanner || !m1UsedForConnection || m2UsedForConnection) return;

  // Experiment M2 is a human-timed, single status capture. Set this
  // before awaiting so rapid clicks cannot queue multiple status commands.
  m2UsedForConnection = true;
  captureM2Btn.disabled = true;
  clearError();
  log('Experiment M2 beginning: sending exactly one status command during visible scanner activity.');

  try {
    const response = await scanner.captureStatusExperimentM2();
    log(`Experiment M2 complete ParsedResponse:\n${serializeParsedResponse(response)}`);
    if (!m3UsedForConnection) captureM3Btn.disabled = false;
  } catch (err) {
    const message = errorMessage(err);
    showError(`Experiment M2 failed: ${message}`);
    log(`Experiment M2 error (unchanged):\n${serializeUnknownError(err)}`);
  }
});

captureM3Btn.addEventListener('click', async () => {
  if (!scanner || !m2UsedForConnection || m3UsedForConnection) return;

  // Experiment M3 is a human-timed, single post-bars status capture. Set
  // this before awaiting so rapid clicks cannot queue multiple commands.
  m3UsedForConnection = true;
  captureM3Btn.disabled = true;
  clearError();
  log('Experiment M3 beginning: sending exactly one status command after the third green bar finished.');

  try {
    const response = await scanner.captureStatusExperimentM3();
    log(`Experiment M3 complete ParsedResponse:\n${serializeParsedResponse(response)}`);
  } catch (err) {
    const message = errorMessage(err);
    showError(`Experiment M3 failed: ${message}`);
    log(`Experiment M3 error (unchanged):\n${serializeUnknownError(err)}`);
  }
});

markM15VisibleCompleteBtn.addEventListener('click', () => {
  if (!m15UsedForConnection || m15VisibleCompletedAt !== null) return;
  m15VisibleCompletedAt = new Date().toISOString();
  markM15VisibleCompleteBtn.disabled = true;
  log(`Experiment M15 human-marked visible scanner completion at ${m15VisibleCompletedAt}.`);
});

runM15Btn.addEventListener('click', async () => {
  if (!scanner || !identifiedV2 || m15UsedForConnection) return;
  m15UsedForConnection = true;
  m15VisibleCompletedAt = null;
  runM15Btn.disabled = true;
  markM15VisibleCompleteBtn.disabled = false;
  disconnectBtn.disabled = true;
  clearError();
  log('Experiment M15 HUMAN GATE CONFIRMED: hand positioned. Starting one non-destructive live AOX; no delete or erase command will be sent.');

  try {
    const artifact = await scanner.runNonDestructiveLiveAoxExperimentM15({
      getVisibleMeasurementCompletedAt: () => m15VisibleCompletedAt,
      onEvent(event) {
        if (event.kind === 'flash-read') {
          const detail = event.detail as { start: number; range: number; validBlockCount: number; responseKind: string };
          log(`M15 flash ${event.timestamp}: start=${detail.start}, range=${detail.range}, valid=${detail.validBlockCount}, response=${detail.responseKind}.`);
        } else {
          log(`M15 ${event.kind} at ${event.timestamp}.`);
        }
      },
    });
    markM15VisibleCompleteBtn.disabled = true;
    downloadJson(`nutriscan-m15-measurement-${artifact.measurementNumber}.json`, {
      schemaVersion: 1,
      experimental: true,
      experiment: 'M15',
      identity: lastIdentity,
      liveAcquisition: artifact,
      rawTranscript,
    });
    log(`Experiment M15 complete: measurement=${artifact.measurementNumber}, blocks=${artifact.acquisition.blocks.length}/5773, missing=${artifact.acquisition.missingLogicalIndexes.length}, anomalies=${artifact.acquisition.anomalies.length}, retries=${artifact.acquisition.retryRounds}. Artifact download started.`);
  } catch (err) {
    markM15VisibleCompleteBtn.disabled = true;
    const message = errorMessage(err);
    showError(`Experiment M15 failed: ${message}`);
    log(`Experiment M15 error (unchanged):\n${serializeUnknownError(err)}`);
    downloadJson('nutriscan-m15-incomplete-diagnostic.json', {
      schemaVersion: 1,
      experimental: true,
      experiment: 'M15',
      failedAt: new Date().toISOString(),
      visibleMeasurementCompletedAt: m15VisibleCompletedAt,
      identity: lastIdentity,
      rawTranscript,
      error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : String(err),
    });
  } finally {
    disconnectBtn.disabled = false;
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
    m1UsedForConnection = false;
    m2UsedForConnection = false;
    m3UsedForConnection = false;
    m4UsedForConnection = false;
    m5UsedForConnection = false;
    m6UsedForConnection = false;
    m7UsedForConnection = false;
    m8UsedForConnection = false;
    m9UsedForConnection = false;
    m15UsedForConnection = false;
    m15VisibleCompletedAt = null;
    identifiedV2 = false;
    runM1Btn.disabled = true;
    captureM2Btn.disabled = true;
    captureM3Btn.disabled = true;
    m4MeasurementInput.disabled = true;
    readM4Btn.disabled = true;
    m5MeasurementInput.disabled = true;
    readM5Btn.disabled = true;
    m6MeasurementInput.disabled = true;
    readM6Btn.disabled = true;
    m7MeasurementInput.disabled = true;
    readM7Btn.disabled = true;
    m8MeasurementInput.disabled = true;
    readM8Btn.disabled = true;
    m9MeasurementInput.disabled = true;
    readM9Btn.disabled = true;
    runM15Btn.disabled = true;
    markM15VisibleCompleteBtn.disabled = true;
    scanner = null;
  }
});

/** Serializes every ParsedResponse field for diagnostics without assigning meaning to any response schema. */
function serializeParsedResponse(response: ParsedResponse): string {
  return JSON.stringify(
    response,
    (_key, value: unknown) => {
      if (value instanceof Uint8Array) return { hex: toHex(value), bytes: Array.from(value) };
      if (value instanceof Error) return { name: value.name, message: value.message };
      return value;
    },
    2,
  );
}

function serializeUnknownError(err: unknown): string {
  if (err instanceof Error) {
    return JSON.stringify({ name: err.name, message: err.message, stack: err.stack }, null, 2);
  }
  return String(err);
}

function downloadJson(filename: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, (_key, entry: unknown) => {
    if (entry instanceof Uint8Array) return { hex: toHex(entry), bytes: Array.from(entry) };
    return entry;
  }, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

clearLogBtn.addEventListener('click', () => {
  logEl.textContent = '';
});

if (!('serial' in navigator)) {
  log('Web Serial API is not available in this browser. Use Chrome/Edge over HTTPS or localhost.');
  showError('Web Serial API is not available in this browser. Use Chrome or Edge over HTTPS or localhost.');
  connectBtn.disabled = true;
}
