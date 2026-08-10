"use client";

import { useReducedMotion } from "framer-motion";

export const QUICK_AOX_SCALE_MIN = 0;
export const QUICK_AOX_SCALE_MAX = 12;

export const QUICK_AOX_ARC = {
  centerX: 110,
  centerY: 108,
  radius: 88,
} as const;

// APK-derived from VitalityCheck's bundled assets/imgs/bar_aox.svg. These
// stops reproduce visual artwork; they are not clinical or category ranges.
export const QUICK_AOX_GRADIENT_STOPS = [
  { offset: 0, color: "#ff798b" },
  { offset: 0.25542316, color: "#f48778" },
  { offset: 0.45784044, color: "#b9d40f" },
  { offset: 0.83361965, color: "#b9d40f" },
  { offset: 0.89599538, color: "#ff798b" },
  { offset: 1, color: "#ff798b" },
] as const;

export function quickAoxNormalizedPosition(aox: number): number {
  const clamped = Math.max(QUICK_AOX_SCALE_MIN, Math.min(QUICK_AOX_SCALE_MAX, aox));
  return clamped / QUICK_AOX_SCALE_MAX;
}

export function quickAoxMarkerPoint(aox: number): { x: number; y: number } {
  const position = quickAoxNormalizedPosition(aox);
  const angle = Math.PI * (1 - position);

  return {
    x: QUICK_AOX_ARC.centerX + QUICK_AOX_ARC.radius * Math.cos(angle),
    y: QUICK_AOX_ARC.centerY - QUICK_AOX_ARC.radius * Math.sin(angle),
  };
}

export default function QuickAoxResultGauge({ aox }: { aox: number }) {
  const reduceMotion = useReducedMotion();
  const markerPosition = quickAoxNormalizedPosition(aox);
  const marker = quickAoxMarkerPoint(aox);
  const arcStart = QUICK_AOX_ARC.centerX - QUICK_AOX_ARC.radius;
  const arcEnd = QUICK_AOX_ARC.centerX + QUICK_AOX_ARC.radius;
  const arcPath = `M ${arcStart} ${QUICK_AOX_ARC.centerY} A ${QUICK_AOX_ARC.radius} ${QUICK_AOX_ARC.radius} 0 0 1 ${arcEnd} ${QUICK_AOX_ARC.centerY}`;

  return (
    <div className="w-full">
      <svg
        className="mx-auto block h-auto w-full max-w-[340px] overflow-visible"
        viewBox="0 0 220 132"
        role="img"
        aria-label={`Antioxidant level ${String(aox)} on a scale from 0 to 12`}
      >
        <defs>
          <linearGradient id="quick-aox-arc-gradient" x1={arcStart} y1="0" x2={arcEnd} y2="0" gradientUnits="userSpaceOnUse">
            {QUICK_AOX_GRADIENT_STOPS.map((stop) => (
              <stop key={stop.offset} offset={stop.offset} stopColor={stop.color} />
            ))}
          </linearGradient>
        </defs>

        <path d={arcPath} fill="none" stroke="#e2e8f0" strokeWidth="12" strokeLinecap="round" />
        <path
          d={arcPath}
          fill="none"
          stroke="url(#quick-aox-arc-gradient)"
          strokeWidth="9"
          strokeLinecap="round"
        />
        {reduceMotion ? (
          <circle
            cx={marker.x}
            cy={marker.y}
            r="5.5"
            fill="#0f172a"
            stroke="white"
            strokeWidth="3"
            aria-hidden="true"
          />
        ) : (
          <circle cx="0" cy="0" r="5.5" fill="#0f172a" stroke="white" strokeWidth="3" aria-hidden="true">
            <animateMotion
              path={arcPath}
              dur="2s"
              keyPoints={`0;${markerPosition}`}
              keyTimes="0;1"
              calcMode="spline"
              keySplines="0.22 1 0.36 1"
              fill="freeze"
            />
          </circle>
        )}

        <text
          x={QUICK_AOX_ARC.centerX}
          y="82"
          textAnchor="middle"
          dominantBaseline="middle"
          className="fill-slate-900 text-[48px] font-semibold tracking-tight tabular-nums"
        >
          {aox}
        </text>
      </svg>
    </div>
  );
}
