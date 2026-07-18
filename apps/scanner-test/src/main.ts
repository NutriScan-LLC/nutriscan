// Manual transport test harness. Talks only to the Transport interface —
// no protocol/command knowledge belongs here (see CLAUDE.md rule 4).
import { toHex, TransportError, WebSerialTransport, type Transport } from '@nutriscan/biozoom-sdk';

const statusEl = document.querySelector<HTMLSpanElement>('#status')!;
const logEl = document.querySelector<HTMLDivElement>('#log')!;
const connectBtn = document.querySelector<HTMLButtonElement>('#connect')!;
const disconnectBtn = document.querySelector<HTMLButtonElement>('#disconnect')!;
const sendTextBtn = document.querySelector<HTMLButtonElement>('#send-text')!;
const clearLogBtn = document.querySelector<HTMLButtonElement>('#clear-log')!;
const textInput = document.querySelector<HTMLInputElement>('#text-input')!;

function log(line: string): void {
  const timestamp = new Date().toISOString().slice(11, 23);
  logEl.textContent += `[${timestamp}] ${line}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

function setConnected(connected: boolean): void {
  statusEl.textContent = connected ? 'connected' : 'disconnected';
  connectBtn.disabled = connected;
  disconnectBtn.disabled = !connected;
  sendTextBtn.disabled = !connected;
  textInput.disabled = !connected;
}

// Confirmed serial configuration from BIOZOOM_PROTOCOL_AND_IMPLEMENTATION.md.
// This is app-level config, not baked into the transport itself.
const BIOZOOM_SERIAL_OPTIONS = {
  baudRate: 2_000_000,
  dataBits: 8 as const,
  stopBits: 1 as const,
  parity: 'none' as const,
};

let transport: Transport | null = null;

connectBtn.addEventListener('click', async () => {
  transport = new WebSerialTransport({
    ...BIOZOOM_SERIAL_OPTIONS,
    logger: {
      onRawBytes(direction, bytes) {
        log(`${direction === 'write' ? '>>' : '<<'} (${bytes.length}B) ${toHex(bytes)}`);
      },
    },
  });

  try {
    await transport.connect();
    setConnected(true);
    log('connected');
  } catch (err) {
    log(`connect failed: ${errorMessage(err)}`);
    transport = null;
  }
});

disconnectBtn.addEventListener('click', async () => {
  if (!transport) return;
  await transport.disconnect();
  setConnected(false);
  log('disconnected');
  transport = null;
});

sendTextBtn.addEventListener('click', async () => {
  if (!transport || !textInput.value) return;
  try {
    await transport.writeText(textInput.value);
    textInput.value = '';
  } catch (err) {
    log(`write failed: ${errorMessage(err)}`);
  }
});

clearLogBtn.addEventListener('click', () => {
  logEl.textContent = '';
});

function errorMessage(err: unknown): string {
  if (err instanceof TransportError) return `${err.name}: ${err.message}`;
  if (err instanceof Error) return err.message;
  return String(err);
}

if (!('serial' in navigator)) {
  log('Web Serial API is not available in this browser. Use Chrome/Edge over HTTPS or localhost.');
  connectBtn.disabled = true;
}
