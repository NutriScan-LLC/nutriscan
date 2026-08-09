// Maps a NutriScore (0-100) to a human-readable status label and range.
//
// This is the single source of truth for score → label/range — always
// derive both from the score with these exports rather than storing or
// hardcoding a separate label, which is how a score of 88 once ended up
// displayed as "Excellent" in mock history data after the ranges changed
// under it.
//
// Prototype-only thresholds, not derived from any published carotenoid
// scoring guidance. Revisit once a real scoring rubric is confirmed.

export type ScoreStatus = "Needs improvement" | "Fair" | "Optimal" | "Too high";

export type ScoreRange = {
  status: ScoreStatus;
  min: number;
  max: number;
  /** Short description used in the results "what it means" legend. */
  description: string;
};

// Ordered low → high. The gauge draws its optimal-range tick marks from the
// "Optimal" entry here, and the results page's legend renders this list
// directly — so a range only ever needs to change in one place.
export const SCORE_RANGES: ScoreRange[] = [
  {
    status: "Needs improvement",
    min: 0,
    max: 49,
    description: "Below the typical range.",
  },
  {
    status: "Fair",
    min: 50,
    max: 69,
    description: "Approaching the optimal range.",
  },
  {
    status: "Optimal",
    min: 70,
    max: 90,
    description: "Within the optimal range.",
  },
  {
    status: "Too high",
    min: 91,
    max: 100,
    description: "Above the typical range.",
  },
];

export function getScoreRange(score: number): ScoreRange {
  const clamped = Math.max(0, Math.min(100, score));
  return (
    SCORE_RANGES.find((range) => clamped >= range.min && clamped <= range.max) ??
    SCORE_RANGES[0]
  );
}

export function getScoreStatus(score: number): ScoreStatus {
  return getScoreRange(score).status;
}

export function isOptimalScore(score: number): boolean {
  return getScoreStatus(score) === "Optimal";
}

// "Within optimal range" for a good score, otherwise the status itself
// (e.g. "Fair", "Too high") — used for the small badge on the results page.
export function getScoreBadgeLabel(score: number): string {
  return isOptimalScore(score) ? "Within optimal range" : getScoreStatus(score);
}
