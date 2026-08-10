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

type Capability = "checking" | "supported" | "unsupported";

type QuickAoxRunContextValue = {
  capability: Capability;
  event: QuickAoxWorkflowEvent | null;
  outcome: QuickAoxWorkflowOutcome | null;
  running: boolean;
  recoveryRequired: boolean;
  startRun: () => void;
  beginScan: () => void;
  cancel: () => void;
  clearCompletedRun: () => void;
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
    if (running || !isWebSerialSupported()) return;
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    beginRef.current = null;
    setEvent(null);
    setOutcome(null);
    setRunning(true);
    setRecoveryRequired(false);

    const session = sessionRef.current ?? new BrowserQuickAoxSession();
    sessionRef.current = session;
    const workflow = session.workflow;
    void workflow.run({
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
      if (requiresSerialRecovery(completedOutcome)) {
        await session.recoverConnection().catch(() => {});
        setRecoveryRequired(true);
      }
      setOutcome(completedOutcome);
      setRunning(false);
      abortControllerRef.current = null;
      beginRef.current = null;
    }).catch((error: unknown) => {
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
    });
  }, [running]);

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

  return (
    <QuickAoxRunContext.Provider value={{
      capability,
      event,
      outcome,
      running,
      recoveryRequired,
      startRun,
      beginScan,
      cancel,
      clearCompletedRun,
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
