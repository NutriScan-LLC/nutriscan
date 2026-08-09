"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { SparkleIcon } from "@/components/icons";
import { scannerService } from "@/services/scanner";

const STAGES = [
  "Reading carotenoid levels",
  "Comparing to your history",
  "Calculating your NutriScore",
];

export default function ScanProcessingPage() {
  const router = useRouter();
  const [stageIndex, setStageIndex] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    const stageTimer = setInterval(() => {
      setStageIndex((i) => Math.min(i + 1, STAGES.length - 1));
    }, 650);

    scannerService.analyzeScan({ signal: controller.signal }).then((result) => {
      clearInterval(stageTimer);
      if (!controller.signal.aborted) {
        const params = new URLSearchParams({
          score: String(result.score),
          delta: String(result.delta),
        });
        router.push(`/scan/results?${params.toString()}`);
      }
    });

    return () => {
      controller.abort();
      clearInterval(stageTimer);
    };
  }, [router]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-12">
      <motion.span
        animate={{ rotate: 360 }}
        transition={{ duration: 2.2, repeat: Infinity, ease: "linear" }}
        className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"
      >
        <SparkleIcon className="h-7 w-7" />
      </motion.span>

      <h1 className="mt-6 text-2xl font-semibold tracking-tight text-slate-900">
        Analyzing your results
      </h1>

      <div className="relative mt-2 h-6">
        <AnimatePresence mode="wait">
          <motion.p
            key={STAGES[stageIndex]}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25 }}
            className="text-sm text-slate-500"
          >
            {STAGES[stageIndex]}
          </motion.p>
        </AnimatePresence>
      </div>
    </div>
  );
}
