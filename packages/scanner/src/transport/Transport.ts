/**
 * Transport-layer contract. Deliberately protocol-agnostic: implementations
 * move raw bytes and know nothing about JSON, BioZoom commands, or
 * call-index handling. See CLAUDE.md rule 4.
 */

export type DataListener = (chunk: Uint8Array) => void;
export type Unsubscribe = () => void;

export interface TransportConnectOptions {
  /** Overrides the transport's configured connect timeout for this call. */
  timeoutMs?: number;
}

export interface Transport {
  readonly isConnected: boolean;

  connect(options?: TransportConnectOptions): Promise<void>;
  disconnect(): Promise<void>;

  writeBytes(data: Uint8Array): Promise<void>;
  writeText(text: string): Promise<void>;

  /** Subscribes to every chunk read from the device. Returns an unsubscribe function. */
  onData(listener: DataListener): Unsubscribe;

  /**
   * Waits for at least one byte to be buffered, then returns and clears
   * everything currently buffered. Throws TransportTimeoutError if nothing
   * arrives within timeoutMs (or the transport's configured read timeout).
   */
  read(timeoutMs?: number): Promise<Uint8Array>;
}
