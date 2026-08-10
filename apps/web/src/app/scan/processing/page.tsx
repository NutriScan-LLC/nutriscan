"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { SparkleIcon } from "@/components/icons";
import { useQuickAoxRun } from "@/lib/quick-aox/run-context";

export default function ScanProcessingPage() {
  const router = useRouter();
  const { event, outcome, running, cancel } = useQuickAoxRun();

  useEffect(() => {
    if (outcome) router.replace(outcome.kind === "accepted" ? "/scan/results" : "/scan/outcome");
  }, [outcome, router]);

  const status = event?.state === "building-scoring-request"
    ? "Preparing validated measurement data"
    : event?.state === "pre-requesting"
      ? "Contacting the scoring service"
      : event?.state === "waiting-to-submit"
        ? "Waiting for the required scoring window"
        : event?.state === "submitting"
          ? "Submitting for scoring"
          : event?.state === "parsing" || event?.state === "interpreting"
            ? "Interpreting measurement quality"
            : "Preparing your result";

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-12">
      <motion.span
        animate={{ rotate: 360 }}
        transition={{ duration: 2.2, repeat: Infinity, ease: "linear" }}
        className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"
      >
        <SparkleIcon className="h-7 w-7" />
      </motion.span>
      <h1 className="mt-6 text-2xl font-semibold tracking-tight text-slate-900">Analyzing your results</h1>
      <div className="relative mt-2 h-6">
        <AnimatePresence mode="wait">
          <motion.p
            key={status}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="text-sm text-slate-500"
          >
            {status}
          </motion.p>
        </AnimatePresence>
      </div>
      <button
        type="button"
        onClick={cancel}
        disabled={!running}
        className="mt-8 text-sm font-medium text-slate-400 hover:text-slate-600 disabled:opacity-50"
      >
        Cancel processing
      </button>
    </div>
  );
}
