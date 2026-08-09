"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
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
import { scannerService, type SystemCheckId, type SystemCheckStatus } from "@/services/scanner";

const ROW_ICONS = {
  browser: BrowserIcon,
  usb: UsbIcon,
  scanner: ScannerDeviceIcon,
} as const;

// Fetched once at module load — this is static metadata (labels/copy/
// icons), synchronous in both the mock and (eventually) real service, so
// there's no reason to re-fetch per render.
const SYSTEM_CHECKS = scannerService.getSystemChecks();

function initialState(): Record<SystemCheckId, SystemCheckStatus> {
  return Object.fromEntries(
    SYSTEM_CHECKS.map((check) => [check.id, "pending"]),
  ) as Record<SystemCheckId, SystemCheckStatus>;
}

export default function ScanSystemCheckPage() {
  return (
    <Suspense fallback={null}>
      <SystemCheckScreen />
    </Suspense>
  );
}

function SystemCheckScreen() {
  const searchParams = useSearchParams();

  // Demo-only affordance: visit /scan/system-check?fail=webusb (or
  // browser, scanner, or a comma-separated combination) to preview the
  // failure state without editing code. Has no effect on real behavior.
  const failing = (searchParams.get("fail")?.split(",").filter(Boolean) ??
    []) as SystemCheckId[];

  const [runId, setRunId] = useState(0);

  // Keying on runId remounts <ChecksRunner> from scratch on retry, so each
  // run starts from a clean "pending" state without reaching for setState
  // inside an effect.
  return (
    <ChecksRunner key={runId} failing={failing} onRetry={() => setRunId((n) => n + 1)} />
  );
}

function ChecksRunner({
  failing,
  onRetry,
}: {
  failing: SystemCheckId[];
  onRetry: () => void;
}) {
  const router = useRouter();
  const [statuses, setStatuses] = useState<Record<SystemCheckId, SystemCheckStatus>>(
    initialState,
  );

  useEffect(() => {
    const controller = new AbortController();

    scannerService.runSystemChecks(
      (id, status) => {
        setStatuses((prev) => ({ ...prev, [id]: status }));
      },
      { signal: controller.signal, failing },
    );

    return () => controller.abort();
    // `failing` is fixed for the lifetime of this mount (a retry remounts
    // via the `key` in the parent), so it's intentionally excluded here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const values = Object.values(statuses);
  const isChecking = values.includes("checking");
  const hasFailure = values.includes("failure");
  const allPassed = values.every((status) => status === "success");

  const primaryAction = allPassed
    ? { label: "Continue", onClick: () => router.push("/scan") }
    : hasFailure
      ? { label: "Try again", onClick: onRetry }
      : { label: "Checking your system…", onClick: () => {}, disabled: true };

  return (
    <ScannerLayout
      eyebrow="Quick check"
      title="Checking your setup"
      description="This only takes a second and never leaves your device."
      primaryAction={primaryAction}
    >
      <ul className="flex flex-col gap-3">
        {SYSTEM_CHECKS.map((check) => (
          <CheckRow
            key={check.id}
            check={check}
            status={statuses[check.id]}
          />
        ))}
      </ul>

      <AnimatePresence>
        {isChecking && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="mt-4 text-center text-xs text-slate-400"
          >
            Running checks…
          </motion.p>
        )}
      </AnimatePresence>
    </ScannerLayout>
  );
}

function CheckRow({
  check,
  status,
}: {
  check: (typeof SYSTEM_CHECKS)[number];
  status: SystemCheckStatus;
}) {
  const RowIcon = ROW_ICONS[check.icon];
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
        <span
          className={
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full " +
            (failed
              ? "bg-amber-100 text-amber-700"
              : status === "success"
                ? "bg-emerald-100 text-emerald-700"
                : "bg-slate-100 text-slate-400")
          }
        >
          <RowIcon className="h-4.5 w-4.5" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-900">{check.label}</p>
          <p className="truncate text-xs text-slate-500">
            {status === "success"
              ? check.successDetail
              : failed
                ? check.failureTitle
                : status === "checking"
                  ? "Checking…"
                  : "Not checked yet"}
          </p>
        </div>

        <StatusIcon status={status} />
      </div>

      <AnimatePresence>
        {failed && (
          <motion.p
            initial={{ opacity: 0, height: 0, marginTop: 0 }}
            animate={{ opacity: 1, height: "auto", marginTop: 10 }}
            exit={{ opacity: 0, height: 0, marginTop: 0 }}
            className="overflow-hidden text-xs leading-relaxed text-amber-800"
          >
            {check.failureDetail}
          </motion.p>
        )}
      </AnimatePresence>
    </motion.li>
  );
}

function StatusIcon({ status }: { status: SystemCheckStatus }) {
  if (status === "success") {
    return <CheckCircleIcon className="h-5 w-5 shrink-0 text-emerald-600" />;
  }
  if (status === "failure") {
    return <AlertTriangleIcon className="h-5 w-5 shrink-0 text-amber-600" />;
  }
  if (status === "checking") {
    return (
      <RefreshIcon className="h-4 w-4 shrink-0 animate-spin text-slate-400" />
    );
  }
  return <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />;
}
