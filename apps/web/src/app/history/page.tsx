"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { motion } from "framer-motion";
import { ArrowRightIcon, CalendarIcon, TrendUpIcon } from "@/components/icons";
import ProgressChart from "@/components/ProgressChart";
import { useAuth } from "@/lib/auth-context";
import { getScoreStatus } from "@/lib/score";
import { scannerService } from "@/services/scanner";

export default function HistoryPage() {
  const { status, user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "signed-out") {
      router.replace("/sign-in?next=/history");
    }
  }, [status, router]);

  if (status !== "signed-in") {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-24 text-sm text-slate-400">
        Loading…
      </div>
    );
  }

  const history = scannerService.getHistory();
  const latest = history[0];

  return (
    <div className="flex flex-1 flex-col bg-slate-50 px-6 py-12">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="mx-auto w-full max-w-3xl"
      >
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-emerald-700">
              {user?.name}&apos;s history
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
              Your NutriScore over time
            </h1>
          </div>
          <Link
            href="/scan/welcome"
            className="mt-3 inline-flex w-fit items-center gap-1.5 rounded-full bg-emerald-700 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-800 sm:mt-0"
          >
            New scan
            <ArrowRightIcon className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Trend</h2>
              <span className="flex items-center gap-1 text-xs font-medium text-emerald-700">
                <TrendUpIcon className="h-3.5 w-3.5" />
                Improving
              </span>
            </div>
            <div className="mt-4">
              <ProgressChart />
            </div>
          </div>

          <div className="flex flex-col justify-center rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-sm">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
              Latest score
            </span>
            <span className="mt-1 text-5xl font-semibold tracking-tight text-slate-900">
              {latest.score}
            </span>
            <span className="mt-1 text-sm font-medium text-emerald-700">
              {getScoreStatus(latest.score)}
            </span>
          </div>
        </div>

        <div className="mt-8 rounded-3xl border border-slate-200 bg-white p-2 shadow-sm">
          <ul>
            {history.map((entry, index) => (
              <li
                key={entry.id}
                className={
                  "flex items-center justify-between px-4 py-4 " +
                  (index < history.length - 1 ? "border-b border-slate-100" : "")
                }
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
                    <CalendarIcon className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {entry.date}
                    </p>
                    <p className="text-xs text-slate-400">
                      {getScoreStatus(entry.score)}
                    </p>
                  </div>
                </div>
                <span className="text-lg font-semibold text-slate-900">
                  {entry.score}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="mt-4 text-center text-xs text-slate-400">
          Sample history shown for preview — your real scans will appear here.
        </p>
      </motion.div>
    </div>
  );
}
