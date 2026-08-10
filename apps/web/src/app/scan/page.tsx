"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowRightIcon,
  ClockIcon,
  DropletIcon,
  HandIcon,
  SparkleIcon,
  SunIcon,
} from "@/components/icons";
import { useQuickAoxRun } from "@/lib/quick-aox/run-context";
import { usePrecisionAoxRun } from "@/lib/precision-aox/run-context";
import { handoffScannerSession } from "@/lib/scan-session-handoff";

type ScanType = "quick" | "precision";

const INSTRUCTIONS = [
  {
    icon: HandIcon,
    title: "Place your hand correctly",
    body: "Align the right edge of your palm next to the indicator icons.",
  },
  {
    icon: ClockIcon,
    title: "Hold still",
    body: "Keep your hand steady until the scan finishes.",
  },
  {
    icon: DropletIcon,
    title: "Keep your hand clean and dry",
    body: "For the most consistent measurements.",
  },
  {
    icon: SunIcon,
    title: "Scan under normal indoor lighting",
    body: "Avoid direct sunlight.",
  },
];

export default function ScanInstructionsPage() {
  const router = useRouter();
  const [agreed, setAgreed] = useState(false);
  const [scanType, setScanType] = useState<ScanType | null>(null);
  const [switching, setSwitching] = useState(false);
  const { event, running, beginScan, releaseConnection } = useQuickAoxRun();
  const precision = usePrecisionAoxRun();
  const quickReady = running && event?.state === "awaiting-begin";
  const precisionReady = precision.running && precision.event?.state === "constituent-progress" && precision.event.event.state === "awaiting-begin";
  const ready = scanType === "quick" ? quickReady : scanType === "precision" ? precisionReady : false;

  async function selectPrecision() {
    if (scanType || switching) return;
    setSwitching(true);
    setScanType("precision");
    await handoffScannerSession(releaseConnection, () => {
      precision.clearCompletedRun();
      precision.startRun();
    });
    setSwitching(false);
  }

  function handleContinue() {
    if (!ready || !scanType) return;
    if (scanType === "quick") {
      beginScan();
      router.push("/scan/in-progress");
    } else {
      precision.beginMeasurement();
      router.push("/scan/precision/in-progress");
    }
  }

  return (
    <div className="flex flex-1 justify-center px-6 py-10 sm:py-12">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="w-full max-w-4xl"
      >
        <div className="mx-auto flex max-w-md flex-col items-center text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
            Before your scan
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">
            Follow these simple steps for the most accurate results.
          </p>
        </div>

        {/* Image (left) + instruction rows (right) on desktop; image stacks
            above the instructions on tablet and mobile. The image gets the
            larger 3fr share of the row — it's the most important element
            on the page. */}
        <div className="mt-8 grid gap-6 lg:grid-cols-[3fr_2fr] lg:items-center lg:gap-10">
          <Image
            src="/instructions-hand-placement.jpg"
            alt="Correct hand placement on the scanner, palm flat and aligned with the indicator icons"
            width={1200}
            height={900}
            className="h-auto w-full rounded-2xl object-contain shadow-md shadow-slate-900/10"
            sizes="(min-width: 1024px) 60vw, 100vw"
            priority
          />

          <div className="flex flex-col gap-2.5">
            {INSTRUCTIONS.map(({ icon: Icon, title, body }, index) => (
              <motion.div
                key={title}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: 0.1 + index * 0.06 }}
                className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-3"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
                  <Icon className="h-4 w-4" />
                </span>
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
                  <p className="mt-0.5 text-sm leading-relaxed text-slate-600">
                    {body}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        <div className="mt-6">
          <p className="text-sm font-semibold text-slate-900">Choose your scan type</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <ScanTypeButton
              selected={scanType === "quick"}
              disabled={scanType !== null && scanType !== "quick"}
              title="Quick AOX scan"
              detail="One measurement for a fast result."
              onClick={() => setScanType("quick")}
            />
            <ScanTypeButton
              selected={scanType === "precision"}
              disabled={scanType !== null && scanType !== "precision"}
              title="Precision Scan"
              detail="Four accepted measurements combined by BioZoom."
              onClick={() => void selectPrecision()}
            />
          </div>
          {scanType === "precision" && !precisionReady && (
            <p className="mt-3 text-center text-xs text-slate-500">Preparing the authorized scanner for Precision…</p>
          )}
        </div>

        <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
          />
          <span className="text-sm leading-relaxed text-slate-600">
            I understand how to perform the selected scan.
          </span>
        </label>

        <button
          type="button"
          disabled={!agreed || !ready || switching}
          onClick={handleContinue}
          className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-emerald-700 px-6 py-3.5 text-base font-semibold text-white shadow-sm ring-1 ring-emerald-700/10 transition-all hover:bg-emerald-800 hover:shadow-md disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none disabled:ring-0"
        >
          {scanType === "precision" ? "Begin Precision Scan" : scanType === "quick" ? "Begin Quick AOX scan" : "Select a scan type"}
          <ArrowRightIcon className="h-4 w-4" />
        </button>
      </motion.div>
    </div>
  );
}

function ScanTypeButton({ selected, disabled, title, detail, onClick }: {
  selected: boolean;
  disabled: boolean;
  title: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      className={"flex items-start gap-3 rounded-2xl border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 " +
        (selected ? "border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500" : "border-slate-200 bg-white hover:border-emerald-300")}
    >
      <span className={"mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full " + (selected ? "bg-emerald-600 text-white" : "bg-emerald-50 text-emerald-700")}>
        <SparkleIcon className="h-4.5 w-4.5" />
      </span>
      <span><span className="block text-sm font-semibold text-slate-900">{title}</span><span className="mt-1 block text-xs leading-relaxed text-slate-600">{detail}</span></span>
    </button>
  );
}
