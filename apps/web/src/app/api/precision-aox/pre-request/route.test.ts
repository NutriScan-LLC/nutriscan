import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const successfulFixture = {
  new_pre_request_req: false,
  waiting_time_ms: 101,
  new_pre_request_delay_ms: 0,
  recommended_server: "https://de2.biozoom.net",
};

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.BIOZOOM_QUICK_AOX_BASE_URL;
});

describe("Precision AOX pre-request route", () => {
  it("uses the shared server configuration and returns only the validated upstream fixture", async () => {
    process.env.BIOZOOM_QUICK_AOX_BASE_URL = "https://de2.biozoom.net";
    const upstreamFetch = vi.fn<typeof fetch>().mockResolvedValue(Response.json(successfulFixture));
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await POST(new Request("https://nutriscan.example/api/precision-aox/pre-request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-NutriScan-Client-Request-Id": "123e4567-e89b-42d3-a456-426614174000",
      },
      body: JSON.stringify({ scannerSerial: "2N2400A5B70F5E3C9251" }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(successfulFixture);
    expect(upstreamFetch).toHaveBeenCalledOnce();
    expect(upstreamFetch.mock.calls[0]?.[0]).toBe(
      "https://de2.biozoom.net/pre-request/?serial_id=2N2400A5B70F5E3C9251&measure_type=1",
    );
    const log = String(vi.mocked(console.info).mock.calls[0]?.[0]);
    expect(log).toContain("precision_aox_pre_request_succeeded");
    expect(log).toContain("123e4567-e89b-42d3-a456-426614174000");
    expect(log).not.toContain("2N2400A5B70F5E3C9251");
  });

  it("returns the shared sanitized configuration diagnostic without an upstream request", async () => {
    const upstreamFetch = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await POST(new Request("https://nutriscan.example/api/precision-aox/pre-request", {
      method: "POST",
      body: JSON.stringify({ scannerSerial: "PRIVATE-SERIAL" }),
    }));

    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).toContain("CONFIG_MISSING");
    expect(body).not.toContain("PRIVATE-SERIAL");
    expect(upstreamFetch).not.toHaveBeenCalled();
  });
});
