// Physiological strain metrics.

import { clamp } from './psychro.js';

/**
 * Physiological Strain Index (Moran, Shitzer & Pandolf, 1998):
 *   PSI = 5 (Tc_t - Tc_0) / (39.5 - Tc_0) + 5 (HR_t - HR_0) / (180 - HR_0)
 * 0 = no strain ... 10 = near-maximal. Equal weight to thermoregulatory and cardiovascular strain.
 */
export function psi(tcNow, hrNow, tc0, hr0) {
  const t = (5 * (tcNow - tc0)) / (39.5 - tc0);
  const h = (5 * (hrNow - hr0)) / (180 - hr0);
  return clamp(t + h, 0, 10);
}

export function psiCategory(v) {
  if (v < 3) return 'none/little';
  if (v < 5) return 'low';
  if (v < 7) return 'moderate';
  if (v < 9) return 'high';
  return 'very high';
}

/** Cumulative thermal dose: area of the core-temperature curve above a reference (degC*min). */
export class HeatDose {
  constructor(ref = 38.0) {
    this.ref = ref;
    this.value = 0;
  }
  push(tc, dtMin = 1) {
    this.value += Math.max(0, tc - this.ref) * dtMin;
    return this.value;
  }
}
