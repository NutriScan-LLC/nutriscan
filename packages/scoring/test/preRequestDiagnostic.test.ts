import { describe, expect, it, vi } from 'vitest';
import {
  BIOZOOM_PRE_REQUEST_DIAGNOSTIC_URL,
  runBioZoomPreRequestDiagnostic,
  type BioZoomPreRequestDiagnosticArtifact,
  type PreRequestHttpObservation,
} from '../src/preRequestDiagnostic.js';
import { runPreRequestCli } from '../src/preRequestCli.js';

const responseBody = JSON.stringify({
  recommended_server: 'https://recommended.example',
  waiting_time_ms: 1234,
  new_pre_request_req: false,
  new_pre_request_delay_ms: 100,
  license_status: 'valid',
  nested: { error_code: null },
});

function httpObservation(): PreRequestHttpObservation {
  return {
    initialUrl: BIOZOOM_PRE_REQUEST_DIAGNOSTIC_URL,
    finalUrl: 'https://de2.biozoom.net/pre-request/final',
    method: 'GET',
    status: 200,
    requestHeaders: { host: 'de2.biozoom.net' },
    responseHeaders: { 'content-type': 'application/json', 'set-cookie': ['session=private; Secure'] },
    redirects: [{
      status: 302,
      fromUrl: BIOZOOM_PRE_REQUEST_DIAGNOSTIC_URL,
      location: '/pre-request/final',
      resolvedUrl: 'https://de2.biozoom.net/pre-request/final',
    }],
    body: responseBody,
  };
}

function dependencies() {
  let saved: BioZoomPreRequestDiagnosticArtifact | undefined;
  const executeHttp = vi.fn().mockResolvedValue(httpObservation());
  const writeArtifact = vi.fn(async (artifact: BioZoomPreRequestDiagnosticArtifact) => {
    saved = artifact;
    return '/tmp/pre-request.json';
  });
  return {
    dependencies: {
      executeHttp,
      writeArtifact,
      now: () => new Date('2026-08-09T15:00:00.000Z'),
    },
    executeHttp,
    writeArtifact,
    get saved() { return saved; },
  };
}

describe('permissioned BioZoom pre-request-only diagnostic', () => {
  it('dry-runs without invoking HTTP or writing an artifact', async () => {
    const fixture = dependencies();
    const output: string[] = [];

    await expect(runPreRequestCli([], fixture.dependencies, {
      stdout: (message) => output.push(message), stderr: vi.fn(),
    })).resolves.toBe(0);

    expect(fixture.executeHttp).not.toHaveBeenCalled();
    expect(fixture.writeArtifact).not.toHaveBeenCalled();
    expect(output[0]).toContain('No network request was made');
    expect(output[0]).toContain(BIOZOOM_PRE_REQUEST_DIAGNOSTIC_URL);
  });

  it('rejects unsupported and duplicate options before HTTP', async () => {
    for (const args of [['--url', 'https://example.test'], ['--execute', '--execute']]) {
      const fixture = dependencies();
      await expect(runPreRequestCli(args, fixture.dependencies, {
        stdout: vi.fn(), stderr: vi.fn(),
      })).resolves.toBe(2);
      expect(fixture.executeHttp).not.toHaveBeenCalled();
    }
  });

  it('executes exactly once at the fixed URL and captures the complete response', async () => {
    const fixture = dependencies();

    const result = await runBioZoomPreRequestDiagnostic(fixture.dependencies);

    expect(fixture.executeHttp).toHaveBeenCalledTimes(1);
    expect(fixture.executeHttp).toHaveBeenCalledWith(BIOZOOM_PRE_REQUEST_DIAGNOSTIC_URL);
    expect(result.artifact.intendedRequest).toEqual({
      method: 'GET', url: BIOZOOM_PRE_REQUEST_DIAGNOSTIC_URL, body: null, applicationHeaders: {}, retryCount: 0,
    });
    expect(result.artifact.observation).toMatchObject({
      finalUrl: 'https://de2.biozoom.net/pre-request/final', status: 200,
      body: responseBody, recommendedServer: 'https://recommended.example', waitingTimeMs: 1234,
      newPreRequestReq: false, newPreRequestDelayMs: 100,
      cookieHeaderPresent: false, authorizationHeaderPresent: false, setsCookies: true,
      licenseAndErrorFields: { license_status: 'valid', 'nested.error_code': null },
    });
    expect(result.artifact.observation?.parsedJson).toEqual(JSON.parse(responseBody));
    expect(result.artifact.observation?.responseHeaders['set-cookie']).toEqual(['[REDACTED]']);
    expect(result.artifact.observation?.redirects).toHaveLength(1);
  });

  it('does not retry failures and still saves the error artifact', async () => {
    const fixture = dependencies();
    fixture.executeHttp.mockRejectedValue(new Error('mock timeout'));

    await expect(runBioZoomPreRequestDiagnostic(fixture.dependencies)).rejects.toThrow('mock timeout');

    expect(fixture.executeHttp).toHaveBeenCalledTimes(1);
    expect(fixture.writeArtifact).toHaveBeenCalledTimes(1);
    expect(fixture.saved?.observation).toBeNull();
    expect(fixture.saved?.error).toMatchObject({ name: 'Error', message: 'mock timeout' });
  });
});
