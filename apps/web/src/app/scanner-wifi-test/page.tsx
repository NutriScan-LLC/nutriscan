'use client';

/**
 * WiFi scanner proof of concept — READ ONLY.
 *
 * Runs inside the NutriScan iOS shell (mobile/, Capacitor), which loads this
 * page from app.yournutriscan.com. iOS Safari blocks this HTTPS page from
 * calling the scanner's plain-HTTP server (mixed content — confirmed
 * 2026-11-06, see BIOZOOM_PROTOCOL_AND_IMPLEMENTATION.md). Inside the shell
 * we route the request through Capacitor's native HTTP plugin instead, which
 * is not subject to WebView mixed-content rules.
 *
 * Safety: the status test only sends GET /status. The full-scan section
 * (which sends /d and /m) renders only when NEXT_PUBLIC_WIFI_FULL_SCAN_ENABLED
 * is "true" for the deployment AND the page runs inside the app.
 */

import { useRef, useState, useSyncExternalStore } from 'react';
import type { QuickAoxWorkflowEvent, QuickAoxWorkflowOutcome } from '@nutriscan/workflows';
import { BrowserQuickAoxWifiSession, WIFI_FULL_SCAN_ENABLED } from '@/lib/quick-aox/wifi-browser-workflow';

// The ONLY scanner path this page is allowed to request.
const STATUS_PATH = '/status';
const DEFAULT_HOST = '192.168.4.1';
const TIMEOUT_MS = 8000;

type NativeHttpResponse = {
  status: number;
  data: unknown;
  headers?: Record<string, string>;
  url?: string;
};

type CapacitorGlobal = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: Record<string, Record<string, (options: unknown) => Promise<unknown>> | undefined>;
  nativePromise?: (plugin: string, method: string, options: unknown) => Promise<unknown>;
};

function getCapacitor(): CapacitorGlobal | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
}

function isNative(): boolean {
  return getCapacitor()?.isNativePlatform?.() === true;
}

/** Native GET through Capacitor's built-in CapacitorHttp plugin. */
async function nativeGet(url: string): Promise<{ response: NativeHttpResponse; via: string }> {
  const cap = getCapacitor();
  const options = {
    url,
    method: 'GET',
    responseType: 'text',
    connectTimeout: TIMEOUT_MS,
    readTimeout: TIMEOUT_MS,
  };
  const plugin = cap?.Plugins?.CapacitorHttp;
  if (plugin?.request) {
    return { response: (await plugin.request(options)) as NativeHttpResponse, via: 'Capacitor.Plugins.CapacitorHttp.request' };
  }
  if (cap?.nativePromise) {
    return { response: (await cap.nativePromise('CapacitorHttp', 'request', options)) as NativeHttpResponse, via: 'Capacitor.nativePromise(CapacitorHttp)' };
  }
  throw new Error('Capacitor native HTTP is not available in this WebView.');
}

function isValidHost(host: string): boolean {
  // Plain IPv4 only for this proof of concept.
  return /^(\d{1,3})(\.\d{1,3}){3}$/.test(host);
}

type StatusSummary = Record<string, unknown>;

type Env = { native: boolean; platform: string; origin: string; ua: string };

// Environment never changes after load; cache one snapshot so
// useSyncExternalStore gets a stable reference. Server render returns null.
let envCache: Env | null = null;
function getEnvSnapshot(): Env {
  if (!envCache) {
    envCache = {
      native: isNative(),
      platform: getCapacitor()?.getPlatform?.() ?? 'web',
      origin: window.location.origin,
      ua: navigator.userAgent,
    };
  }
  return envCache;
}
const noopSubscribe = () => () => {};

function summarize(raw: unknown): StatusSummary | null {
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch { return null; }
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const s = parsed as Record<string, unknown>;
  const keys = ['serial', 'wifi_firmware', 'battery_voltage', 'usb_charging', 'busy', 'mode', 'wifi_mode', 'ip', 'ap_ip', 'wifi', 'ap_wifi', 'uptime'];
  const out: StatusSummary = {};
  for (const k of keys) if (k in s) out[k] = s[k];
  return out;
}

export default function ScannerWifiTestPage() {
  const env = useSyncExternalStore(noopSubscribe, getEnvSnapshot, () => null);
  const [host, setHost] = useState(DEFAULT_HOST);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [summary, setSummary] = useState<StatusSummary | null>(null);

  function append(line: string) {
    const ts = new Date().toISOString().slice(11, 23);
    setLog((prev) => [...prev, `[${ts}] ${line}`]);
  }

  async function readStatus() {
    if (running || !isValidHost(host)) return;
    setRunning(true);
    setSummary(null);
    const url = `http://${host}${STATUS_PATH}`;
    append(`GET ${url} (native=${isNative()})`);
    const t0 = performance.now();
    try {
      if (!isNative()) throw new Error('Not running inside the NutriScan app — a browser page cannot reach the scanner (mixed content).');
      const { response, via } = await nativeGet(url);
      const ms = Math.round(performance.now() - t0);
      append(`OK via ${via}: HTTP ${response.status} in ${ms} ms`);
      const body = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
      append(`Body: ${body.slice(0, 1200)}`);
      setSummary(summarize(response.data));
    } catch (cause) {
      const ms = Math.round(performance.now() - t0);
      const message = cause instanceof Error ? cause.message : JSON.stringify(cause);
      append(`FAILED after ${ms} ms: ${message}`);
    } finally {
      setRunning(false);
    }
  }

  const copyText = [
    env ? `env: native=${env.native} platform=${env.platform} origin=${env.origin}` : '',
    env ? `ua: ${env.ua}` : '',
    ...log,
  ].join('\n');

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-10">
      <p className="text-xs font-semibold uppercase tracking-widest text-amber-700">Proof of concept · Read only</p>
      <h1 className="mt-2 text-2xl font-semibold text-slate-900">WiFi scanner status test</h1>
      <p className="mt-3 text-sm leading-relaxed text-slate-600">
        Sends one <code>GET /status</code> to the scanner through the NutriScan app&apos;s native HTTP. It does not start a
        measurement, read or delete data, or change any scanner setting.
      </p>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
        {env ? (
          <>
            <p>
              Running in NutriScan app:{' '}
              <strong className={env.native ? 'text-emerald-700' : 'text-amber-700'}>{env.native ? `yes (${env.platform})` : 'no — open this page in the NutriScan app'}</strong>
            </p>
            <p className="mt-1 break-all text-xs text-slate-500">Origin: {env.origin}</p>
          </>
        ) : (
          <p>Checking environment…</p>
        )}
      </section>

      <ol className="mt-6 list-decimal space-y-1 pl-5 text-sm text-slate-700">
        <li>Close the Biozoom app.</li>
        <li>In Settings → Wi-Fi, join <code>biozoomAP_…</code> (password from the scanner setup).</li>
        <li>Come back here and tap the button.</li>
      </ol>

      <label className="mt-6 block text-sm font-semibold text-slate-800" htmlFor="scanner-host">Scanner IP</label>
      <input
        id="scanner-host"
        value={host}
        onChange={(e) => setHost(e.target.value.trim())}
        inputMode="decimal"
        autoComplete="off"
        className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-mono text-sm"
      />

      <button
        type="button"
        onClick={() => void readStatus()}
        disabled={running || !isValidHost(host) || !env?.native}
        className="mt-4 w-full rounded-full bg-emerald-700 px-6 py-3.5 font-semibold text-white disabled:bg-slate-300"
      >
        {running ? 'Reading status…' : 'Read scanner status'}
      </button>

      {summary && (
        <section className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <h2 className="font-semibold text-emerald-900">Scanner reached</h2>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            {Object.entries(summary).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-slate-500">{k}</dt>
                <dd className="break-all font-mono text-slate-900">{String(v)}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {WIFI_FULL_SCAN_ENABLED && env?.native && <FullScanSection onLog={append} />}

      <section className="mt-6">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-800">Log</h2>
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(copyText)}
            className="text-sm font-semibold text-emerald-700"
          >
            Copy log
          </button>
        </div>
        <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-slate-900 p-3 text-xs text-slate-100">
          {log.length ? log.join('\n') : 'No requests yet.'}
        </pre>
      </section>
    </main>
  );
}

function describeEvent(event: QuickAoxWorkflowEvent): string {
  switch (event.state) {
    case 'downloading':
      return `downloading ${event.validBlocks}/${event.expectedBlocks} blocks (missing ${event.missingBlocks}, reads ${event.readCount})`;
    case 'measurement-started':
      return `measurement started #${event.measurementNumber}`;
    case 'waiting-to-submit':
      return `waiting ${event.requiredMs} ms before submit`;
    case 'completed':
      return `completed: ${event.outcomeKind}`;
    default:
      return event.state;
  }
}

function describeOutcome(outcome: QuickAoxWorkflowOutcome): string {
  if (outcome.kind === 'accepted') return `Accepted — AOX score ${outcome.score}`;
  if (outcome.kind === 'failed') return `Failed (${outcome.failureKind}) during ${outcome.phase}: ${outcome.message}`;
  if (outcome.kind === 'cancelled') return `Cancelled during ${outcome.phase}`;
  return `Finished: ${outcome.kind}`;
}

/** Full Quick AOX scan over Wi-Fi. Rendered only when the deployment flag is on. */
function FullScanSection({ onLog }: { readonly onLog: (line: string) => void }) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function run() {
    if (running || !acknowledged) return;
    setRunning(true);
    setOutcome(null);
    const controller = new AbortController();
    abortRef.current = controller;
    let lastDownloadLog = 0;
    const session = new BrowserQuickAoxWifiSession({
      onRequest: (e) => {
        // read-flash fires ~4x/second; log every request but keep lines short.
        onLog(`HTTP ${e.path} -> ${e.status ?? e.error ?? 'error'} (${e.durationMs} ms)`);
      },
    });
    onLog('--- full Quick AOX scan (Wi-Fi) ---');
    try {
      const result = await session.workflow.run({
        language: 'en',
        createUuid: () => crypto.randomUUID(),
        signal: controller.signal,
        // Tapping "Run full scan" is the begin confirmation.
        waitForBegin: async () => {},
        onProgress: (event) => {
          setPhase(event.state);
          if (event.state === 'downloading') {
            const now = Date.now();
            if (now - lastDownloadLog < 1000) return;
            lastDownloadLog = now;
          }
          onLog(`event: ${describeEvent(event)}`);
        },
        disconnectOnFinish: true,
      });
      const text = describeOutcome(result);
      setOutcome(text);
      onLog(`OUTCOME: ${text}`);
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      setOutcome(`Error: ${text}`);
      onLog(`ERROR: ${text}`);
    } finally {
      abortRef.current = null;
      setRunning(false);
      await session.disconnect().catch(() => {});
    }
  }

  return (
    <section className="mt-8 rounded-2xl border border-amber-300 bg-amber-50 p-4">
      <h2 className="font-semibold text-amber-900">Full Quick AOX scan (Wi-Fi)</h2>
      <p className="mt-2 text-sm text-amber-900">
        Repeats the Biozoom app&apos;s exact sequence: hand check, <code>/d</code> (clears data stored on the scanner — scope not
        confirmed), <code>/m</code> (starts the measurement), download, then scoring through NutriScan. Scoring needs internet, so keep
        cellular data on. Use the demo scanner only.
      </p>
      <label className="mt-3 flex items-start gap-2 text-sm text-amber-900">
        <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} className="mt-1" />
        <span>I understand this clears stored data on the scanner and starts a real measurement.</span>
      </label>
      <div className="mt-3 flex gap-3">
        <button
          type="button"
          onClick={() => void run()}
          disabled={running || !acknowledged}
          className="flex-1 rounded-full bg-amber-700 px-6 py-3 font-semibold text-white disabled:bg-slate-300"
        >
          {running ? `Running… ${phase ?? ''}` : 'Run full scan'}
        </button>
        {running && (
          <button type="button" onClick={() => abortRef.current?.abort()} className="rounded-full border border-amber-700 px-5 py-3 font-semibold text-amber-800">
            Cancel
          </button>
        )}
      </div>
      {running && phase === 'detecting-hand' && <p className="mt-3 text-sm font-semibold text-amber-900">Place your hand on the scanner.</p>}
      {running && phase === 'detecting-hand-removal' && <p className="mt-3 text-sm font-semibold text-amber-900">You can lift your hand now.</p>}
      {outcome && <p className="mt-3 rounded-xl bg-white p-3 text-sm font-semibold text-slate-900">{outcome}</p>}
    </section>
  );
}
