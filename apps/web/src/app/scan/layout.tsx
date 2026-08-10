"use client";

import { useRouter } from "next/navigation";
import { ChevronLeftIcon } from "@/components/icons";
import ScanStepper from "@/components/scan/ScanStepper";
import { useQuickAoxRun } from "@/lib/quick-aox/run-context";

// Shared chrome for the whole scanner flow: Welcome → System Check →
// Instructions → Scan → Processing → Results. This is the ONLY navigation
// the flow gets — the site header (logo/nav/user menu/Begin Scan) is
// suppressed for every /scan route in Header.tsx, so the experience reads
// as a focused wizard rather than a marketing page. No auth gate here —
// signing in only happens after Results, when there's an actual scan to
// save (see scan/results/page.tsx), so every screen up to and including
// Results is open to signed-out visitors.
export default function ScanLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { cancel } = useQuickAoxRun();

  function exitScan() {
    cancel();
    router.push("/");
  }

  return (
    <div className="flex flex-1 flex-col bg-slate-50">
      <div className="border-b border-slate-100 bg-white px-6 py-5">
        <div className="mx-auto flex max-w-4xl items-center gap-4 sm:gap-8">
          <button
            type="button"
            onClick={exitScan}
            className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-800"
          >
            <ChevronLeftIcon className="h-4 w-4" />
            Exit Scan
          </button>
          <ScanStepper />
        </div>
      </div>

      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
