"use client";

import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircleIcon } from "@/components/icons";
import { scannerService } from "@/services/scanner";

const RADIUS = 90;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const DEFAULT_NOMINAL_MS = 30_000;

// Dev-only acceleration: the mock always completes in ~7s of real time,
// regardless of which scan type was picked on the Instructions screen, so
// testing the flow doesn't mean actually waiting up to 90 real seconds.
// The countdown shown on screen still counts down the full nominal 30s/90s
// duration — only the underlying mock's pacing is compressed. Swap this out
// once real scanner timing exists; nothing else on this screen depends on
// how long the mock actually takes.
const ACCELERATED_MOCK_MS = 7000;

// "Cancel Scan" is only offered for the first 3 real seconds — after that
// the scan is considered committed/in progress. This is wall-clock time on
// this screen, independent of the (accelerated, in dev) mock duration.
const CANCEL_WINDOW_MS = 3000;

// Must match scan/layout.tsx's page background (bg-slate-50) exactly — this
// circle is drawn on top of the solid green "full" ring and, being the same
// color as the page behind it, visually erases a growing clockwise wedge of
// it as time elapses. That's what makes a ring that starts complete and
// shrinks clockwise, rather than reusing the fill-up formula directly
// (which would grow the ring instead of depleting it).
const RING_ERASE_COLOR = "#f8fafc";

// Status copy cycles by progress percent — illustrative UX pacing to make
// the mock feel like a real device working through stages, not a confirmed
// protocol sequence. See lib/mock-scanner.ts's file-level note.
const STATUS_STAGES: { threshold: number; label: string }[] = [
  { threshold: 8, label: "Connecting to scanner…" },
  { threshold: 25, label: "Calibrating sensors…" },
  { threshold: 75, label: "Measuring carotenoid levels…" },
  { threshold: 92, label: "Analyzing reflected light…" },
  { threshold: 100, label: "Finalizing measurement…" },
];

function statusForPercent(percent: number) {
  if (percent >= 100) return "Measurement complete";
  return (
    STATUS_STAGES.find((stage) => percent < stage.threshold)?.label ??
    STATUS_STAGES[STATUS_STAGES.length - 1].label
  );
}

export default function ScanInProgressPage() {
  return (
    <Suspense fallback={null}>
      <ScanInProgress />
    </Suspense>
  );
}

function ScanInProgress() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [percent, setPercent] = useState(0);
  const [showCancel, setShowCancel] = useState(true);

  // The nominal duration (what the user was told on Instructions — 30s
  // Quick / 90s Precision) drives the displayed countdown; it's separate
  // from ACCELERATED_MOCK_MS, which drives how fast the mock actually runs.
  const nominalMs = Number(searchParams.get("duration")) || DEFAULT_NOMINAL_MS;
  const nominalSeconds = Math.round(nominalMs / 1000);

  useEffect(() => {
    const controller = new AbortController();

    scannerService.startScan(setPercent, {
      durationMs: ACCELERATED_MOCK_MS,
      signal: controller.signal,
    }).then(() => {
      if (controller.signal.aborted) return;
      // Re-check on fire, not just when scheduling: if "Cancel Scan" is
      // clicked during this pause, the signal aborts after this timeout is
      // already queued, so without the second check here it would still
      // fire and override the cancel navigation.
      setTimeout(() => {
        if (!controller.signal.aborted) router.push("/scan/processing");
      }, 700);
    });

    return () => controller.abort();
  }, [router]);

  useEffect(() => {
    const timer = setTimeout(() => setShowCancel(false), CANCEL_WINDOW_MS);
    return () => clearTimeout(timer);
  }, []);

  // Depletes clockwise from a complete ring, not a fill-up gauge — see
  // RING_ERASE_COLOR above for how.
  const eraseOffset = CIRCUMFERENCE * (percent / 100);
  const secondsRemaining = Math.max(
    0,
    Math.ceil(nominalSeconds * (1 - percent / 100)),
  );
  const complete = percent >= 100;
  const status = statusForPercent(percent);

  return (
    <div className="flex flex-1 items-center justify-center px-6 py-10 sm:py-12">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="flex w-full max-w-md flex-col items-center text-center"
      >
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
          Scanning…
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">
          Keep your hand still while we take your measurement.
        </p>

        {/* Subtle breathing scale — barely perceptible, not a pulse: one
            full 4s cycle, only ±1.5% scale. */}
        <motion.div
          animate={{ scale: [1, 1.015, 1] }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
          className="relative mt-8 w-full max-w-[275px] overflow-hidden rounded-2xl shadow-md shadow-slate-900/10"
        >
          <Image
            src="/instructions-hand-placement.jpg"
            alt="Hand resting flat on the scanner"
            width={1200}
            height={900}
            className="h-auto w-full object-contain"
            sizes="275px"
            priority
          />
        </motion.div>

        <div className="relative mt-8 flex h-72 w-72 items-center justify-center">
          <svg viewBox="0 0 200 200" className="h-full w-full -rotate-90">
            {/* Complete green ring — the full "time available" base. Always
                fully drawn; never redrawn or resized. */}
            <circle
              cx="100"
              cy="100"
              r={RADIUS}
              fill="none"
              stroke="#15803d"
              strokeWidth="12"
            />
            {/* Page-background-colored "eraser" — the only thing that
                animates. Grows clockwise from 12 o'clock as time elapses,
                visually depleting the green ring underneath rather than
                filling one up, so it reads as a countdown, not a loader. */}
            <circle
              cx="100"
              cy="100"
              r={RADIUS}
              fill="none"
              stroke={RING_ERASE_COLOR}
              strokeWidth="13"
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={CIRCUMFERENCE - eraseOffset}
              style={{ transition: "stroke-dashoffset 0.08s linear" }}
            />
          </svg>

          <div
            className="absolute inset-0 flex flex-col items-center justify-center"
            role="img"
            aria-label={
              complete
                ? "Measurement complete"
                : `${secondsRemaining} seconds remaining`
            }
          >
            <span className="text-6xl font-semibold tracking-tight text-slate-900">
              {secondsRemaining}
            </span>
            <span className="mt-1.5 text-sm font-medium uppercase tracking-wide text-slate-400">
              seconds remaining
            </span>
          </div>
        </div>

        <div className="relative mt-6 flex h-6 items-center justify-center">
          <AnimatePresence mode="wait">
            <motion.p
              key={status}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.25 }}
              className={
                "flex items-center gap-1.5 text-sm font-medium " +
                (complete ? "text-emerald-700" : "text-slate-500")
              }
            >
              {complete && <CheckCircleIcon className="h-4 w-4 shrink-0" />}
              {status}
            </motion.p>
          </AnimatePresence>
        </div>

        <AnimatePresence>
          {showCancel && (
            <motion.button
              type="button"
              onClick={() => router.push("/")}
              initial={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5 }}
              className="mt-8 inline-flex items-center justify-center rounded-full border border-slate-200 px-6 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              Cancel Scan
            </motion.button>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
