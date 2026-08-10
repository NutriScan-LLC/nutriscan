import { describe, expect, it } from 'vitest';
import type {
  AoxMeasurementStart,
  RawAoxMeasurementArtifact,
  ScannerIdentity,
} from '@nutriscan/scanner';
import {
  QuickAoxWorkflow,
  QuickAoxWorkflowConcurrentRunError,
  type QuickAoxScanner,
  type QuickAoxScoringGateway,
  type QuickAoxWorkflowOptions,
} from '../src/index.js';

const identity = {
  serial: '2N2400A5B70F5E3C9251',
  protocolVersion: 'v2',
  commandUsed: 'status',
  response: { kind: 'ok' },
} as unknown as ScannerIdentity;

const measurementStart = {
  measurementNumber: 42,
  acknowledgedAt: '2026-08-09T00:00:00.000Z',
  acknowledgment: { kind: 'ok' },
} as unknown as AoxMeasurementStart;

function artifact(overrides: Partial<RawAoxMeasurementArtifact> = {}): RawAoxMeasurementArtifact {
  const originalBase64Blocks = ['BLOCK-A', 'BLOCK-B'];
  return {
    scannerSerial: identity.serial,
    measurementNumber: measurementStart.measurementNumber,
    type: 'aox',
    profile: { type: 'aox', logicalBlockCount: 2, blockByteLength: 33 },
    blocks: [
      { logicalIndex: 0, internalIndex: 1, base64: originalBase64Blocks[0]!, decodedBytes: [], byteLength: 33, declaredLength: 31, crcResidual: 0, firstObservedAt: null },
      { logicalIndex: 1, internalIndex: 1, base64: originalBase64Blocks[1]!, decodedBytes: [], byteLength: 33, declaredLength: 31, crcResidual: 0, firstObservedAt: null },
    ],
    originalBase64Blocks,
    measurementBlocks: originalBase64Blocks.join(''),
    missingLogicalIndexes: [], missingRanges: [], anomalies: [],
    summary: { expectedBlockCount: 2, validBlockCount: 2, missingBlockCount: 0, anomalyCount: 0, complete: true },
    startedAt: '2026-08-09T00:00:00.000Z', completedAt: '2026-08-09T00:00:30.000Z',
    reads: [], retryRounds: 0, failure: null,
    ...overrides,
  };
}

interface Harness {
  readonly calls: string[];
  readonly scanner: QuickAoxScanner;
  readonly scoring: QuickAoxScoringGateway;
  readonly submitted: Array<Parameters<QuickAoxScoringGateway['submit']>[0]>;
  scoringResponse: unknown;
  preRequestResponse: unknown;
  preRequest: () => Promise<unknown>;
  download: (measurementNumber: number) => Promise<RawAoxMeasurementArtifact>;
}

function harness(): Harness {
  const state: Harness = {
    calls: [],
    submitted: [],
    scoringResponse: { aox: 5.6, aox_q: 40, error_prediction: { qnn_error: { error: 0.1 } }, unknown: 'preserved' },
    preRequestResponse: { recommended_server: 'https://de2.biozoom.net', waiting_time_ms: 109, new_pre_request_req: false },
    preRequest: async () => state.preRequestResponse,
    download: async () => artifact(),
    scanner: undefined as unknown as QuickAoxScanner,
    scoring: undefined as unknown as QuickAoxScoringGateway,
  };
  state.scanner = {
    connect: async () => { state.calls.push('connect'); },
    disconnect: async () => { state.calls.push('disconnect'); },
    identify: async () => { state.calls.push('identify'); return identity; },
    prepareHandRecognition: async () => {},
    recognizeHand: async (target) => { state.calls.push(`hand:${target}`); return true; },
    startAoxMeasurement: async () => { state.calls.push('start'); return measurementStart; },
    downloadAoxMeasurement: async (measurementNumber) => {
      state.calls.push(`download:${measurementNumber}`);
      return state.download(measurementNumber);
    },
  };
  state.scoring = {
    preRequest: async ({ scannerSerial }) => {
      state.calls.push(`pre:${scannerSerial}`);
      return state.preRequest();
    },
    submit: async (request) => {
      state.calls.push(`submit:${request.scoringRequest.measurementNumber}`);
      state.submitted.push(request);
      return state.scoringResponse;
    },
  };
  return state;
}

function options(overrides: Partial<QuickAoxWorkflowOptions> = {}): QuickAoxWorkflowOptions {
  return {
    language: 'EN',
    createUuid: () => '11111111-1111-4111-8111-111111111111',
    waitForBegin: async () => {},
    handDetection: { initialDelayMs: 0, resultDelayMs: 0, successDelayMs: 0 },
    ...overrides,
  };
}

describe('QuickAoxWorkflow sequencing', () => {
  it('applies APK-confirmed 100 + 500 + 100 ms timing and reads status once before polling', async () => {
    const h = harness();
    const timeline: string[] = [];
    let samples = 0;
    h.scanner.prepareHandRecognition = async (target) => { timeline.push(`prepare:${target}`); };
    h.scanner.recognizeHand = async (target) => { timeline.push(`sample:${target}`); return target === 'removed' || ++samples === 2; };
    h.scanner.startAoxMeasurement = async () => { timeline.push('measure'); return measurementStart; };
    await new QuickAoxWorkflow({
      scanner: h.scanner, scoring: h.scoring,
      wait: async (milliseconds) => { timeline.push(`wait:${milliseconds}`); },
    }).run(options({ handDetection: { initialDelayMs: 100, resultDelayMs: 500, successDelayMs: 100 } }));
    expect(timeline.slice(0, 8)).toEqual([
      'prepare:present', 'wait:100', 'sample:present', 'wait:500',
      'sample:present', 'wait:500', 'wait:100', 'measure',
    ]);
    expect(timeline.filter((entry) => entry === 'prepare:present')).toHaveLength(1);
  });

  it('cannot start measurement before scanner-confirmed presence or score before confirmed removal', async () => {
    const h = harness();
    let presentSamples = 0;
    let removalSamples = 0;
    h.scanner.recognizeHand = async (target) => {
      h.calls.push(`hand:${target}`);
      if (target === 'present') return ++presentSamples === 2;
      return ++removalSamples === 2;
    };
    const workflow = new QuickAoxWorkflow({ scanner: h.scanner, scoring: h.scoring, wait: async () => {} });
    await workflow.run(options());
    expect(h.calls).toEqual([
      'connect', 'identify', 'hand:present', 'hand:present', 'start', 'download:42',
      'hand:removed', 'hand:removed', `pre:${identity.serial}`, 'submit:42', 'disconnect',
    ]);
    expect(h.calls.indexOf('start')).toBeGreaterThan(h.calls.lastIndexOf('hand:present'));
    expect(h.calls.indexOf(`pre:${identity.serial}`)).toBeGreaterThan(h.calls.lastIndexOf('hand:removed'));
  });

  it('requires hand confirmation, starts exactly once, honors wait, and preserves exact evidence', async () => {
    const h = harness();
    const waits: number[] = [];
    const events: string[] = [];
    const workflow = new QuickAoxWorkflow({
      scanner: h.scanner,
      scoring: h.scoring,
      wait: async (milliseconds) => { h.calls.push(`wait:${milliseconds}`); waits.push(milliseconds); },
    });
    const outcome = await workflow.run(options({
      waitForBegin: async () => { h.calls.push('begin-confirmed'); },
      onProgress: (event) => events.push(event.state),
    }));

    expect(outcome.kind).toBe('accepted');
    expect(h.calls).toEqual([
      'connect', 'identify', 'begin-confirmed', 'hand:present', 'start', 'download:42', 'hand:removed',
      `pre:${identity.serial}`, 'wait:109', 'submit:42', 'disconnect',
    ]);
    expect(h.calls.filter((call) => call === 'start')).toHaveLength(1);
    expect(waits).toEqual([109]);
    expect(h.submitted[0]).toMatchObject({
      scannerSerial: identity.serial,
      recommendedServer: 'https://de2.biozoom.net',
      scoringRequest: { measurementNumber: 42, measurementBlocks: 'BLOCK-ABLOCK-B' },
    });
    expect(h.submitted[0]!.scoringRequest.measureJson.MeasurementBlocks).toBe('BLOCK-ABLOCK-B');
    if (outcome.kind === 'accepted') {
      expect(outcome.score).toBe(5.6);
      expect(outcome.rawScoringResponse).toBe(h.scoringResponse);
      expect(outcome.result.rawResponse).toBe(h.scoringResponse);
      expect(outcome.result.diagnostics).toBe((h.scoringResponse as Record<string, unknown>).error_prediction);
      expect(outcome.acquisition.measurementNumber).toBe(42);
    }
    expect(events).toEqual([
      'connecting', 'identifying', 'awaiting-begin', 'detecting-hand', 'hand-detected', 'starting-measurement',
      'measurement-started', 'measurement-complete', 'detecting-hand-removal', 'hand-removed', 'building-scoring-request', 'pre-requesting',
      'waiting-to-submit', 'submitting', 'parsing', 'interpreting', 'completed',
    ]);
  });

  it.each([
    [40, 'accepted'],
    [50, 'rescan-required'],
    [60, 'rescan-required'],
    [70, 'rescan-required'],
    [80, 'device-condition-required'],
    [90, 'device-condition-required'],
    [100, 'stopped'],
    [55, 'rescan-required'],
  ] as const)('maps quality code %i to %s without automatically starting another scan', async (qualityCode, expectedKind) => {
    const h = harness();
    h.scoringResponse = { aox: 5.6, aox_q: qualityCode };
    const outcome = await new QuickAoxWorkflow({ scanner: h.scanner, scoring: h.scoring, wait: async () => {} }).run(options());
    expect(outcome.kind).toBe(expectedKind);
    expect(h.calls.filter((call) => call === 'start')).toHaveLength(1);
    expect(h.calls.filter((call) => call.startsWith('download:'))).toHaveLength(1);
  });

  it('maps missing quality to unable-to-determine while retaining the raw response', async () => {
    const h = harness();
    h.scoringResponse = { aox: 5.6, future: true };
    const outcome = await new QuickAoxWorkflow({ scanner: h.scanner, scoring: h.scoring, wait: async () => {} }).run(options());
    expect(outcome.kind).toBe('unable-to-determine');
    if (outcome.kind === 'unable-to-determine' && 'result' in outcome) {
      expect(outcome.result.decision.action).toBe('unable-to-decide');
      expect(outcome.rawScoringResponse).toBe(h.scoringResponse);
    }
  });

  it('maps malformed scoring responses to unable-to-determine with the raw response', async () => {
    const h = harness();
    h.scoringResponse = { aox_q: 40, future: true };
    const outcome = await new QuickAoxWorkflow({ scanner: h.scanner, scoring: h.scoring, wait: async () => {} }).run(options());
    expect(outcome).toMatchObject({ kind: 'unable-to-determine', parseError: { code: 'missing-score' } });
    if (outcome.kind === 'unable-to-determine') expect(outcome.rawScoringResponse).toBe(h.scoringResponse);
  });

  it('rejects concurrent runs on one workflow instance before any second-run scanner activity', async () => {
    const h = harness();
    let releaseHand!: () => void;
    const hand = new Promise<void>((resolve) => { releaseHand = resolve; });
    const workflow = new QuickAoxWorkflow({ scanner: h.scanner, scoring: h.scoring, wait: async () => {} });
    const first = workflow.run(options({ waitForBegin: () => hand }));
    await Promise.resolve();
    await Promise.resolve();
    await expect(workflow.run(options())).rejects.toBeInstanceOf(QuickAoxWorkflowConcurrentRunError);
    releaseHand();
    await first;
    expect(h.calls.filter((call) => call === 'connect')).toHaveLength(1);
    expect(h.calls.filter((call) => call === 'start')).toHaveLength(1);
  });
});

describe('QuickAoxWorkflow cancellation and failures', () => {
  it.each([
    ['UPSTREAM_INVALID_PRE_REQUEST', 'invalid-pre-request'],
    ['UPSTREAM_REPEAT_REQUIRED', 'unsupported-pre-request'],
    ['UPSTREAM_DNS_FAILURE', 'scoring-transport'],
  ] as const)('preserves sanitized diagnostic %s as %s', async (diagnosticCode, failureKind) => {
    const h = harness();
    h.preRequest = async () => { throw Object.assign(new Error('sanitized'), { diagnosticCode, status: 502, requestId: 'safe-ref' }); };
    const outcome = await new QuickAoxWorkflow({ scanner: h.scanner, scoring: h.scoring, wait: async () => {} }).run(options());
    expect(outcome).toMatchObject({
      kind: 'failed', failureKind,
      message: `Quick AOX pre-request failed: ${diagnosticCode} (reference safe-ref)`,
      diagnostic: { code: diagnosticCode, status: 502, requestId: 'safe-ref' },
    });
  });

  it.each([
    ['initial', 1],
    ['result', 2],
    ['success', 3],
  ] as const)('cancels during the APK-confirmed %s hand delay without starting measurement', async (_stage, abortOnWait) => {
    const h = harness();
    const controller = new AbortController();
    let waits = 0;
    const workflow = new QuickAoxWorkflow({
      scanner: h.scanner, scoring: h.scoring,
      wait: async () => {
        waits++;
        if (waits === abortOnWait) {
          controller.abort(`cancelled-delay-${abortOnWait}`);
          throw controller.signal.reason;
        }
      },
    });
    const outcome = await workflow.run(options({
      signal: controller.signal,
      handDetection: { initialDelayMs: 100, resultDelayMs: 500, successDelayMs: 100 },
    }));
    expect(outcome).toMatchObject({ kind: 'cancelled', phase: 'detecting-hand', physicalMeasurementStarted: false });
    expect(h.calls).not.toContain('start');
  });

  it('times out cancellable hand polling without starting a measurement', async () => {
    const h = harness();
    h.scanner.recognizeHand = async () => false;
    let now = 0;
    const workflow = new QuickAoxWorkflow({
      scanner: h.scanner, scoring: h.scoring, now: () => now,
      wait: async (milliseconds) => { now += milliseconds; },
    });
    const outcome = await workflow.run(options({ handDetection: { initialDelayMs: 0, resultDelayMs: 500, successDelayMs: 0, timeoutMs: 1_000 } }));
    expect(outcome).toMatchObject({ kind: 'failed', failureKind: 'hand-detection', phase: 'detecting-hand', physicalMeasurementStarted: false });
    expect(h.calls).not.toContain('start');
  });

  it('cancels before hand confirmation without starting or scoring', async () => {
    const h = harness();
    const controller = new AbortController();
    const outcomePromise = new QuickAoxWorkflow({ scanner: h.scanner, scoring: h.scoring }).run(options({
      signal: controller.signal,
      waitForBegin: ({ signal }) => new Promise((_, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
    }));
    await Promise.resolve();
    await Promise.resolve();
    controller.abort('user-cancelled');
    const outcome = await outcomePromise;
    expect(outcome).toMatchObject({ kind: 'cancelled', phase: 'awaiting-begin', physicalMeasurementStarted: false, reason: 'user-cancelled' });
    expect(h.calls).toEqual(['connect', 'identify', 'disconnect']);
  });

  it('reports post-start cancellation as software cancellation and sends no further operation', async () => {
    const h = harness();
    const controller = new AbortController();
    h.download = async () => {
      controller.abort('cancelled-after-start');
      throw new DOMException('Aborted', 'AbortError');
    };
    const outcome = await new QuickAoxWorkflow({ scanner: h.scanner, scoring: h.scoring }).run(options({ signal: controller.signal }));
    expect(outcome).toMatchObject({
      kind: 'cancelled', phase: 'downloading', physicalMeasurementStarted: true, reason: 'cancelled-after-start',
    });
    expect(h.calls).toEqual(['connect', 'identify', 'hand:present', 'start', 'download:42', 'disconnect']);
  });

  it('cancels during required wait and never submits', async () => {
    const h = harness();
    const controller = new AbortController();
    const workflow = new QuickAoxWorkflow({
      scanner: h.scanner,
      scoring: h.scoring,
      wait: async (_milliseconds, signal) => {
        controller.abort('cancelled-during-wait');
        throw signal?.reason;
      },
    });
    const outcome = await workflow.run(options({ signal: controller.signal }));
    expect(outcome).toMatchObject({ kind: 'cancelled', phase: 'waiting-to-submit', physicalMeasurementStarted: true });
    expect(h.calls.some((call) => call.startsWith('submit:'))).toBe(false);
    expect(h.calls.filter((call) => call === 'start')).toHaveLength(1);
  });

  it('does not identify or send another scanner operation when cancellation is observed after connect', async () => {
    const h = harness();
    const controller = new AbortController();
    h.scanner.connect = async () => {
      h.calls.push('connect');
      controller.abort('cancelled-while-connecting');
    };
    const outcome = await new QuickAoxWorkflow({ scanner: h.scanner, scoring: h.scoring }).run(options({ signal: controller.signal }));
    expect(outcome).toMatchObject({
      kind: 'cancelled',
      phase: 'connecting',
      physicalMeasurementStarted: false,
      physicalMeasurementMayHaveStarted: false,
    });
    expect(h.calls).toEqual(['connect', 'disconnect']);
  });

  it('returns typed unsupported pre-request and does not wait or submit', async () => {
    const h = harness();
    h.preRequestResponse = { recommended_server: 'https://de2.biozoom.net', waiting_time_ms: 10, new_pre_request_req: true };
    const waits: number[] = [];
    const outcome = await new QuickAoxWorkflow({
      scanner: h.scanner,
      scoring: h.scoring,
      wait: async (milliseconds) => { waits.push(milliseconds); },
    }).run(options());
    expect(outcome).toMatchObject({
      kind: 'failed',
      failureKind: 'unsupported-pre-request',
      phase: 'pre-requesting',
      preRequestError: { code: 'unsupported-repeat-pre-request' },
      physicalMeasurementStarted: true,
    });
    expect(waits).toEqual([]);
    expect(h.calls.some((call) => call.startsWith('submit:'))).toBe(false);
  });

  it('distinguishes incomplete acquisition and never contacts scoring', async () => {
    const h = harness();
    h.download = async () => artifact({
      summary: { expectedBlockCount: 2, validBlockCount: 1, missingBlockCount: 1, anomalyCount: 0, complete: false },
      failure: { kind: 'incomplete', message: 'missing one block' },
    });
    const outcome = await new QuickAoxWorkflow({ scanner: h.scanner, scoring: h.scoring }).run(options());
    expect(outcome).toMatchObject({ kind: 'failed', failureKind: 'acquisition', phase: 'downloading' });
    expect(h.calls.some((call) => call.startsWith('pre:'))).toBe(false);
    expect(h.calls.filter((call) => call === 'start')).toHaveLength(1);
  });

  it('passes the start measurement number to download and rejects mismatched acquisition evidence', async () => {
    const h = harness();
    h.download = async (measurementNumber) => artifact({ measurementNumber: measurementNumber + 1 });
    const outcome = await new QuickAoxWorkflow({ scanner: h.scanner, scoring: h.scoring }).run(options());
    expect(h.calls).toContain('download:42');
    expect(outcome).toMatchObject({ kind: 'failed', failureKind: 'acquisition' });
    expect(h.calls.some((call) => call.startsWith('pre:'))).toBe(false);
  });
});
