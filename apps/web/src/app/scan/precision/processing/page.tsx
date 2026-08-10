'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { SparkleIcon } from '@/components/icons';
import { usePrecisionAoxRun } from '@/lib/precision-aox/run-context';

export default function PrecisionProcessingPage() {
  const router = useRouter();
  const { event, outcome, running, cancel } = usePrecisionAoxRun();
  useEffect(() => { if (outcome) router.replace(outcome.kind === 'accepted' ? '/scan/precision/results' : '/scan/precision/outcome'); }, [outcome, router]);
  const status = event?.state === 'precision-pre-requesting' ? 'Preparing the Precision scoring window' : event?.state === 'precision-waiting-to-submit' ? 'Waiting for the required scoring window' : event?.state === 'precision-submitting' ? 'Submitting the retained four-measurement series' : event?.state === 'precision-parsing' ? 'Validating the Precision response' : 'Preparing the final merge';
  return <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
    <span className="flex h-16 w-16 animate-pulse items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><SparkleIcon className="h-7 w-7" /></span>
    <p className="mt-6 text-xs font-semibold uppercase tracking-widest text-emerald-700">Precision Scan</p><h1 className="mt-2 text-3xl font-semibold text-slate-900">Calculating your Precision result</h1><p className="mt-3 text-sm text-slate-500">{status}</p>
    <button type="button" disabled={!running} onClick={cancel} className="mt-8 text-sm text-slate-400 disabled:opacity-50">Cancel processing</button>
  </div>;
}
