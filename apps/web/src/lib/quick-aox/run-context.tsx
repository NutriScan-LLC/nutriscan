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
  createBrowserQuickAoxWorkflow,
  isWebSerialSupported,
} from "./browser-workflow";

type Capability = "checking" | "supported" | "unsupported";

type QuickAoxRunContextValue = {
  capability: Capability;
  event: QuickAoxWorkflowEvent | null;
  outcome: QuickAoxWorkflowOutcome | null;
  running: boolean;
  startRun: () => void;
  confirmHandPositioned: () => void;
  cancel: () => void;
  clearCompletedRun: () => void;
};

const QuickAoxRunContext = createContext<QuickAoxRunContextValue | null>(null);

export function QuickAoxRunProvider({ children }: { children: ReactNode }) {
  const [capability, setCapability] = useState<Capability>("checking");
  const [event, setEvent] = useState<QuickAoxWorkflowEvent | null>(null);
  const [outcome, setOutcome] = useState<QuickAoxWorkflowOutcome | null>(null);
  const [running, setRunning] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const handConfirmationRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) setCapability(isWebSerialSupported() ? "supported" : "unsupported");
    });
    return () => {
      active = false;
      abortControllerRef.current?.abort("NutriScan closed the active workflow");
    };
  }, []);

  const startRun = useCallback(() => {
    if (running || !isWebSerialSupported()) return;
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    handConfirmationRef.current = null;
    setEvent(null);
    setOutcome(null);
    setRunning(true);

    const workflow = createBrowserQuickAoxWorkflow();
    void workflow.run({
      language: "en",
      createUuid: () => crypto.randomUUID(),
      signal: abortController.signal,
      waitForHandPositioned: ({ signal }) => new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          handConfirmationRef.current = null;
          reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
        };
        const confirm = () => {
          signal?.removeEventListener("abort", onAbort);
          handConfirmationRef.current = null;
          resolve();
        };
        handConfirmationRef.current = confirm;
        signal?.addEventListener("abort", onAbort, { once: true });
      }),
      onProgress: setEvent,
    }).then((completedOutcome) => {
      setOutcome(completedOutcome);
      setRunning(false);
      abortControllerRef.current = null;
      handConfirmationRef.current = null;
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
      handConfirmationRef.current = null;
    });
  }, [running]);

  const confirmHandPositioned = useCallback(() => {
    handConfirmationRef.current?.();
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
      startRun,
      confirmHandPositioned,
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
