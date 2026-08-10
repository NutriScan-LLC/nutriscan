'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangleIcon } from '@/components/icons';
import { DEFAULT_QUICK_AOX_PRESENTATION } from '@nutriscan/scoring/quick-aox';
import { usePrecisionAoxRun } from '@/lib/precision-aox/run-context';
import { formatSafeScannerDiagnostic } from '@/lib/scanner-session-diagnostic';

export default function PrecisionOutcomePage() {
  const router = useRouter();
  const { event, outcome, running, authorizeReplacement, clearCompletedRun, diagnostic } = usePrecisionAoxRun();
  const rejected = event?.state === 'constituent-rejected' ? event : null;
  useEffect(() => { if (event?.state === 'replacement-planned') router.replace('/scan/precision/in-progress'); }, [event, router]);
  if (rejected) {
    const result = 'result' in rejected.outcome ? rejected.outcome.result : undefined;
    const reason = result?.decision.reason;
    return <Card eyebrow="Measurement rejected" title={`Measurement ${rejected.measurementIndex} of ${rejected.measurementCount} was not retained`} message={reason ? DEFAULT_QUICK_AOX_PRESENTATION[reason] ?? 'The measurement did not pass its quality check.' : 'The measurement could not be retained.'}>
      <button type="button" disabled={!running} onClick={authorizeReplacement} className="mt-6 w-full rounded-full bg-emerald-700 px-6 py-3.5 font-semibold text-white disabled:opacity-50">Deliberately replace measurement {rejected.measurementIndex}</button>
    </Card>;
  }
  if (!outcome || outcome.kind === 'accepted') return <Card eyebrow="No outcome" title="No Precision failure is available" message="Precision evidence is kept in memory only." />;
  return <Card eyebrow={outcome.kind === 'cancelled' ? 'Workflow stopped' : 'Unable to complete'} title={outcome.kind === 'cancelled' ? 'Precision workflow was cancelled' : 'Precision Scan could not be completed'} message={outcome.kind === 'failed' ? outcome.message : 'NutriScan stopped software activity and did not issue a scanner stop or delete command.'}>
    {outcome.kind === 'failed' && outcome.diagnostic && <div className="mt-4 rounded-2xl bg-slate-50 p-3 text-left text-xs text-slate-500"><p>Diagnostic: {outcome.diagnostic.code}</p><p>Reference: {outcome.diagnostic.requestId}</p></div>}
    {outcome.kind === 'failed' && diagnostic && <details className="mt-4 text-left"><summary className="cursor-pointer text-xs font-semibold text-slate-600">Sanitized scanner diagnostic</summary><textarea aria-label="Sanitized scanner diagnostic" readOnly value={formatSafeScannerDiagnostic(diagnostic)} className="mt-2 h-48 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 font-mono text-[10px] text-slate-600" /><button type="button" onClick={() => void navigator.clipboard.writeText(formatSafeScannerDiagnostic(diagnostic))} className="mt-2 text-xs font-semibold text-emerald-700">Copy sanitized diagnostic</button></details>}
    <button type="button" onClick={() => { clearCompletedRun(); router.replace('/scan/precision/system-check'); }} className="mt-6 w-full rounded-full bg-emerald-700 px-6 py-3.5 font-semibold text-white">Start a new Precision Scan</button>
  </Card>;
}

function Card({ eyebrow, title, message, children }: { eyebrow: string; title: string; message: string; children?: React.ReactNode }) {
  return <div className="flex flex-1 items-center justify-center px-6"><div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-7 text-center shadow-sm"><span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-amber-700"><AlertTriangleIcon className="h-6 w-6" /></span><p className="mt-5 text-xs font-semibold uppercase tracking-widest text-amber-700">{eyebrow}</p><h1 className="mt-2 text-2xl font-semibold text-slate-900">{title}</h1><p className="mt-3 text-sm text-slate-600">{message}</p>{children}</div></div>;
}
