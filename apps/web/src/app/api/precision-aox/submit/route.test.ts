import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPrecisionAoxScoringRequest } from '@nutriscan/scoring/quick-aox';
import { POST } from './route';

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  process.env.BIOZOOM_QUICK_AOX_BASE_URL = 'https://de2.biozoom.net';
});
afterEach(() => { vi.unstubAllGlobals(); delete process.env.BIOZOOM_QUICK_AOX_BASE_URL; });

describe('Precision AOX submission route', () => {
  it('submits once and logs only safe correlation metadata', async () => {
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ precise_aox: 5.4, precise_quality_hand: 17 }));
    vi.stubGlobal('fetch', upstream);
    const scoringRequest = requestFixture();
    const response = await POST(new Request('https://nutriscan.example/api/precision-aox/submit', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-NutriScan-Client-Request-Id': '123e4567-e89b-42d3-a456-426614174000' },
      body: JSON.stringify({ scannerSerial: '2NTEST', recommendedServer: 'https://de2.biozoom.net', scoringRequest }),
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ precise_aox: 5.4 });
    expect(upstream).toHaveBeenCalledOnce();
    const log = String(vi.mocked(console.info).mock.calls[0]?.[0]);
    expect(log).toContain('precision_aox_submission_succeeded');
    expect(log).toContain('123e4567-e89b-42d3-a456-426614174000');
    expect(log).not.toContain('2NTEST');
    expect(log).not.toContain('series_results');
  });

  it('rejects any non-empty MeasurementBlocks before upstream fetch', async () => {
    const upstream = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', upstream);
    const scoringRequest = requestFixture() as unknown as { measureJson: { MeasurementBlocks: string } };
    scoringRequest.measureJson.MeasurementBlocks = 'private-blocks';
    const response = await POST(new Request('https://nutriscan.example/api/precision-aox/submit', {
      method: 'POST', body: JSON.stringify({ scannerSerial: '2NTEST', recommendedServer: 'https://de2.biozoom.net', scoringRequest }),
    }));
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain('private-blocks');
    expect(upstream).not.toHaveBeenCalled();
  });
});

function requestFixture() {
  return buildPrecisionAoxScoringRequest({
    scannerSerial: '2NTEST', language: 'EN', requestUuid: '20000000-0000-4000-8000-000000000000', expectedMeasurementCount: 4,
    series: [1, 2, 3, 4].map((value) => ({ normalizedAox: value, aoxQ: 40, responseUuid: `10000000-0000-4000-8000-00000000000${value}` })),
  });
}
