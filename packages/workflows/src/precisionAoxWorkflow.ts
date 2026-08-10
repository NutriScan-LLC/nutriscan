import {
  DEFAULT_PRECISION_AOX_MEASUREMENT_COUNT,
  buildPrecisionAoxScoringRequest,
  normalizedConstituentAox,
  parsePrecisionAoxResponse,
  parseQuickAoxPreRequest,
  type ParsedPrecisionAoxResponse,
  type ParsedQuickAoxPreRequest,
  type PrecisionAoxScoringRequest,
  type PrecisionAoxSeriesEntry,
} from '@nutriscan/scoring/quick-aox';
import type {
  QuickAoxWorkflowEvent,
  QuickAoxWorkflowOptions,
  QuickAoxWorkflowOutcome,
} from './quickAoxWorkflow.js';

export interface QuickAoxWorkflowRunner {
  run(options: QuickAoxWorkflowOptions): Promise<QuickAoxWorkflowOutcome>;
}

export interface PrecisionAoxScoringGateway {
  preRequest(request: { scannerSerial: string; signal?: AbortSignal }): Promise<unknown>;
  submit(request: {
    scannerSerial: string;
    recommendedServer: string;
    scoringRequest: PrecisionAoxScoringRequest;
    signal?: AbortSignal;
  }): Promise<unknown>;
}

export type PrecisionAoxAttemptKind = 'planned' | 'replacement';

export type PrecisionAoxWorkflowPhase =
  | 'planning-measurement'
  | 'running-constituent'
  | 'awaiting-replacement'
  | 'building-final-request'
  | 'precision-pre-requesting'
  | 'precision-waiting-to-submit'
  | 'precision-submitting'
  | 'precision-parsing';

export type PrecisionAoxWorkflowEvent =
  | { state: 'measurement-planned'; measurementIndex: number; measurementCount: number; attempt: number; attemptKind: PrecisionAoxAttemptKind }
  | { state: 'constituent-progress'; measurementIndex: number; measurementCount: number; attempt: number; event: QuickAoxWorkflowEvent }
  | { state: 'constituent-retained'; measurementIndex: number; measurementCount: number; retained: PrecisionAoxSeriesEntry }
  | { state: 'constituent-rejected'; measurementIndex: number; measurementCount: number; attempt: number; outcome: Exclude<QuickAoxWorkflowOutcome, { kind: 'accepted' } | { kind: 'failed' } | { kind: 'cancelled' }> }
  | { state: 'replacement-planned'; measurementIndex: number; measurementCount: number; discardedUuid?: string }
  | { state: 'series-complete'; measurementCount: number }
  | { state: 'building-final-request' }
  | { state: 'precision-pre-requesting' }
  | { state: 'precision-waiting-to-submit'; requiredMs: number }
  | { state: 'precision-submitting' }
  | { state: 'precision-parsing' }
  | { state: 'completed'; outcomeKind: PrecisionAoxWorkflowOutcome['kind'] };

export interface PrecisionAoxWorkflowOptions {
  readonly language: string;
  readonly createUuid: () => string;
  readonly measurementCount?: number;
  readonly signal?: AbortSignal;
  readonly quickOptions?: Omit<QuickAoxWorkflowOptions, 'language' | 'createUuid' | 'waitForBegin' | 'signal' | 'onProgress' | 'disconnectOnFinish'>;
  readonly waitForMeasurementBegin: (context: {
    measurementIndex: number;
    measurementCount: number;
    attempt: number;
    attemptKind: PrecisionAoxAttemptKind;
    signal?: AbortSignal;
  }) => Promise<void>;
  /** Must resolve to replace before a rejected scan is discarded and repeated. */
  readonly waitForReplacement: (context: {
    measurementIndex: number;
    measurementCount: number;
    attempt: number;
    outcome: Exclude<QuickAoxWorkflowOutcome, { kind: 'accepted' } | { kind: 'failed' } | { kind: 'cancelled' }>;
    signal?: AbortSignal;
  }) => Promise<'replace' | 'cancel'>;
  readonly onProgress?: (event: PrecisionAoxWorkflowEvent) => void;
}

export interface PrecisionAoxWorkflowEvidence {
  readonly scannerSerial: string;
  readonly retainedSeries: readonly PrecisionAoxSeriesEntry[];
  readonly discardedUuids: readonly string[];
  readonly scoringRequest: PrecisionAoxScoringRequest;
  readonly preRequest: ParsedQuickAoxPreRequest;
  readonly result: ParsedPrecisionAoxResponse;
  readonly rawPrecisionResponse: unknown;
}

export type PrecisionAoxWorkflowOutcome =
  | ({ kind: 'accepted'; score: number } & PrecisionAoxWorkflowEvidence)
  | { kind: 'failed'; phase: PrecisionAoxWorkflowPhase; message: string; cause: unknown; retainedSeries: readonly PrecisionAoxSeriesEntry[]; discardedUuids: readonly string[]; diagnostic?: PrecisionAoxWorkflowDiagnostic }
  | { kind: 'cancelled'; phase: PrecisionAoxWorkflowPhase; reason: unknown; retainedSeries: readonly PrecisionAoxSeriesEntry[]; discardedUuids: readonly string[] };

export interface PrecisionAoxWorkflowDiagnostic {
  readonly code: string;
  readonly status: number;
  readonly requestId: string;
  readonly upstreamStatus?: number;
}

export class PrecisionAoxWorkflow {
  readonly #quick: QuickAoxWorkflowRunner;
  readonly #scoring: PrecisionAoxScoringGateway;
  readonly #wait: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  #running = false;

  constructor(dependencies: {
    quick: QuickAoxWorkflowRunner;
    scoring: PrecisionAoxScoringGateway;
    wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  }) {
    this.#quick = dependencies.quick;
    this.#scoring = dependencies.scoring;
    this.#wait = dependencies.wait ?? abortableWait;
  }

  async run(options: PrecisionAoxWorkflowOptions): Promise<PrecisionAoxWorkflowOutcome> {
    if (this.#running) throw new Error('Precision AOX workflow instance already has an active run');
    this.#running = true;
    const measurementCount = options.measurementCount ?? DEFAULT_PRECISION_AOX_MEASUREMENT_COUNT;
    if (!Number.isSafeInteger(measurementCount) || measurementCount < 2) {
      this.#running = false;
      throw new RangeError('measurementCount must be a safe integer of at least 2');
    }
    const retainedSeries: PrecisionAoxSeriesEntry[] = [];
    const discardedUuids: string[] = [];
    let scannerSerial: string | undefined;
    let phase: PrecisionAoxWorkflowPhase = 'planning-measurement';
    const emit = (event: PrecisionAoxWorkflowEvent) => {
      try { options.onProgress?.(event); } catch { /* observers cannot alter workflow safety */ }
    };

    try {
      for (let measurementIndex = 1; measurementIndex <= measurementCount; measurementIndex++) {
        let attempt = 1;
        let attemptKind: PrecisionAoxAttemptKind = 'planned';
        for (;;) {
          throwIfAborted(options.signal);
          phase = 'planning-measurement';
          emit({ state: 'measurement-planned', measurementIndex, measurementCount, attempt, attemptKind });
          phase = 'running-constituent';
          const quickOutcome = await this.#quick.run({
            ...options.quickOptions,
            language: options.language,
            createUuid: options.createUuid,
            ...(options.signal ? { signal: options.signal } : {}),
            disconnectOnFinish: false,
            waitForBegin: () => options.waitForMeasurementBegin({
              measurementIndex, measurementCount, attempt, attemptKind,
              ...(options.signal ? { signal: options.signal } : {}),
            }),
            onProgress: (event) => emit({ state: 'constituent-progress', measurementIndex, measurementCount, attempt, event }),
          });
          throwIfAborted(options.signal);
          if (quickOutcome.kind === 'cancelled') {
            return this.#cancelled(phase, quickOutcome.reason, retainedSeries, discardedUuids, emit);
          }
          if (quickOutcome.kind === 'failed') {
            return this.#failed(phase, quickOutcome.message, quickOutcome, retainedSeries, discardedUuids, emit, diagnosticFrom(quickOutcome.cause) ?? quickOutcome.diagnostic);
          }
          scannerSerial ??= quickOutcome.identity.serial;
          if (quickOutcome.identity.serial !== scannerSerial) {
            return this.#failed(phase, 'Precision AOX series cannot combine measurements from different scanners', quickOutcome, retainedSeries, discardedUuids, emit);
          }
          if (quickOutcome.kind === 'accepted') {
            const retained = retainedEntry(quickOutcome);
            if (!retained) {
              return this.#failed(phase, 'Accepted Quick AOX response is missing a finite aox_q or response UUID', quickOutcome.rawScoringResponse, retainedSeries, discardedUuids, emit);
            }
            retainedSeries.push(retained);
            emit({ state: 'constituent-retained', measurementIndex, measurementCount, retained });
            break;
          }

          emit({ state: 'constituent-rejected', measurementIndex, measurementCount, attempt, outcome: quickOutcome });
          phase = 'awaiting-replacement';
          const decision = await options.waitForReplacement({
            measurementIndex, measurementCount, attempt, outcome: quickOutcome,
            ...(options.signal ? { signal: options.signal } : {}),
          });
          throwIfAborted(options.signal);
          if (decision !== 'replace') {
            return this.#cancelled(phase, 'Precision AOX replacement was not authorized', retainedSeries, discardedUuids, emit);
          }
          const discardedUuid = responseUuid(quickOutcome.rawScoringResponse);
          if (discardedUuid) discardedUuids.push(discardedUuid);
          emit({ state: 'replacement-planned', measurementIndex, measurementCount, ...(discardedUuid ? { discardedUuid } : {}) });
          attempt += 1;
          attemptKind = 'replacement';
        }
      }

      if (!scannerSerial) throw new Error('Precision AOX completed without a scanner identity');
      emit({ state: 'series-complete', measurementCount });
      throwIfAborted(options.signal);
      phase = 'building-final-request';
      emit({ state: 'building-final-request' });
      const scoringRequest = buildPrecisionAoxScoringRequest({
        scannerSerial,
        language: options.language,
        requestUuid: options.createUuid(),
        series: retainedSeries,
        discardedUuids,
        expectedMeasurementCount: measurementCount,
      });
      throwIfAborted(options.signal);
      phase = 'precision-pre-requesting';
      emit({ state: 'precision-pre-requesting' });
      const rawPreRequest = await this.#scoring.preRequest({ scannerSerial, ...(options.signal ? { signal: options.signal } : {}) });
      throwIfAborted(options.signal);
      const parsedPreRequest = parseQuickAoxPreRequest(rawPreRequest);
      if (!parsedPreRequest.ok) {
        return this.#failed(phase, parsedPreRequest.error.message, parsedPreRequest.error, retainedSeries, discardedUuids, emit);
      }
      phase = 'precision-waiting-to-submit';
      emit({ state: 'precision-waiting-to-submit', requiredMs: parsedPreRequest.value.waitingTimeMs });
      await this.#wait(parsedPreRequest.value.waitingTimeMs, options.signal);
      throwIfAborted(options.signal);
      phase = 'precision-submitting';
      emit({ state: 'precision-submitting' });
      const rawPrecisionResponse = await this.#scoring.submit({
        scannerSerial,
        recommendedServer: parsedPreRequest.value.recommendedServer,
        scoringRequest,
        ...(options.signal ? { signal: options.signal } : {}),
      });
      throwIfAborted(options.signal);
      phase = 'precision-parsing';
      emit({ state: 'precision-parsing' });
      const parsed = parsePrecisionAoxResponse(rawPrecisionResponse);
      if (!parsed.ok) {
        return this.#failed(phase, parsed.error.message, parsed.error, retainedSeries, discardedUuids, emit);
      }
      const outcome: PrecisionAoxWorkflowOutcome = {
        kind: 'accepted',
        score: parsed.value.preciseAox,
        scannerSerial,
        retainedSeries: [...retainedSeries],
        discardedUuids: [...discardedUuids],
        scoringRequest,
        preRequest: parsedPreRequest.value,
        result: parsed.value,
        rawPrecisionResponse,
      };
      emit({ state: 'completed', outcomeKind: outcome.kind });
      return outcome;
    } catch (cause) {
      if (options.signal?.aborted || isAbortError(cause)) {
        return this.#cancelled(phase, options.signal?.reason ?? cause, retainedSeries, discardedUuids, emit);
      }
      return this.#failed(phase, cause instanceof Error ? cause.message : 'Precision AOX workflow failed', cause, retainedSeries, discardedUuids, emit, diagnosticFrom(cause));
    } finally {
      this.#running = false;
    }
  }

  #failed(
    phase: PrecisionAoxWorkflowPhase,
    message: string,
    cause: unknown,
    retainedSeries: readonly PrecisionAoxSeriesEntry[],
    discardedUuids: readonly string[],
    emit: (event: PrecisionAoxWorkflowEvent) => void,
    diagnostic?: PrecisionAoxWorkflowDiagnostic,
  ): PrecisionAoxWorkflowOutcome {
    const outcome: PrecisionAoxWorkflowOutcome = { kind: 'failed', phase, message, cause, retainedSeries: [...retainedSeries], discardedUuids: [...discardedUuids], ...(diagnostic ? { diagnostic } : {}) };
    emit({ state: 'completed', outcomeKind: outcome.kind });
    return outcome;
  }

  #cancelled(
    phase: PrecisionAoxWorkflowPhase,
    reason: unknown,
    retainedSeries: readonly PrecisionAoxSeriesEntry[],
    discardedUuids: readonly string[],
    emit: (event: PrecisionAoxWorkflowEvent) => void,
  ): PrecisionAoxWorkflowOutcome {
    const outcome: PrecisionAoxWorkflowOutcome = { kind: 'cancelled', phase, reason, retainedSeries: [...retainedSeries], discardedUuids: [...discardedUuids] };
    emit({ state: 'completed', outcomeKind: outcome.kind });
    return outcome;
  }
}

function retainedEntry(outcome: Extract<QuickAoxWorkflowOutcome, { kind: 'accepted' }>): PrecisionAoxSeriesEntry | null {
  const uuid = responseUuid(outcome.rawScoringResponse);
  const aoxQ = outcome.result.qualityCode;
  if (!uuid || aoxQ === null || !Number.isFinite(aoxQ)) return null;
  return {
    normalizedAox: normalizedConstituentAox(outcome.result.rawResponse, outcome.score),
    aoxQ,
    responseUuid: uuid,
    ...(outcome.result.diagnosticsPresent ? { errorPrediction: outcome.result.diagnostics } : {}),
  };
}

function responseUuid(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const uuid = (value as Record<string, unknown>).uuid;
  return typeof uuid === 'string' && uuid.length > 0 ? uuid : undefined;
}

function diagnosticFrom(value: unknown): PrecisionAoxWorkflowDiagnostic | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.diagnosticCode === 'string' && typeof candidate.status === 'number' && typeof candidate.requestId === 'string'
    ? { code: candidate.diagnosticCode, status: candidate.status, requestId: candidate.requestId, ...(typeof candidate.upstreamStatus === 'number' ? { upstreamStatus: candidate.upstreamStatus } : {}) }
    : undefined;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
}

function isAbortError(value: unknown): boolean {
  return value instanceof DOMException && value.name === 'AbortError';
}

function abortableWait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  if (milliseconds === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  });
}
