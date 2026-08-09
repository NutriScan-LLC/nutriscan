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

// Compact "hero" NutriScore gauge — used on the homepage only. Shares its
// arc/needle with the full NutriScoreGauge (results page) via
// NutriScoreGaugeArc, so appearance stays consistent, but renders nothing
// beyond arc + score + status: no zone labels, no recommendation, no scale
// text, no cards. Keep it that way — the homepage is a preview, not the
// results experience. Score/status fade timing matches NutriScoreGauge —
// see lib/gauge-timing.ts.

type NutriScoreGaugeCompactProps = {
  score: number;
  delta?: number;
  size?: number;
  showSampleTag?: boolean;
  className?: string;
};

export default function NutriScoreGaugeCompact({
  score,
  delta,
  size,
  showSampleTag = true,
  className = "",
}: NutriScoreGaugeCompactProps) {
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
          className="text-5xl font-semibold tracking-tight text-slate-900 sm:text-6xl"
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
