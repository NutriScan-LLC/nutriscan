import type {
  AoxMeasurementStart,
  DownloadAoxMeasurementOptions,
  RawAoxMeasurementArtifact,
  ScannerIdentity,
} from '@nutriscan/scanner';
import {
  APK_0_50_107_QUICK_AOX_POLICY,
  buildQuickAoxScoringRequest,
  interpretQuickAoxQuality,
  parseQuickAoxPreRequest,
  parseQuickAoxResponse,
  type ParsedQuickAoxPreRequest,
  type QuickAoxParseError,
  type QuickAoxPreRequestParseError,
  type QuickAoxQualityPolicy,
  type QuickAoxResult,
  type QuickAoxScoringRequest,
} from '@nutriscan/scoring/quick-aox';

export type QuickAoxWorkflowPhase =
  | 'connecting'
  | 'identifying'
  | 'awaiting-begin'
  | 'detecting-hand'
  | 'starting-measurement'
  | 'downloading'
  | 'detecting-hand-removal'
  | 'building-scoring-request'
  | 'pre-requesting'
  | 'waiting-to-submit'
  | 'submitting'
  | 'parsing'
  | 'interpreting';

export type QuickAoxWorkflowEvent =
  | { readonly state: 'connecting' }
  | { readonly state: 'identifying' }
  | { readonly state: 'awaiting-begin'; readonly identity: ScannerIdentity }
  | { readonly state: 'detecting-hand' }
  | { readonly state: 'hand-detected' }
  | { readonly state: 'starting-measurement' }
  | { readonly state: 'measurement-started'; readonly measurementNumber: number }
  | {
      readonly state: 'downloading';
      readonly validBlocks: number;
      readonly expectedBlocks: number;
      readonly missingBlocks: number;
      readonly readCount: number;
    }
  | { readonly state: 'measurement-complete'; readonly validBlocks: number }
  | { readonly state: 'detecting-hand-removal' }
  | { readonly state: 'hand-removed' }
  | { readonly state: 'building-scoring-request' }
  | { readonly state: 'pre-requesting' }
  | { readonly state: 'waiting-to-submit'; readonly requiredMs: number }
  | { readonly state: 'submitting' }
  | { readonly state: 'parsing' }
  | { readonly state: 'interpreting' }
  | { readonly state: 'completed'; readonly outcomeKind: QuickAoxWorkflowOutcome['kind'] };

export interface QuickAoxScanner {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  identify(): Promise<ScannerIdentity>;
  startAoxMeasurement(): Promise<AoxMeasurementStart>;
  prepareHandRecognition(target: 'present' | 'removed'): Promise<void>;
  recognizeHand(target: 'present' | 'removed'): Promise<boolean>;
  downloadAoxMeasurement(
    measurementNumber: number,
    options?: DownloadAoxMeasurementOptions,
  ): Promise<RawAoxMeasurementArtifact>;
}

export interface QuickAoxScoringGateway {
  /** Intended production route: browser -> NutriScan backend -> BioZoom. */
  preRequest(request: {
    readonly scannerSerial: string;
    readonly signal?: AbortSignal;
  }): Promise<unknown>;
  /** The gateway owns HTTP/multipart transport; the workflow supplies the exact contract. */
  submit(request: {
    readonly scannerSerial: string;
    readonly recommendedServer: string;
    readonly scoringRequest: QuickAoxScoringRequest;
    readonly signal?: AbortSignal;
  }): Promise<unknown>;
}

export interface QuickAoxWorkflowOptions {
  readonly language: string;
  readonly createUuid: () => string;
  readonly waitForBegin: (context: {
    readonly identity: ScannerIdentity;
    readonly signal?: AbortSignal;
  }) => Promise<void>;
  readonly handDetection?: {
    /** APK-confirmed delay after status and before the first hand command. */
    readonly initialDelayMs?: number;
    /** APK-confirmed delay applied to every hand result. */
    readonly resultDelayMs?: number;
    /** APK-confirmed delay after a successful result before stage transition. */
    readonly successDelayMs?: number;
    readonly timeoutMs?: number;
  };
  readonly signal?: AbortSignal;
  readonly acquisition?: Omit<DownloadAoxMeasurementOptions, 'signal' | 'onProgress'>;
  readonly qualityPolicy?: QuickAoxQualityPolicy;
  readonly onProgress?: (event: QuickAoxWorkflowEvent) => void;
  readonly disconnectOnFinish?: boolean;
}

export interface QuickAoxWorkflowEvidence {
  readonly identity: ScannerIdentity;
  readonly measurementStart: AoxMeasurementStart;
  readonly acquisition: RawAoxMeasurementArtifact;
  readonly scoringRequest: QuickAoxScoringRequest;
  readonly preRequest: ParsedQuickAoxPreRequest;
  readonly rawScoringResponse: unknown;
}

export type QuickAoxWorkflowSuccessOutcome =
  | ({ readonly kind: 'accepted'; readonly score: number; readonly result: QuickAoxResult } & QuickAoxWorkflowEvidence)
  | ({ readonly kind: 'rescan-required'; readonly result: QuickAoxResult } & QuickAoxWorkflowEvidence)
  | ({ readonly kind: 'device-condition-required'; readonly result: QuickAoxResult } & QuickAoxWorkflowEvidence)
  | ({ readonly kind: 'stopped'; readonly result: QuickAoxResult } & QuickAoxWorkflowEvidence)
  | ({ readonly kind: 'unable-to-determine'; readonly result: QuickAoxResult } & QuickAoxWorkflowEvidence)
  | ({
      readonly kind: 'unable-to-determine';
      readonly parseError: QuickAoxParseError;
      readonly rawScoringResponse: unknown;
      readonly identity: ScannerIdentity;
      readonly measurementStart: AoxMeasurementStart;
      readonly acquisition: RawAoxMeasurementArtifact;
      readonly scoringRequest: QuickAoxScoringRequest;
      readonly preRequest: ParsedQuickAoxPreRequest;
    });

export type QuickAoxWorkflowFailureKind =
  | 'scanner'
  | 'hand-detection'
  | 'acquisition'
  | 'scoring-contract'
  | 'scoring-transport'
  | 'unsupported-pre-request'
  | 'invalid-pre-request'
  | 'quality';

export interface QuickAoxWorkflowFailedOutcome {
  readonly kind: 'failed';
  readonly failureKind: QuickAoxWorkflowFailureKind;
  readonly phase: QuickAoxWorkflowPhase;
  readonly message: string;
  readonly cause: unknown;
  readonly physicalMeasurementStarted: boolean;
  readonly physicalMeasurementMayHaveStarted: boolean;
  readonly identity?: ScannerIdentity;
  readonly measurementStart?: AoxMeasurementStart;
  readonly acquisition?: RawAoxMeasurementArtifact;
  readonly rawPreRequestResponse?: unknown;
  readonly preRequestError?: QuickAoxPreRequestParseError;
  readonly rawScoringResponse?: unknown;
  readonly diagnostic?: QuickAoxWorkflowDiagnostic;
}

export interface QuickAoxWorkflowDiagnostic {
  readonly code: string;
  readonly status: number;
  readonly requestId: string;
  readonly upstreamStatus?: number;
}

export interface QuickAoxWorkflowCancelledOutcome {
  readonly kind: 'cancelled';
  readonly phase: QuickAoxWorkflowPhase;
  /** Software work stopped; true does not imply the scanner's physical acquisition stopped. */
  readonly physicalMeasurementStarted: boolean;
  /** True once start was invoked, including when acknowledgment was not obtained. */
  readonly physicalMeasurementMayHaveStarted: boolean;
  readonly reason: unknown;
  readonly identity?: ScannerIdentity;
  readonly measurementStart?: AoxMeasurementStart;
  readonly acquisition?: RawAoxMeasurementArtifact;
}

export type QuickAoxWorkflowOutcome =
  | QuickAoxWorkflowSuccessOutcome
  | QuickAoxWorkflowFailedOutcome
  | QuickAoxWorkflowCancelledOutcome;

export interface QuickAoxWorkflowDependencies {
  readonly scanner: QuickAoxScanner;
  readonly scoring: QuickAoxScoringGateway;
  readonly wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  readonly now?: () => number;
}

export class QuickAoxWorkflowConcurrentRunError extends Error {
  constructor() {
    super('Quick AOX workflow instance already has an active run');
    this.name = 'QuickAoxWorkflowConcurrentRunError';
  }
}

export class QuickAoxWorkflow {
  readonly #scanner: QuickAoxScanner;
  readonly #scoring: QuickAoxScoringGateway;
  readonly #wait: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  readonly #now: () => number;
  #running = false;

  constructor(dependencies: QuickAoxWorkflowDependencies) {
    this.#scanner = dependencies.scanner;
    this.#scoring = dependencies.scoring;
    this.#wait = dependencies.wait ?? abortableWait;
    this.#now = dependencies.now ?? Date.now;
  }

  async run(options: QuickAoxWorkflowOptions): Promise<QuickAoxWorkflowOutcome> {
    if (this.#running) throw new QuickAoxWorkflowConcurrentRunError();
    this.#running = true;
    let phase: QuickAoxWorkflowPhase = 'connecting';
    let identity: ScannerIdentity | undefined;
    let measurementStart: AoxMeasurementStart | undefined;
    let measurementStartInvoked = false;
    let acquisition: RawAoxMeasurementArtifact | undefined;
    let rawPreRequestResponse: unknown;
    let rawScoringResponse: unknown;

    const emit = (event: QuickAoxWorkflowEvent) => {
      try { options.onProgress?.(event); } catch { /* observers do not control safety-critical sequencing */ }
    };

    try {
      throwIfAborted(options.signal);
      emit({ state: 'connecting' });
      await this.#scanner.connect();
      throwIfAborted(options.signal);

      phase = 'identifying';
      emit({ state: 'identifying' });
      identity = await this.#scanner.identify();
      throwIfAborted(options.signal);
      if (identity.protocolVersion !== 'v2' || identity.serial === undefined || identity.serial.length === 0) {
        throw failure('scanner', 'Scanner must identify as V2 with a serial number');
      }

      phase = 'awaiting-begin';
      emit({ state: 'awaiting-begin', identity });
      try {
        await options.waitForBegin({
          identity,
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        });
      } catch (cause) {
        if (options.signal?.aborted) throw cause;
        throw failure('hand-detection', 'Begin-scan confirmation failed', cause);
      }
      throwIfAborted(options.signal);

      phase = 'detecting-hand';
      emit({ state: 'detecting-hand' });
      try {
        await pollForHand(this.#scanner, 'present', this.#wait, this.#now, options);
      } catch (cause) {
        if (options.signal?.aborted) throw cause;
        throw failure('hand-detection', 'Scanner did not confirm hand presence', cause);
      }
      emit({ state: 'hand-detected' });
      throwIfAborted(options.signal);

      phase = 'starting-measurement';
      emit({ state: 'starting-measurement' });
      // The only physical measurement start in the workflow. Never loop or retry it.
      measurementStartInvoked = true;
      measurementStart = await this.#scanner.startAoxMeasurement();
      emit({ state: 'measurement-started', measurementNumber: measurementStart.measurementNumber });
      throwIfAborted(options.signal);

      phase = 'downloading';
      let completedReadCount = 0;
      acquisition = await this.#scanner.downloadAoxMeasurement(measurementStart.measurementNumber, {
        ...options.acquisition,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        onProgress: (result) => {
          completedReadCount++;
          emit({
            state: 'downloading',
            validBlocks: result.summary.validBlockCount,
            expectedBlocks: result.summary.expectedBlockCount,
            missingBlocks: result.summary.missingBlockCount,
            readCount: completedReadCount,
          });
        },
      });
      if (!acquisition.summary.complete || acquisition.failure !== null) {
        throw failure('acquisition', acquisition.failure?.message ?? 'AOX acquisition was incomplete');
      }
      if (acquisition.measurementNumber !== measurementStart.measurementNumber || acquisition.scannerSerial !== identity.serial) {
        throw failure('acquisition', 'AOX acquisition identity or measurement number did not match the active workflow');
      }
      emit({ state: 'measurement-complete', validBlocks: acquisition.summary.validBlockCount });
      phase = 'detecting-hand-removal';
      emit({ state: 'detecting-hand-removal' });
      try {
        await pollForHand(this.#scanner, 'removed', this.#wait, this.#now, options);
      } catch (cause) {
        if (options.signal?.aborted) throw cause;
        throw failure('hand-detection', 'Scanner did not confirm hand removal', cause);
      }
      emit({ state: 'hand-removed' });
      throwIfAborted(options.signal);

      phase = 'building-scoring-request';
      emit({ state: 'building-scoring-request' });
      let scoringRequest: QuickAoxScoringRequest;
      try {
        scoringRequest = buildQuickAoxScoringRequest(acquisition, {
          language: options.language,
          uuid: options.createUuid(),
        });
      } catch (cause) {
        throw failure('scoring-contract', 'Could not build Quick AOX scoring request', cause);
      }

      // Keep the confirmed scoring transaction contiguous and after acquisition.
      phase = 'pre-requesting';
      emit({ state: 'pre-requesting' });
      try {
        rawPreRequestResponse = await this.#scoring.preRequest({
          scannerSerial: identity.serial,
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        });
      } catch (cause) {
        const diagnostic = safeDiagnostic(cause);
        if (diagnostic?.code === 'UPSTREAM_REPEAT_REQUIRED') {
          throw failure('unsupported-pre-request', diagnosticMessage(diagnostic), cause);
        }
        if (diagnostic?.code === 'UPSTREAM_INVALID_PRE_REQUEST') {
          throw failure('invalid-pre-request', diagnosticMessage(diagnostic), cause);
        }
        throw failure('scoring-transport', diagnostic === undefined ? 'Quick AOX pre-request transport failed' : diagnosticMessage(diagnostic), cause);
      }
      const parsedPreRequest = parseQuickAoxPreRequest(rawPreRequestResponse);
      if (!parsedPreRequest.ok) {
        const kind = parsedPreRequest.error.code === 'unsupported-repeat-pre-request'
          ? 'unsupported-pre-request'
          : 'invalid-pre-request';
        throw failure(kind, parsedPreRequest.error.message, parsedPreRequest.error);
      }

      phase = 'waiting-to-submit';
      emit({ state: 'waiting-to-submit', requiredMs: parsedPreRequest.value.waitingTimeMs });
      await this.#wait(parsedPreRequest.value.waitingTimeMs, options.signal);
      throwIfAborted(options.signal);

      phase = 'submitting';
      emit({ state: 'submitting' });
      try {
        rawScoringResponse = await this.#scoring.submit({
          scannerSerial: identity.serial,
          recommendedServer: parsedPreRequest.value.recommendedServer,
          scoringRequest,
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        });
      } catch (cause) {
        throw failure('scoring-transport', 'Quick AOX measurement submission failed', cause);
      }
      throwIfAborted(options.signal);

      phase = 'parsing';
      emit({ state: 'parsing' });
      const parsedScoring = parseQuickAoxResponse(rawScoringResponse);
      if (!parsedScoring.ok) {
        const outcome: QuickAoxWorkflowOutcome = {
          kind: 'unable-to-determine',
          parseError: parsedScoring.error,
          rawScoringResponse,
          identity,
          measurementStart,
          acquisition,
          scoringRequest,
          preRequest: parsedPreRequest.value,
        };
        emit({ state: 'completed', outcomeKind: outcome.kind });
        return outcome;
      }

      phase = 'interpreting';
      emit({ state: 'interpreting' });
      let result: QuickAoxResult;
      try {
        result = interpretQuickAoxQuality(
          parsedScoring.value,
          options.qualityPolicy ?? APK_0_50_107_QUICK_AOX_POLICY,
        );
      } catch (cause) {
        throw failure('quality', 'Quick AOX quality interpretation failed', cause);
      }
      const evidence: QuickAoxWorkflowEvidence = {
        identity,
        measurementStart,
        acquisition,
        scoringRequest,
        preRequest: parsedPreRequest.value,
        rawScoringResponse,
      };
      const outcome = outcomeFromResult(result, evidence);
      emit({ state: 'completed', outcomeKind: outcome.kind });
      return outcome;
    } catch (cause) {
      if (options.signal?.aborted) {
        const outcome: QuickAoxWorkflowCancelledOutcome = {
          kind: 'cancelled',
          phase,
          physicalMeasurementStarted: measurementStart !== undefined,
          physicalMeasurementMayHaveStarted: measurementStartInvoked,
          reason: options.signal.reason,
          ...(identity === undefined ? {} : { identity }),
          ...(measurementStart === undefined ? {} : { measurementStart }),
          ...(acquisition === undefined ? {} : { acquisition }),
        };
        emit({ state: 'completed', outcomeKind: outcome.kind });
        return outcome;
      }
      const marked = isMarkedFailure(cause) ? cause : failure(defaultFailureKind(phase), messageOf(cause), cause);
      const preRequestError = isPreRequestError(marked.cause) ? marked.cause : undefined;
      const diagnostic = safeDiagnostic(marked.cause);
      const outcome: QuickAoxWorkflowFailedOutcome = {
        kind: 'failed',
        failureKind: marked.kind,
        phase,
        message: marked.message,
        cause: marked.cause,
        physicalMeasurementStarted: measurementStart !== undefined,
        physicalMeasurementMayHaveStarted: measurementStartInvoked,
        ...(identity === undefined ? {} : { identity }),
        ...(measurementStart === undefined ? {} : { measurementStart }),
        ...(acquisition === undefined ? {} : { acquisition }),
        ...(rawPreRequestResponse === undefined ? {} : { rawPreRequestResponse }),
        ...(preRequestError === undefined ? {} : { preRequestError }),
        ...(rawScoringResponse === undefined ? {} : { rawScoringResponse }),
        ...(diagnostic === undefined ? {} : { diagnostic }),
      };
      emit({ state: 'completed', outcomeKind: outcome.kind });
      return outcome;
    } finally {
      if (options.disconnectOnFinish ?? true) await this.#scanner.disconnect().catch(() => {});
      this.#running = false;
    }
  }
}

function safeDiagnostic(value: unknown): QuickAoxWorkflowDiagnostic | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.diagnosticCode !== 'string' || typeof candidate.status !== 'number' || typeof candidate.requestId !== 'string') return undefined;
  return {
    code: candidate.diagnosticCode,
    status: candidate.status,
    requestId: candidate.requestId,
    ...(typeof candidate.upstreamStatus === 'number' ? { upstreamStatus: candidate.upstreamStatus } : {}),
  };
}

function diagnosticMessage(diagnostic: QuickAoxWorkflowDiagnostic): string {
  return `Quick AOX pre-request failed: ${diagnostic.code} (reference ${diagnostic.requestId})`;
}

async function pollForHand(
  scanner: QuickAoxScanner,
  target: 'present' | 'removed',
  wait: (milliseconds: number, signal?: AbortSignal) => Promise<void>,
  now: () => number,
  options: QuickAoxWorkflowOptions,
): Promise<void> {
  const initialDelay = options.handDetection?.initialDelayMs ?? 100;
  const resultDelay = options.handDetection?.resultDelayMs ?? 500;
  const successDelay = options.handDetection?.successDelayMs ?? 100;
  const timeout = options.handDetection?.timeoutMs ?? 60_000;
  if (![initialDelay, resultDelay, successDelay].every((value) => value >= 0) || !(timeout > 0)) throw new RangeError('Invalid hand-detection timing');
  const started = now();
  await scanner.prepareHandRecognition(target);
  if (initialDelay > 0) await wait(initialDelay, options.signal);
  for (;;) {
    throwIfAborted(options.signal);
    const recognized = await scanner.recognizeHand(target);
    // APK-confirmed RxJS delay(500) applies to both false and true results.
    if (resultDelay > 0) await wait(resultDelay, options.signal);
    if (recognized) {
      if (successDelay > 0) await wait(successDelay, options.signal);
      return;
    }
    if (now() - started >= timeout) throw new Error(`Hand ${target} detection timed out after ${timeout} ms`);
  }
}

interface MarkedFailure {
  readonly marker: 'quick-aox-workflow-failure';
  readonly kind: QuickAoxWorkflowFailureKind;
  readonly message: string;
  readonly cause: unknown;
}

function outcomeFromResult(result: QuickAoxResult, evidence: QuickAoxWorkflowEvidence): QuickAoxWorkflowSuccessOutcome {
  const action = result.decision.action;
  switch (action) {
    case 'accept': return { kind: 'accepted', score: result.score, result, ...evidence };
    case 'rescan': return { kind: 'rescan-required', result, ...evidence };
    case 'resolve-device-condition': return { kind: 'device-condition-required', result, ...evidence };
    case 'stop': return { kind: 'stopped', result, ...evidence };
    case 'unable-to-decide': return { kind: 'unable-to-determine', result, ...evidence };
    default: return assertNever(action);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unreachable Quick AOX action: ${String(value)}`);
}

function failure(kind: QuickAoxWorkflowFailureKind, message: string, cause?: unknown): MarkedFailure {
  return { marker: 'quick-aox-workflow-failure', kind, message, cause };
}

function isMarkedFailure(value: unknown): value is MarkedFailure {
  return typeof value === 'object' && value !== null && (value as { marker?: unknown }).marker === 'quick-aox-workflow-failure';
}

function isPreRequestError(value: unknown): value is QuickAoxPreRequestParseError {
  return typeof value === 'object' && value !== null && 'code' in value && 'rawResponse' in value;
}

function defaultFailureKind(phase: QuickAoxWorkflowPhase): QuickAoxWorkflowFailureKind {
  if (phase === 'downloading') return 'acquisition';
  if (phase === 'pre-requesting' || phase === 'waiting-to-submit' || phase === 'submitting') return 'scoring-transport';
  if (phase === 'building-scoring-request') return 'scoring-contract';
  if (phase === 'interpreting') return 'quality';
  if (phase === 'awaiting-begin' || phase === 'detecting-hand' || phase === 'detecting-hand-removal') return 'hand-detection';
  return 'scanner';
}

function messageOf(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
}

function abortableWait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  if (milliseconds === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
