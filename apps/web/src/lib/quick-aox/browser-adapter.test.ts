import { afterEach, describe, expect, it, vi } from "vitest";
import type { QuickAoxScoringRequest } from "@nutriscan/scoring/quick-aox";
import { NutriScanBrowserScoringGateway } from "./browser-gateway";
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
      }),
    );
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
});
