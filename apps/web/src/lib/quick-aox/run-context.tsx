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
import { BrowserQuickAoxSession } from "./browser-workflow";
import { BrowserQuickAoxWifiSession } from "./wifi-browser-workflow";
import { detectScannerConnection, type QuickAoxBrowserSession, type ScannerConnection } from "./scanner-connection";
import { requiresSerialRecovery } from "./retry-policy";
import { ScannerRunGuard, type SafeScannerDiagnosticReport } from "../scanner-session-diagnostic";

type Capability = "checking" | "supported" | "unsupported";

type QuickAoxRunContextValue = {
  capability: Capability;
  /** Which transport this device will use; null while checking or when unsupported. */
  connection: ScannerConnection | null;
  /** Wi-Fi only: per-request and per-step log of the current/last run, for copy-paste diagnostics. */
  wifiLog: readonly string[];
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
  const [connection, setConnection] = useState<ScannerConnection | null>(null);
  const [wifiLog, setWifiLog] = useState<readonly string[]>([]);
  const wifiLogRef = useRef<string[]>([]);
  // Stable (refs + state setter only) so a reused session's callback keeps working.
  const appendWifiLog = useCallback((line: string) => {
    const stamped = `[${new Date().toISOString().slice(11, 23)}] ${line}`;
    wifiLogRef.current = [...wifiLogRef.current.slice(-499), stamped];
    setWifiLog(wifiLogRef.current);
  }, []);
  const [event, setEvent] = useState<QuickAoxWorkflowEvent | null>(null);
  const [outcome, setOutcome] = useState<QuickAoxWorkflowOutcome | null>(null);
  const [running, setRunning] = useState(false);
  const [recoveryRequired, setRecoveryRequired] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const beginRef = useRef<(() => void) | null>(null);
  const sessionRef = useRef<QuickAoxBrowserSession | null>(null);
  const runGuardRef = useRef(new ScannerRunGuard());
  const [diagnostic, setDiagnostic] = useState<SafeScannerDiagnosticReport | null>(null);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const detected = detectScannerConnection();
      setConnection(detected);
      setCapability(detected ? "supported" : "unsupported");
    });
    return () => {
      active = false;
      abortControllerRef.current?.abort("NutriScan closed the active workflow");
      void sessionRef.current?.disconnect();
    };
  }, []);

  const startRun = useCallback(() => {
    const detected = detectScannerConnection();
    if (!detected) return;
    const guardRunId = crypto.randomUUID();
    if (!runGuardRef.current.tryStart(guardRunId)) return;
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    beginRef.current = null;
    setEvent(null);
    setOutcome(null);
    setRunning(true);
    setRecoveryRequired(false);

    if (detected === "wifi") {
      wifiLogRef.current = [];
      setWifiLog([]);
      appendWifiLog("--- Quick AOX scan (Wi-Fi) ---");
    }
    const session: QuickAoxBrowserSession = sessionRef.current ?? (detected === "wifi"
      ? new BrowserQuickAoxWifiSession({
        onRequest: (e) => appendWifiLog(`HTTP ${e.path} -> ${e.status ?? e.error ?? "error"} (${e.durationMs} ms)`),
        onHandSample: (h) => appendWifiLog(h.metrics
          ? `hand ${h.target}: ${h.recognized ? "YES" : "no"} dark=${h.metrics.dark.toFixed(2)} near=${h.metrics.near.toFixed(1)} middle=${h.metrics.middle.toFixed(1)} far=${h.metrics.far.toFixed(1)} near/far=${(h.metrics.near / h.metrics.far).toFixed(2)} near/middle=${(h.metrics.near / h.metrics.middle).toFixed(2)}`
          : `hand ${h.target}: malformed sample`),
      })
      : new BrowserQuickAoxSession(undefined, setDiagnostic));
    let lastDownloadLog = 0;
    const onProgress = (progress: QuickAoxWorkflowEvent) => {
      setEvent(progress);
      if (detected !== "wifi") return;
      if (progress.state === "downloading") {
        const now = Date.now();
        if (now - lastDownloadLog < 1000) return;
        lastDownloadLog = now;
        appendWifiLog(`event: downloading ${progress.validBlocks}/${progress.expectedBlocks}`);
        return;
      }
      appendWifiLog(`event: ${progress.state}`);
    };
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
      onProgress,
      disconnectOnFinish: false,
    }).then(async (completedOutcome) => {
      if (!runGuardRef.current.isCurrent(guardRunId)) return;
      if (detected === "wifi") {
        appendWifiLog(`OUTCOME: ${completedOutcome.kind}${completedOutcome.kind === "failed" ? ` (${completedOutcome.failureKind}, ${completedOutcome.phase}): ${completedOutcome.message}` : ""}`);
        if (completedOutcome.kind === "failed") appendWifiLog(`cause: ${describeCause(completedOutcome.cause)}`);
      }
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
  }, [appendWifiLog]);

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
      connection,
      wifiLog,
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

function describeCause(cause: unknown, depth = 0): string {
  if (depth > 3) return "…";
  if (cause instanceof Error) {
    const inner = (cause as Error & { cause?: unknown }).cause;
    return `${cause.name}: ${cause.message}${inner === undefined ? "" : ` <- ${describeCause(inner, depth + 1)}`}`;
  }
  try { return JSON.stringify(cause); } catch { return String(cause); }
}
