// Occupational heat-exposure limits (NIOSH 2016 criteria) and work/rest planning.
//
// NIOSH defines WBGT limits as a function of the time-weighted metabolic rate M (watts) so that
// an average worker reaches thermal equilibrium without core temperature exceeding ~38.0 degC:
//   RAL (unacclimatised) = 59.9 - 14.1 * log10(M)
//   REL (acclimatised)   = 56.7 - 11.5 * log10(M)
// Because the limit is defined on the *time-weighted* M, it can be inverted to find the work
// fraction that keeps an exposure inside the limit - that is the work/rest plan we show.

import { clamp } from './psychro.js';

/** Representative metabolic rates (W) for the NIOSH/ISO 8996 work classes. */
export const ACTIVITY = {
  rest: { label: 'Resting', M: 115 },
  light: { label: 'Light', M: 180 },
  moderate: { label: 'Moderate', M: 300 },
  heavy: { label: 'Heavy', M: 415 },
  veryHeavy: { label: 'Very heavy', M: 520 },
};
export const ACTIVITY_ORDER = ['rest', 'light', 'moderate', 'heavy', 'veryHeavy'];

/** WBGT clothing adjustment factors (degC-WBGT added to the measured value), per ACGIH. */
export const CLOTHING = {
  light: { label: 'Light work clothes', adj: 0 },
  coverall: { label: 'Woven coveralls', adj: 0 },
  doubleLayer: { label: 'Double-layer / FR suit', adj: 3 },
  vaporBarrier: { label: 'Vapour-barrier suit', adj: 11 },
  arctic: { label: 'Arctic parka', adj: 0 },
};

/** Site-level heat-load label for a WBGT reading: [label, alert level 0-3]. */
export function heatCategory(wb) {
  return wb < 25 ? ['Low', 0] : wb < 28 ? ['Moderate', 0] : wb < 31 ? ['High', 1] : wb < 33 ? ['Very high', 2] : ['Extreme', 3];
}

export function wbgtLimit(M, acclimatized) {
  const lg = Math.log10(Math.max(M, 60));
  return acclimatized ? 56.7 - 11.5 * lg : 59.9 - 14.1 * lg;
}

/** Highest time-weighted metabolic rate permitted at this (clothing-adjusted) WBGT. */
export function allowedMetabolicRate(wbgtEff, acclimatized) {
  const [a, b] = acclimatized ? [56.7, 11.5] : [59.9, 14.1];
  return Math.pow(10, (a - wbgtEff) / b);
}

/** Work/rest split per hour that keeps the time-weighted M inside the NIOSH limit. */
export function workRestPlan(wbgtEff, M, acclimatized, Mrest = ACTIVITY.rest.M) {
  const Mallowed = allowedMetabolicRate(wbgtEff, acclimatized);
  if (M <= Mallowed) return { workMin: 60, restMin: 0, workFraction: 1, Mallowed };
  const f = clamp((Mallowed - Mrest) / (M - Mrest), 0, 1);
  const workMin = Math.round((60 * f) / 5) * 5;
  return { workMin, restMin: 60 - workMin, workFraction: f, Mallowed };
}
