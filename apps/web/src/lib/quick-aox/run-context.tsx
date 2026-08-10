"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  QuickAoxWorkflowEvent,
  QuickAoxWorkflowOutcome,
} from "@nutriscan/workflows";
import {
  BrowserQuickAoxSession,
  isWebSerialSupported,
} from "./browser-workflow";
import { requiresSerialRecovery } from "./retry-policy";
import { ScannerRunGuard, type SafeScannerDiagnosticReport } from "../scanner-session-diagnostic";

type Capability = "checking" | "supported" | "unsupported";

type QuickAoxRunContextValue = {
  capability: Capability;
  event: QuickAoxWorkflowEvent | null;
  outcome: QuickAoxWorkflowOutcome | null;
  running: boolean;
  recoveryRequired: boolean;
  diagnostic: SafeScannerDiagnosticReport | null;
  startRun: () => void;
  beginScan: () => void;
  cancel: () => void;
  clearCompletedRun: () => void;
  /** Releases an idle, pre-measurement session when the user selects another workflow. */
  releaseConnection: () => Promise<void>;
};

const QuickAoxRunContext = createContext<QuickAoxRunContextValue | null>(null);

export function QuickAoxRunProvider({ children }: { children: ReactNode }) {
  const [capability, setCapability] = useState<Capability>("checking");
  const [event, setEvent] = useState<QuickAoxWorkflowEvent | null>(null);
  const [outcome, setOutcome] = useState<QuickAoxWorkflowOutcome | null>(null);
  const [running, setRunning] = useState(false);
  const [recoveryRequired, setRecoveryRequired] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const beginRef = useRef<(() => void) | null>(null);
  const sessionRef = useRef<BrowserQuickAoxSession | null>(null);
  const runGuardRef = useRef(new ScannerRunGuard());
  const [diagnostic, setDiagnostic] = useState<SafeScannerDiagnosticReport | null>(null);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) setCapability(isWebSerialSupported() ? "supported" : "unsupported");
    });
    return () => {
      active = false;
      abortControllerRef.current?.abort("NutriScan closed the active workflow");
      void sessionRef.current?.disconnect();
    };
  }, []);

  const startRun = useCallback(() => {
    if (!isWebSerialSupported()) return;
    const guardRunId = crypto.randomUUID();
    if (!runGuardRef.current.tryStart(guardRunId)) return;
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    beginRef.current = null;
    setEvent(null);
    setOutcome(null);
    setRunning(true);
    setRecoveryRequired(false);

    const session = sessionRef.current ?? new BrowserQuickAoxSession(undefined, setDiagnostic);
    sessionRef.current = session;
    session.startDiagnosticRun();
    const workflow = session.workflow;
    const settlement = workflow.run({
      language: "en",
      createUuid: () => crypto.randomUUID(),
      signal: abortController.signal,
      waitForBegin: ({ signal }) => new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          beginRef.current = null;
          reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
        };
        const confirm = () => {
          signal?.removeEventListener("abort", onAbort);
          beginRef.current = null;
          resolve();
        };
        beginRef.current = confirm;
        signal?.addEventListener("abort", onAbort, { once: true });
      }),
      onProgress: setEvent,
      disconnectOnFinish: false,
    }).then(async (completedOutcome) => {
      if (!runGuardRef.current.isCurrent(guardRunId)) return;
      if (requiresSerialRecovery(completedOutcome)) {
        await session.recoverConnection().catch(() => {});
        if (!runGuardRef.current.isCurrent(guardRunId)) return;
        setRecoveryRequired(true);
      }
      setOutcome(completedOutcome);
      setRunning(false);
      abortControllerRef.current = null;
      beginRef.current = null;
    }).catch((error: unknown) => {
      if (!runGuardRef.current.isCurrent(guardRunId)) return;
      setOutcome({
        kind: "failed",
        failureKind: "scanner",
        phase: "connecting",
        message: error instanceof Error ? error.message : "The scan could not be started.",
        cause: error,
        physicalMeasurementStarted: false,
        physicalMeasurementMayHaveStarted: false,
      });
      setRunning(false);
      abortControllerRef.current = null;
      beginRef.current = null;
    }).finally(() => {
      runGuardRef.current.finish(guardRunId);
    });
    runGuardRef.current.attach(guardRunId, settlement);
  }, []);

  const beginScan = useCallback(() => {
    beginRef.current?.();
  }, []);

  const cancel = useCallback(() => {
    abortControllerRef.current?.abort("Cancelled by the user");
  }, []);

  const clearCompletedRun = useCallback(() => {
    if (running) return;
    setEvent(null);
    setOutcome(null);
  }, [running]);

  const releaseConnection = useCallback(async () => {
    abortControllerRef.current?.abort("Switching scan type before measurement");
    beginRef.current = null;
    await runGuardRef.current.awaitCurrentSettlement();
    await sessionRef.current?.recoverConnection();
    abortControllerRef.current = null;
    setRunning(false);
    setEvent(null);
    setOutcome(null);
    setRecoveryRequired(false);
  }, []);

  return (
    <QuickAoxRunContext.Provider value={{
      capability,
      event,
      outcome,
      running,
      recoveryRequired,
      diagnostic,
      startRun,
      beginScan,
      cancel,
      clearCompletedRun,
      releaseConnection,
    }}>
      {children}
    </QuickAoxRunContext.Provider>
  );
}


export function useQuickAoxRun(): QuickAoxRunContextValue {
  const context = useContext(QuickAoxRunContext);
  if (!context) throw new Error("useQuickAoxRun must be used within QuickAoxRunProvider");
  return context;
}
