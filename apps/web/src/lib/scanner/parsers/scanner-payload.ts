// Types + decoder for the scanner's raw measurement payload.
//
// IMPORTANT: this is a full multi-metric panel, not a single score. Always
// keep the entire decoded object around (it gets stored as-is in
// `raw_payload` — see Stream D) instead of re-serializing just the typed
// fields, since the scanner vendor may add fields we don't know about yet.
//
// This is a minimal decoder for Stream A (just proves the plumbing works).
// Stream B replaces the loose validation below with a real schema
// (e.g. zod) and adds error reporting suited to a patient-facing UI.
//
// Field names below (aox, hrv_bio_age, product_j2bf, etc.) are the actual
// wire-format keys confirmed from real hardware — do not rename these, only
// the type/function names around them.

export type ScannerPayload = {
  aox: number;
  aox_int_result: number;
  mean_hr: number;
  std_nn: string;
  bmi: number;
  hrv_bio_age: string;
  hrv_bio_age_category: number;
  hrv_age_category: number;
  hr_age_gender_category: number;
  bmi_age_gender_category: number;
  product_j2bf: string;
  serial: string;
  timestamp: number;
  demo?: boolean;
  // Undocumented per the vendor's spec — archive only, don't depend on these.
  x?: number;
  x2?: number;
  x3?: number;
  x4?: number;
  x6?: number;
  // The scanner vendor may add fields we don't know about; keep this open.
  [key: string]: unknown;
};

export type DecodeResult =
  | { ok: true; payload: ScannerPayload }
  | { ok: false; error: string };

export function decodeScannerPayload(base64Data: string): DecodeResult {
  let jsonString: string;
  try {
    jsonString = Buffer.from(base64Data, "base64").toString("utf-8");
  } catch {
    return { ok: false, error: "not valid base64" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    return { ok: false, error: "decoded string is not valid JSON" };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, error: "decoded JSON is not an object" };
  }

  const obj = parsed as Record<string, unknown>;
  if (typeof obj.aox !== "number") {
    return {
      ok: false,
      error: "missing or non-numeric 'aox' field — not a scanner payload",
    };
  }

  return { ok: true, payload: obj as ScannerPayload };
}

// True if this scan should be excluded from patient history and clinician
// aggregates. Always filter on this before persisting or displaying scan
// data outside of internal/debug views.
export function isDemoScan(payload: ScannerPayload): boolean {
  return payload.demo === true;
}
