"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ArrowRightIcon, CheckCircleIcon } from "@/components/icons";
import NutriScoreGauge from "@/components/NutriScoreGauge";
import { useAuth } from "@/lib/auth-context";
import { CARD_FADE_DURATION, CARD_STAGGER, CARDS_FADE_AT, STATUS_FADE_AT, STATUS_FADE_DURATION } from "@/lib/gauge-timing";
import { getScoreStatus, SCORE_RANGES, type ScoreStatus } from "@/lib/score";
import { scannerService } from "@/services/scanner";

// One short sentence explaining what the number means (item 6), and one
// concise suggestion (item 8's recommendation card) — kept separate so each
// stays short, per status. Not medical advice; see Design-System.md tone
// guidance (encouraging, scientific, never preachy).
const STATUS_COPY: Record<ScoreStatus, { explanation: string; recommendation: string }> = {
  "Needs improvement": {
    explanation:
      "Your carotenoid levels are lower than typical for a diet rich in colorful produce.",
    recommendation:
      "Add more colorful fruits and vegetables to your meals, then check back in a few weeks.",
  },
  Fair: {
    explanation: "Your carotenoid levels are approaching the optimal range.",
    recommendation:
      "A few more servings of colorful produce a week can help move you into the optimal range.",
  },
  Optimal: {
    explanation:
      "Your carotenoid levels reflect a diet rich in colorful fruits and vegetables.",
    recommendation:
      "Keep up your current habits — your carotenoid intake looks right on track.",
  },
  "Too high": {
    explanation:
      "Your carotenoid levels are higher than typical — often linked to high supplement intake.",
    recommendation:
      "Consider moderating carotenoid-rich supplements, and check in with a healthcare provider if this persists.",
  },
};

// Small legend swatch colors — representative of each band's position on
// the gauge's spectrum, not pulled from the gauge itself since these are
// flat chips rather than a gradient.
const RANGE_SWATCH: Record<ScoreStatus, string> = {
  "Needs improvement": "#dc2626",
  Fair: "#eab308",
  Optimal: "#16a34a",
  "Too high": "#ea580c",
};

export default function ScanResultsPage() {
  return (
    <Suspense fallback={null}>
      <ScanResults />
    </Suspense>
  );
}

function ScanResults() {
  const searchParams = useSearchParams();
  const score = Number(searchParams.get("score") ?? 91);
  const delta = Number(searchParams.get("delta") ?? 3);
  const status = getScoreStatus(score);
  const copy = STATUS_COPY[status];

  // Authentication happens after the result, not before it — see
  // scan/layout.tsx. A returning signed-in user's result is saved without
  // asking again; a signed-out visitor is offered sign-in/sign-up, which
  // brings them right back here (via `next=`) once they've done so, and the
  // save then happens automatically too.
  const { status: authStatus, user } = useAuth();
  const savedRef = useRef(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (authStatus !== "signed-in" || savedRef.current) return;
    savedRef.current = true;
    scannerService.saveResult({ score, delta, capturedAt: new Date().toISOString() });
    setSaved(true);
  }, [authStatus, score, delta]);

  const resultsUrl = `/scan/results?${new URLSearchParams({
    score: String(score),
    delta: String(delta),
  }).toString()}`;
  const nextParam = `?next=${encodeURIComponent(resultsUrl)}`;

  return (
    <div className="flex flex-1 justify-center px-6 py-10 sm:items-center sm:py-12">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="w-full max-w-md"
      >
        {/* 1. Page title */}
        <h1 className="text-center text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
          Your NutriScore
        </h1>

        {/* 2-4. Spectrum arc gauge, large score, status label (all inside
            the shared gauge). `score` is the final value from the start —
            see NutriScoreGauge's own note on why it's never counted up. */}
        <div className="mt-6 flex justify-center">
          <NutriScoreGauge score={score} showSampleTag={false} />
        </div>

        {/* 6. Explanatory sentence — fades in timed to appear right as the
            gauge's own status label does. The "What it means" card below
            already covers the ranges, so there's no status pill here
            repeating "Optimal"/"Within optimal range" a second time. */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: STATUS_FADE_DURATION, delay: STATUS_FADE_AT }}
          className="mx-auto mt-4 max-w-sm text-center text-sm leading-relaxed text-slate-600"
        >
          {copy.explanation}
        </motion.p>

        {/* 7. Supporting cards fade in last, with a slight stagger. */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: CARD_FADE_DURATION, delay: CARDS_FADE_AT }}
          className="mt-6 rounded-2xl border border-slate-200 bg-white p-4"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            What it means
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {SCORE_RANGES.map((range) => (
              <li
                key={range.status}
                className={
                  "flex items-center justify-between rounded-xl px-2.5 py-1.5 text-sm " +
                  (range.status === status ? "bg-slate-50 font-medium text-slate-900" : "text-slate-500")
                }
              >
                <span className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: RANGE_SWATCH[range.status] }}
                  />
                  {range.status}
                </span>
                <span className="tabular-nums text-xs text-slate-400">
                  {range.min}–{range.max}
                </span>
              </li>
            ))}
          </ul>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: CARD_FADE_DURATION, delay: CARDS_FADE_AT + CARD_STAGGER }}
          className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
            Recommendation
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-700">
            {copy.recommendation}
          </p>
        </motion.div>

        {authStatus === "signed-in" ? (
          <div className="mt-4 flex items-center justify-center gap-2 rounded-2xl border border-emerald-100 bg-emerald-50/70 px-4 py-3 text-sm text-emerald-800">
            <CheckCircleIcon className="h-4 w-4 shrink-0 text-emerald-700" />
            {saved
              ? `Saved to ${user?.name ?? "your"} history`
              : "Saving to your history…"}
          </div>
        ) : (
          <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-sm font-medium text-slate-900">
              Save this result
            </p>
            <p className="mt-1 text-sm leading-relaxed text-slate-500">
              Sign in or create a free account to save this scan and track
              your NutriScore over time.
            </p>
            <div className="mt-4 flex flex-col gap-2.5 sm:flex-row">
              <Link
                href={`/sign-in${nextParam}`}
                className="inline-flex flex-1 items-center justify-center rounded-full bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-800"
              >
                Sign in
              </Link>
              <Link
                href={`/sign-up${nextParam}`}
                className="inline-flex flex-1 items-center justify-center rounded-full border border-slate-200 px-5 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
              >
                Create account
              </Link>
            </div>
          </div>
        )}

        {/* 9-10. Primary "Scan again", secondary "View history" */}
        <div className="mt-6 flex flex-col gap-3">
          <Link
            href="/scan/welcome"
            className="inline-flex items-center justify-center gap-1.5 rounded-full bg-emerald-700 px-6 py-3.5 text-base font-semibold text-white shadow-sm ring-1 ring-emerald-700/10 transition-all hover:bg-emerald-800 hover:shadow-md"
          >
            Scan again
            <ArrowRightIcon className="h-4 w-4" />
          </Link>
          <Link
            href="/history"
            className="inline-flex items-center justify-center gap-1.5 rounded-full border border-slate-200 px-6 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            View history
          </Link>
        </div>

        <Link
          href="/"
          className="mt-6 block text-center text-sm font-medium text-slate-400 hover:text-slate-600"
        >
          Done for now
        </Link>
      </motion.div>
    </div>
  );
}
