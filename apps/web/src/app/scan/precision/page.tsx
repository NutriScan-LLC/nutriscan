'use client';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowRightIcon } from '@/components/icons';
import { usePrecisionAoxRun } from '@/lib/precision-aox/run-context';

export default function PrecisionInstructionsPage() {
  const router = useRouter();
  const [agreed, setAgreed] = useState(false);
  const { event, running, beginMeasurement, measurementCount } = usePrecisionAoxRun();
  const ready = running && event?.state === 'constituent-progress' && event.event.state === 'awaiting-begin';
  return <div className="flex flex-1 justify-center px-6 py-10"><div className="w-full max-w-4xl">
    <div className="text-center"><p className="text-xs font-semibold uppercase tracking-widest text-emerald-700">Precision Scan</p><h1 className="mt-2 text-3xl font-semibold text-slate-900">Measurement 1 of {measurementCount}</h1><p className="mt-2 text-sm text-slate-500">Begin first, then place your hand when the scanner asks for it.</p></div>
    <div className="mt-8 grid gap-6 lg:grid-cols-[3fr_2fr] lg:items-center">
      <Image src="/instructions-hand-placement.jpg" alt="Correct hand placement on the scanner" width={1200} height={900} className="w-full rounded-2xl shadow-md" priority />
      <div className="rounded-3xl border border-slate-200 bg-white p-6 text-sm leading-relaxed text-slate-600">
        <p className="font-semibold text-slate-900">For each measurement</p>
        <ol className="mt-3 list-inside list-decimal space-y-2"><li>Place your hand when prompted.</li><li>Hold still through 100% validation.</li><li>Remove your hand when prompted.</li></ol>
        <p className="mt-4">NutriScan will score each measurement before deliberately moving to the next one.</p>
      </div>
    </div>
    <label className="mt-6 flex gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600"><input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />I understand the four-measurement sequence.</label>
    <button type="button" disabled={!agreed || !ready} onClick={() => { beginMeasurement(); router.push('/scan/precision/in-progress'); }} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full bg-emerald-700 px-6 py-3.5 font-semibold text-white disabled:bg-slate-300">Begin measurement 1 <ArrowRightIcon className="h-4 w-4" /></button>
  </div></div>;
}
