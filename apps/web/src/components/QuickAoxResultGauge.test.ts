import { describe, expect, it } from "vitest";
import {
  QUICK_AOX_ARC,
  QUICK_AOX_GRADIENT_STOPS,
  QUICK_AOX_SCALE_MAX,
  QUICK_AOX_SCALE_MIN,
  quickAoxMarkerPoint,
  quickAoxNormalizedPosition,
} from "./QuickAoxResultGauge";

describe("QuickAoxResultGauge", () => {
  it.each([
    [0, 0],
    [3, 0.25],
    [5.7, 0.475],
    [6, 0.5],
    [9, 0.75],
    [12, 1],
    [-1, 0],
    [13, 1],
  ])("maps AOX %s linearly to normalized arc position %s", (aox, expected) => {
    expect(quickAoxNormalizedPosition(aox)).toBeCloseTo(expected);
  });

  it("maps the normalized position along the complete semicircle", () => {
    expect(quickAoxMarkerPoint(0).x).toBeCloseTo(QUICK_AOX_ARC.centerX - QUICK_AOX_ARC.radius);
    expect(quickAoxMarkerPoint(0).y).toBeCloseTo(QUICK_AOX_ARC.centerY);
    expect(quickAoxMarkerPoint(6).x).toBeCloseTo(QUICK_AOX_ARC.centerX);
    expect(quickAoxMarkerPoint(6).y).toBeCloseTo(QUICK_AOX_ARC.centerY - QUICK_AOX_ARC.radius);
    expect(quickAoxMarkerPoint(12).x).toBeCloseTo(QUICK_AOX_ARC.centerX + QUICK_AOX_ARC.radius);
    expect(quickAoxMarkerPoint(12).y).toBeCloseTo(QUICK_AOX_ARC.centerY);
    expect(quickAoxMarkerPoint(5.7).x).toBeLessThan(QUICK_AOX_ARC.centerX);
  });

  it("uses the native scale and exact APK-derived gradient stops", () => {
    expect([QUICK_AOX_SCALE_MIN, QUICK_AOX_SCALE_MAX]).toEqual([0, 12]);
    expect(QUICK_AOX_GRADIENT_STOPS).toEqual([
      { offset: 0, color: "#ff798b" },
      { offset: 0.25542316, color: "#f48778" },
      { offset: 0.45784044, color: "#b9d40f" },
      { offset: 0.83361965, color: "#b9d40f" },
      { offset: 0.89599538, color: "#ff798b" },
      { offset: 1, color: "#ff798b" },
    ]);
  });
});
