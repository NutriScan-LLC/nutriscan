import { FrameTooLargeError } from './errors.js';

const LF = 0x0a;

// Engineering safety guard, not a protocol fact: bounds how many
// unterminated bytes FrameReader will buffer before giving up on ever
// seeing an LF. Configurable via FrameReaderOptions.maxBufferSize. Real
// maximum V2 response size is not confirmed — see docs/unknowns.md.
const DEFAULT_MAX_BUFFER_SIZE = 64 * 1024;

export interface FrameReaderOptions {
  /**
   * Maximum number of bytes FrameReader will hold without finding a
   * terminating LF before throwing FrameTooLargeError. This bounds
   * unterminated, still-buffering data — it does not cap the size of a
   * single complete frame delivered within one push() call.
   */
  maxBufferSize?: number;
}

/**
 * Splits a continuous byte stream into LF-delimited (0x0A) frames.
 *
 * Purely synchronous and byte-oriented: it does not strip CR, 0x80, or any
 * whitespace, and does not decode UTF-8 — see response.ts for that layer.
 * Empty frames (two adjacent LFs) are emitted unchanged as zero-length
 * arrays, not filtered out.
 */
export class FrameReader {
  #buffer: Uint8Array = new Uint8Array(0);
  readonly #maxBufferSize: number;

  constructor(options: FrameReaderOptions = {}) {
    this.#maxBufferSize = options.maxBufferSize ?? DEFAULT_MAX_BUFFER_SIZE;
  }

  /**
   * Feeds newly received bytes and returns zero or more complete frames,
   * in order, with the terminating LF excluded. Bytes after the last LF
   * (a partial frame) are retained internally for the next push().
   *
   * Throws FrameTooLargeError if the unterminated remainder exceeds
   * maxBufferSize; the reader drops that remainder and resynchronizes so
   * later, well-formed frames can still be parsed.
   */
  push(chunk: Uint8Array): Uint8Array[] {
    if (chunk.length === 0) return [];
    this.#buffer = concatBytes(this.#buffer, chunk);

    const frames: Uint8Array[] = [];
    let start = 0;
    for (let i = 0; i < this.#buffer.length; i++) {
      if (this.#buffer[i] === LF) {
        frames.push(this.#buffer.slice(start, i));
        start = i + 1;
      }
    }
    this.#buffer = start > 0 ? this.#buffer.slice(start) : this.#buffer;

    if (this.#buffer.length > this.#maxBufferSize) {
      const overflow = this.#buffer;
      this.#buffer = new Uint8Array(0);
      throw new FrameTooLargeError(overflow, this.#maxBufferSize);
    }

    return frames;
  }

  /** Bytes buffered so far that don't yet form a complete (LF-terminated) frame. */
  get pendingByteCount(): number {
    return this.#buffer.length;
  }
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
