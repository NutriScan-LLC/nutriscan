"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { ArrowRightIcon, CheckCircleIcon } from "@/components/icons";
import QuickAoxResultGauge from "@/components/QuickAoxResultGauge";
import { useAuth } from "@/lib/auth-context";
import { saveSessionResult } from "@/lib/history";
import { useQuickAoxRun } from "@/lib/quick-aox/run-context";

export default function ScanResultsPage() {
  const { outcome } = useQuickAoxRun();
  const accepted = outcome?.kind === "accepted" ? outcome : null;
  const score = accepted?.score ?? 0;

  // Authentication happens after the result, not before it — see
  // scan/layout.tsx. A returning signed-in user's result is saved without
  // asking again; a signed-out visitor is offered sign-in/sign-up, which
  // brings them right back here (via `next=`) once they've done so, and the
  // save then happens automatically too.
  const { status: authStatus, user } = useAuth();
  const savedRef = useRef(false);
  useEffect(() => {
    if (authStatus !== "signed-in" || savedRef.current) return;
    savedRef.current = true;
    if (!accepted) return;
    saveSessionResult({ score, capturedAt: accepted.measurementStart.acknowledgedAt });
  }, [accepted, authStatus, score]);

  const resultsUrl = "/scan/results";
  const nextParam = `?next=${encodeURIComponent(resultsUrl)}`;

  if (!accepted) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <h1 className="text-2xl font-semibold text-slate-900">No accepted result is available</h1>
        <p className="mt-2 text-sm text-slate-500">Scan evidence is held in memory and is cleared by a page reload.</p>
        <Link href="/scan/welcome" className="mt-6 rounded-full bg-emerald-700 px-6 py-3 text-sm font-semibold text-white">
          Return to scan setup
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-1 justify-center px-6 py-10 sm:items-center sm:py-12">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="w-full max-w-md"
      >
        <h1 className="text-center text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
          Your antioxidant level
        </h1>

        <div className="mt-6 rounded-3xl border border-slate-200 bg-white px-7 py-8 shadow-sm">
          <QuickAoxResultGauge aox={score} />
        </div>

        {authStatus === "signed-in" ? (
          <div className="mt-4 flex items-center justify-center gap-2 rounded-2xl border border-emerald-100 bg-emerald-50/70 px-4 py-3 text-sm text-emerald-800">
            <CheckCircleIcon className="h-4 w-4 shrink-0 text-emerald-700" />
            {`Saved to ${user?.name ?? "your"} history`}
          </div>
        ) : (
          <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-sm font-medium text-slate-900">
              Save this result
            </p>
            <p className="mt-1 text-sm leading-relaxed text-slate-500">
              Sign in or create a free account to save this scan and track
              your AOX score over time.
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
