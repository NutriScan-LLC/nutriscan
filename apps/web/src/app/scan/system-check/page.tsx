"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangleIcon,
  BrowserIcon,
  CheckCircleIcon,
  RefreshIcon,
  ScannerDeviceIcon,
  UsbIcon,
} from "@/components/icons";
import ScannerLayout from "@/components/scan/ScannerLayout";
import { useQuickAoxRun } from "@/lib/quick-aox/run-context";

type CheckStatus = "pending" | "checking" | "success" | "failure";

export default function ScanSystemCheckPage() {
  const router = useRouter();
  const { capability, event, outcome, running, startRun, clearCompletedRun } = useQuickAoxRun();
  const identified = event?.state === "awaiting-hand-position";

  useEffect(() => {
    if (identified) router.push("/scan");
  }, [identified, router]);

  const browserStatus: CheckStatus = capability === "checking" ? "checking" : "success";
  const serialStatus: CheckStatus = capability === "checking"
    ? "checking"
    : capability === "supported" ? "success" : "failure";
  const scannerStatus: CheckStatus = identified
    ? "success"
    : outcome?.kind === "failed" || outcome?.kind === "cancelled"
      ? "failure"
      : running ? "checking" : "pending";

  function connect() {
    clearCompletedRun();
    startRun();
  }

  return (
    <ScannerLayout
      eyebrow="Quick check"
      title="Checking your setup"
      description="NutriScan uses Web Serial to connect securely to your scanner."
      primaryAction={{
        label: running ? "Connecting to scanner…" : "Connect scanner",
        onClick: connect,
        disabled: capability !== "supported" || running,
      }}
    >
      <ul className="flex flex-col gap-3">
        <CheckRow
          icon={BrowserIcon}
          label="Browser supported"
          status={browserStatus}
          detail={browserStatus === "success" ? "Running a compatible browser" : "Checking your browser…"}
        />
        <CheckRow
          icon={UsbIcon}
          label="Web Serial supported"
          status={serialStatus}
          detail={serialStatus === "success"
            ? "Web Serial is available"
            : serialStatus === "failure"
              ? "Use the latest Chrome or Edge on a desktop computer."
              : "Checking Web Serial support…"}
        />
        <CheckRow
          icon={ScannerDeviceIcon}
          label="Scanner identified"
          status={scannerStatus}
          detail={identified && event.state === "awaiting-hand-position"
            ? `Scanner ${event.identity.serial ?? "identified"}`
            : scannerStatus === "checking"
              ? event?.state === "identifying" ? "Identifying scanner…" : "Choose your scanner in the browser prompt…"
              : scannerStatus === "failure"
                ? outcome?.kind === "failed" ? outcome.message : "Scanner connection was cancelled."
                : "Connect and select your scanner to continue."}
        />
      </ul>

      <AnimatePresence>
        {capability === "unsupported" && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/70 p-4 text-sm leading-relaxed text-amber-900"
          >
            This browser cannot connect to the scanner. Open NutriScan in the latest Chrome or Edge on a desktop computer.
          </motion.div>
        )}
      </AnimatePresence>
    </ScannerLayout>
  );
}

function CheckRow({
  icon: Icon,
  label,
  status,
  detail,
}: {
  icon: typeof BrowserIcon;
  label: string;
  status: CheckStatus;
  detail: string;
}) {
  const failed = status === "failure";
  return (
    <motion.li
      layout
      className={
        "rounded-2xl border p-4 transition-colors " +
        (failed
          ? "border-amber-200 bg-amber-50/60"
          : status === "success"
            ? "border-emerald-100 bg-emerald-50/70"
            : "border-slate-200 bg-white")
      }
    >
      <div className="flex items-center gap-3">
        <span className={
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full " +
          (failed ? "bg-amber-100 text-amber-700" : status === "success"
            ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400")
        }>
          <Icon className="h-4.5 w-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-900">{label}</p>
          <p className="text-xs text-slate-500">{detail}</p>
        </div>
        {status === "success" ? <CheckCircleIcon className="h-5 w-5 text-emerald-600" />
          : status === "failure" ? <AlertTriangleIcon className="h-5 w-5 text-amber-600" />
            : status === "checking" ? <RefreshIcon className="h-4 w-4 animate-spin text-slate-400" />
              : <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />}
      </div>
    </motion.li>
  );
}
