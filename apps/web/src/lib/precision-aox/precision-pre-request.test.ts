import { afterEach, describe, expect, it, vi } from "vitest";
import { NutriScanPrecisionPreRequestGateway } from "./browser-pre-request";
import {
  buildPrecisionAoxPreRequestUrl,
  createPrecisionAoxPreRequestGateway,
} from "./server-pre-request";
import { buildPrecisionAoxScoringRequest } from "@nutriscan/scoring/quick-aox";
import { createPrecisionAoxServerGateway } from "./server-gateway";

const successfulFixture = {
  new_pre_request_req: false,
  waiting_time_ms: 101,
  new_pre_request_delay_ms: 0,
  recommended_server: "https://de2.biozoom.net",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Precision AOX pre-request-only diagnostic", () => {
  it("constructs exactly the APK-confirmed measure_type=1 URL", () => {
    expect(buildPrecisionAoxPreRequestUrl("https://de2.biozoom.net/", "SERIAL /1")).toBe(
      "https://de2.biozoom.net/pre-request/?serial_id=SERIAL%20%2F1&measure_type=1",
    );
  });

  it("performs one GET without headers, MeasurementBlocks, submission, or retries", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      ...successfulFixture,
      private_future_field: "must-not-cross-server-boundary",
    }));
    const gateway = createPrecisionAoxPreRequestGateway({
      preRequestBaseUrl: "https://de2.biozoom.net",
      fetchImplementation,
    });

    await expect(gateway.preRequest({ scannerSerial: "2N2400A5B70F5E3C9251" })).resolves.toEqual(successfulFixture);
    expect(fetchImplementation).toHaveBeenCalledOnce();
    const [url, init] = fetchImplementation.mock.calls[0]!;
    expect(url).toBe("https://de2.biozoom.net/pre-request/?serial_id=2N2400A5B70F5E3C9251&measure_type=1");
    expect(init).toMatchObject({ method: "GET", cache: "no-store" });
    expect(init).not.toHaveProperty("body");
    expect(init).not.toHaveProperty("headers");
    expect(String(url)).not.toContain("MeasurementBlocks");
  });

  it("rejects malformed diagnostic-only fields instead of returning upstream evidence", async () => {
    const gateway = createPrecisionAoxPreRequestGateway({
      preRequestBaseUrl: "https://de2.biozoom.net",
      requestId: "safe-reference",
      fetchImplementation: vi.fn<typeof fetch>().mockResolvedValue(Response.json({
        ...successfulFixture,
        new_pre_request_delay_ms: { private: "upstream evidence" },
      })),
    });

    await expect(gateway.preRequest({ scannerSerial: "SERIAL-1" })).rejects.toMatchObject({
      diagnosticCode: "UPSTREAM_INVALID_PRE_REQUEST",
      requestId: "safe-reference",
    });
  });

  it("returns a sanitized HTTP diagnostic after one failed request", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(new Response("private", { status: 503 }));
    const gateway = createPrecisionAoxPreRequestGateway({
      preRequestBaseUrl: "https://de2.biozoom.net",
      requestId: "safe-reference",
      fetchImplementation,
    });

    await expect(gateway.preRequest({ scannerSerial: "SERIAL-1" })).rejects.toMatchObject({
      diagnosticCode: "UPSTREAM_HTTP_ERROR",
      status: 502,
      upstreamStatus: 503,
      requestId: "safe-reference",
    });
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it("uses the proven 2,000 ms timeout without retrying", async () => {
    vi.useFakeTimers();
    const fetchImplementation = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    const gateway = createPrecisionAoxPreRequestGateway({
      preRequestBaseUrl: "https://de2.biozoom.net",
      requestId: "safe-reference",
      fetchImplementation,
    });
    const pending = gateway.preRequest({ scannerSerial: "SERIAL-1" });
    const assertion = expect(pending).rejects.toMatchObject({ diagnosticCode: "UPSTREAM_TIMEOUT", status: 504 });
    await vi.advanceTimersByTimeAsync(2_000);
    await assertion;
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it("routes the browser request only through the NutriScan Precision endpoint", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(Response.json(successfulFixture));
    const gateway = new NutriScanPrecisionPreRequestGateway(fetchImplementation);

    await expect(gateway.preRequest({ scannerSerial: "PRIVATE-SERIAL" })).resolves.toEqual(successfulFixture);
    expect(fetchImplementation).toHaveBeenCalledOnce();
    const [url, init] = fetchImplementation.mock.calls[0]!;
    expect(url).toBe("/api/precision-aox/pre-request");
    expect(init?.body).toBe(JSON.stringify({ scannerSerial: "PRIVATE-SERIAL" }));
    expect(String(init?.body)).not.toContain("MeasurementBlocks");
  });

  it("routes final submission through NutriScan with empty MeasurementBlocks and receiver-safe fetch", async () => {
    const request = precisionRequest();
    const fetchImplementation = vi.fn(function (this: unknown, _url: RequestInfo | URL, _init?: RequestInit) {
      void _url;
      void _init;
      expect(this).toBe(globalThis);
      return Promise.resolve(Response.json({ precise_aox: 5.1 }));
    }) as typeof fetch;
    const gateway = new NutriScanPrecisionPreRequestGateway(fetchImplementation);
    await gateway.submit({ scannerSerial: "2NTEST", recommendedServer: "https://de2.biozoom.net", scoringRequest: request });
    const [url, init] = vi.mocked(fetchImplementation).mock.calls[0]!;
    expect(url).toBe('/api/precision-aox/submit');
    const browserBody = JSON.parse(String(init?.body));
    expect(browserBody.scoringRequest.measureJson.MeasurementBlocks).toBe('');
    expect(String(init?.body)).not.toContain('official-shaped-payload');
  });

  it("server submission uses one measure_type=1 multipart request and validates the response", async () => {
    const upstreamFetch = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      precise_aox: 5.1, precise_aox_std: 0.2, precise_quality_result: 999,
    }));
    const gateway = createPrecisionAoxServerGateway({
      preRequestBaseUrl: 'https://de2.biozoom.net', requestId: 'safe-reference', fetchImplementation: upstreamFetch,
    });
    await expect(gateway.submit({
      scannerSerial: '2NTEST', recommendedServer: 'https://de2.biozoom.net', scoringRequest: precisionRequest(),
    })).resolves.toMatchObject({ precise_aox: 5.1 });
    expect(upstreamFetch).toHaveBeenCalledOnce();
    const [url, init] = upstreamFetch.mock.calls[0]!;
    expect(url).toBe('https://de2.biozoom.net/measure/?serial_id=2NTEST&measure_type=1');
    expect(init?.method).toBe('POST');
    const form = init?.body as FormData;
    const file = form.get('measure_json') as File;
    const sent = JSON.parse(await file.text());
    expect(sent.MeasurementBlocks).toBe('');
  });

  it("server submission returns sanitized diagnostics for non-JSON and invalid Precision responses without retry", async () => {
    for (const [response, diagnosticCode] of [
      [new Response('private body', { status: 200 }), 'UPSTREAM_NON_JSON'],
      [Response.json({ precise_aox: 'private-invalid' }), 'UPSTREAM_INVALID_PRECISION_RESPONSE'],
    ] as const) {
      const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(response);
      const gateway = createPrecisionAoxServerGateway({ preRequestBaseUrl: 'https://de2.biozoom.net', requestId: 'safe-reference', fetchImplementation });
      await expect(gateway.submit({ scannerSerial: '2NTEST', recommendedServer: 'https://de2.biozoom.net', scoringRequest: precisionRequest() }))
        .rejects.toMatchObject({ diagnosticCode, requestId: 'safe-reference' });
      expect(fetchImplementation).toHaveBeenCalledOnce();
    }
  });
});

function precisionRequest() {
  return buildPrecisionAoxScoringRequest({
    scannerSerial: '2NTEST', language: 'EN', requestUuid: '20000000-0000-4000-8000-000000000000', expectedMeasurementCount: 4,
    series: [1, 2, 3, 4].map((value) => ({
      normalizedAox: value, aoxQ: 40, responseUuid: `10000000-0000-4000-8000-00000000000${value}`,
    })),
  });
}
