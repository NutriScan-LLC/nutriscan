'use client';
import Link from 'next/link';
import QuickAoxResultGauge from '@/components/QuickAoxResultGauge';
import { usePrecisionAoxRun } from '@/lib/precision-aox/run-context';

export default function PrecisionResultsPage() {
  const { outcome } = usePrecisionAoxRun();
  if (outcome?.kind !== 'accepted') return <div className="flex flex-1 items-center justify-center text-center"><div><h1 className="text-2xl font-semibold">No Precision result is available</h1><Link href="/scan/precision/welcome" className="mt-5 inline-block rounded-full bg-emerald-700 px-6 py-3 text-white">Return to setup</Link></div></div>;
  return <div className="flex flex-1 items-center justify-center px-6 py-10"><div className="w-full max-w-md text-center">
    <p className="text-xs font-semibold uppercase tracking-widest text-emerald-700">Precision Scan complete</p><h1 className="mt-2 text-3xl font-semibold text-slate-900">Your Precision antioxidant level</h1><p className="mt-2 text-sm text-slate-500">Calculated by the scoring service from {outcome.retainedSeries.length} retained measurements.</p>
    <div className="mt-6 rounded-3xl border border-slate-200 bg-white px-7 py-8 shadow-sm"><QuickAoxResultGauge aox={outcome.score} /></div>
    <Link href="/scan/precision/welcome" className="mt-6 inline-flex w-full justify-center rounded-full bg-emerald-700 px-6 py-3.5 font-semibold text-white">New Precision Scan</Link><Link href="/history" className="mt-3 inline-flex w-full justify-center rounded-full border border-slate-200 px-6 py-3 text-sm text-slate-700">View history</Link>
  </div></div>;
}
