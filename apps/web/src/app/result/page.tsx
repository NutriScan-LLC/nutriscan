import { decodeScannerPayload } from "@/lib/scanner/parsers/scanner-payload";

// This page renders inside an iframe embedded in the scanner vendor's
// tablet app — NOT a page a patient opens directly on their phone. Keep it
// tablet-width friendly and self-contained (no reliance on browser chrome).
//
// The scanner vendor's config passes:
//   ?data=<base64 JSON scanner payload>&lang=<app language>&theme=light|dark
//
// This is a Stream A placeholder: it proves the route is live and can be
// pointed at from the scanner vendor's config so the hardware test can
// proceed. The full typed decoder, validation, branded result UI, and
// persistence to Supabase are Stream B.

type ResultPageProps = {
  searchParams: Promise<{ data?: string; lang?: string; theme?: string }>;
};

export default async function ResultPage({ searchParams }: ResultPageProps) {
  const { data, lang, theme } = await searchParams;
  const isDark = theme === "dark";

  const decoded = data ? decodeScannerPayload(data) : null;

  return (
    <div
      className={
        "flex min-h-screen w-full flex-col items-center justify-center px-6 py-10 " +
        (isDark ? "bg-slate-950 text-slate-100" : "bg-white text-slate-900")
      }
    >
      <div className="w-full max-w-2xl">
        <p className="text-xs font-medium uppercase tracking-widest text-emerald-600">
          NutriScan Result
        </p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">
          Result page — infrastructure placeholder
        </h1>
        <p
          className={
            "mt-3 text-sm " + (isDark ? "text-slate-400" : "text-slate-500")
          }
        >
          lang: <code>{lang ?? "(none)"}</code> · theme:{" "}
          <code>{theme ?? "(none)"}</code>
        </p>

        <div
          className={
            "mt-8 rounded-xl border p-6 " +
            (isDark
              ? "border-slate-800 bg-slate-900"
              : "border-slate-200 bg-slate-50")
          }
        >
          {!data && (
            <p className={isDark ? "text-slate-400" : "text-slate-600"}>
              No <code>data</code> query param was provided. Once Björn points
              the iframe URL at this page, a real scan will arrive here as a
              base64-encoded scanner JSON payload.
            </p>
          )}

          {data && decoded && !decoded.ok && (
            <p className="text-red-500">
              Could not decode <code>data</code> as a scanner payload:{" "}
              {decoded.error}
            </p>
          )}

          {data && decoded && decoded.ok && (
            <div>
              {decoded.payload.demo && (
                <p className="mb-4 inline-block rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
                  demo: true — this scan would be excluded from patient/clinician
                  views
                </p>
              )}
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <Field label="aox" value={decoded.payload.aox} />
                <Field
                  label="aox_int_result"
                  value={decoded.payload.aox_int_result}
                />
                <Field label="hrv_bio_age" value={decoded.payload.hrv_bio_age} />
                <Field label="mean_hr" value={decoded.payload.mean_hr} />
                <Field label="std_nn" value={decoded.payload.std_nn} />
                <Field label="bmi" value={decoded.payload.bmi} />
                <Field label="serial" value={decoded.payload.serial} />
                <Field
                  label="timestamp"
                  value={
                    decoded.payload.timestamp
                      ? new Date(
                          decoded.payload.timestamp * 1000,
                        ).toISOString()
                      : undefined
                  }
                />
              </dl>
              <p
                className={
                  "mt-4 text-xs " +
                  (isDark ? "text-slate-500" : "text-slate-400")
                }
              >
                Raw decoded payload is captured below for verification. In the
                real build this is stored as-is in <code>raw_payload</code>{" "}
                and never re-derived from these individual fields.
              </p>
              <pre className="mt-2 overflow-x-auto rounded-lg bg-black/80 p-3 text-xs text-emerald-300">
                {JSON.stringify(decoded.payload, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-400">
        {label}
      </dt>
      <dd className="font-medium">
        {value === undefined || value === null || value === ""
          ? "—"
          : String(value)}
      </dd>
    </div>
  );
}
