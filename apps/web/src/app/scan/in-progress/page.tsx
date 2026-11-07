"use client";

import Image from "next/image";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useQuickAoxRun } from "@/lib/quick-aox/run-context";

const RADIUS = 90;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const SCORING_STATES = new Set([
  "building-scoring-request",
  "pre-requesting",
  "waiting-to-submit",
  "submitting",
  "parsing",
  "interpreting",
]);

export default function ScanInProgressPage() {
  const router = useRouter();
  const { event, outcome, running, cancel } = useQuickAoxRun();
  const downloading = event?.state === "downloading" ? event : null;
  const downloadFinished = event?.state === "measurement-complete" || event?.state === "detecting-hand-removal" || event?.state === "hand-removed";
  const percent = downloadFinished
    ? 100
    : downloading && downloading.expectedBlocks > 0
      ? Math.round((downloading.validBlocks / downloading.expectedBlocks) * 100)
      : 0;

  useEffect(() => {
    if (event && SCORING_STATES.has(event.state)) {
      router.replace("/scan/processing");
      return;
    }
    if (outcome) router.replace(outcomePath(outcome.kind));
  }, [event, outcome, router]);

  const detectingHand = event?.state === "detecting-hand";
  const removingHand = event?.state === "measurement-complete" || event?.state === "detecting-hand-removal";
  const status = detectingHand
    ? "Place your hand on the scanner"
    : removingHand
      ? "Remove your hand"
      : event?.state === "starting-measurement" || event?.state === "hand-detected"
    ? "Starting one AOX measurement…"
    : event?.state === "measurement-started"
      ? "Measurement started — keep your hand still…"
      : downloading
        ? `Validating scanner data — ${downloading.validBlocks.toLocaleString()} of ${downloading.expectedBlocks.toLocaleString()} blocks`
        : "Waiting for the scanner…";
  const dashOffset = CIRCUMFERENCE * (1 - percent / 100);

  return (
    <div className="flex flex-1 items-center justify-center px-6 py-10 sm:py-12">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="flex w-full max-w-md flex-col items-center text-center"
      >
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
          {detectingHand ? "Place your hand on the scanner" : removingHand ? "Remove your hand" : "Hold still — scanning"}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">
          {detectingHand ? "The scanner will detect your hand automatically." : removingHand ? "Results processing begins after removal is confirmed." : "Keep your hand still until all measurement data is validated."}
        </p>

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
            <circle cx="100" cy="100" r={RADIUS} fill="none" stroke="#e2e8f0" strokeWidth="12" />
            <circle
              cx="100"
              cy="100"
              r={RADIUS}
              fill="none"
              stroke="#15803d"
              strokeWidth="12"
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={dashOffset}
              style={{ transition: "stroke-dashoffset 0.2s ease-out" }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center" role="status">
            <span className="text-6xl font-semibold tracking-tight text-slate-900">{percent}%</span>
            <span className="mt-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">
              validated data
            </span>
          </div>
        </div>

        <p className="mt-6 min-h-6 text-sm font-medium text-slate-600">{status}</p>
        <button
          type="button"
          disabled={!running}
          onClick={cancel}
          className="mt-8 inline-flex items-center justify-center rounded-full border border-slate-200 px-6 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
        >
          Stop software workflow
        </button>
        <p className="mt-2 max-w-sm text-xs leading-relaxed text-slate-400">
          Stopping software does not stop a physical measurement that has already begun.
        </p>
      </motion.div>
    </div>
  );
}

function outcomePath(kind: string): string {
  return kind === "accepted" ? "/scan/results" : "/scan/outcome";
}
