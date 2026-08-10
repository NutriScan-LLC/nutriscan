export type ScanResult = {
  score: number;
  capturedAt: string;
};

export type HistoryEntry = {
  id: string;
  date: string;
  score: number;
};

const SESSION_HISTORY_KEY = "nutriscan.session-scan-results";

const SAMPLE_HISTORY: HistoryEntry[] = [
  { id: "sample-4", date: "Sample · 3 weeks ago", score: 88 },
  { id: "sample-3", date: "Sample · 7 weeks ago", score: 84 },
  { id: "sample-2", date: "Sample · 11 weeks ago", score: 79 },
];

export function saveSessionResult(result: ScanResult): void {
  try {
    const saved = readSessionResults();
    const entry = { id: `scan-${result.capturedAt}`, date: "Just now", score: result.score };
    if (saved.some((existing) => existing.id === entry.id)) return;
    sessionStorage.setItem(SESSION_HISTORY_KEY, JSON.stringify([entry, ...saved]));
  } catch {
    // The accepted score remains available in the in-memory workflow state.
  }
}

export function getSessionHistory(): HistoryEntry[] {
  return [...readSessionResults(), ...SAMPLE_HISTORY];
}

function readSessionResults(): HistoryEntry[] {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(SESSION_HISTORY_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed as HistoryEntry[] : [];
  } catch {
    return [];
  }
}
