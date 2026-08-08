import type { Transport, TransportConnectOptions } from '../transport/Transport.js';
import { ProtocolClient, type ProtocolClientOptions, type V2DetectionResult } from '../protocol/ProtocolClient.js';
import type { ParsedResponse } from '../protocol/response.js';
import { ScannerNotConnectedError } from './errors.js';

export interface BioZoomScannerOptions {
  /** Forwarded to the internal ProtocolClient. */
  protocol?: ProtocolClientOptions;
}

/**
 * Result of identify(). Only fields confirmed by BIOZOOM_PROTOCOL_AND_IMPLEMENTATION.md
 * are pulled out; `response` carries the full parsed frame so nothing
 * observed is lost (mirrors BioZoomJsonResponse's own philosophy).
 */
export interface ScannerIdentity {
  /** undefined if the response carried no "serial" field — not yet observed, but not guaranteed. */
  readonly serial: string | undefined;
  readonly protocolVersion: V2DetectionResult['version'];
  readonly commandUsed: V2DetectionResult['commandUsed'];
  readonly response: ParsedResponse;
}

/**
 * Phase 1 public scanner API: connect, disconnect, identify. Deliberately
 * thin — a wrapper over an injected Transport and an internally-owned
 * ProtocolClient, per BIOZOOM_PROTOCOL_AND_IMPLEMENTATION.md's Scanner
 * layer ("No UI should send raw serial commands directly") and CLAUDE.md
 * rule 4 (transport/protocol/UI stay separate). No measurement commands —
 * that's a later milestone.
 */
export class BioZoomScanner {
  readonly #transport: Transport;
  readonly #protocol: ProtocolClient;

  #identity: ScannerIdentity | null = null;

  constructor(transport: Transport, options: BioZoomScannerOptions = {}) {
    this.#transport = transport;
    this.#protocol = new ProtocolClient(transport, options.protocol);
  }

  /** True once connect() has succeeded and the protocol read loop is running. */
  get isConnected(): boolean {
    return this.#protocol.isRunning;
  }

  /** The result of the most recent successful identify() call, or null before one has happened. */
  get identity(): ScannerIdentity | null {
    return this.#identity;
  }

  /**
   * Opens the transport (this is where Web Serial's device picker/discovery
   * happens — see Transport.connect()) and starts the protocol read loop.
   * Idempotent: a no-op if already connected, matching Transport.connect()'s
   * own idempotency.
   */
  async connect(options?: TransportConnectOptions): Promise<void> {
    if (this.isConnected) return;
    await this.#transport.connect(options);
    this.#protocol.start();
  }

  /**
   * Stops the protocol read loop and closes the transport. Safe to call
   * even if connect() was never called or already failed — both
   * ProtocolClient.stop() and Transport.disconnect() tolerate that.
   */
  async disconnect(): Promise<void> {
    await this.#protocol.stop();
    await this.#transport.disconnect();
    this.#identity = null;
  }

  /**
   * Confirms V2 protocol framing and extracts whatever identity fields the
   * device's response carries (currently just `serial`, when present — see
   * ScannerIdentity). Wraps ProtocolClient.detectV2(); throws
   * ScannerNotConnectedError instead of ProtocolNotStartedError if called
   * before connect() succeeds, so callers never need to know ProtocolClient
   * exists.
   */
  async identify(): Promise<ScannerIdentity> {
    if (!this.isConnected) throw new ScannerNotConnectedError();

    const detection = await this.#protocol.detectV2();
    const identity: ScannerIdentity = {
      serial: extractSerial(detection.response),
      protocolVersion: detection.version,
      commandUsed: detection.commandUsed,
      response: detection.response,
    };
    this.#identity = identity;
    return identity;
  }
}

function extractSerial(response: ParsedResponse): string | undefined {
  return response.kind === 'ok' || response.kind === 'error' ? response.serial : undefined;
}
