import { describe, expect, it } from "vitest";
import type { QuickAoxWorkflowOutcome } from "@nutriscan/workflows";
import { FAILED_SCAN_RETRY_PATH, requiresSerialRecovery } from "./retry-policy";

const failed = (failureKind: "scanner" | "hand-detection" | "acquisition" | "scoring-transport") => ({
  kind: "failed", failureKind, phase: "downloading", message: "failed", cause: new Error("failed"),
  physicalMeasurementStarted: true, physicalMeasurementMayHaveStarted: true,
}) as QuickAoxWorkflowOutcome;

describe("failed Quick AOX retry policy", () => {
  it.each(["scanner", "hand-detection", "acquisition"] as const)("requires serial recovery for %s failures", (kind) => {
    expect(requiresSerialRecovery(failed(kind))).toBe(true);
  });
  it("does not discard a healthy connection for scoring failure or quality rejection", () => {
    expect(requiresSerialRecovery(failed("scoring-transport"))).toBe(false);
    expect(requiresSerialRecovery({ kind: "rescan-required" } as QuickAoxWorkflowOutcome)).toBe(false);
  });
  it("routes explicit retry directly to setup, never the missing-outcome guard", () => {
    expect(FAILED_SCAN_RETRY_PATH).toBe("/scan/system-check");
  });
});
