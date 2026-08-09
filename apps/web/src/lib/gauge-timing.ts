// Single source of truth for the NutriScore gauge's staged reveal:
//
//   needle fades in at rest -> rotates to the score -> stops
//   -> score number fades in -> status label fades in
//   -> (results page only) supporting cards fade in with a slight stagger
//
// Each stage's delay is computed from the previous stage's own duration, so
// nothing on screen fights for attention at once, and every consumer
// (NutriScoreGaugeArc, NutriScoreGauge, NutriScoreGaugeCompact, the results
// page) reads the exact same numbers instead of re-deriving them and
// risking drift.

export const NEEDLE_FADE_DURATION = 0.3;
export const NEEDLE_ROTATE_DURATION = 1.1; // within the requested 1.0-1.2s window
export const NEEDLE_SETTLE_AT = NEEDLE_FADE_DURATION + NEEDLE_ROTATE_DURATION; // 1.4

export const SCORE_FADE_AT = NEEDLE_SETTLE_AT;
export const SCORE_FADE_DURATION = 0.35;

export const STATUS_FADE_AT = SCORE_FADE_AT + SCORE_FADE_DURATION;
export const STATUS_FADE_DURATION = 0.3;

export const CARDS_FADE_AT = STATUS_FADE_AT + STATUS_FADE_DURATION;
export const CARD_FADE_DURATION = 0.35;
export const CARD_STAGGER = 0.12;
