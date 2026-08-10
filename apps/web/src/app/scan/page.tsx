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
  const { event, running, confirmHandPositioned } = useQuickAoxRun();
  const ready = running && event?.state === "awaiting-hand-position";

  function handleContinue() {
    if (!ready) return;
    confirmHandPositioned();
    router.push("/scan/in-progress");
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

        <div className="mt-6 flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
            <SparkleIcon className="h-4.5 w-4.5" />
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-900">Quick AOX scan</p>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-600">
              One measurement will begin only after you confirm your hand is positioned.
            </p>
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
          disabled={!agreed || !ready}
          onClick={handleContinue}
          className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-emerald-700 px-6 py-3.5 text-base font-semibold text-white shadow-sm ring-1 ring-emerald-700/10 transition-all hover:bg-emerald-800 hover:shadow-md disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none disabled:ring-0"
        >
          Start scan
          <ArrowRightIcon className="h-4 w-4" />
        </button>
      </motion.div>
    </div>
  );
}
