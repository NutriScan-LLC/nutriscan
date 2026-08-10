'use client';

import { useState } from 'react';
import {
  BrowserScannerDeleteOnceDiagnostic,
  SCANNER_DELETE_ONCE_EXECUTION_PHRASE,
  type SanitizedScannerDeleteOnceResult,
} from '@/lib/scanner-delete-once-diagnostic';

export default function ScannerDeleteOnceDiagnosticPage() {
  const [phrase, setPhrase] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SanitizedScannerDeleteOnceResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const developmentOnly = process.env.NODE_ENV === 'development';

  async function execute(): Promise<void> {
    if (!developmentOnly || running || phrase !== SCANNER_DELETE_ONCE_EXECUTION_PHRASE) return;
    setRunning(true); setResult(null); setError(null);
    try {
      setResult(await new BrowserScannerDeleteOnceDiagnostic().runner.execute(phrase));
    } catch {
      setError('The diagnostic could not complete. The scanner was disconnected; no automatic retry was attempted.');
    } finally { setRunning(false); }
  }

  if (!developmentOnly) return <main className="mx-auto max-w-xl px-6 py-16"><h1 className="text-2xl font-semibold">Scanner diagnostic unavailable</h1><p className="mt-3 text-sm text-slate-600">This permissioned destructive diagnostic is available only in local development.</p></main>;

  return <main className="mx-auto w-full max-w-2xl px-6 py-12">
    <p className="text-xs font-semibold uppercase tracking-widest text-red-700">Development diagnostic · Destructive scope unknown</p>
    <h1 className="mt-2 text-3xl font-semibold text-slate-900">Single bare-delete diagnostic</h1>
    <div className="mt-5 rounded-2xl border border-red-300 bg-red-50 p-5 text-sm leading-relaxed text-red-950">
      <p className="font-semibold">Warning: the scanner-side scope of <code>delete</code> is unknown.</p>
      <p className="mt-2">This may delete an unspecified amount of scanner-resident measurement data. The action connects and identifies, reads status, sends exactly one call-index-correlated bare <code>delete</code>, waits no more than 10 seconds for its response, reads status once more, and disconnects.</p>
      <p className="mt-2">It does not erase the chip, start a measurement, recognize a hand, read flash, retry, loop, or contact BioZoom.</p>
    </div>
    <label className="mt-7 block text-sm font-semibold text-slate-800">Type <code>{SCANNER_DELETE_ONCE_EXECUTION_PHRASE}</code> to authorize exactly one bare delete.</label>
    <input value={phrase} onChange={(event) => setPhrase(event.target.value)} autoComplete="off" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-mono text-sm" />
    <button type="button" disabled={running || phrase !== SCANNER_DELETE_ONCE_EXECUTION_PHRASE} onClick={() => void execute()} className="mt-4 w-full rounded-full bg-red-700 px-6 py-3.5 font-semibold text-white disabled:bg-slate-300">{running ? 'Running one bare delete…' : 'Select scanner and execute once'}</button>
    {error && <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{error}</div>}
    {result && <section className="mt-7 rounded-2xl border border-slate-200 bg-slate-50 p-5">
      <h2 className="font-semibold text-slate-900">Sanitized diagnostic result</h2>
      <textarea aria-label="Sanitized bare-delete diagnostic" readOnly value={JSON.stringify(result, null, 2)} className="mt-4 h-96 w-full rounded-xl border border-slate-200 bg-white p-3 font-mono text-xs text-slate-700" />
      <button type="button" onClick={() => void navigator.clipboard.writeText(JSON.stringify(result, null, 2))} className="mt-3 text-sm font-semibold text-emerald-700">Copy sanitized result</button>
    </section>}
  </main>;
}
