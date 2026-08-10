import { afterEach, describe, expect, it, vi } from "vitest";
import type { QuickAoxScoringRequest } from "@nutriscan/scoring/quick-aox";
import { NutriScanBrowserScoringGateway, NutriScanScoringGatewayError } from "./browser-gateway";
import { isWebSerialSupported } from "./browser-workflow";

afterEach(() => vi.unstubAllGlobals());

describe("browser Quick AOX adapters", () => {
  it("reports Web Serial capability without requesting a port", () => {
    vi.stubGlobal("navigator", {});
    expect(isWebSerialSupported()).toBe(false);
    const requestPort = vi.fn();
    vi.stubGlobal("navigator", { serial: { requestPort } });
    expect(isWebSerialSupported()).toBe(true);
    expect(requestPort).not.toHaveBeenCalled();
  });

  it("routes pre-request through the NutriScan origin", async () => {
    const raw = { recommended_server: "https://score.example", waiting_time_ms: 10 };
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(Response.json(raw));
    const gateway = new NutriScanBrowserScoringGateway(fetchImplementation);

    await expect(gateway.preRequest({ scannerSerial: "SERIAL-1" })).resolves.toEqual(raw);
    expect(fetchImplementation).toHaveBeenCalledWith(
      "/api/quick-aox/pre-request",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ scannerSerial: "SERIAL-1" }),
        headers: expect.objectContaining({
          "X-NutriScan-Client-Request-Id": expect.stringMatching(/^[0-9a-f-]{36}$/),
        }),
      }),
    );
  });

  it("binds an injected receiver-sensitive fetch implementation to globalThis", async () => {
    const raw = { recommended_server: "https://score.example", waiting_time_ms: 10 };
    const receiverSensitiveFetch = vi.fn(function (
      this: unknown,
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> {
      if (this !== globalThis) throw new TypeError("Illegal invocation");
      expect(input).toBe("/api/quick-aox/pre-request");
      expect(init?.method).toBe("POST");
      return Promise.resolve(Response.json(raw));
    }) as unknown as typeof fetch;

    const gateway = new NutriScanBrowserScoringGateway(receiverSensitiveFetch);

    await expect(gateway.preRequest({ scannerSerial: "SERIAL-1" })).resolves.toEqual(raw);
    expect(receiverSensitiveFetch).toHaveBeenCalledOnce();
  });

  it("binds the default production fetch implementation to globalThis", async () => {
    const raw = { recommended_server: "https://score.example", waiting_time_ms: 10 };
    const receiverSensitiveFetch = vi.fn(function (
      this: unknown,
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> {
      if (this !== globalThis) throw new TypeError("Illegal invocation");
      expect(input).toBe("/api/quick-aox/pre-request");
      expect(init?.method).toBe("POST");
      return Promise.resolve(Response.json(raw));
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", receiverSensitiveFetch);

    const gateway = new NutriScanBrowserScoringGateway();

    await expect(gateway.preRequest({ scannerSerial: "SERIAL-1" })).resolves.toEqual(raw);
    expect(receiverSensitiveFetch).toHaveBeenCalledOnce();
  });

  it("routes scoring evidence only through the NutriScan submission endpoint", async () => {
    const scoringRequest: QuickAoxScoringRequest = {
      scannerSerial: "SERIAL-1",
      measurementNumber: 4,
      measurementBlocks: "PRIVATE-BLOCKS",
      measureJson: {
        Serial: "SERIAL-1",
        MeasurementBlocks: "PRIVATE-BLOCKS",
        UserID: "ffffffffffffffffffffffffffffffff",
        lang: "en",
        AdditionalData: "{}",
      },
    };
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ aox: 70, aox_q: 40 }));
    const gateway = new NutriScanBrowserScoringGateway(fetchImplementation);

    await gateway.submit({
      scannerSerial: "SERIAL-1",
      recommendedServer: "https://score.example",
      scoringRequest,
    });

    expect(fetchImplementation).toHaveBeenCalledOnce();
    const [url, init] = fetchImplementation.mock.calls[0]!;
    expect(url).toBe("/api/quick-aox/submit");
    expect(String(url)).not.toContain("score.example");
    expect(init?.body).toContain("PRIVATE-BLOCKS");
  });

  it("preserves only sanitized pre-request diagnostic fields", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      error: { diagnosticCode: "UPSTREAM_TLS_FAILURE", status: 502, requestId: "safe-ref" },
    }, { status: 502 }));
    const gateway = new NutriScanBrowserScoringGateway(fetchImplementation);
    const error = await gateway.preRequest({ scannerSerial: "PRIVATE-SERIAL" }).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(NutriScanScoringGatewayError);
    expect(error).toMatchObject({ diagnosticCode: "UPSTREAM_TLS_FAILURE", status: 502, requestId: "safe-ref" });
    expect(JSON.stringify(error)).not.toContain("PRIVATE-SERIAL");
  });

  it("classifies a raw browser fetch rejection without exposing its cause", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockRejectedValue(
      new Error("private browser network details"),
    );
    const gateway = new NutriScanBrowserScoringGateway(fetchImplementation);

    const error = await gateway.preRequest({ scannerSerial: "PRIVATE-SERIAL" }).catch((cause: unknown) => cause);
    expect(error).toMatchObject({
      diagnosticCode: "BROWSER_FETCH_REJECTED",
      status: 0,
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    expect(error).not.toHaveProperty("cause");
    expect(JSON.stringify(error)).not.toContain("private browser network details");
    expect(JSON.stringify(error)).not.toContain("PRIVATE-SERIAL");
  });

  it("preserves cancellation instead of classifying it as a fetch rejection", async () => {
    const controller = new AbortController();
    const cancellation = new DOMException("cancelled", "AbortError");
    const fetchImplementation = vi.fn<typeof fetch>().mockImplementation(async () => {
      controller.abort("user cancellation");
      throw cancellation;
    });
    const gateway = new NutriScanBrowserScoringGateway(fetchImplementation);

    await expect(gateway.preRequest({ scannerSerial: "SERIAL-1", signal: controller.signal }))
      .rejects.toBe(cancellation);
  });

  it("classifies a non-diagnostic non-2xx response", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("development server error page", { status: 502 }),
    );
    const gateway = new NutriScanBrowserScoringGateway(fetchImplementation);

    await expect(gateway.preRequest({ scannerSerial: "SERIAL-1" })).rejects.toMatchObject({
      diagnosticCode: "NUTRISCAN_NON_DIAGNOSTIC_HTTP_ERROR",
      status: 502,
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
  });

  it("classifies a successful non-JSON response", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("not json", { status: 200 }),
    );
    const gateway = new NutriScanBrowserScoringGateway(fetchImplementation);

    await expect(gateway.preRequest({ scannerSerial: "SERIAL-1" })).rejects.toMatchObject({
      diagnosticCode: "NUTRISCAN_SUCCESS_NON_JSON",
      status: 200,
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
  });
});
