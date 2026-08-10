import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { BIOZOOM_M35_MEASURE_URL } from '../src/measurementSubmissionDiagnostic.js';
import { runPairedScoringCli } from '../src/pairedScoringCli.js';
import { runPairedScoringDiagnostic, type PairedScoringDiagnosticArtifact } from '../src/pairedScoringDiagnostic.js';
import { BIOZOOM_PRE_REQUEST_DIAGNOSTIC_URL } from '../src/preRequestDiagnostic.js';

const blocks = 'UNCHANGED_MEASUREMENT_35_BLOCKS';
const blocksHash = createHash('sha256').update(blocks, 'utf8').digest('hex');
const measureJson = {
  Serial: '2N2400A5B70F5E3C9251', MeasurementBlocks: blocks,
  UserID: 'ffffffffffffffffffffffffffffffff', lang: 'EN',
  AdditionalData: '{"model":"MRSRRS_SCN06","uuid":"unchanged"}',
};

function sourceArtifact(): unknown {
  return {
    action: 'OFFLINE-SCORING', error: null,
    rawAoxMeasurementArtifact: {
      scannerSerial: '2N2400A5B70F5E3C9251', measurementNumber: 35, measurementBlocks: blocks,
      summary: { complete: true, validBlockCount: 5_773, anomalyCount: 0 },
    },
    offlineScoringProposal: {
      acquisition: {
        measurementBlocksLength: { value: blocks.length },
        measurementBlocksSha256: { value: blocksHash },
      },
      measureRequest: { measureJson: { value: measureJson } },
    },
  };
}

function fixture() {
  let monotonic = 1_000;
  let saved: PairedScoringDiagnosticArtifact | undefined;
  const events: string[] = [];
  const loadSourceArtifact = vi.fn(async () => sourceArtifact());
  const executePreRequest = vi.fn(async () => {
    events.push('pre');
    return {
      initialUrl: BIOZOOM_PRE_REQUEST_DIAGNOSTIC_URL,
      finalUrl: BIOZOOM_PRE_REQUEST_DIAGNOSTIC_URL,
      method: 'GET' as const,
      status: 200,
      requestHeaders: { host: 'de2.biozoom.net' }, responseHeaders: { 'content-type': 'application/json' }, redirects: [],
      body: JSON.stringify({
        recommended_server: 'https://de2.biozoom.net', waiting_time_ms: 109,
        new_pre_request_req: false, new_pre_request_delay_ms: 0,
      }),
    };
  });
  const sleep = vi.fn(async (milliseconds: number) => {
    events.push(`sleep:${milliseconds}`);
    monotonic += milliseconds;
  });
  const executeMeasurement = vi.fn(async () => {
    events.push('measure');
    return {
      finalUrl: BIOZOOM_M35_MEASURE_URL, status: 200,
      requestHeaders: { host: 'de2.biozoom.net', 'content-type': 'multipart/form-data' },
      responseHeaders: { 'content-type': 'application/json' },
      body: JSON.stringify({ aox: 5.5, aox_q: 40, quality: 99, error_prediction: { qnn_error: 0 } }),
    };
  });
  const writeArtifact = vi.fn(async (artifact: PairedScoringDiagnosticArtifact) => {
    saved = artifact;
    return '/tmp/paired.json';
  });
  return {
    dependencies: {
      loadSourceArtifact, executePreRequest, executeMeasurement, writeArtifact, sleep,
      createBoundary: () => 'PAIREDBOUNDARY',
      now: () => new Date(1_780_000_000_000 + monotonic),
      monotonicNow: () => monotonic,
    },
    events, loadSourceArtifact, executePreRequest, executeMeasurement, writeArtifact, sleep,
    get saved() { return saved; },
  };
}

describe('paired pre-request plus unchanged measurement-35 diagnostic', () => {
  it('dry-runs without loading data or making either request', async () => {
    const current = fixture();
    const output: string[] = [];
    await expect(runPairedScoringCli([], current.dependencies, {
      stdout: (message) => output.push(message), stderr: vi.fn(),
    })).resolves.toBe(0);
    expect(current.loadSourceArtifact).not.toHaveBeenCalled();
    expect(current.executePreRequest).not.toHaveBeenCalled();
    expect(current.executeMeasurement).not.toHaveBeenCalled();
    expect(current.writeArtifact).not.toHaveBeenCalled();
    expect(output.join('\n')).toContain('no network request was made');
  });

  it('rejects unsupported and duplicate arguments before any request', async () => {
    for (const args of [['--server', 'https://example.test'], ['--execute', '--execute']]) {
      const current = fixture();
      await expect(runPairedScoringCli(args, current.dependencies, {
        stdout: vi.fn(), stderr: vi.fn(),
      })).resolves.toBe(2);
      expect(current.executePreRequest).not.toHaveBeenCalled();
      expect(current.executeMeasurement).not.toHaveBeenCalled();
    }
  });

  it('performs one pre-request, waits at least the server duration, then posts the unchanged payload once', async () => {
    const current = fixture();
    const result = await runPairedScoringDiagnostic(current.dependencies);

    expect(current.executePreRequest).toHaveBeenCalledTimes(1);
    expect(current.executePreRequest).toHaveBeenCalledWith(BIOZOOM_PRE_REQUEST_DIAGNOSTIC_URL);
    expect(current.sleep).toHaveBeenCalledWith(109);
    expect(current.executeMeasurement).toHaveBeenCalledTimes(1);
    expect(current.events).toEqual(['pre', 'sleep:109', 'measure']);
    const submitted = current.executeMeasurement.mock.calls[0]?.[0];
    expect(submitted?.url).toBe(BIOZOOM_M35_MEASURE_URL);
    expect(submitted?.measureJson).toEqual(measureJson);
    expect(submitted?.measurementBlocksSha256).toBe(blocksHash);
    expect(result.artifact.timing?.actualPreRequestCompletionToMeasurementStartMs).toBeGreaterThanOrEqual(109);
    expect(result.artifact.measurementRequest).toMatchObject({ retryCount: 0, redirectsFollowed: false });
    expect(result.artifact.measurementResponse).toMatchObject({ status: 200, aox: 5.5, aoxQ: 40 });
  });

  it('does not POST or repeat GET when pre-request fails or asks for another pre-request', async () => {
    for (const mode of ['http', 'repeat'] as const) {
      const current = fixture();
      current.executePreRequest.mockImplementationOnce(async () => ({
        initialUrl: BIOZOOM_PRE_REQUEST_DIAGNOSTIC_URL, finalUrl: BIOZOOM_PRE_REQUEST_DIAGNOSTIC_URL,
        method: 'GET', status: mode === 'http' ? 500 : 200,
        requestHeaders: {}, responseHeaders: {}, redirects: [],
        body: mode === 'http' ? '{}' : JSON.stringify({
          recommended_server: 'https://de2.biozoom.net', waiting_time_ms: 109, new_pre_request_req: true,
        }),
      }));
      await expect(runPairedScoringDiagnostic(current.dependencies)).rejects.toThrow();
      expect(current.executePreRequest).toHaveBeenCalledTimes(1);
      expect(current.executeMeasurement).not.toHaveBeenCalled();
    }
  });

  it('does not retry a failed measurement POST and preserves the failure artifact', async () => {
    const current = fixture();
    current.executeMeasurement.mockRejectedValueOnce(new Error('mock POST failure'));
    await expect(runPairedScoringDiagnostic(current.dependencies)).rejects.toThrow('mock POST failure');
    expect(current.executePreRequest).toHaveBeenCalledTimes(1);
    expect(current.executeMeasurement).toHaveBeenCalledTimes(1);
    expect(current.writeArtifact).toHaveBeenCalledTimes(1);
    expect(current.saved?.measurementRequest?.measureJson).toEqual(measureJson);
    expect(current.saved?.error).toMatchObject({ message: 'mock POST failure' });
  });

  it('does not print MeasurementBlocks during executed output', async () => {
    const current = fixture();
    const output: string[] = [];
    await expect(runPairedScoringCli(['--execute'], current.dependencies, {
      stdout: (message) => output.push(message), stderr: vi.fn(),
    })).resolves.toBe(0);
    expect(output.join('\n')).not.toContain(blocks);
    expect(output.join('\n')).toContain(`<omitted from console; ${blocks.length} characters>`);
  });
});
