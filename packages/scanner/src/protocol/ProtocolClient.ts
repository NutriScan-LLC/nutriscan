import type { Transport, Unsubscribe } from '../transport/Transport.js';
import { TransportTimeoutError } from '../transport/errors.js';
import { FrameReader, type FrameReaderOptions } from './frame.js';
import { parseResponseFrame, type ParsedResponse } from './response.js';
import { formatCommandLine } from './command.js';
import { generateCallIndex } from './callIndex.js';
import {
  ProtocolDetectionError,
  ProtocolError,
  ProtocolNotStartedError,
  ProtocolResponseTimeoutError,
} from './errors.js';

export type FrameListener = (frame: ParsedResponse) => void;
export type ErrorListener = (error: Error) => void;

export interface ProtocolClientOptions {
  /** How long sendCommand() waits for a matching response before rejecting with ProtocolResponseTimeoutError. */
  responseTimeoutMs?: number;
  /**
   * How long each internal transport.read() poll waits before looping
   * again to check whether stop() was called. Does not bound
   * sendCommand()'s own response timeout.
   */
  pollTimeoutMs?: number;
  /** Forwarded to the internal FrameReader. */
  maxFrameBufferSize?: number;
}

interface PendingRequest {
  callIndex: string;
  resolve: (frame: ParsedResponse) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  requireCallIndex: boolean;
}

const DEFAULT_RESPONSE_TIMEOUT_MS = 5_000;
const DEFAULT_POLL_TIMEOUT_MS = 1_000;

export interface V2DetectionResult {
  readonly version: 'v2';
  readonly commandUsed: 'get_status' | 'status';
  /**
   * The response actually used to confirm V2 — the `status` retry's
   * response if get_status returned an error, otherwise get_status's own
   * response.
   */
  readonly response: ParsedResponse;
  /** The raw get_status response, kept for diagnostics even when a retry occurred. */
  readonly getStatusResponse: ParsedResponse;
}

/**
 * V2 protocol layer: command formatting, response framing/parsing,
 * call-index correlation, and version detection. Holds no serial/browser
 * APIs — it only calls the injected Transport. See CLAUDE.md rule 4.
 */
export class ProtocolClient {
  readonly #transport: Transport;
  readonly #frameReader: FrameReader;
  readonly #frameListeners = new Set<FrameListener>();
  readonly #errorListeners = new Set<ErrorListener>();
  readonly #responseTimeoutMs: number;
  readonly #pollTimeoutMs: number;

  #running = false;
  #loopPromise: Promise<void> | null = null;
  #pending: PendingRequest | null = null;
  #writeQueue: Promise<void> = Promise.resolve();

  constructor(transport: Transport, options: ProtocolClientOptions = {}) {
    this.#transport = transport;
    this.#responseTimeoutMs = options.responseTimeoutMs ?? DEFAULT_RESPONSE_TIMEOUT_MS;
    this.#pollTimeoutMs = options.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;

    const frameReaderOptions: FrameReaderOptions = {};
    if (options.maxFrameBufferSize !== undefined) frameReaderOptions.maxBufferSize = options.maxFrameBufferSize;
    this.#frameReader = new FrameReader(frameReaderOptions);
  }

  get isRunning(): boolean {
    return this.#running;
  }

  /** Begins consuming the transport's byte stream and framing responses. The transport must already be connected. */
  start(): void {
    if (this.#running) return;
    this.#frameReader.reset();
    this.#running = true;
    this.#loopPromise = this.#runLoop();
  }

  /**
   * Stops the read loop. Because it's built on transport.read()'s own
   * polling timeout, this may take up to pollTimeoutMs to actually exit —
   * this method awaits that. Any request still pending afterward is
   * rejected.
   */
  async stop(): Promise<void> {
    this.#running = false;
    if (this.#loopPromise) {
      await this.#loopPromise;
      this.#loopPromise = null;
    }
    this.#failPending(new ProtocolError('ProtocolClient stopped before a response arrived'));
    this.#frameReader.reset();
  }

  /** Subscribes to every parsed response frame, whether or not it was matched to a pending sendCommand(). Returns an unsubscribe function. */
  onFrame(listener: FrameListener): Unsubscribe {
    this.#frameListeners.add(listener);
    return () => this.#frameListeners.delete(listener);
  }

  /** Subscribes to non-fatal loop errors (e.g. FrameTooLargeError) for diagnostics. Returns an unsubscribe function. */
  onError(listener: ErrorListener): Unsubscribe {
    this.#errorListeners.add(listener);
    return () => this.#errorListeners.delete(listener);
  }

  async #runLoop(): Promise<void> {
    while (this.#running) {
      let chunk: Uint8Array;
      try {
        chunk = await this.#transport.read(this.#pollTimeoutMs);
      } catch (err) {
        if (err instanceof TransportTimeoutError) continue; // just a poll interval elapsing; keep waiting
        const error = toError(err);
        this.#running = false;
        this.#emitError(error);
        this.#failPending(error);
        return;
      }

      let frames: Uint8Array[];
      try {
        frames = this.#frameReader.push(chunk);
      } catch (err) {
        // FrameReader only ever throws FrameTooLargeError, which it has
        // already recovered from internally (buffer cleared) — surface it
        // for diagnostics and fail whatever was pending, but keep looping.
        const error = toError(err);
        this.#emitError(error);
        this.#failPending(error);
        continue;
      }

      for (const rawFrame of frames) {
        const parsed = parseResponseFrame(rawFrame);
        this.#emitFrame(parsed);
        this.#deliver(parsed);
      }
    }
  }

  #emitFrame(frame: ParsedResponse): void {
    for (const listener of this.#frameListeners) listener(frame);
  }

  #emitError(err: Error): void {
    for (const listener of this.#errorListeners) listener(err);
  }

  #deliver(frame: ParsedResponse): void {
    const pending = this.#pending;
    if (!pending) return; // No caller is waiting — onFrame listeners already saw it.

    const callIndex = frame.kind === 'ok' || frame.kind === 'error' ? frame.callIndex : undefined;
    if (callIndex !== undefined && callIndex !== pending.callIndex) return;
    if (callIndex === undefined && pending.requireCallIndex) {
      // Strict production commands ignore unrelated call-index-less frames.
      return;
    }

    // A frame with no resolvable call-index is treated as a match by
    // default — confirmed hardware shows get_status's error response
    // carries no call-index anywhere. See docs/unknowns.md.
    this.#settlePending((p) => p.resolve(frame));
  }

  #settlePending(settle: (pending: PendingRequest) => void): void {
    const pending = this.#pending;
    if (!pending) return;
    this.#pending = null;
    clearTimeout(pending.timer);
    settle(pending);
  }

  #failPending(err: Error): void {
    this.#settlePending((p) => p.reject(err));
  }

  /**
   * Sends a V2 command and waits for its correlated response. Only one
   * command may be in flight at a time — concurrent calls queue and run
   * in order.
   */
  async sendCommand(
    name: string,
    params?: Record<string, string>,
    options: { readonly requireCallIndex?: boolean } = {},
  ): Promise<ParsedResponse> {
    if (!this.#running) throw new ProtocolNotStartedError();
    const task = this.#writeQueue.then(() => this.#sendCommandExclusive(name, params, options.requireCallIndex ?? false));
    this.#writeQueue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  async #sendCommandExclusive(name: string, params: Record<string, string> | undefined, requireCallIndex: boolean): Promise<ParsedResponse> {
    const callIndex = generateCallIndex();
    const line = formatCommandLine(name, params, callIndex);

    const responsePromise = new Promise<ParsedResponse>((resolve, reject) => {
      this.#pending = {
        callIndex,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.#settlePending((p) =>
            p.reject(
              new ProtocolResponseTimeoutError(
                `No response to "${name}" (call-index ${p.callIndex}) within ${this.#responseTimeoutMs}ms`,
              ),
            ),
          );
        }, this.#responseTimeoutMs),
        requireCallIndex,
      };
    });

    await this.#transport.writeText(`${line}\n`);
    return responsePromise;
  }

  /**
   * V2 detection per BIOZOOM_PROTOCOL_AND_IMPLEMENTATION.md: send
   * get_status; if that response is a JSON error, retry with `status`.
   * Either response carrying a "command" field confirms V2 framing — the
   * confirmed get_status error example already carries one, so this is
   * evidence-gathering independent of the retry, not a sequential gate.
   * Does not attempt V1 detection.
   */
  async detectV2(): Promise<V2DetectionResult> {
    const getStatusResponse = await this.sendCommand('get_status');
    let finalResponse = getStatusResponse;
    let commandUsed: 'get_status' | 'status' = 'get_status';

    if (getStatusResponse.kind === 'error') {
      finalResponse = await this.sendCommand('status', undefined, { requireCallIndex: true });
      commandUsed = 'status';
    }

    if (!hasCommandField(getStatusResponse) && !hasCommandField(finalResponse)) {
      throw new ProtocolDetectionError(
        'Neither get_status nor status responses contained a "command" field — cannot confirm V2 framing. V1 detection is not implemented.',
      );
    }

    return { version: 'v2', commandUsed, response: finalResponse, getStatusResponse };
  }
}

function hasCommandField(response: ParsedResponse): boolean {
  return (response.kind === 'ok' || response.kind === 'error') && response.command !== undefined;
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}
