import type { Transport, TransportConnectOptions } from '../transport/Transport.js';
import { ProtocolClient, type ProtocolClientOptions, type V2DetectionResult } from '../protocol/ProtocolClient.js';
import type { ParsedResponse } from '../protocol/response.js';
import { AoxMeasurementStartRejectedError, MalformedAoxMeasurementAcknowledgmentError, ScannerError, ScannerNotConnectedError, ScannerNotIdentifiedError } from './errors.js';
import {
  downloadAndReassembleAoxMeasurement,
  type DownloadAoxMeasurementOptions,
  type RawAoxMeasurementArtifact,
} from '../protocol/aoxMeasurement.js';
import {
  handRecognitionCommand,
  interpretHandRecognitionResponse,
  selectV2HandRecognitionStrategy,
  type HandRecognitionTarget,
  type LegacyHandRecognitionThresholds,
} from '../protocol/handRecognition.js';
import {
  downloadExperimentalAoxMeasurement,
  type ExperimentalAoxMeasurementArtifact,
  type ExperimentalAoxReadRecord,
} from '../protocol/experimentalMeasurementDownload.js';

export interface BioZoomScannerOptions {
  /** Forwarded to the internal ProtocolClient. */
  protocol?: ProtocolClientOptions;
}

export const APK_BARE_DELETE_RESPONSE_TIMEOUT_MS = 10_000;

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

export interface AoxMeasurementStart {
  readonly measurementNumber: number;
  readonly acknowledgedAt: string;
  readonly acknowledgment: ParsedResponse;
  /** Sanitized proof that the strict production request correlation succeeded. */
  readonly commandName: 'measure';
  readonly correlated: true;
}

export interface ExperimentalLiveAoxEvent {
  readonly timestamp: string;
  readonly kind: 'baseline-status' | 'measurement-acknowledgment' | 'flash-read' | 'final-status';
  readonly detail: unknown;
}

export interface ExperimentalLiveAoxArtifact {
  readonly experimental: true;
  readonly startedAt: string;
  readonly baselineStatusCapturedAt: string;
  readonly baselineStatus: ParsedResponse;
  readonly measurementCommandSentAt: string;
  readonly measurementAcknowledgedAt: string;
  readonly measurementAcknowledgment: ParsedResponse;
  readonly measurementNumber: number;
  readonly firstReadableBlockAt: string | null;
  readonly finalBlockAvailableAt: string | null;
  readonly visibleMeasurementCompletedAt: string | null;
  readonly finalStatusCapturedAt: string;
  readonly finalStatus: ParsedResponse;
  readonly completedAt: string;
  readonly acquisition: ExperimentalAoxMeasurementArtifact;
}

export interface ExperimentalLiveAoxOptions {
  readonly now?: () => Date;
  readonly onEvent?: (event: ExperimentalLiveAoxEvent) => void;
  readonly getVisibleMeasurementCompletedAt?: () => string | null;
  /** Experiment M15 human safety gate, invoked after baseline status and before measure. */
  readonly waitForHandReady?: () => Promise<void>;
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
  readonly #measurementAcknowledgments = new Map<number, string>();
  readonly #handRecognitionStrategies = new Map<HandRecognitionTarget, ReturnType<typeof selectV2HandRecognitionStrategy>>();

  constructor(transport: Transport, options: BioZoomScannerOptions = {}) {
    this.#transport = transport;
    this.#protocol = new ProtocolClient(transport, options.protocol);
  }

  /** True once connect() has succeeded and the protocol read loop is running. */
  get isConnected(): boolean {
    return this.#protocol.isRunning && this.#transport.isConnected;
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
    if (this.#protocol.isRunning) await this.#protocol.stop();
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
    this.#measurementAcknowledgments.clear();
    this.#handRecognitionStrategies.clear();
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

  /**
   * Captures one strictly correlated, non-destructive V2 status response.
   * It does not measure, recognize a hand, read flash, poll, retry, or mutate
   * scanner state. Callers are responsible for privacy-safe presentation.
   */
  async readStatusSnapshot(): Promise<ParsedResponse> {
    this.#requireIdentifiedV2();
    return this.#protocol.sendCommand('status', undefined, { requireCallIndex: true });
  }

  /**
   * Permissioned diagnostic primitive: sends exactly one APK-confirmed bare
   * `delete` command with strict V2 call-index correlation. The scanner-side
   * deletion scope is unknown. This method does not poll, retry, measure,
   * recognize a hand, read flash, or send any other command.
   */
  async deleteMeasurementStorageOnceDiagnostic(): Promise<ParsedResponse> {
    this.#requireIdentifiedV2();
    return this.#deleteMeasurementStorageOnce();
  }

  /**
   * Starts one hardware-confirmed full AOX measurement and returns its assigned
   * number with the complete acknowledgment. APK-confirmed routine preparation
   * sends one bare delete first; its firmware-side scope remains unknown. This
   * path never performs a full-flash erase, polls, retries, downloads, or
   * invokes server processing.
   */
  async startAoxMeasurement(options: {
    readonly signal?: AbortSignal;
    readonly onMeasurementCommandSent?: () => void;
  } = {}): Promise<AoxMeasurementStart> {
    this.#requireIdentifiedV2();
    throwIfAborted(options.signal);
    await this.#deleteMeasurementStorageOnce();
    // A delete already acknowledged by the scanner cannot be undone. This
    // gate guarantees cancellation never proceeds into physical acquisition.
    throwIfAborted(options.signal);
    try { options.onMeasurementCommandSent?.(); } catch { /* metadata observers cannot alter command sequencing */ }
    const acknowledgment = await this.#protocol.sendCommand('measure', { type: 'aox' }, { requireCallIndex: true });
    if (acknowledgment.kind === 'error') throw new AoxMeasurementStartRejectedError(acknowledgment);
    const measurementNumber = acknowledgment.kind === 'ok' ? acknowledgment.json.measurement_nr : undefined;
    const measurementType = acknowledgment.kind === 'ok' ? acknowledgment.json.type : undefined;
    const command = acknowledgment.kind === 'ok' ? acknowledgment.command : undefined;
    if (!isAoxMeasureCommand(command) || measurementType !== 'aox' || !Number.isSafeInteger(measurementNumber) || (measurementNumber as number) < 1) {
      throw new MalformedAoxMeasurementAcknowledgmentError(acknowledgment);
    }
    const acknowledgedAt = new Date().toISOString();
    this.#measurementAcknowledgments.set(measurementNumber as number, acknowledgedAt);
    return {
      measurementNumber: measurementNumber as number,
      acknowledgedAt,
      acknowledgment,
      commandName: 'measure',
      correlated: true,
    };
  }

  async #deleteMeasurementStorageOnce(): Promise<ParsedResponse> {
    return this.#protocol.sendCommand('delete', undefined, {
      requireCallIndex: true,
      responseTimeoutMs: APK_BARE_DELETE_RESPONSE_TIMEOUT_MS,
    });
  }

  /**
   * Downloads and validates an AOX measurement using bounded flash reads.
   * Completion means the configured profile's entire valid logical block set
   * was recovered; status fields and visible scanner activity are not used.
   */
  async downloadAoxMeasurement(
    measurementNumber: number,
    options: DownloadAoxMeasurementOptions = {},
  ): Promise<RawAoxMeasurementArtifact> {
    this.#requireIdentifiedV2();
    return downloadAndReassembleAoxMeasurement(
      this.#identity?.serial,
      measurementNumber,
      (start, range) => this.#protocol.sendCommand('read-flash', {
        nr: String(measurementNumber), block: String(start), range: String(range),
      }, { requireCallIndex: true }),
      (() => {
        const acknowledgedAt = options.measurementAcknowledgedAt ?? this.#measurementAcknowledgments.get(measurementNumber);
        return { ...options, ...(acknowledgedAt === undefined ? {} : { measurementAcknowledgedAt: acknowledgedAt }) };
      })(),
    );
  }

  /**
   * Performs one non-destructive APK-confirmed V2 hand-recognition sample.
   * Firmware selection is derived from the identified status response. Older
   * firmware is accepted only when deployment-provided thresholds are passed.
   */
  async prepareHandRecognition(
    target: HandRecognitionTarget,
    options: { readonly legacyThresholds?: LegacyHandRecognitionThresholds } = {},
  ): Promise<void> {
    this.#requireIdentifiedV2();
    const status = await this.#protocol.sendCommand('status', undefined, { requireCallIndex: true });
    const strategy = selectV2HandRecognitionStrategy(status, options.legacyThresholds);
    this.#handRecognitionStrategies.set(target, strategy);
  }

  async recognizeHand(target: HandRecognitionTarget): Promise<boolean> {
    this.#requireIdentifiedV2();
    const strategy = this.#handRecognitionStrategies.get(target);
    if (!strategy) throw new ScannerError(`Hand ${target} recognition was not prepared`);
    const command = handRecognitionCommand(target, strategy);
    const response = await this.#protocol.sendCommand(command.command, command.params, { requireCallIndex: true });
    return interpretHandRecognitionResponse(response, target, strategy);
  }

  /**
   * UNVERIFIED — Experiment M1 only.
   * @deprecated Use startAoxMeasurement(); retained for diagnostic evidence.
   *
   * Sends the vendor-proposed V2 AOX measurement-start command exactly
   * once and returns ProtocolClient's complete response unchanged. This
   * method deliberately makes no claim about whether a measurement starts
   * or how any response fields should be interpreted. It does not poll,
   * retry, detect completion, or read flash. See docs/unknowns.md.
   */
  async startAoxMeasurementExperiment(): Promise<ParsedResponse> {
    if (!this.isConnected) throw new ScannerNotConnectedError();
    return this.#protocol.sendCommand('measure', { type: 'aox' });
  }

  /**
   * UNVERIFIED — Experiment M2 only.
   *
   * Sends exactly one `status` command for a human-timed observation
   * during visible scanner activity and returns the complete response
   * unchanged. It does not poll, retry, interpret `busy`, detect
   * completion, or read flash. See docs/unknowns.md.
   */
  async captureStatusExperimentM2(): Promise<ParsedResponse> {
    if (!this.isConnected) throw new ScannerNotConnectedError();
    return this.#protocol.sendCommand('status');
  }

  /**
   * UNVERIFIED — Experiment M3 only.
   *
   * Sends exactly one `status` command for a human-timed observation after
   * the third green bar has finished and returns the complete response
   * unchanged. It does not poll, retry, interpret fields, detect
   * completion, or read flash. See docs/unknowns.md.
   */
  async captureStatusExperimentM3(): Promise<ParsedResponse> {
    if (!this.isConnected) throw new ScannerNotConnectedError();
    return this.#protocol.sendCommand('status');
  }

  /**
   * UNVERIFIED — Experiment M4 only.
   *
   * Sends exactly one vendor-proposed `read-flash` request for `block=0`
   * and `range=1` of the supplied completed measurement. The assumption
   * that request block 0 means "first block" is unverified. Returns the
   * complete response unchanged and performs no decoding, retries,
   * follow-up ranges, completion checks, or writes. See docs/unknowns.md.
   */
  async readFirstFlashBlockExperimentM4(measurementNumber: number): Promise<ParsedResponse> {
    if (!this.isConnected) throw new ScannerNotConnectedError();
    if (!Number.isSafeInteger(measurementNumber) || measurementNumber < 1) {
      throw new RangeError('Experiment M4 measurement number must be a positive safe integer');
    }
    return this.#protocol.sendCommand('read-flash', {
      nr: String(measurementNumber),
      block: '0',
      range: '1',
    });
  }

  /**
   * UNVERIFIED — Experiment M5 only.
   *
   * Sends exactly one vendor-proposed `read-flash` request for `block=1`
   * and `range=1` of the supplied completed measurement. Returns the
   * complete response unchanged and performs no decoding, comparison,
   * retries, follow-up ranges, normalization, or writes. See
   * docs/unknowns.md.
   */
  async readSecondFlashBlockExperimentM5(measurementNumber: number): Promise<ParsedResponse> {
    if (!this.isConnected) throw new ScannerNotConnectedError();
    if (!Number.isSafeInteger(measurementNumber) || measurementNumber < 1) {
      throw new RangeError('Experiment M5 measurement number must be a positive safe integer');
    }
    return this.#protocol.sendCommand('read-flash', {
      nr: String(measurementNumber),
      block: '1',
      range: '1',
    });
  }

  /**
   * UNVERIFIED — Experiment M6 only.
   *
   * Sends exactly one vendor-proposed `read-flash` request for `block=2`
   * and `range=1` of the supplied completed measurement. Returns the
   * complete response unchanged and performs no decoding, comparison,
   * retries, follow-up ranges, normalization, or writes. See
   * docs/unknowns.md.
   */
  async readThirdFlashBlockExperimentM6(measurementNumber: number): Promise<ParsedResponse> {
    if (!this.isConnected) throw new ScannerNotConnectedError();
    if (!Number.isSafeInteger(measurementNumber) || measurementNumber < 1) {
      throw new RangeError('Experiment M6 measurement number must be a positive safe integer');
    }
    return this.#protocol.sendCommand('read-flash', {
      nr: String(measurementNumber),
      block: '2',
      range: '1',
    });
  }

  /**
   * UNVERIFIED — Experiment M7 only.
   *
   * Sends exactly one vendor-proposed `read-flash` request for `block=0`
   * and `range=3` of the supplied completed measurement. Returns the
   * complete response unchanged and performs no retries, follow-up reads,
   * normalization, measurement start, status polling, or writes. See
   * docs/unknowns.md.
   */
  async readFirstThreeFlashBlocksExperimentM7(measurementNumber: number): Promise<ParsedResponse> {
    if (!this.isConnected) throw new ScannerNotConnectedError();
    if (!Number.isSafeInteger(measurementNumber) || measurementNumber < 1) {
      throw new RangeError('Experiment M7 measurement number must be a positive safe integer');
    }
    return this.#protocol.sendCommand('read-flash', {
      nr: String(measurementNumber),
      block: '0',
      range: '3',
    });
  }

  /**
   * UNVERIFIED — Experiment M8 only.
   *
   * Sends exactly one bounded vendor-proposed `read-flash` request for
   * `block=0` and `range=150` of the supplied completed measurement.
   * Returns the complete response unchanged and performs no retries,
   * follow-up reads, normalization, measurement start, status polling, or
   * writes. See docs/unknowns.md.
   */
  async readBoundedFlashRangeExperimentM8(measurementNumber: number): Promise<ParsedResponse> {
    if (!this.isConnected) throw new ScannerNotConnectedError();
    if (!Number.isSafeInteger(measurementNumber) || measurementNumber < 1) {
      throw new RangeError('Experiment M8 measurement number must be a positive safe integer');
    }
    return this.#protocol.sendCommand('read-flash', {
      nr: String(measurementNumber),
      block: '0',
      range: '150',
    });
  }

  /**
   * UNVERIFIED — Experiment M9 only.
   *
   * Sends exactly one bounded vendor-proposed `read-flash` request for
   * `block=150` and `range=150` of the supplied completed measurement.
   * Returns the complete response unchanged and performs no retries,
   * follow-up reads, normalization, measurement start, status polling, or
   * writes. See docs/unknowns.md.
   */
  async readSecondBoundedFlashRangeExperimentM9(measurementNumber: number): Promise<ParsedResponse> {
    if (!this.isConnected) throw new ScannerNotConnectedError();
    if (!Number.isSafeInteger(measurementNumber) || measurementNumber < 1) {
      throw new RangeError('Experiment M9 measurement number must be a positive safe integer');
    }
    return this.#protocol.sendCommand('read-flash', {
      nr: String(measurementNumber),
      block: '150',
      range: '150',
    });
  }

  /**
   * UNVERIFIED — Experiment M10 only.
   *
   * Sends exactly one bounded read-only `read-flash` request for
   * `block=300` and `range=150`. This changes only the start offset from
   * M9 to look for the measurement boundary. It performs no retry,
   * follow-up read, measurement start, status poll, or interpretation.
   */
  async readThirdBoundedFlashRangeExperimentM10(measurementNumber: number): Promise<ParsedResponse> {
    if (!this.isConnected) throw new ScannerNotConnectedError();
    if (!Number.isSafeInteger(measurementNumber) || measurementNumber < 1) {
      throw new RangeError('Experiment M10 measurement number must be a positive safe integer');
    }
    return this.#protocol.sendCommand('read-flash', {
      nr: String(measurementNumber),
      block: '300',
      range: '150',
    });
  }

  /** UNVERIFIED — Experiment M11: one read-only block=450, range=150 request; no retry or follow-up. */
  async readFourthBoundedFlashRangeExperimentM11(measurementNumber: number): Promise<ParsedResponse> {
    if (!this.isConnected) throw new ScannerNotConnectedError();
    if (!Number.isSafeInteger(measurementNumber) || measurementNumber < 1) {
      throw new RangeError('Experiment M11 measurement number must be a positive safe integer');
    }
    return this.#protocol.sendCommand('read-flash', {
      nr: String(measurementNumber), block: '450', range: '150',
    });
  }

  /** UNVERIFIED — Experiment M12: one read-only block=600, range=150 request; no retry or follow-up. */
  async readFifthBoundedFlashRangeExperimentM12(measurementNumber: number): Promise<ParsedResponse> {
    if (!this.isConnected) throw new ScannerNotConnectedError();
    if (!Number.isSafeInteger(measurementNumber) || measurementNumber < 1) {
      throw new RangeError('Experiment M12 measurement number must be a positive safe integer');
    }
    return this.#protocol.sendCommand('read-flash', {
      nr: String(measurementNumber), block: '600', range: '150',
    });
  }

  /** UNVERIFIED — Experiment M13: one read-only boundary request at block 5772; no retry or follow-up. */
  async readAoxBoundaryLastBlockExperimentM13(measurementNumber: number): Promise<ParsedResponse> {
    if (!this.isConnected) throw new ScannerNotConnectedError();
    if (!Number.isSafeInteger(measurementNumber) || measurementNumber < 1) {
      throw new RangeError('Experiment M13 measurement number must be a positive safe integer');
    }
    return this.#protocol.sendCommand('read-flash', {
      nr: String(measurementNumber), block: '5772', range: '1',
    });
  }

  /** UNVERIFIED — Experiment M14: one read-only request immediately beyond the APK-derived boundary. */
  async readAoxBoundaryBeyondEndExperimentM14(measurementNumber: number): Promise<ParsedResponse> {
    if (!this.isConnected) throw new ScannerNotConnectedError();
    if (!Number.isSafeInteger(measurementNumber) || measurementNumber < 1) {
      throw new RangeError('Experiment M14 measurement number must be a positive safe integer');
    }
    return this.#protocol.sendCommand('read-flash', {
      nr: String(measurementNumber), block: '5773', range: '1',
    });
  }

  /**
   * UNVERIFIED — complete measurement 21 download experiment only.
   * @deprecated Use downloadAoxMeasurement(); retained by the diagnostic CLI.
   * Sends bounded read-flash requests of at most 150 and retries only missing
   * logical ranges. It never starts, deletes, erases, polls, or writes.
   */
  async downloadCompletedAoxMeasurement21Experiment(): Promise<ExperimentalAoxMeasurementArtifact> {
    if (!this.isConnected) throw new ScannerNotConnectedError();
    return downloadExperimentalAoxMeasurement(21, (start, range) => this.#protocol.sendCommand('read-flash', {
      nr: '21', block: String(start), range: String(range),
    }));
  }

  /**
   * UNVERIFIED — Experiment M15 only: non-destructive live AOX acquisition.
   * @deprecated Use startAoxMeasurement() and downloadAoxMeasurement(); retained for M15 regression evidence.
   * A supplied hand-position gate runs after baseline status and before measure.
   * This sends status, one measure?type=aox, bounded read-flash requests, and
   * one final status. It never sends delete, erase-chip, reset, or update.
   */
  async runNonDestructiveLiveAoxExperimentM15(options: ExperimentalLiveAoxOptions = {}): Promise<ExperimentalLiveAoxArtifact> {
    if (!this.isConnected) throw new ScannerNotConnectedError();
    const now = options.now ?? (() => new Date());
    const emit = (kind: ExperimentalLiveAoxEvent['kind'], detail: unknown) => {
      options.onEvent?.({ timestamp: now().toISOString(), kind, detail });
    };
    const startedAt = now().toISOString();
    const baselineStatus = await this.#protocol.sendCommand('status');
    const baselineStatusCapturedAt = now().toISOString();
    emit('baseline-status', baselineStatus);

    await options.waitForHandReady?.();

    const measurementCommandSentAt = now().toISOString();
    const measurementAcknowledgment = await this.#protocol.sendCommand('measure', { type: 'aox' });
    const measurementAcknowledgedAt = now().toISOString();
    emit('measurement-acknowledgment', measurementAcknowledgment);
    const measurementNumber = measurementAcknowledgment.kind === 'ok'
      ? measurementAcknowledgment.json.measurement_nr
      : undefined;
    if (!Number.isSafeInteger(measurementNumber) || (measurementNumber as number) < 1) {
      throw new Error('Experiment M15 acknowledgment did not contain a positive integer measurement_nr');
    }
    const acquisitionStartedAtMs = now().getTime();
    const acquisition = await downloadExperimentalAoxMeasurement(
      measurementNumber as number,
      (start, range) => this.#protocol.sendCommand('read-flash', {
        nr: String(measurementNumber), block: String(start), range: String(range),
      }),
      now,
      {
        maxRetryRounds: 12,
        acquisitionStartedAtMs,
        blocksPerSecond: 400,
        beforeRead: async (start) => {
          const targetMs = acquisitionStartedAtMs + Math.floor((start / 400) * 1000);
          const waitMs = targetMs - now().getTime();
          if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
        },
        onReadComplete: (record: ExperimentalAoxReadRecord, validBlockCount: number) => emit('flash-read', { ...record, validBlockCount }),
      },
    );
    const finalStatus = await this.#protocol.sendCommand('status');
    const finalStatusCapturedAt = now().toISOString();
    emit('final-status', finalStatus);
    return {
      experimental: true,
      startedAt,
      baselineStatusCapturedAt,
      baselineStatus,
      measurementCommandSentAt,
      measurementAcknowledgedAt,
      measurementAcknowledgment,
      measurementNumber: measurementNumber as number,
      firstReadableBlockAt: acquisition.blocks.reduce<string | null>(
        (earliest, block) => earliest === null || block.firstObservedAt < earliest ? block.firstObservedAt : earliest,
        null,
      ),
      finalBlockAvailableAt: acquisition.complete ? acquisition.blocks.at(-1)?.firstObservedAt ?? null : null,
      visibleMeasurementCompletedAt: options.getVisibleMeasurementCompletedAt?.() ?? null,
      finalStatusCapturedAt,
      finalStatus,
      completedAt: now().toISOString(),
      acquisition,
    };
  }

  #requireIdentifiedV2(): void {
    if (!this.isConnected) throw new ScannerNotConnectedError();
    if (this.#identity?.protocolVersion !== 'v2') throw new ScannerNotIdentifiedError();
  }
}

function extractSerial(response: ParsedResponse): string | undefined {
  return response.kind === 'ok' || response.kind === 'error' ? response.serial : undefined;
}

function isAoxMeasureCommand(command: string | undefined): boolean {
  if (!command) return false;
  const [name, query = ''] = command.split('?');
  return name === 'measure' && new URLSearchParams(query).get('type') === 'aox';
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
}
