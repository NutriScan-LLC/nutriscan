import { describe, expect, it } from "vitest";
import { loadQuickAoxServerConfig } from "./server-config";

describe("Quick AOX server-only configuration", () => {
  it("reports missing configuration", () => {
    expect(() => loadQuickAoxServerConfig("req-1", {})).toThrowError(expect.objectContaining({ diagnosticCode: "CONFIG_MISSING", requestId: "req-1" }));
  });
  it.each(["not-a-url", "http://pre.example", "https://user:pass@pre.example"])("reports invalid configuration: %s", (value) => {
    expect(() => loadQuickAoxServerConfig("req-2", { BIOZOOM_QUICK_AOX_BASE_URL: value })).toThrowError(expect.objectContaining({ diagnosticCode: "CONFIG_INVALID" }));
  });
  it("normalizes the runtime-confirmed HTTPS base", () => {
    expect(loadQuickAoxServerConfig("req-3", { BIOZOOM_QUICK_AOX_BASE_URL: "https://de2.biozoom.net/" })).toEqual({ preRequestBaseUrl: "https://de2.biozoom.net" });
  });
});
