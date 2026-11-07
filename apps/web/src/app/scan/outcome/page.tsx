"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { AlertTriangleIcon, ArrowRightIcon } from "@/components/icons";
import { DEFAULT_QUICK_AOX_PRESENTATION } from "@nutriscan/scoring/quick-aox";
import { useQuickAoxRun } from "@/lib/quick-aox/run-context";
import { FAILED_SCAN_RETRY_PATH } from "@/lib/quick-aox/retry-policy";
import { formatSafeScannerDiagnostic } from "@/lib/scanner-session-diagnostic";

export default function ScanOutcomePage() {
  const router = useRouter();
  const { event, outcome, running, clearCompletedRun, diagnostic, connection, wifiLog } = useQuickAoxRun();

  useEffect(() => {
    if (event?.state === "awaiting-begin") router.replace("/scan");
  }, [event, router]);

  if (!outcome || outcome.kind === "accepted") {
    return <MissingOutcome onReturn={() => router.replace("/scan/welcome")} />;
  }

  const presentation = presentationFor(outcome);
  function beginAnotherRun() {
    clearCompletedRun();
    router.replace(FAILED_SCAN_RETRY_PATH);
  }

  return (
    <div className="flex flex-1 items-center justify-center px-6 py-12">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-7 text-center shadow-sm"
      >
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-amber-700">
          <AlertTriangleIcon className="h-6 w-6" />
        </span>
        <p className="mt-5 text-xs font-semibold uppercase tracking-widest text-amber-700">{presentation.eyebrow}</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{presentation.title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">{presentation.message}</p>
        {outcome.kind === "failed" && outcome.diagnostic && (
          <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 text-left text-xs text-slate-500">
            <p>Diagnostic: {outcome.diagnostic.code}</p>
            <p className="mt-1">Reference: {outcome.diagnostic.requestId}</p>
            <p className="mt-1">NutriScan status: {outcome.diagnostic.status}</p>
            {outcome.diagnostic.upstreamStatus !== undefined && (
              <p className="mt-1">Upstream status: {outcome.diagnostic.upstreamStatus}</p>
            )}
          </div>
        )}
        {outcome.kind === "failed" && diagnostic && (
          <details className="mt-4 text-left">
            <summary className="cursor-pointer text-xs font-semibold text-slate-600">Sanitized scanner diagnostic</summary>
            <textarea aria-label="Sanitized scanner diagnostic" readOnly value={formatSafeScannerDiagnostic(diagnostic)} className="mt-2 h-48 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 font-mono text-[10px] text-slate-600" />
            <button type="button" onClick={() => void navigator.clipboard.writeText(formatSafeScannerDiagnostic(diagnostic))} className="mt-2 text-xs font-semibold text-emerald-700">Copy sanitized diagnostic</button>
          </details>
        )}

        {connection === "wifi" && wifiLog.length > 0 && (
          <details className="mt-4 text-left">
            <summary className="cursor-pointer text-xs font-semibold text-slate-600">Wi-Fi scan log</summary>
            <textarea aria-label="Wi-Fi scan log" readOnly value={wifiLog.join("\n")} className="mt-2 h-48 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 font-mono text-[10px] text-slate-600" />
            <div className="mt-2 flex items-center justify-between">
              <button type="button" onClick={() => void navigator.clipboard.writeText(wifiLog.join("\n"))} className="text-xs font-semibold text-emerald-700">Copy Wi-Fi log</button>
              <Link href="/scanner-wifi-test" className="text-xs font-semibold text-slate-500 underline">Wi-Fi diagnostics</Link>
            </div>
          </details>
        )}

        {presentation.canTryAgain && (
          <button
            type="button"
            onClick={beginAnotherRun}
            disabled={running}
            className="mt-7 inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-emerald-700 px-6 py-3.5 text-base font-semibold text-white shadow-sm transition-colors hover:bg-emerald-800 disabled:opacity-60"
          >
            {running ? "Connecting…" : "Start another scan"}
            <ArrowRightIcon className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          onClick={() => router.push("/")}
          className="mt-4 text-sm font-medium text-slate-400 hover:text-slate-600"
        >
          Done for now
        </button>
      </motion.div>
    </div>
  );
}

function presentationFor(outcome: Exclude<NonNullable<ReturnType<typeof useQuickAoxRun>["outcome"]>, { kind: "accepted" }>) {
  if (outcome.kind === "cancelled") {
    return {
      eyebrow: "Workflow stopped",
      title: "The software workflow was cancelled",
      message: outcome.physicalMeasurementMayHaveStarted
        ? "A physical measurement may still have continued on the scanner. NutriScan did not send a stop or delete command."
        : "No confirmed physical measurement was started.",
      canTryAgain: true,
    };
  }
  if (outcome.kind === "failed") {
    return {
      eyebrow: "Unable to complete",
      title: "The scan could not be completed",
      message: outcome.message,
      canTryAgain: true,
    };
  }
  const reason = "result" in outcome ? outcome.result.decision.reason : undefined;
  const reasonCopy = reason ? DEFAULT_QUICK_AOX_PRESENTATION[reason] : undefined;
  if (outcome.kind === "rescan-required") {
    return {
      eyebrow: "Rescan required",
      title: "This measurement did not pass its quality check",
      message: reasonCopy ?? "Adjust your hand position and deliberately start another scan when ready.",
      canTryAgain: true,
    };
  }
  if (outcome.kind === "device-condition-required") {
    return {
      eyebrow: "Scanner needs attention",
      title: "Resolve the scanner condition first",
      message: reasonCopy ?? "Check the scanner before attempting another measurement.",
      canTryAgain: true,
    };
  }
  if (outcome.kind === "stopped") {
    return {
      eyebrow: "No result available",
      title: "Scoring stopped for this measurement",
      message: reasonCopy ?? "NutriScan cannot display a normal Quick AOX result for this measurement.",
      canTryAgain: false,
    };
  }
  return {
    eyebrow: "Unable to determine",
    title: "The result could not be interpreted",
    message: reasonCopy ?? "The scoring response did not contain enough valid information to determine a result.",
    canTryAgain: true,
  };
}

function MissingOutcome({ onReturn }: { onReturn: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <h1 className="text-2xl font-semibold text-slate-900">No completed scan is available</h1>
      <p className="mt-2 text-sm text-slate-500">Scan evidence is kept in memory and is cleared when the page is reloaded.</p>
      <button type="button" onClick={onReturn} className="mt-6 rounded-full bg-emerald-700 px-6 py-3 text-sm font-semibold text-white">
        Return to scan setup
      </button>
    </div>
  );
}
