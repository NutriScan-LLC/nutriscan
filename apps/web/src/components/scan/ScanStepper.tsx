"use client";

import { usePathname } from "next/navigation";
import { CheckCircleIcon } from "@/components/icons";

// The one continuous progress system for the whole scanner experience —
// every screen from Welcome through Results is represented here in order,
// and every screen's chrome renders this same component so progress reads
// as a single sequence rather than several disconnected mini-flows.
const STEPS = [
  { label: "Welcome", path: "/scan/welcome" },
  { label: "System Check", path: "/scan/system-check" },
  { label: "Instructions", path: "/scan" },
  { label: "Scan", path: "/scan/in-progress" },
  { label: "Processing", path: "/scan/processing" },
  { label: "Results", path: "/scan/results" },
];

export default function ScanStepper() {
  const pathname = usePathname();
  const activeIndex = Math.max(
    0,
    STEPS.findIndex((step) => step.path === pathname),
  );

  return (
    <ol className="mx-auto flex w-full max-w-xl items-center" aria-label="Scan progress">
      {STEPS.map((step, index) => {
        const isComplete = index < activeIndex;
        const isActive = index === activeIndex;
        return (
          <li key={step.path} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center gap-1.5">
              <span
                className={
                  "flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition-colors " +
                  (isComplete
                    ? "bg-emerald-700 text-white"
                    : isActive
                      ? "bg-emerald-100 text-emerald-700 ring-2 ring-emerald-600"
                      : "bg-slate-100 text-slate-400")
                }
              >
                {isComplete ? <CheckCircleIcon className="h-4 w-4" /> : index + 1}
              </span>
              <span
                className={
                  "hidden text-[11px] font-medium sm:block " +
                  (isActive || isComplete ? "text-slate-700" : "text-slate-400")
                }
              >
                {step.label}
              </span>
            </div>
            {index < STEPS.length - 1 && (
              <span
                className={
                  "mx-2 h-px flex-1 " + (isComplete ? "bg-emerald-600" : "bg-slate-200")
                }
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
