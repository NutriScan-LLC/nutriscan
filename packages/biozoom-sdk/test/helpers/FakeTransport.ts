import type { DataListener, Transport, TransportConnectOptions, Unsubscribe } from '../../src/transport/Transport.js';
import { TransportDisconnectedError, TransportNotConnectedError, TransportTimeoutError } from '../../src/transport/errors.js';

/**
 * In-memory Transport double for protocol-layer tests. Mirrors
 * WebSerialTransport.read()'s pull-based semantics (drain-on-call, reject
 * on timeout/disconnect) without any Web Serial / stream plumbing, so
 * protocol tests can push bytes and inspect writes directly.
 */
export class FakeTransport implements Transport {
  #connected = true;
  #queue: Uint8Array[] = [];
  #waiter: { resolve: () => void; reject: (err: Error) => void } | null = null;

  readonly writes: Uint8Array[] = [];
  readonly writtenText: string[] = [];

  get isConnected(): boolean {
    return this.#connected;
  }

  async connect(_options?: TransportConnectOptions): Promise<void> {
    this.#connected = true;
  }

  async disconnect(): Promise<void> {
    this.#connected = false;
    this.#waiter?.reject(new TransportDisconnectedError());
    this.#waiter = null;
  }

  async writeBytes(data: Uint8Array): Promise<void> {
    if (!this.#connected) throw new TransportNotConnectedError();
    this.writes.push(data);
  }

  async writeText(text: string): Promise<void> {
    this.writtenText.push(text);
    await this.writeBytes(new TextEncoder().encode(text));
  }

  onData(_listener: DataListener): Unsubscribe {
    return () => {};
  }

  async read(timeoutMs?: number): Promise<Uint8Array> {
    if (!this.#connected) throw new TransportNotConnectedError();
    if (this.#queue.length > 0) return this.#drain();

    return new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#waiter = null;
        reject(new TransportTimeoutError());
      }, timeoutMs ?? 5000);

      this.#waiter = {
        resolve: () => {
          clearTimeout(timer);
          resolve(this.#drain());
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      };
    });
  }

  #drain(): Uint8Array {
    const total = this.#queue.reduce((sum, chunk) => sum + chunk.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of this.#queue) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    this.#queue = [];
    return out;
  }

  /** Test helper: simulates the device sending bytes. */
  pushIncoming(chunk: Uint8Array): void {
    this.#queue.push(chunk);
    if (this.#waiter) this.#waiter.resolve();
  }

  /** Test helper: simulates the transport dying mid-read (distinct from a graceful disconnect() call). */
  simulateError(err: Error): void {
    this.#connected = false;
    this.#waiter?.reject(err);
    this.#waiter = null;
  }
}
