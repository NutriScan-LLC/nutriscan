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
  WifiRingsIcon,
} from "@/components/icons";
import ScannerLayout from "@/components/scan/ScannerLayout";
import { useQuickAoxRun } from "@/lib/quick-aox/run-context";
import { usePrecisionAoxRun } from "@/lib/precision-aox/run-context";
import { handoffScannerSession } from "@/lib/scan-session-handoff";

type CheckStatus = "pending" | "checking" | "success" | "failure";

export default function ScanSystemCheckPage() {
  const router = useRouter();
  const { capability, connection, event, outcome, running, startRun, clearCompletedRun } = useQuickAoxRun();
  const wifi = connection === "wifi";
  const { releaseConnection: releasePrecisionConnection } = usePrecisionAoxRun();
  const identified = event?.state === "awaiting-begin";

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

  async function connect() {
    await handoffScannerSession(releasePrecisionConnection, () => {
      clearCompletedRun();
      startRun();
    });
  }

  return (
    <ScannerLayout
      eyebrow="Quick check"
      title="Checking your setup"
      description={wifi
        ? "NutriScan connects to your scanner over the scanner’s own Wi-Fi."
        : "NutriScan uses Web Serial to connect securely to your scanner."}
      primaryAction={{
        label: running ? "Connecting to scanner…" : "Connect scanner",
        onClick: () => void connect(),
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
        {wifi ? (
          <CheckRow
            icon={WifiRingsIcon}
            label="NutriScan app Wi-Fi connection"
            status={serialStatus}
            detail="Ready to reach the scanner over its Wi-Fi"
          />
        ) : (
          <CheckRow
            icon={UsbIcon}
            label="Web Serial supported"
            status={serialStatus}
            detail={serialStatus === "success"
              ? "Web Serial is available"
              : serialStatus === "failure"
                ? "Use the latest Chrome or Edge on a desktop computer, or the NutriScan app."
                : "Checking Web Serial support…"}
          />
        )}
        <CheckRow
          icon={ScannerDeviceIcon}
          label="Scanner identified"
          status={scannerStatus}
          detail={identified && event.state === "awaiting-begin"
            ? `Scanner ${event.identity.serial ?? "identified"}`
            : scannerStatus === "checking"
              ? event?.state === "identifying"
                ? "Identifying scanner…"
                : wifi ? "Looking for the scanner on Wi-Fi…" : "Choose your scanner in the browser prompt…"
              : scannerStatus === "failure"
                ? outcome?.kind === "failed" ? outcome.message : "Scanner connection was cancelled."
                : "Connect and select your scanner to continue."}
        />
      </ul>

      {wifi && !identified && (
        <div className="mt-4 rounded-2xl border border-sky-200 bg-sky-50/70 p-4 text-sm leading-relaxed text-sky-900">
          <p className="font-medium">Before you connect</p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5">
            <li>Turn the scanner on and close the Biozoom app.</li>
            <li>Keep cellular data on. Your result is scored online.</li>
            <li>In Settings → Wi-Fi, join the network that starts with <span className="font-mono">biozoomAP_</span>.</li>
            <li>Come back here and tap Connect scanner.</li>
          </ol>
        </div>
      )}

      <AnimatePresence>
        {capability === "unsupported" && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/70 p-4 text-sm leading-relaxed text-amber-900"
          >
            This browser cannot connect to the scanner. Open NutriScan in the latest Chrome or Edge on a desktop computer, or use the NutriScan app with a Wi-Fi scanner.
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
