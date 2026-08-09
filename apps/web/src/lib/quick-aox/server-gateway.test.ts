import { describe, expect, it, vi } from "vitest";
import type { QuickAoxScoringRequest } from "@nutriscan/scoring/quick-aox";
import { createQuickAoxServerGateway, QuickAoxUpstreamError } from "./server-gateway";

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
      Response.json({ recommended_server: "https://score.example", waiting_time_ms: 109 }),
    );
    const gateway = createQuickAoxServerGateway({
      preRequestBaseUrl: "https://pre.example/",
      fetchImplementation,
    });

    await expect(gateway.preRequest({ scannerSerial: "SERIAL /1" })).resolves.toEqual({
      recommended_server: "https://score.example",
      waiting_time_ms: 109,
    });
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

    await expect(gateway.preRequest({ scannerSerial: "SERIAL-1" })).rejects.toEqual(
      new QuickAoxUpstreamError("pre-request", 503),
    );
    expect(fetchImplementation).toHaveBeenCalledOnce();
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
