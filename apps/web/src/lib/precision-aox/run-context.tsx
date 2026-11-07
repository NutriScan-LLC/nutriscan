'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_PRECISION_AOX_MEASUREMENT_COUNT } from '@nutriscan/scoring/quick-aox';
import type { PrecisionAoxWorkflowEvent, PrecisionAoxWorkflowOutcome } from '@nutriscan/workflows';
import { detectScannerConnection, type ScannerConnection } from '@/lib/quick-aox/scanner-connection';
import { BrowserPrecisionAoxSession } from './browser-workflow';
import { BrowserPrecisionAoxWifiSession } from './wifi-browser-workflow';
import { ScannerRunGuard, type SafeScannerDiagnosticReport } from '../scanner-session-diagnostic';

type PrecisionAoxRunContextValue = {
  capability: 'checking' | 'supported' | 'unsupported';
  /** 'wifi' inside the NutriScan app, 'usb' with Web Serial; null while checking/unsupported. */
  connection: ScannerConnection | null;
  event: PrecisionAoxWorkflowEvent | null;
  outcome: PrecisionAoxWorkflowOutcome | null;
  running: boolean;
  measurementCount: number;
  diagnostic: SafeScannerDiagnosticReport | null;
  startRun: () => void;
  beginMeasurement: () => void;
  authorizeReplacement: () => void;
  cancel: () => void;
  clearCompletedRun: () => void;
  releaseConnection: () => Promise<void>;
};

const Context = createContext<PrecisionAoxRunContextValue | null>(null);

export function PrecisionAoxRunProvider({ children }: { children: ReactNode }) {
  const [capability, setCapability] = useState<PrecisionAoxRunContextValue['capability']>('checking');
  const [connection, setConnection] = useState<ScannerConnection | null>(null);
  const [event, setEvent] = useState<PrecisionAoxWorkflowEvent | null>(null);
  const [outcome, setOutcome] = useState<PrecisionAoxWorkflowOutcome | null>(null);
  const [running, setRunning] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const beginRef = useRef<(() => void) | null>(null);
  const replacementRef = useRef<(() => void) | null>(null);
  const sessionRef = useRef<BrowserPrecisionAoxSession | BrowserPrecisionAoxWifiSession | null>(null);
  const runGuardRef = useRef(new ScannerRunGuard());
  const [diagnostic, setDiagnostic] = useState<SafeScannerDiagnosticReport | null>(null);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const detected = detectScannerConnection();
      setConnection(detected);
      setCapability(detected ? 'supported' : 'unsupported');
    });
    return () => {
      active = false;
      controllerRef.current?.abort('NutriScan closed the active Precision workflow');
      void sessionRef.current?.disconnect();
    };
  }, []);

  const startRun = useCallback(() => {
    const detected = detectScannerConnection();
    if (!detected) return;
    const guardRunId = crypto.randomUUID();
    if (!runGuardRef.current.tryStart(guardRunId)) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    beginRef.current = null;
    replacementRef.current = null;
    setEvent(null);
    setOutcome(null);
    setRunning(true);
    const session = sessionRef.current ?? (detected === 'wifi'
      ? new BrowserPrecisionAoxWifiSession()
      : new BrowserPrecisionAoxSession(undefined, setDiagnostic));
    sessionRef.current = session;
    session.startDiagnosticRun();
    const settlement = session.workflow.run({
      language: 'en',
      measurementCount: DEFAULT_PRECISION_AOX_MEASUREMENT_COUNT,
      createUuid: () => crypto.randomUUID(),
      signal: controller.signal,
      onProgress: setEvent,
      waitForMeasurementBegin: ({ measurementIndex, attemptKind, signal }) => {
        if (shouldAutoBeginPrecisionMeasurement(measurementIndex, attemptKind)) return Promise.resolve();
        return new Promise<void>((resolve, reject) => {
        const onAbort = () => { beginRef.current = null; reject(signal?.reason ?? new DOMException('Aborted', 'AbortError')); };
        beginRef.current = () => { signal?.removeEventListener('abort', onAbort); beginRef.current = null; resolve(); };
        signal?.addEventListener('abort', onAbort, { once: true });
        });
      },
      waitForReplacement: ({ signal }) => new Promise<'replace'>((resolve, reject) => {
        const onAbort = () => { replacementRef.current = null; reject(signal?.reason ?? new DOMException('Aborted', 'AbortError')); };
        replacementRef.current = () => { signal?.removeEventListener('abort', onAbort); replacementRef.current = null; resolve('replace'); };
        signal?.addEventListener('abort', onAbort, { once: true });
      }),
    }).then(async (completed) => {
      if (!runGuardRef.current.isCurrent(guardRunId)) return;
      if (completed.kind === 'failed' || completed.kind === 'cancelled') await session.recoverConnection().catch(() => {});
      if (!runGuardRef.current.isCurrent(guardRunId)) return;
      setOutcome(completed);
      setRunning(false);
      controllerRef.current = null;
      beginRef.current = null;
      replacementRef.current = null;
    }).catch(async (cause: unknown) => {
      if (!runGuardRef.current.isCurrent(guardRunId)) return;
      await session.recoverConnection().catch(() => {});
      if (!runGuardRef.current.isCurrent(guardRunId)) return;
      setOutcome({ kind: 'failed', phase: 'planning-measurement', message: cause instanceof Error ? cause.message : 'Precision AOX could not start', cause, retainedSeries: [], discardedUuids: [] });
      setRunning(false);
    }).finally(() => {
      runGuardRef.current.finish(guardRunId);
    });
    runGuardRef.current.attach(guardRunId, settlement);
  }, []);

  const beginMeasurement = useCallback(() => beginRef.current?.(), []);
  const authorizeReplacement = useCallback(() => replacementRef.current?.(), []);
  const cancel = useCallback(() => controllerRef.current?.abort('Cancelled by the user'), []);
  const clearCompletedRun = useCallback(() => { if (!running) { setEvent(null); setOutcome(null); } }, [running]);
  const releaseConnection = useCallback(async () => {
    controllerRef.current?.abort('Switching scan type before measurement');
    beginRef.current = null;
    replacementRef.current = null;
    await runGuardRef.current.awaitCurrentSettlement();
    await sessionRef.current?.recoverConnection();
    controllerRef.current = null;
    setRunning(false);
    setEvent(null);
    setOutcome(null);
  }, []);

  return <Context.Provider value={{
    capability, connection, event, outcome, running, diagnostic, measurementCount: DEFAULT_PRECISION_AOX_MEASUREMENT_COUNT,
    startRun, beginMeasurement, authorizeReplacement, cancel, clearCompletedRun, releaseConnection,
  }}>{children}</Context.Provider>;
}

export function usePrecisionAoxRun(): PrecisionAoxRunContextValue {
  const value = useContext(Context);
  if (!value) throw new Error('usePrecisionAoxRun must be used within PrecisionAoxRunProvider');
  return value;
}

/** Planned measurements after the first move directly into hand detection; replacements never do. */
export function shouldAutoBeginPrecisionMeasurement(
  measurementIndex: number,
  attemptKind: 'planned' | 'replacement',
): boolean {
  return measurementIndex > 1 && attemptKind === 'planned';
}
