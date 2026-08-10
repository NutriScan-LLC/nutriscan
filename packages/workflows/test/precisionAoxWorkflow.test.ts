import { describe, expect, it, vi } from 'vitest';
import type { QuickAoxWorkflowOptions, QuickAoxWorkflowOutcome } from '../src/quickAoxWorkflow.js';
import { PrecisionAoxWorkflow } from '../src/precisionAoxWorkflow.js';

const serial = '2NTEST';
const finalUuid = '90000000-0000-4000-8000-000000000000';
const responseUuids = [1, 2, 3, 4, 5].map((n) => `10000000-0000-4000-8000-00000000000${n}`);

function quickOutcome(index: number, kind: 'accepted' | 'rescan-required' = 'accepted'): QuickAoxWorkflowOutcome {
  const raw = { aox: index + 1, aox_q: kind === 'accepted' ? 40 : 50, uuid: responseUuids[index], error_prediction: { qnn_error: index } };
  return {
    kind, score: index + 1,
    identity: { serial, protocolVersion: 'v2', commandUsed: 'get_status', response: {} as never },
    measurementStart: { measurementNumber: index + 1, type: 'aox', acknowledgedAt: new Date().toISOString(), response: {} as never },
    acquisition: { summary: { complete: true, validBlockCount: 5773 }, blocks: Array(5773) } as never,
    scoringRequest: {} as never, preRequest: {} as never, rawScoringResponse: raw,
    result: {
      score: index + 1, qualityCode: raw.aox_q, qualityCodeState: 'valid', rawQualityCode: raw.aox_q,
      diagnostics: raw.error_prediction, diagnosticsPresent: true, rawResponse: raw,
      decision: { qualityCode: raw.aox_q, qualityCodeState: 'valid', accepted: kind === 'accepted', action: kind === 'accepted' ? 'accept' : 'rescan', reason: kind === 'accepted' ? null : 'surrounding-light-or-incomplete-coverage', recognizedCode: true, policyName: 'test' },
    },
  } as QuickAoxWorkflowOutcome;
}

function harness(outcomes: QuickAoxWorkflowOutcome[] = [0, 1, 2, 3].map((n) => quickOutcome(n))) {
  const run = vi.fn(async (options: QuickAoxWorkflowOptions) => {
    await options.waitForBegin({ identity: { serial } as never, ...(options.signal ? { signal: options.signal } : {}) });
    const next = outcomes.shift()!;
    if ('measurementStart' in next && next.measurementStart) {
      options.onProgress?.({ state: 'measurement-started', measurementNumber: next.measurementStart.measurementNumber });
      options.onProgress?.({ state: 'downloading', validBlocks: 5773, expectedBlocks: 5773, missingBlocks: 0, readCount: 40 });
    }
    return next;
  });
  const preRequest = vi.fn().mockResolvedValue({ recommended_server: 'https://de2.biozoom.net', waiting_time_ms: 101, new_pre_request_req: false });
  const submit = vi.fn().mockResolvedValue({ precise_aox: 5.2, precise_quality_hand: 77, precise_quality_result: 88 });
  const wait = vi.fn().mockResolvedValue(undefined);
  const workflow = new PrecisionAoxWorkflow({ quick: { run }, scoring: { preRequest, submit }, wait });
  let uuidCall = 0;
  const options = {
    language: 'EN', createUuid: () => uuidCall++ < 4 ? `40000000-0000-4000-8000-00000000000${uuidCall}` : finalUuid,
    waitForMeasurementBegin: vi.fn().mockResolvedValue(undefined),
    waitForReplacement: vi.fn().mockResolvedValue('replace' as const),
    onProgress: vi.fn(),
  };
  return { workflow, run, preRequest, submit, wait, options };
}

describe('PrecisionAoxWorkflow', () => {
  it('runs exactly four planned Quick scans by default, retaining ordered 5,773-block results', async () => {
    const h = harness();
    const outcome = await h.workflow.run(h.options);
    expect(outcome.kind).toBe('accepted');
    expect(h.run).toHaveBeenCalledTimes(4);
    expect(h.options.waitForMeasurementBegin).toHaveBeenCalledTimes(4);
    expect(h.run.mock.calls.every(([options]) => options.disconnectOnFinish === false)).toBe(true);
    expect(outcome.retainedSeries.map((entry) => entry.responseUuid)).toEqual(responseUuids.slice(0, 4));
    const starts = vi.mocked(h.options.onProgress).mock.calls.map(([event]) => event).filter((event) => event.state === 'constituent-progress' && event.event.state === 'measurement-started');
    const fullDownloads = vi.mocked(h.options.onProgress).mock.calls.map(([event]) => event).filter((event) => event.state === 'constituent-progress' && event.event.state === 'downloading' && event.event.validBlocks === 5773);
    expect(starts).toHaveLength(4);
    expect(fullDownloads).toHaveLength(4);
  });

  it('Quick-scores every constituent and uses measure_type=1 only for the final merge', async () => {
    const h = harness();
    await h.workflow.run(h.options);
    expect(h.run).toHaveBeenCalledTimes(4);
    expect(h.preRequest).toHaveBeenCalledOnce();
    expect(h.submit).toHaveBeenCalledOnce();
    const request = h.submit.mock.calls[0]![0].scoringRequest;
    expect(request.measureType).toBe(1);
    expect(request.measureJson.MeasurementBlocks).toBe('');
    expect(JSON.parse(request.measureJson.AdditionalData).series_uuid).toEqual(responseUuids.slice(0, 4));
  });

  it('does not advance a rejected measurement until replacement is explicitly authorized', async () => {
    let release!: (value: 'replace') => void;
    const replacement = new Promise<'replace'>((resolve) => { release = resolve; });
    const h = harness([quickOutcome(0, 'rescan-required'), quickOutcome(1), quickOutcome(2), quickOutcome(3), quickOutcome(4)]);
    h.options.waitForReplacement.mockReturnValueOnce(replacement);
    const pending = h.workflow.run(h.options);
    await vi.waitFor(() => expect(h.options.waitForReplacement).toHaveBeenCalledOnce());
    expect(h.run).toHaveBeenCalledTimes(1);
    release('replace');
    const outcome = await pending;
    expect(h.run).toHaveBeenCalledTimes(5);
    expect(outcome.kind).toBe('accepted');
    expect(outcome.discardedUuids).toEqual([responseUuids[0]]);
    expect(outcome.retainedSeries.map((entry) => entry.responseUuid)).toEqual(responseUuids.slice(1, 5));
  });

  it('cancels without automatic replacement when the user declines', async () => {
    const h = harness([quickOutcome(0, 'rescan-required')]);
    h.options.waitForReplacement.mockResolvedValueOnce('cancel');
    const outcome = await h.workflow.run(h.options);
    expect(outcome.kind).toBe('cancelled');
    expect(h.run).toHaveBeenCalledOnce();
    expect(h.preRequest).not.toHaveBeenCalled();
  });

  it('preserves cancellation before and during a constituent Quick workflow', async () => {
    const before = harness();
    const alreadyAborted = new AbortController();
    alreadyAborted.abort('before-start');
    const beforeOutcome = await before.workflow.run({ ...before.options, signal: alreadyAborted.signal });
    expect(beforeOutcome.kind).toBe('cancelled');
    expect(before.run).not.toHaveBeenCalled();

    const cancelledQuick = {
      kind: 'cancelled', phase: 'detecting-hand', physicalMeasurementStarted: false,
      physicalMeasurementMayHaveStarted: false, reason: 'during-constituent',
    } as QuickAoxWorkflowOutcome;
    const during = harness([cancelledQuick]);
    const duringOutcome = await during.workflow.run(during.options);
    expect(duringOutcome.kind).toBe('cancelled');
    expect(during.preRequest).not.toHaveBeenCalled();
  });

  it.each(['pre-request', 'required wait', 'submission'])(
    'preserves cancellation during final %s without retry',
    async (stage) => {
      const controller = new AbortController();
      const h = harness();
      if (stage === 'pre-request') h.preRequest.mockImplementation(async () => { controller.abort('cancel-pre'); throw new DOMException('Aborted', 'AbortError'); });
      if (stage === 'required wait') h.wait.mockImplementation(async () => { controller.abort('cancel-wait'); throw new DOMException('Aborted', 'AbortError'); });
      if (stage === 'submission') h.submit.mockImplementation(async () => { controller.abort('cancel-submit'); throw new DOMException('Aborted', 'AbortError'); });
      const outcome = await h.workflow.run({ ...h.options, signal: controller.signal });
      expect(outcome.kind).toBe('cancelled');
      expect(h.preRequest).toHaveBeenCalledTimes(1);
      expect(h.submit.mock.calls.length).toBeLessThanOrEqual(1);
    },
  );

  it('fails rather than merging when accepted Quick evidence lacks its response UUID', async () => {
    const broken = quickOutcome(0) as Extract<QuickAoxWorkflowOutcome, { kind: 'accepted' }>;
    (broken.rawScoringResponse as Record<string, unknown>).uuid = undefined;
    const h = harness([broken]);
    const outcome = await h.workflow.run(h.options);
    expect(outcome.kind).toBe('failed');
    expect(h.preRequest).not.toHaveBeenCalled();
  });

  it('has no scanner-command surface and delegates constituent work only to QuickAoxWorkflow.run', async () => {
    const h = harness();
    const accessed: PropertyKey[] = [];
    const quick = new Proxy({ run: h.run }, {
      get(target, property, receiver) {
        accessed.push(property);
        return Reflect.get(target, property, receiver);
      },
    });
    const workflow = new PrecisionAoxWorkflow({
      quick,
      scoring: { preRequest: h.preRequest, submit: h.submit },
      wait: h.wait,
    });
    await workflow.run(h.options);
    expect(new Set(accessed)).toEqual(new Set(['run']));
  });
});
