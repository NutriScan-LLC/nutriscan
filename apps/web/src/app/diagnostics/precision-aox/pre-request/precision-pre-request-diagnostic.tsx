"use client";

import { useRef, useState } from "react";
import { parseQuickAoxPreRequest } from "@nutriscan/scoring/quick-aox";
import { NutriScanScoringGatewayError } from "@/lib/quick-aox/browser-gateway";
import { NutriScanPrecisionPreRequestGateway } from "@/lib/precision-aox/browser-pre-request";

const KNOWN_SCANNER_SERIAL = "2N2400A5B70F5E3C9251";

type SafeResult =
  | {
      kind: "success";
      httpStatus: 200;
      recommendedServer: string;
      waitingTimeMs: number;
      newPreRequestReq: false | null;
      newPreRequestDelayMs: unknown;
    }
  | { kind: "diagnostic"; code: string; status: number; requestId: string; upstreamStatus?: number }
  | { kind: "cancelled" }
  | { kind: "invalid" };

export default function PrecisionPreRequestDiagnostic() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SafeResult | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  async function run() {
    const controller = new AbortController();
    controllerRef.current = controller;
    setRunning(true);
    setResult(null);
    try {
      const raw = await new NutriScanPrecisionPreRequestGateway().preRequest({
        scannerSerial: KNOWN_SCANNER_SERIAL,
        signal: controller.signal,
      });
      const parsed = parseQuickAoxPreRequest(raw);
      setResult(parsed.ok ? {
        kind: "success",
        httpStatus: 200,
        recommendedServer: parsed.value.recommendedServer,
        waitingTimeMs: parsed.value.waitingTimeMs,
        newPreRequestReq: parsed.value.newPreRequestReq,
        newPreRequestDelayMs: parsed.value.newPreRequestDelayMs,
      } : { kind: "invalid" });
    } catch (cause) {
      if (controller.signal.aborted) {
        setResult({ kind: "cancelled" });
      } else if (cause instanceof NutriScanScoringGatewayError && cause.diagnosticCode && cause.requestId) {
        setResult({
          kind: "diagnostic",
          code: cause.diagnosticCode,
          status: cause.status,
          requestId: cause.requestId,
          ...(cause.upstreamStatus === undefined ? {} : { upstreamStatus: cause.upstreamStatus }),
        });
      } else {
        setResult({ kind: "invalid" });
      }
    } finally {
      controllerRef.current = null;
      setRunning(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col px-6 py-12">
      <p className="text-xs font-semibold uppercase tracking-widest text-emerald-700">Development diagnostic</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">Precision AOX pre-request</h1>
      <p className="mt-3 text-sm leading-relaxed text-slate-600">
        Tests only Precision AOX routing through the NutriScan server. It does not access a scanner, send MeasurementBlocks, or submit a Precision measurement.
      </p>
      <div className="mt-8 flex gap-3">
        <button type="button" onClick={() => void run()} disabled={running} className="rounded-full bg-emerald-700 px-6 py-3 text-sm font-semibold text-white disabled:opacity-60">
          {running ? "Running…" : "Run Precision pre-request"}
        </button>
        {running && (
          <button type="button" onClick={() => controllerRef.current?.abort("Cancelled by diagnostic user")} className="rounded-full border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700">
            Cancel
          </button>
        )}
      </div>
      {result && <SafeResultView result={result} />}
    </main>
  );
}

function SafeResultView({ result }: { result: SafeResult }) {
  return (
    <div className="mt-8 rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
      {result.kind === "success" && <>
        <p className="font-semibold text-emerald-700">HTTP success: {result.httpStatus}</p>
        <p className="mt-3">recommended_server: {result.recommendedServer}</p>
        <p className="mt-1">waiting_time_ms: {result.waitingTimeMs}</p>
        <p className="mt-1">new_pre_request_req: {String(result.newPreRequestReq)}</p>
        <p className="mt-1">new_pre_request_delay_ms: {String(result.newPreRequestDelayMs)}</p>
      </>}
      {result.kind === "diagnostic" && <>
        <p className="font-semibold text-amber-700">HTTP failure: {result.status}</p>
        <p className="mt-3">Diagnostic: {result.code}</p>
        <p className="mt-1">Reference: {result.requestId}</p>
        {result.upstreamStatus !== undefined && <p className="mt-1">Upstream status: {result.upstreamStatus}</p>}
      </>}
      {result.kind === "cancelled" && <p className="font-semibold text-slate-700">Diagnostic cancelled by the user.</p>}
      {result.kind === "invalid" && <p className="font-semibold text-amber-700">The response could not be safely validated.</p>}
    </div>
  );
}
