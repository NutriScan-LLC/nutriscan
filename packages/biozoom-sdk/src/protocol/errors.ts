export class ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtocolError';
  }
}

/**
 * No matching response arrived within the configured response timeout.
 * Distinct from TransportTimeoutError, which is about raw bytes arriving
 * on a single transport.read() call rather than a full correlated
 * response.
 */
export class ProtocolResponseTimeoutError extends ProtocolError {
  constructor(message = 'Timed out waiting for a matching response') {
    super(message);
    this.name = 'ProtocolResponseTimeoutError';
  }
}

export class CallIndexMismatchError extends ProtocolError {
  readonly expected: string;
  readonly actual: string;

  constructor(expected: string, actual: string) {
    super(`Expected call-index "${expected}" but response carried "${actual}"`);
    this.name = 'CallIndexMismatchError';
    this.expected = expected;
    this.actual = actual;
  }
}

export class ProtocolDetectionError extends ProtocolError {
  constructor(message: string) {
    super(message);
    this.name = 'ProtocolDetectionError';
  }
}

export class ProtocolNotStartedError extends ProtocolError {
  constructor(message = 'ProtocolClient has not been started — call start() first') {
    super(message);
    this.name = 'ProtocolNotStartedError';
  }
}

/**
 * Thrown by FrameReader when bytes accumulate past its configured
 * maxBufferSize without a terminating LF. The oversized buffer is dropped
 * (its bytes are attached here for diagnostics, per CLAUDE.md rule 5) so
 * the reader can resynchronize on the next LF instead of throwing forever.
 */
export class FrameTooLargeError extends ProtocolError {
  readonly byteLength: number;
  readonly maxBufferSize: number;
  readonly rawBytes: Uint8Array;

  constructor(rawBytes: Uint8Array, maxBufferSize: number) {
    super(
      `Buffered frame data exceeded ${maxBufferSize} bytes without a terminating LF ` +
        `(got ${rawBytes.length} bytes) — dropping and resynchronizing on the next LF`,
    );
    this.name = 'FrameTooLargeError';
    this.byteLength = rawBytes.length;
    this.maxBufferSize = maxBufferSize;
    this.rawBytes = rawBytes;
  }
}
