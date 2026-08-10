import { autoDetect } from '@serialport/bindings-cpp';
import { ByteBuffer } from './ByteBuffer.js';
import type { DataListener, Transport, TransportConnectOptions, Unsubscribe } from './Transport.js';
import { TransportDisconnectedError, TransportNotConnectedError, TransportTimeoutError } from './errors.js';
import { noopLogger, type TransportLogger } from './logger.js';

export interface NodeSerialPortInfo {
  path: string;
  manufacturer: string | undefined;
  serialNumber: string | undefined;
  pnpId: string | undefined;
  locationId: string | undefined;
  productId: string | undefined;
  vendorId: string | undefined;
}

export interface NodeSerialBindingPort {
  readonly isOpen: boolean;
  close(): Promise<void>;
  read(buffer: Buffer, offset: number, length: number): Promise<{ buffer: Buffer; bytesRead: number }>;
  write(buffer: Buffer): Promise<void>;
}

export interface NodeSerialBinding {
  list(): Promise<NodeSerialPortInfo[]>;
  open(options: {
    path: string;
    baudRate: number;
    dataBits?: 5 | 6 | 7 | 8;
    stopBits?: 1 | 1.5 | 2;
    parity?: 'none' | 'even' | 'odd';
  }): Promise<NodeSerialBindingPort>;
}

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_READ_TIMEOUT_MS = 5_000;
const DEFAULT_WRITE_TIMEOUT_MS = 5_000;
const DEFAULT_READ_BUFFER_SIZE = 64 * 1024;

export interface NodeSerialTransportOptions {
  /** Explicit OS serial path. NodeSerialTransport never discovers or selects a port. */
  path: string;
  baudRate: number;
  dataBits?: 5 | 6 | 7 | 8;
  stopBits?: 1 | 1.5 | 2;
  parity?: 'none' | 'even' | 'odd';
  connectTimeoutMs?: number;
  readTimeoutMs?: number;
  writeTimeoutMs?: number;
  readBufferSize?: number;
  logger?: TransportLogger;
  /** Test injection only. Production defaults to the current platform binding. */
  binding?: NodeSerialBinding;
}

/** Lists OS serial metadata without opening or reserving any port. */
export function listNodeSerialPorts(binding: NodeSerialBinding = autoDetect()): Promise<NodeSerialPortInfo[]> {
  return binding.list();
}

/**
 * Node-specific raw-byte Transport. It contains no BioZoom commands,
 * framing, JSON parsing, device selection, or automatic connection logic.
 */
export class NodeSerialTransport implements Transport {
  readonly #options: NodeSerialTransportOptions;
  readonly #binding: NodeSerialBinding;
  readonly #logger: TransportLogger;
  readonly #buffer = new ByteBuffer();
  readonly #listeners = new Set<DataListener>();

  #port: NodeSerialBindingPort | null = null;
  #readLoopPromise: Promise<void> | null = null;
  #connected = false;

  constructor(options: NodeSerialTransportOptions) {
    if (options.path.length === 0) throw new TypeError('Node serial path must not be empty');
    this.#options = options;
    this.#binding = options.binding ?? autoDetect();
    this.#logger = options.logger ?? noopLogger;
  }

  get isConnected(): boolean {
    return this.#connected;
  }

  async connect(connectOptions?: TransportConnectOptions): Promise<void> {
    if (this.#connected) return;
    const timeoutMs = connectOptions?.timeoutMs ?? this.#options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    const openOptions: Parameters<NodeSerialBinding['open']>[0] = {
      path: this.#options.path,
      baudRate: this.#options.baudRate,
    };
    if (this.#options.dataBits !== undefined) openOptions.dataBits = this.#options.dataBits;
    if (this.#options.stopBits !== undefined) openOptions.stopBits = this.#options.stopBits;
    if (this.#options.parity !== undefined) openOptions.parity = this.#options.parity;
    const port = await withTimeout(
      this.#binding.open(openOptions),
      timeoutMs,
      `connect() timed out after ${timeoutMs}ms`,
    );
    this.#port = port;
    this.#connected = true;
    this.#readLoopPromise = this.#runReadLoop(port);
  }

  async #runReadLoop(port: NodeSerialBindingPort): Promise<void> {
    const size = this.#options.readBufferSize ?? DEFAULT_READ_BUFFER_SIZE;
    try {
      while (this.#connected && port.isOpen) {
        const target = Buffer.allocUnsafe(size);
        const { buffer, bytesRead } = await port.read(target, 0, target.length);
        if (bytesRead > 0) {
          const chunk = Uint8Array.from(buffer.subarray(0, bytesRead));
          this.#logger.onRawBytes?.('read', chunk);
          this.#buffer.append(chunk);
          for (const listener of this.#listeners) listener(chunk);
        }
      }
    } catch (err) {
      if (this.#connected) {
        this.#connected = false;
        this.#buffer.close(toDisconnectedError(err));
      }
    }
  }

  async writeBytes(data: Uint8Array): Promise<void> {
    if (!this.#connected || !this.#port) throw new TransportNotConnectedError();
    const timeoutMs = this.#options.writeTimeoutMs ?? DEFAULT_WRITE_TIMEOUT_MS;
    const bytes = Uint8Array.from(data);
    this.#logger.onRawBytes?.('write', bytes);
    await withTimeout(this.#port.write(Buffer.from(bytes)), timeoutMs, `write() timed out after ${timeoutMs}ms`);
  }

  async writeText(text: string): Promise<void> {
    await this.writeBytes(new TextEncoder().encode(text));
  }

  onData(listener: DataListener): Unsubscribe {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async read(timeoutMs?: number): Promise<Uint8Array> {
    if (!this.#connected) throw new TransportNotConnectedError();
    await this.#buffer.waitForData(timeoutMs ?? this.#options.readTimeoutMs ?? DEFAULT_READ_TIMEOUT_MS);
    return this.#buffer.readAll();
  }

  async disconnect(): Promise<void> {
    const port = this.#port;
    this.#connected = false;
    this.#port = null;
    if (port?.isOpen) await port.close().catch(() => {});
    if (this.#readLoopPromise) await this.#readLoopPromise.catch(() => {});
    this.#readLoopPromise = null;
    this.#buffer.close(new TransportDisconnectedError());
    this.#listeners.clear();
  }
}

function toDisconnectedError(err: unknown): TransportDisconnectedError {
  return new TransportDisconnectedError(err instanceof Error ? err.message : String(err));
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
