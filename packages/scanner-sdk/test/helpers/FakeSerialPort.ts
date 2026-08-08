/**
 * Minimal stand-in for the browser's SerialPort so WebSerialTransport can
 * be exercised in tests without a real device or browser. Cast to
 * `SerialPort` at the call site (`requestPort`) — it intentionally does
 * not implement the full interface (getSignals, forget, etc.), only what
 * the transport actually uses.
 */
export class FakeSerialPort {
  readable: ReadableStream<Uint8Array> | null = null;
  writable: WritableStream<Uint8Array> | null = null;

  readonly writtenChunks: Uint8Array[] = [];
  readonly openCalls: Array<Record<string, unknown>> = [];
  closeCallCount = 0;

  #readableController: ReadableStreamDefaultController<Uint8Array> | null = null;

  async open(options: Record<string, unknown>): Promise<void> {
    this.openCalls.push(options);

    this.readable = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.#readableController = controller;
      },
      cancel: () => {
        this.#readableController = null;
      },
    });

    this.writable = new WritableStream<Uint8Array>({
      write: async (chunk) => {
        this.writtenChunks.push(chunk);
      },
    });
  }

  async close(): Promise<void> {
    this.closeCallCount += 1;
    this.#readableController?.close();
    this.#readableController = null;
    this.readable = null;
    this.writable = null;
  }

  /** Test helper: simulates the device sending a chunk of bytes. */
  pushIncoming(chunk: Uint8Array): void {
    this.#readableController?.enqueue(chunk);
  }

  /** Test helper: simulates the device/port erroring out mid-read. */
  simulateError(err: Error): void {
    this.#readableController?.error(err);
    this.#readableController = null;
  }

  /** Test helper: simulates the stream ending normally (port unplugged cleanly). */
  simulateStreamEnd(): void {
    this.#readableController?.close();
    this.#readableController = null;
  }
}
