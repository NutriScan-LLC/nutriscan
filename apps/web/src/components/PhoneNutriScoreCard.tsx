import NutriScoreGaugeCompact from "@/components/NutriScoreGaugeCompact";

// Sample score for marketing use — 85 sits within the "Optimal" range
// (70-90, see src/lib/score.ts), matching the surrounding homepage copy
// that describes a strong, on-track result.
const SAMPLE_SCORE = 85;

type PhoneNutriScoreCardProps = {
  variant?: "phone" | "flat";
  className?: string;
};

export default function PhoneNutriScoreCard({
  variant = "phone",
  className = "",
}: PhoneNutriScoreCardProps) {
  if (variant === "flat") {
    return (
      <div
        className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}
      >
        <NutriScoreGaugeCompact score={SAMPLE_SCORE} delta={4} />
      </div>
    );
  }

  return (
    <div
      className={`rounded-[2.25rem] bg-slate-900 p-3 shadow-xl ${className}`}
    >
      <div className="flex flex-col items-center rounded-[1.65rem] bg-white px-4 py-6">
        <NutriScoreGaugeCompact score={SAMPLE_SCORE} delta={4} />
      </div>
    </div>
  );
}
