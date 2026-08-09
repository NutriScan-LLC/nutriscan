// Static sample trend line — illustrative only, not real scan history.

import { ArrowRightIcon } from "@/components/icons";

const SAMPLE_POINTS = [
  { label: "Week 1", value: 82 },
  { label: "Week 3", value: 86 },
  { label: "Week 6", value: 91 },
  { label: "Today", value: 97 },
];

const WIDTH = 360;
const HEIGHT = 140;
const PADDING_X = 20;
const PADDING_TOP = 28;
const PADDING_BOTTOM = 24;

export default function ProgressChart() {
  const values = SAMPLE_POINTS.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const points = SAMPLE_POINTS.map((point, index) => {
    const x =
      PADDING_X +
      (index / (SAMPLE_POINTS.length - 1)) * (WIDTH - PADDING_X * 2);
    const y =
      HEIGHT -
      PADDING_BOTTOM -
      ((point.value - min) / range) * (HEIGHT - PADDING_TOP - PADDING_BOTTOM);
    return { ...point, x, y };
  });

  const linePath = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");

  return (
    <div className="flex flex-col">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        role="img"
        aria-label={`Sample NutriScore trend rising from ${min} to ${max} across ${SAMPLE_POINTS.length} scans`}
      >
        <path
          d={linePath}
          fill="none"
          stroke="#16a34a"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {points.map((point) => (
          <g key={point.label}>
            <circle cx={point.x} cy={point.y} r={4} fill="#16a34a" />
            <text
              x={point.x}
              y={point.y - 12}
              textAnchor="middle"
              className="fill-slate-900 text-[13px] font-semibold"
            >
              {point.value}
            </text>
            <text
              x={point.x}
              y={HEIGHT - 4}
              textAnchor="middle"
              className="fill-slate-400 text-[11px]"
            >
              {point.label}
            </text>
          </g>
        ))}
      </svg>

      <a
        href="#"
        className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:text-emerald-800"
      >
        View history
        <ArrowRightIcon className="h-3.5 w-3.5" />
      </a>

      <p className="mt-2 text-[11px] text-slate-400">Sample data — your trend builds as you scan.</p>
    </div>
  );
}
