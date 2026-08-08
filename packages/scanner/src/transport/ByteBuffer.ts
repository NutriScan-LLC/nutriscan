import { TransportDisconnectedError, TransportTimeoutError } from './errors.js';

interface PendingWait {
  resolve: () => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * A FIFO byte accumulator for a continuous read stream. Holds no protocol
 * knowledge — it just buffers whatever bytes it is given and lets callers
 * pull them out, optionally waiting (with a timeout) for more to arrive.
 */
export class ByteBuffer {
  #chunks: Uint8Array[] = [];
  #length = 0;
  #waiters: PendingWait[] = [];
  #closed = false;

  get length(): number {
    return this.#length;
  }

  get isClosed(): boolean {
    return this.#closed;
  }

  /** Appends a chunk of bytes, waking any pending waitForData() calls. */
  append(chunk: Uint8Array): void {
    if (this.#closed || chunk.length === 0) return;
    this.#chunks.push(chunk);
    this.#length += chunk.length;
    this.#drainWaiters();
  }

  /**
   * Reads up to maxBytes without blocking, removing them from the buffer.
   * Returns fewer bytes (possibly zero) if that's all that is available.
   * Omit maxBytes to drain everything currently buffered.
   */
  read(maxBytes?: number): Uint8Array {
    if (this.#length === 0) return new Uint8Array(0);
    const limit = maxBytes === undefined ? this.#length : Math.min(maxBytes, this.#length);
    const out = new Uint8Array(limit);
    let offset = 0;
    while (offset < limit) {
      const chunk = this.#chunks[0];
      if (!chunk) break;
      const need = limit - offset;
      if (chunk.length <= need) {
        out.set(chunk, offset);
        offset += chunk.length;
        this.#chunks.shift();
      } else {
        out.set(chunk.subarray(0, need), offset);
        this.#chunks[0] = chunk.subarray(need);
        offset += need;
      }
    }
    this.#length -= limit;
    return out;
  }

  readAll(): Uint8Array {
    return this.read();
  }

  /**
   * Resolves as soon as at least one byte is available (immediately, if
   * data is already buffered). Rejects with TransportTimeoutError if
   * timeoutMs elapses first, or TransportDisconnectedError if the buffer
   * is closed while waiting.
   */
  waitForData(timeoutMs: number): Promise<void> {
    if (this.#length > 0) return Promise.resolve();
    if (this.#closed) return Promise.reject(new TransportDisconnectedError());

    return new Promise((resolve, reject) => {
      const waiter: PendingWait = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.#removeWaiter(waiter);
          reject(new TransportTimeoutError(`Timed out after ${timeoutMs}ms waiting for data`));
        }, timeoutMs),
      };
      this.#waiters.push(waiter);
    });
  }

  /** Rejects all pending waiters and refuses further appends. Idempotent. */
  close(reason?: Error): void {
    if (this.#closed) return;
    this.#closed = true;
    const err = reason ?? new TransportDisconnectedError();
    for (const waiter of this.#waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(err);
    }
  }

  clear(): void {
    this.#chunks = [];
    this.#length = 0;
  }

  #drainWaiters(): void {
    if (this.#length === 0) return;
    for (const waiter of this.#waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.resolve();
    }
  }

  #removeWaiter(waiter: PendingWait): void {
    const idx = this.#waiters.indexOf(waiter);
    if (idx !== -1) this.#waiters.splice(idx, 1);
  }
}
