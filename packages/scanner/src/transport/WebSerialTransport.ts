import type { DataListener, Transport, TransportConnectOptions, Unsubscribe } from './Transport.js';
import { ByteBuffer } from './ByteBuffer.js';
import { TransportDisconnectedError, TransportNotConnectedError, TransportTimeoutError } from './errors.js';
import { noopLogger, type TransportLogger } from './logger.js';

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_READ_TIMEOUT_MS = 5_000;
const DEFAULT_WRITE_TIMEOUT_MS = 5_000;

export interface WebSerialTransportOptions {
  /**
   * Baud rate for the serial connection. Required — this is a serial-port
   * concern the caller configures; the transport makes no assumption about
   * any particular device's rate.
   */
  baudRate: number;
  dataBits?: 7 | 8;
  stopBits?: 1 | 2;
  parity?: 'none' | 'even' | 'odd';
  bufferSize?: number;
  flowControl?: 'none' | 'hardware';

  /** Milliseconds to wait for connect() to complete before failing. */
  connectTimeoutMs?: number;
  /** Default milliseconds read() waits for data when no explicit timeout is given. */
  readTimeoutMs?: number;
  /** Milliseconds to wait for a write to complete before failing. */
  writeTimeoutMs?: number;

  /** Raw byte logging hook. Defaults to a no-op logger. */
  logger?: TransportLogger;

  /**
   * Injection point for obtaining a SerialPort. Defaults to
   * navigator.serial.requestPort(). Tests supply a fake port here so the
   * transport can be exercised without a real browser or device.
   */
  requestPort?: () => Promise<SerialPort>;
}

export class WebSerialTransport implements Transport {
  readonly #options: WebSerialTransportOptions;
  readonly #logger: TransportLogger;
  readonly #buffer = new ByteBuffer();
  readonly #listeners = new Set<DataListener>();

  #port: SerialPort | null = null;
  #reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  #writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  #readLoopPromise: Promise<void> | null = null;
  #connected = false;

  constructor(options: WebSerialTransportOptions) {
    this.#options = options;
    this.#logger = options.logger ?? noopLogger;
  }

  get isConnected(): boolean {
    return this.#connected;
  }

  async connect(connectOptions?: TransportConnectOptions): Promise<void> {
    if (this.#connected) return;
    const timeoutMs = connectOptions?.timeoutMs ?? this.#options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    await withTimeout(this.#doConnect(), timeoutMs, `connect() timed out after ${timeoutMs}ms`);
  }

  async #doConnect(): Promise<void> {
    const requestPort = this.#options.requestPort ?? defaultRequestPort;
    const port = await requestPort();

    await port.open({
      baudRate: this.#options.baudRate,
      dataBits: this.#options.dataBits,
      stopBits: this.#options.stopBits,
      parity: this.#options.parity,
      bufferSize: this.#options.bufferSize,
      flowControl: this.#options.flowControl,
    });

    if (!port.readable || !port.writable) {
      throw new TransportDisconnectedError('Serial port opened without readable/writable streams');
    }

    this.#port = port;
    this.#writer = port.writable.getWriter();
    this.#reader = port.readable.getReader();
    this.#buffer.clear();
    this.#connected = true;
    this.#readLoopPromise = this.#runReadLoop(this.#reader);
  }

  async #runReadLoop(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value && value.length > 0) {
          this.#logger.onRawBytes?.('read', value);
          this.#buffer.append(value);
          for (const listener of this.#listeners) listener(value);
        }
      }
    } catch {
      // Reader was cancelled during disconnect(), or the device dropped
      // the connection mid-read. Either way, buffer teardown in the
      // `finally` block below notifies anyone waiting on read().
    } finally {
      this.#buffer.close(new TransportDisconnectedError());
    }
  }

  onData(listener: DataListener): Unsubscribe {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async read(timeoutMs?: number): Promise<Uint8Array> {
    if (!this.#connected) throw new TransportNotConnectedError();
    const effectiveTimeout = timeoutMs ?? this.#options.readTimeoutMs ?? DEFAULT_READ_TIMEOUT_MS;
    await this.#buffer.waitForData(effectiveTimeout);
    return this.#buffer.readAll();
  }

  async writeBytes(data: Uint8Array): Promise<void> {
    if (!this.#connected || !this.#writer) throw new TransportNotConnectedError();
    const timeoutMs = this.#options.writeTimeoutMs ?? DEFAULT_WRITE_TIMEOUT_MS;
    this.#logger.onRawBytes?.('write', data);
    await withTimeout(this.#writer.write(data), timeoutMs, `write() timed out after ${timeoutMs}ms`);
  }

  async writeText(text: string): Promise<void> {
    await this.writeBytes(new TextEncoder().encode(text));
  }

  async disconnect(): Promise<void> {
    if (!this.#connected && !this.#port) return;
    this.#connected = false;

    if (this.#reader) {
      await this.#reader.cancel().catch(() => {
        // Cancellation racing an in-flight read can reject; the read loop
        // tears itself down regardless.
      });
      this.#reader.releaseLock();
      this.#reader = null;
    }

    if (this.#readLoopPromise) {
      await this.#readLoopPromise.catch(() => {});
      this.#readLoopPromise = null;
    }

    if (this.#writer) {
      await this.#writer.close().catch(() => {
        // Port may already be gone.
      });
      this.#writer.releaseLock();
      this.#writer = null;
    }

    if (this.#port) {
      await this.#port.close().catch(() => {});
      this.#port = null;
    }

    this.#buffer.close(new TransportDisconnectedError());
    this.#listeners.clear();
  }
}

function defaultRequestPort(): Promise<SerialPort> {
  if (typeof navigator === 'undefined' || !navigator.serial) {
    return Promise.reject(new TransportDisconnectedError('Web Serial API is not available in this environment'));
  }
  return navigator.serial.requestPort();
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TransportTimeoutError(message)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
