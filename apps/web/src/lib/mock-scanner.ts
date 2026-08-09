// Placeholder scanner "API" for UI prototyping only.
//
// This does NOT talk to hardware, WebUSB, or the real scanner protocol in
// any way — it exists so the scan-flow screens have something to call while
// the real integration (an isolated hardware SDK package) is built
// separately. Nothing here
// encodes real device behavior; timings and steps are illustrative UX
// pacing, not confirmed protocol facts. See CLAUDE.md — this file must never
// be treated as a source of truth for real scanner behavior.

export type MockScanResult = {
  score: number;
  delta: number;
  capturedAt: string;
};

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// Reports progress from 0-100 over roughly `durationMs`.
export async function mockRunScan(
  onProgress: (percent: number) => void,
  { durationMs = 6000, signal }: { durationMs?: number; signal?: AbortSignal } = {},
) {
  const stepMs = 80;
  const steps = Math.ceil(durationMs / stepMs);
  for (let i = 1; i <= steps; i += 1) {
    await wait(stepMs);
    if (signal?.aborted) return;
    onProgress(Math.min(100, Math.round((i / steps) * 100)));
  }
}

// Simulates server-side analysis and returns an illustrative result.
// Not derived from any real measurement — display-only sample data.
// Status label is intentionally not part of this result — it's always
// derived from `score` via getScoreStatus() at display time (see
// src/lib/score.ts) so the label can never drift out of sync with the
// number, the way a stored "Excellent" label previously could.
export async function mockAnalyzeScan({
  signal,
}: { signal?: AbortSignal } = {}): Promise<MockScanResult> {
  await wait(1800);
  if (signal?.aborted) {
    return { score: 0, delta: 0, capturedAt: "" };
  }
  return {
    score: 91,
    delta: 3,
    capturedAt: new Date().toISOString(),
  };
}

// --- System check (Welcome → System Check screens) ---------------------
//
// Purely simulated pass/fail state for the pre-flight checklist shown on
// the System Check screen. This intentionally never touches `navigator.usb`
// or any other real browser/WebUSB API — it's UX pacing + copy only, so the
// real implementation can later satisfy the exact same
// `onUpdate`/`SystemCheckId` contract without the screen needing a rewrite.

export type SystemCheckId = "browser" | "webusb" | "scanner";

export type SystemCheckStatus = "pending" | "checking" | "success" | "failure";

export type SystemCheckDefinition = {
  id: SystemCheckId;
  label: string;
  icon: "browser" | "usb" | "scanner";
  successDetail: string;
  failureTitle: string;
  failureDetail: string;
};

export const SYSTEM_CHECKS: SystemCheckDefinition[] = [
  {
    id: "browser",
    label: "Browser supported",
    icon: "browser",
    successDetail: "Running a supported browser",
    failureTitle: "Unsupported browser",
    failureDetail:
      "NutriScan works best in a Chromium-based browser, like Chrome or Edge, on a desktop computer.",
  },
  {
    id: "webusb",
    label: "WebUSB supported",
    icon: "usb",
    successDetail: "WebUSB is available",
    failureTitle: "WebUSB not available",
    failureDetail:
      "Your browser doesn't support WebUSB. Switch to the latest Chrome or Edge and try again.",
  },
  {
    id: "scanner",
    label: "Scanner connected",
    icon: "scanner",
    successDetail: "NutriScan Scanner · SN-08213",
    failureTitle: "No scanner found",
    failureDetail:
      "Plug in your NutriScan scanner with the included USB cable and make sure it's powered on.",
  },
];

// Walks through SYSTEM_CHECKS in order, calling `onUpdate` as each one
// settles. Stops at the first failure — like a real dependency chain, there's
// no point checking for a paired scanner if WebUSB itself isn't available —
// leaving the remaining checks in their initial "pending" state.
//
// `failing` lets a caller simulate specific checks failing (see the
// System Check screen's `?fail=` query param for a way to preview that UI).
// Swap this function out for a real implementation later; the screen only
// depends on this signature and the SYSTEM_CHECKS/SystemCheckId shape above.
export async function mockRunSystemChecks(
  onUpdate: (id: SystemCheckId, status: SystemCheckStatus) => void,
  { signal, failing = [] }: { signal?: AbortSignal; failing?: SystemCheckId[] } = {},
): Promise<boolean> {
  for (const check of SYSTEM_CHECKS) {
    onUpdate(check.id, "checking");
    await wait(700);
    if (signal?.aborted) return false;
    const passed = !failing.includes(check.id);
    onUpdate(check.id, passed ? "success" : "failure");
    if (!passed) return false;
  }
  return true;
}

export type MockHistoryEntry = {
  id: string;
  date: string;
  score: number;
};

// Sample-only scan history for the /history placeholder screen. No stored
// `status` field here either — see the note on mockAnalyzeScan above.
export const MOCK_SCAN_HISTORY: MockHistoryEntry[] = [
  { id: "scan-4", date: "Today", score: 91 },
  { id: "scan-3", date: "3 weeks ago", score: 88 },
  { id: "scan-2", date: "7 weeks ago", score: 84 },
  { id: "scan-1", date: "11 weeks ago", score: 79 },
];

// --- Saving a result (Results screen, post-auth) ------------------------
//
// Placeholder persistence only — mirrors the sessionStorage approach in
// auth-context.tsx. There is no backend here; this exists so "save your
// result automatically" is something a reviewer can actually see happen
// (the new entry shows up on /history) rather than a save that silently
// goes nowhere. Swap for a real save-to-account call later.

const SAVED_HISTORY_KEY = "nutriscan.placeholder-saved-scans";

function readSavedScans(): MockHistoryEntry[] {
  try {
    const stored = sessionStorage.getItem(SAVED_HISTORY_KEY);
    return stored ? (JSON.parse(stored) as MockHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

// Saves a just-completed scan result so it shows up in getScanHistory().
// Safe to call more than once for the same result — callers are expected to
// guard against re-saving on re-render, but duplicate ids are harmless here.
export function mockSaveScanResult(result: MockScanResult): void {
  try {
    const saved = readSavedScans();
    const entry: MockHistoryEntry = {
      id: `scan-${result.capturedAt}`,
      date: "Just now",
      score: result.score,
    };
    if (saved.some((existing) => existing.id === entry.id)) return;
    sessionStorage.setItem(
      SAVED_HISTORY_KEY,
      JSON.stringify([entry, ...saved]),
    );
  } catch {
    // Ignore — nothing to persist to in this environment.
  }
}

// Newly saved scans first, then the sample seed history.
export function getScanHistory(): MockHistoryEntry[] {
  return [...readSavedScans(), ...MOCK_SCAN_HISTORY];
}
