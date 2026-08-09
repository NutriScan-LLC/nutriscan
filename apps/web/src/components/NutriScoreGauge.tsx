"use client";

import { motion } from "framer-motion";
import NutriScoreGaugeArc from "@/components/NutriScoreGaugeArc";
import {
  SCORE_FADE_AT,
  SCORE_FADE_DURATION,
  STATUS_FADE_AT,
  STATUS_FADE_DURATION,
} from "@/lib/gauge-timing";
import { getScoreStatus, isOptimalScore } from "@/lib/score";

// Full NutriScore gauge — used on the results page. Shares its arc/needle
// with NutriScoreGaugeCompact (the homepage version) via NutriScoreGaugeArc,
// so the two always look identical. The score is the visual focal point
// (~100px on desktop) with just the status word beneath it — no "Too Low /
// Optimal / Too High" labels and no status pill; the results page's "What
// it means" card already covers the ranges, so repeating them here would
// just be noise. Status is always derived from `score` via getScoreStatus —
// there is no way to pass in a mismatched label.
//
// `score` is the FINAL value from the moment this mounts — it is never
// tweened/counted-up by a parent. Counting the number up on every frame
// used to also feed a constantly-shifting target into the needle's
// rotation (since both read from the same prop), which is what made the
// needle look like it was chasing a moving target instead of sweeping
// smoothly once. The score and status labels fade in on their own, timed
// to start only once the needle has finished — see lib/gauge-timing.ts.

type NutriScoreGaugeProps = {
  score: number;
  delta?: number;
  size?: number;
  showSampleTag?: boolean;
  className?: string;
};

export default function NutriScoreGauge({
  score,
  delta,
  size,
  showSampleTag = true,
  className = "",
}: NutriScoreGaugeProps) {
  const clampedScore = Math.max(0, Math.min(100, score));
  const status = getScoreStatus(clampedScore);
  const optimal = isOptimalScore(clampedScore);

  return (
    <div
      className={`relative mx-auto flex flex-col items-center ${className}`}
      style={size ? { width: size } : { width: "100%", maxWidth: 320 }}
    >
      {showSampleTag && (
        <span className="absolute right-0 top-0 text-[10px] font-medium uppercase tracking-wide text-slate-400">
          Sample
        </span>
      )}

      <NutriScoreGaugeArc score={clampedScore} />

      <div className="-mt-2 flex flex-col items-center text-center">
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: SCORE_FADE_DURATION, delay: SCORE_FADE_AT }}
          className="text-7xl font-semibold tracking-tight text-slate-900 sm:text-[100px]"
        >
          {clampedScore}
        </motion.span>
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: STATUS_FADE_DURATION, delay: STATUS_FADE_AT }}
          className={
            "mt-1 text-base font-medium sm:text-lg " +
            (optimal ? "text-emerald-700" : "text-amber-700")
          }
        >
          {status}
        </motion.span>
        {delta !== undefined && (
          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: STATUS_FADE_DURATION, delay: STATUS_FADE_AT }}
            className="mt-1.5 flex items-center gap-1 text-xs font-medium text-slate-500"
          >
            <ArrowUp />
            {delta >= 0 ? "+" : ""}
            {delta} since last scan
          </motion.span>
        )}
      </div>

      <span className="sr-only">NutriScore: {clampedScore}, {status}.</span>
    </div>
  );
}

function ArrowUp() {
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3 text-emerald-600" fill="none" aria-hidden="true">
      <path
        d="M6 10V2M2.5 5.5 6 2l3.5 3.5"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
