import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  BIOZOOM_M35_MEASURE_URL,
  prepareM35Submission,
  runM35MeasurementSubmissionDiagnostic,
  type BioZoomMeasurementSubmissionArtifact,
  type MeasurementSubmissionHttpObservation,
} from '../src/measurementSubmissionDiagnostic.js';
import { runMeasurementSubmissionCli } from '../src/measurementSubmissionCli.js';

const measurementBlocks = 'SECRET_MEASUREMENT_BLOCKS_VALUE';
const hash = createHash('sha256').update(measurementBlocks, 'utf8').digest('hex');

function sourceArtifact(): unknown {
  return {
    action: 'OFFLINE-SCORING', error: null,
    rawAoxMeasurementArtifact: {
      scannerSerial: '2N2400A5B70F5E3C9251', measurementNumber: 35,
      measurementBlocks,
      summary: { complete: true, validBlockCount: 5_773, anomalyCount: 0 },
    },
    offlineScoringProposal: {
      acquisition: {
        measurementBlocksLength: { value: measurementBlocks.length },
        measurementBlocksSha256: { value: hash },
      },
      measureRequest: { measureJson: { value: {
        Serial: '2N2400A5B70F5E3C9251', MeasurementBlocks: measurementBlocks,
        UserID: 'ffffffffffffffffffffffffffffffff', lang: 'EN',
        AdditionalData: '{"measurement_type":"aox"}',
      } } },
    },
  };
}

function response(): MeasurementSubmissionHttpObservation {
  return {
    finalUrl: BIOZOOM_M35_MEASURE_URL,
    status: 200,
    requestHeaders: {
      host: 'de2.biozoom.net',
      'content-type': 'multipart/form-data; boundary=TESTBOUNDARY',
      'content-length': '999',
    },
    responseHeaders: { 'content-type': 'application/json', 'set-cookie': 'private=value' },
    body: JSON.stringify({
      aox: 5.5, aox_q: 40, quality: 'good',
      error_prediction: { qnn_error: 0, positional_error_scaled: 0.1 },
    }),
  };
}

function fixture() {
  let saved: BioZoomMeasurementSubmissionArtifact | undefined;
  const loadSourceArtifact = vi.fn().mockResolvedValue(sourceArtifact());
  const executeHttp = vi.fn().mockResolvedValue(response());
  const writeArtifact = vi.fn(async (artifact: BioZoomMeasurementSubmissionArtifact) => {
    saved = artifact;
    return '/tmp/m35-submission.json';
  });
  return {
    dependencies: {
      loadSourceArtifact, executeHttp, writeArtifact,
      createBoundary: () => 'TESTBOUNDARY',
      now: () => new Date('2026-08-09T16:00:00.000Z'),
    },
    loadSourceArtifact, executeHttp, writeArtifact,
    get saved() { return saved; },
  };
}

describe('measurement-35 single-submission diagnostic', () => {
  it('constructs exactly one multipart measure_json part from the saved proposal', () => {
    const prepared = prepareM35Submission(sourceArtifact(), 'TESTBOUNDARY');
    const body = Buffer.from(prepared.body).toString('utf8');

    expect(prepared.url).toBe(BIOZOOM_M35_MEASURE_URL);
    expect(prepared.method).toBe('POST');
    expect(prepared.multipart).toMatchObject({
      partCount: 1, fieldName: 'measure_json', filename: 'measure.json', contentType: 'application/json',
    });
    expect(body.match(/Content-Disposition:/g)).toHaveLength(1);
    expect(body).toContain('name="measure_json"; filename="measure.json"');
    expect(body).toContain('Content-Type: application/json');
    expect(body).toContain(`"MeasurementBlocks":"${measurementBlocks}"`);
    expect(prepared.headers['Content-Length']).toBe(String(Buffer.byteLength(body)));
    expect(prepared.measurementBlocksSha256).toBe(hash);
  });

  it('dry-runs without loading the source artifact, HTTP, or artifact writes', async () => {
    const current = fixture();
    const output: string[] = [];

    await expect(runMeasurementSubmissionCli([], current.dependencies, {
      stdout: (message) => output.push(message), stderr: vi.fn(),
    })).resolves.toBe(0);

    expect(current.loadSourceArtifact).not.toHaveBeenCalled();
    expect(current.executeHttp).not.toHaveBeenCalled();
    expect(current.writeArtifact).not.toHaveBeenCalled();
    expect(output.join('\n')).toContain('no network request was made');
  });

  it('rejects unsupported or duplicate arguments before HTTP', async () => {
    for (const args of [['--artifact', '/tmp/other'], ['--execute', '--execute']]) {
      const current = fixture();
      await expect(runMeasurementSubmissionCli(args, current.dependencies, {
        stdout: vi.fn(), stderr: vi.fn(),
      })).resolves.toBe(2);
      expect(current.loadSourceArtifact).not.toHaveBeenCalled();
      expect(current.executeHttp).not.toHaveBeenCalled();
    }
  });

  it('submits once, captures scoring fields, redacts cookies, and omits blocks from console', async () => {
    const current = fixture();
    const output: string[] = [];

    await expect(runMeasurementSubmissionCli(['--execute'], current.dependencies, {
      stdout: (message) => output.push(message), stderr: vi.fn(),
    })).resolves.toBe(0);

    expect(current.executeHttp).toHaveBeenCalledTimes(1);
    expect(current.executeHttp).toHaveBeenCalledWith(expect.objectContaining({
      url: BIOZOOM_M35_MEASURE_URL, method: 'POST', measurementBlocksLength: measurementBlocks.length,
    }));
    expect(current.saved?.observation).toMatchObject({
      status: 200, aox: 5.5, aoxQ: 40,
      cookieHeaderPresent: false, authorizationHeaderPresent: false, setsCookies: true,
      qualityAndErrorFields: {
        quality: 'good',
        error_prediction: { qnn_error: 0, positional_error_scaled: 0.1 },
        'error_prediction.qnn_error': 0,
        'error_prediction.positional_error_scaled': 0.1,
      },
    });
    expect(current.saved?.observation?.responseHeaders['set-cookie']).toBe('[REDACTED]');
    expect(current.saved?.request?.measureJson.MeasurementBlocks).toBe(measurementBlocks);
    expect(output.join('\n')).not.toContain(measurementBlocks);
    expect(output.join('\n')).toContain(`<omitted from console; ${measurementBlocks.length} characters>`);
  });

  it('does not retry a failed submission and saves the failure artifact', async () => {
    const current = fixture();
    current.executeHttp.mockRejectedValue(new Error('mock network failure'));

    await expect(runM35MeasurementSubmissionDiagnostic(current.dependencies)).rejects.toThrow('mock network failure');

    expect(current.executeHttp).toHaveBeenCalledTimes(1);
    expect(current.writeArtifact).toHaveBeenCalledTimes(1);
    expect(current.saved?.observation).toBeNull();
    expect(current.saved?.error).toMatchObject({ message: 'mock network failure' });
  });
});
