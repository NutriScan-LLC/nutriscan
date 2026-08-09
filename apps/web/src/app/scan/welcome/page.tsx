"use client";

import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ClockIcon, HandIcon, NonInvasiveIcon, TrendUpIcon } from "@/components/icons";
import ScannerLayout from "@/components/scan/ScannerLayout";

// Reuses the homepage's supporting-benefit copy/icons so the promise made
// on the marketing page ("about 2 minutes, non-invasive, track progress")
// carries through into the flow instead of being restated differently here.
const BENEFITS = [
  { icon: ClockIcon, label: "About 2 minutes" },
  { icon: NonInvasiveIcon, label: "Non-invasive" },
  { icon: TrendUpIcon, label: "Track progress over time" },
];

export default function ScanWelcomePage() {
  const router = useRouter();

  return (
    <ScannerLayout
      icon={HandIcon}
      eyebrow="Let's get started"
      title="Ready for your scan?"
      description="We'll quickly check that your browser and scanner are ready, then walk you through everything before you begin."
      primaryAction={{
        label: "Get started",
        onClick: () => router.push("/scan/system-check"),
      }}
    >
      <motion.ul
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.15 }}
        className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 border-t border-slate-200 pt-6 text-sm text-slate-500"
      >
        {BENEFITS.map(({ icon: Icon, label }) => (
          <li key={label} className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-emerald-700" />
            <span>{label}</span>
          </li>
        ))}
      </motion.ul>
    </ScannerLayout>
  );
}
