"use client";

import { useEffect, useId, useRef } from "react";
import { animate, useMotionValue } from "framer-motion";
import { NEEDLE_FADE_DURATION, NEEDLE_ROTATE_DURATION } from "@/lib/gauge-timing";

// The shared visual core of the NutriScore gauge — just the spectrum arc
// and the needle, nothing else. Both NutriScoreGauge (full, results page)
// and NutriScoreGaugeCompact (homepage) render this so the arc/needle stay
// pixel-identical between the two; only the text around it differs.
//
// The arc is a fixed red → orange → yellow → green → yellow → orange → red
// spectrum spanning the full 0-100 range; it never fills/animates in
// proportion to the score, because a filling bar implies "more is always
// better," which isn't true here (both too low AND too high are red). Only
// the needle moves, like a real analog instrument settling on a reading.
// The green "optimal" band is deliberately widened (a flat plateau, not
// just a single point) so the target zone reads clearly at a glance.
//
// Needle animation — behaves like a real analog gauge, not a redrawn SVG.
// The needle shaft AND both hub circles live inside ONE <g> — a single
// physical object — and the shaft's base starts exactly at the hub's
// center (CX, CY), not at the shaft's own midpoint.
//
// Rotation is applied via a hand-written SVG-native `transform="rotate(angle
// CX CY)"` attribute on that <g>, kept in sync with a Motion Value through a
// plain ref + `.on("change", ...)` subscription — deliberately NOT via
// `motion.g`'s own style-based rotate/transformOrigin handling. That's not
// a style choice: passing a Motion Value through `motion.g`'s `transform`
// prop was tried first and silently did nothing — Framer Motion still fell
// back to its own `transform-box: fill-box; transform-origin: 50% 50%`
// handling, which rotates around the GROUP'S BOUNDING BOX center (roughly
// the shaft's midpoint, since the shaft is much longer than the hub is
// wide) instead of the hub — the exact bug this component exists to avoid.
// The 3-argument SVG rotate() function takes its pivot as an explicit
// argument, so writing it directly to the DOM attribute ourselves is the
// only way to guarantee the pivot is always (CX, CY), full stop. No
// scaleX/scaleY, width/height, path data, or opacity is ever animated —
// rotation is the only animated property.

type NutriScoreGaugeArcProps = {
  score: number;
  className?: string;
};

const CX = 120;
const CY = 122;
const RADIUS = 98;
const STROKE_WIDTH = 18;
const VIEW_WIDTH = 240;
const VIEW_HEIGHT = 148;
// Stops slightly inside the arc's inner edge (RADIUS - STROKE_WIDTH/2 = 89)
// — shortened ~12% from an earlier 65 — so the tip reads as clearing the
// colored band rather than nearly touching it. Fixed: never animated.
const NEEDLE_LENGTH = 57;

function angleForScore(score: number) {
  // 0 -> 180deg (left), 50 -> 90deg (top), 100 -> 0deg (right)
  return 180 - score * 1.8;
}

function pointForScore(score: number, radius: number) {
  const rad = (angleForScore(score) * Math.PI) / 180;
  return {
    x: CX + radius * Math.cos(rad),
    y: CY - radius * Math.sin(rad),
  };
}

// Rotation (degrees, SVG's clockwise-positive convention) to apply to a
// needle whose neutral/drawn orientation points straight up (the score-50
// position) so it ends up pointing at the given score instead. Derived so
// that score 0 -> -90deg (left), score 50 -> 0deg (straight up, unrotated),
// score 100 -> +90deg (right).
function needleRotationForScore(score: number) {
  return score * 1.8 - 90;
}

export default function NutriScoreGaugeArc({ score, className = "" }: NutriScoreGaugeArcProps) {
  const clampedScore = Math.max(0, Math.min(100, score));
  const gradientId = useId();

  const arcStart = pointForScore(0, RADIUS);
  const arcEnd = pointForScore(100, RADIUS);

  const rotation = useMotionValue(needleRotationForScore(0));
  const groupRef = useRef<SVGGElement>(null);

  useEffect(() => {
    const applyRotation = (angle: number) => {
      groupRef.current?.setAttribute("transform", `rotate(${angle} ${CX} ${CY})`);
    };
    applyRotation(rotation.get());
    const unsubscribe = rotation.on("change", applyRotation);

    const controls = animate(rotation, needleRotationForScore(clampedScore), {
      duration: NEEDLE_ROTATE_DURATION,
      ease: "easeOut",
      delay: NEEDLE_FADE_DURATION,
    });

    return () => {
      unsubscribe();
      controls.stop();
    };
  }, [clampedScore, rotation]);

  return (
    <svg
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      className={`w-full ${className}`}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#dc2626" />
          <stop offset="15%" stopColor="#f97316" />
          <stop offset="32%" stopColor="#f59e0b" />
          <stop offset="48%" stopColor="#eab308" />
          <stop offset="64%" stopColor="#84cc16" />
          {/* Widened green plateau — 72%-88% is a flat, obvious "optimal" band */}
          <stop offset="72%" stopColor="#16a34a" />
          <stop offset="80%" stopColor="#16a34a" />
          <stop offset="88%" stopColor="#16a34a" />
          <stop offset="94%" stopColor="#f97316" />
          <stop offset="100%" stopColor="#dc2626" />
        </linearGradient>
      </defs>

      {/* Static spectrum track — geometry and gradient never animate. */}
      <path
        d={`M ${arcStart.x} ${arcStart.y} A ${RADIUS} ${RADIUS} 0 0 1 ${arcEnd.x} ${arcEnd.y}`}
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
      />

      {/* Needle assembly: shaft + both hub circles, ONE <g>, one physical
          object. The shaft's base (x1,y1) is exactly (CX, CY) — the same
          point the group rotates around — so the shaft is always anchored
          to the hub's true center, never its own midpoint. */}
      <g ref={groupRef}>
        <line
          x1={CX}
          y1={CY}
          x2={CX}
          y2={CY - NEEDLE_LENGTH}
          stroke="#0f172a"
          strokeWidth={5}
          strokeLinecap="round"
        />
        <circle cx={CX} cy={CY} r={12} fill="#0f172a" />
        <circle cx={CX} cy={CY} r={4.5} fill="#ffffff" />
      </g>
    </svg>
  );
}
