'use client';
import Image from 'next/image';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { usePrecisionAoxRun } from '@/lib/precision-aox/run-context';

const FINAL_STATES = new Set(['series-complete', 'building-final-request', 'precision-pre-requesting', 'precision-waiting-to-submit', 'precision-submitting', 'precision-parsing']);
const RADIUS = 90;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export default function PrecisionInProgressPage() {
  const router = useRouter();
  const { event, outcome, running, beginMeasurement, cancel, measurementCount } = usePrecisionAoxRun();
  useEffect(() => {
    if (event?.state === 'constituent-rejected') router.replace('/scan/precision/outcome');
    else if (event && FINAL_STATES.has(event.state)) router.replace('/scan/precision/processing');
    else if (outcome) router.replace(outcome.kind === 'accepted' ? '/scan/precision/results' : '/scan/precision/outcome');
  }, [event, outcome, router]);
  const index = event && 'measurementIndex' in event ? event.measurementIndex : measurementCount;
  const attempt = event && 'attempt' in event ? event.attempt : 1;
  const quick = event?.state === 'constituent-progress' ? event.event : null;
  const ready = quick?.state === 'awaiting-begin' && attempt > 1;
  const downloading = quick?.state === 'downloading' ? quick : null;
  const percent = downloading ? Math.round(downloading.validBlocks / downloading.expectedBlocks * 100) : 0;
  const dashOffset = CIRCUMFERENCE * (1 - percent / 100);
  const place = quick?.state === 'detecting-hand';
  const remove = quick?.state === 'measurement-complete' || quick?.state === 'detecting-hand-removal';
  const scoring = quick && ['building-scoring-request', 'pre-requesting', 'waiting-to-submit', 'submitting', 'parsing', 'interpreting'].includes(quick.state);
  const title = ready ? `Measurement ${index} of ${measurementCount} ready` : place ? 'Place your hand on the scanner' : remove ? 'Remove your hand' : scoring ? `Scoring measurement ${index} of ${measurementCount}` : 'Hold still — scanning';
  return <div className="flex flex-1 items-center justify-center px-6 py-10"><div className="flex w-full max-w-md flex-col items-center text-center">
    <p className="text-xs font-semibold uppercase tracking-widest text-emerald-700">Precision Scan · Measurement {index} of {measurementCount}</p>
    <h1 className="mt-2 text-3xl font-semibold text-slate-900">{title}</h1>
    <p className="mt-2 text-sm text-slate-500">{ready ? 'Continue deliberately when you are ready for the next hand measurement.' : place ? 'The scanner will detect your hand automatically.' : remove ? 'Processing begins after removal is confirmed.' : scoring ? 'This Quick AOX result must pass quality before it is retained.' : 'Keep your hand still until all 5,773 blocks are validated.'}</p>
    <Image src="/instructions-hand-placement.jpg" alt="Hand placement" width={600} height={450} className="mt-7 w-full max-w-[275px] rounded-2xl shadow-md" />
    <div className="relative mt-7 flex h-48 w-48 items-center justify-center">
      <svg viewBox="0 0 200 200" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="100" cy="100" r={RADIUS} fill="none" stroke="#e2e8f0" strokeWidth="12" />
        <circle
          key={`${index}-${attempt}`}
          cx="100"
          cy="100"
          r={RADIUS}
          fill="none"
          stroke="#15803d"
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={dashOffset}
          style={{ transition: 'stroke-dashoffset 0.2s ease-out' }}
        />
      </svg>
      <span className="absolute text-5xl font-semibold text-slate-900" role="status">{percent}%</span>
    </div>
    {ready && <button type="button" onClick={beginMeasurement} className="mt-6 w-full rounded-full bg-emerald-700 px-6 py-3.5 font-semibold text-white">Begin measurement {index}</button>}
    <button type="button" disabled={!running} onClick={cancel} className="mt-6 text-sm font-medium text-slate-500 disabled:opacity-50">Stop software workflow</button>
    <p className="mt-2 text-xs text-slate-400">Stopping software does not stop a physical measurement already in progress.</p>
  </div></div>;
}
