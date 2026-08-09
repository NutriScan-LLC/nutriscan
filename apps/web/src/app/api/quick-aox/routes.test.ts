import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as preRequest } from "./pre-request/route";
import { POST as submit } from "./submit/route";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.BIOZOOM_QUICK_AOX_BASE_URL;
});

describe("Quick AOX API routes", () => {
  it("returns the raw pre-request JSON through the server boundary", async () => {
    process.env.BIOZOOM_QUICK_AOX_BASE_URL = "https://pre.example";
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      recommended_server: "https://score.example",
      waiting_time_ms: 25,
      new_pre_request_req: false,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await preRequest(new Request("https://nutriscan.example/api/quick-aox/pre-request", {
      method: "POST",
      body: JSON.stringify({ scannerSerial: "SERIAL-1" }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      recommended_server: "https://score.example",
      waiting_time_ms: 25,
      new_pre_request_req: false,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("keeps MeasurementBlocks in the POST body and returns raw scoring JSON", async () => {
    process.env.BIOZOOM_QUICK_AOX_BASE_URL = "https://pre.example";
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ aox: 74, aox_q: 40 }));
    vi.stubGlobal("fetch", fetchMock);
    const scoringRequest = {
      scannerSerial: "SERIAL-1",
      measurementNumber: 7,
      measurementBlocks: "BLOCKS",
      measureJson: {
        Serial: "SERIAL-1",
        MeasurementBlocks: "BLOCKS",
        UserID: "ffffffffffffffffffffffffffffffff",
        lang: "en",
        AdditionalData: "{}",
      },
    };

    const response = await submit(new Request("https://nutriscan.example/api/quick-aox/submit", {
      method: "POST",
      body: JSON.stringify({
        scannerSerial: "SERIAL-1",
        recommendedServer: "https://score.example",
        scoringRequest,
      }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ aox: 74, aox_q: 40 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("returns a sanitized error without upstream response evidence", async () => {
    process.env.BIOZOOM_QUICK_AOX_BASE_URL = "https://pre.example";
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(
      new Response("private upstream body", { status: 503 }),
    ));

    const response = await preRequest(new Request("https://nutriscan.example/api/quick-aox/pre-request", {
      method: "POST",
      body: JSON.stringify({ scannerSerial: "SERIAL-1" }),
    }));

    expect(response.status).toBe(502);
    const body = await response.text();
    expect(body).toContain("BIOZOOM_PRE_REQUEST_FAILED");
    expect(body).not.toContain("private upstream body");
  });
});
