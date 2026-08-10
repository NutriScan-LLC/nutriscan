import { afterEach, describe, expect, it, vi } from "vitest";
import type { QuickAoxScoringRequest } from "@nutriscan/scoring/quick-aox";
import { createQuickAoxServerGateway } from "./server-gateway";

const successfulPreRequest = {
  new_pre_request_req: false,
  waiting_time_ms: 109,
  new_pre_request_delay_ms: 0,
  recommended_server: "https://de2.biozoom.net",
};

afterEach(() => vi.useRealTimers());

const scoringRequest: QuickAoxScoringRequest = {
  scannerSerial: "SERIAL-1",
  measurementNumber: 42,
  measurementBlocks: "BLOCKS",
  measureJson: {
    Serial: "SERIAL-1",
    MeasurementBlocks: "BLOCKS",
    UserID: "ffffffffffffffffffffffffffffffff",
    lang: "en",
    AdditionalData: "{}",
  },
};

describe("Quick AOX server gateway", () => {
  it("performs the confirmed pre-request without credentials or custom headers", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(successfulPreRequest),
    );
    const gateway = createQuickAoxServerGateway({
      preRequestBaseUrl: "https://pre.example/",
      fetchImplementation,
    });

    await expect(gateway.preRequest({ scannerSerial: "SERIAL /1" })).resolves.toEqual(successfulPreRequest);
    expect(fetchImplementation).toHaveBeenCalledOnce();
    const [url, init] = fetchImplementation.mock.calls[0]!;
    expect(url).toBe("https://pre.example/pre-request/?serial_id=SERIAL%20%2F1&measure_type=0");
    expect(init).toMatchObject({ method: "GET", cache: "no-store" });
    expect(init).not.toHaveProperty("headers");
  });

  it("submits exactly one generated multipart measure_json part", async () => {
    const raw = { aox: 73, aox_q: 40, extra: "preserved" };
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(Response.json(raw));
    const gateway = createQuickAoxServerGateway({
      preRequestBaseUrl: "https://pre.example",
      fetchImplementation,
    });

    await expect(gateway.submit({
      scannerSerial: "SERIAL-1",
      recommendedServer: "https://score.example/",
      scoringRequest,
    })).resolves.toEqual(raw);

    expect(fetchImplementation).toHaveBeenCalledOnce();
    const [url, init] = fetchImplementation.mock.calls[0]!;
    expect(url).toBe("https://score.example/measure/?serial_id=SERIAL-1&measure_type=0");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toBeUndefined();
    const form = init?.body as FormData;
    expect([...form.keys()]).toEqual(["measure_json"]);
    const part = form.get("measure_json") as File;
    expect(part.name).toBe("measure.json");
    expect(part.type).toBe("application/json");
    expect(JSON.parse(await part.text())).toEqual(scoringRequest.measureJson);
  });

  it("does not retry a failed upstream request", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 }));
    const gateway = createQuickAoxServerGateway({
      preRequestBaseUrl: "https://pre.example",
      fetchImplementation,
    });

    await expect(gateway.preRequest({ scannerSerial: "SERIAL-1" })).rejects.toMatchObject({
      diagnosticCode: "UPSTREAM_HTTP_ERROR", status: 502, upstreamStatus: 503,
    });
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it.each([
    ["ENOTFOUND", "UPSTREAM_DNS_FAILURE"],
    ["EAI_AGAIN", "UPSTREAM_DNS_FAILURE"],
    ["CERT_HAS_EXPIRED", "UPSTREAM_TLS_FAILURE"],
    ["ECONNRESET", "UPSTREAM_NETWORK_FAILURE"],
  ] as const)("classifies fetch code %s as %s without exposing the exception", async (code, diagnosticCode) => {
    const fetchImplementation = vi.fn<typeof fetch>().mockRejectedValue(Object.assign(new TypeError("private raw failure"), { cause: { code } }));
    const gateway = createQuickAoxServerGateway({ preRequestBaseUrl: "https://pre.example", requestId: "request-1", fetchImplementation });
    await expect(gateway.preRequest({ scannerSerial: "SERIAL-1" })).rejects.toMatchObject({ diagnosticCode, requestId: "request-1" });
  });

  it("classifies a successful non-JSON response", async () => {
    const gateway = createQuickAoxServerGateway({
      preRequestBaseUrl: "https://pre.example", requestId: "request-2",
      fetchImplementation: vi.fn<typeof fetch>().mockResolvedValue(new Response("private body", { status: 200 })),
    });
    await expect(gateway.preRequest({ scannerSerial: "SERIAL-1" })).rejects.toMatchObject({ diagnosticCode: "UPSTREAM_NON_JSON", upstreamStatus: 200 });
  });

  it.each([
    [{ waiting_time_ms: 109 }, "UPSTREAM_INVALID_PRE_REQUEST"],
    [{ ...successfulPreRequest, new_pre_request_req: true }, "UPSTREAM_REPEAT_REQUIRED"],
  ] as const)("validates upstream JSON as %s", async (body, diagnosticCode) => {
    const gateway = createQuickAoxServerGateway({
      preRequestBaseUrl: "https://pre.example", requestId: "request-3",
      fetchImplementation: vi.fn<typeof fetch>().mockResolvedValue(Response.json(body)),
    });
    await expect(gateway.preRequest({ scannerSerial: "SERIAL-1" })).rejects.toMatchObject({ diagnosticCode });
  });

  it("applies one 2,000 ms timeout without retrying", async () => {
    vi.useFakeTimers();
    const fetchImplementation = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    const gateway = createQuickAoxServerGateway({ preRequestBaseUrl: "https://pre.example", requestId: "request-4", fetchImplementation });
    const pending = gateway.preRequest({ scannerSerial: "SERIAL-1" });
    const assertion = expect(pending).rejects.toMatchObject({ diagnosticCode: "UPSTREAM_TIMEOUT", status: 504 });
    await vi.advanceTimersByTimeAsync(2_000);
    await assertion;
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it("preserves caller cancellation separately from upstream timeout", async () => {
    const controller = new AbortController();
    const fetchImplementation = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }));
    const gateway = createQuickAoxServerGateway({ preRequestBaseUrl: "https://pre.example", fetchImplementation });
    const pending = gateway.preRequest({ scannerSerial: "SERIAL-1", signal: controller.signal });
    controller.abort("user-cancelled");
    await expect(pending).rejects.toBe("user-cancelled");
  });

  it("rejects inconsistent scanner evidence before making a request", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const gateway = createQuickAoxServerGateway({
      preRequestBaseUrl: "https://pre.example",
      fetchImplementation,
    });

    await expect(gateway.submit({
      scannerSerial: "OTHER",
      recommendedServer: "https://score.example",
      scoringRequest,
    })).rejects.toThrow("Scanner serials");
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});
