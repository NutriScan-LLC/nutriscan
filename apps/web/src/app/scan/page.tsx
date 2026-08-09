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
  TargetIcon,
} from "@/components/icons";

// Durations here match the confirmed scan types in docs/Scanner.md
// ("Quick Scan — 30 seconds", "Precision Scan — 90 seconds") — do not
// change these without updating that doc first.
const SCAN_MODES = [
  {
    id: "quick" as const,
    icon: SparkleIcon,
    label: "Quick Scan",
    duration: "~30 seconds",
    durationMs: 30_000,
    tagline: "Best for everyday use",
  },
  {
    id: "precision" as const,
    icon: TargetIcon,
    label: "Precision Scan",
    duration: "~90 seconds",
    durationMs: 90_000,
    tagline: "Best for tracking changes over time",
  },
];

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
  const [mode, setMode] = useState<(typeof SCAN_MODES)[number]["id"]>("quick");
  const [agreed, setAgreed] = useState(false);

  function handleContinue() {
    const selected = SCAN_MODES.find((m) => m.id === mode)!;
    const params = new URLSearchParams({
      mode: selected.id,
      duration: String(selected.durationMs),
    });
    router.push(`/scan/in-progress?${params.toString()}`);
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
          <h2 className="text-sm font-semibold text-slate-900">
            Choose your scan
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {SCAN_MODES.map(({ id, icon: Icon, label, duration, tagline }, index) => {
              const selected = mode === id;
              return (
                <motion.button
                  key={id}
                  type="button"
                  onClick={() => setMode(id)}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, delay: 0.3 + index * 0.08 }}
                  aria-pressed={selected}
                  className={
                    "flex flex-col items-start gap-2 rounded-2xl border p-4 text-left transition-colors " +
                    (selected
                      ? "border-emerald-600 bg-emerald-50/70 ring-1 ring-emerald-600"
                      : "border-slate-200 bg-white hover:border-slate-300")
                  }
                >
                  <span
                    className={
                      "flex h-9 w-9 items-center justify-center rounded-full " +
                      (selected
                        ? "bg-emerald-600 text-white"
                        : "bg-emerald-50 text-emerald-700")
                    }
                  >
                    <Icon className="h-4.5 w-4.5" />
                  </span>
                  <div>
                    <p className="flex items-baseline gap-1.5 text-sm font-semibold text-slate-900">
                      {label}
                      <span className="text-xs font-medium text-slate-400">
                        {duration}
                      </span>
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
                      {tagline}
                    </p>
                  </div>
                </motion.button>
              );
            })}
          </div>
        </div>

        <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
          />
          <span className="text-sm leading-relaxed text-slate-600">
            I understand how to perform the scan.
          </span>
        </label>

        <button
          type="button"
          disabled={!agreed}
          onClick={handleContinue}
          className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-emerald-700 px-6 py-3.5 text-base font-semibold text-white shadow-sm ring-1 ring-emerald-700/10 transition-all hover:bg-emerald-800 hover:shadow-md disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none disabled:ring-0"
        >
          Continue
          <ArrowRightIcon className="h-4 w-4" />
        </button>
      </motion.div>
    </div>
  );
}
