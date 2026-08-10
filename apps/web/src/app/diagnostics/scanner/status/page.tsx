'use client';

import { useRef, useState } from 'react';
import {
  BrowserScannerStatusDiagnostic,
  SCANNER_STATUS_EXECUTION_PHRASE,
  type SanitizedScannerStatusResult,
} from '@/lib/scanner-status-diagnostic';

export default function ScannerStatusDiagnosticPage() {
  const [phrase, setPhrase] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SanitizedScannerStatusResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const diagnosticRef = useRef<BrowserScannerStatusDiagnostic | null>(null);
  const developmentOnly = process.env.NODE_ENV === 'development';

  async function execute(): Promise<void> {
    if (!developmentOnly || phrase !== SCANNER_STATUS_EXECUTION_PHRASE || running) return;
    setRunning(true);
    setResult(null);
    setError(null);
    try {
      const diagnostic = new BrowserScannerStatusDiagnostic();
      diagnosticRef.current = diagnostic;
      setResult(await diagnostic.runner.execute(phrase));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Scanner status diagnostic failed');
    } finally {
      setRunning(false);
    }
  }

  if (!developmentOnly) return <main className="mx-auto max-w-xl px-6 py-16"><h1 className="text-2xl font-semibold">Scanner status diagnostic unavailable</h1><p className="mt-3 text-sm text-slate-600">This permissioned diagnostic is available only in local development.</p></main>;

  return <main className="mx-auto w-full max-w-2xl px-6 py-12">
    <p className="text-xs font-semibold uppercase tracking-widest text-amber-700">Development diagnostic · Read only</p>
    <h1 className="mt-2 text-3xl font-semibold text-slate-900">Scanner status only</h1>
    <p className="mt-3 text-sm leading-relaxed text-slate-600">This action connects, identifies the selected scanner, reads one status snapshot, and disconnects. It does not measure, recognize a hand, read flash, delete, erase, reset, update firmware, or contact BioZoom.</p>
    <label className="mt-7 block text-sm font-semibold text-slate-800">Type <code>{SCANNER_STATUS_EXECUTION_PHRASE}</code> to authorize this one status read.</label>
    <input value={phrase} onChange={(event) => setPhrase(event.target.value)} autoComplete="off" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-mono text-sm" />
    <button type="button" disabled={running || phrase !== SCANNER_STATUS_EXECUTION_PHRASE} onClick={() => void execute()} className="mt-4 w-full rounded-full bg-emerald-700 px-6 py-3.5 font-semibold text-white disabled:bg-slate-300">{running ? 'Reading status…' : 'Select scanner and read status once'}</button>
    {error && <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><p className="font-semibold">Status diagnostic failed</p><p className="mt-1">{error}</p></div>}
    {result && <section className="mt-7 rounded-2xl border border-slate-200 bg-slate-50 p-5">
      <h2 className="font-semibold text-slate-900">Sanitized status summary</h2>
      <p className="mt-1 text-xs text-slate-500">Protocol {result.protocol}; identified through {result.identificationCommand}; captured {result.capturedAt}</p>
      <textarea aria-label="Sanitized scanner status" readOnly value={JSON.stringify(result.statusFields, null, 2)} className="mt-4 h-96 w-full rounded-xl border border-slate-200 bg-white p-3 font-mono text-xs text-slate-700" />
      <button type="button" onClick={() => void navigator.clipboard.writeText(JSON.stringify(result, null, 2))} className="mt-3 text-sm font-semibold text-emerald-700">Copy sanitized status</button>
    </section>}
  </main>;
}
