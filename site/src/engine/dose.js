// Chemical / particulate exposure: what the *person* has breathed, not just what a fixed sensor reads.

/** O(1) sliding-window mean over the last `n` samples. */
export class RollingMean {
  constructor(n) {
    this.n = n;
    this.buf = [];
    this.sum = 0;
  }
  push(x) {
    this.buf.push(x);
    this.sum += x;
    if (this.buf.length > this.n) this.sum -= this.buf.shift();
    return this.mean;
  }
  get mean() { return this.buf.length ? this.sum / this.buf.length : 0; }
}

/** Hydrogen sulfide limits (ppm): NIOSH REL 10 ppm 10-min ceiling, OSHA ceiling 20 ppm, IDLH 100 ppm. */
export const H2S = { rel10min: 10, oshaCeiling: 20, idlh: 100, watch: 5 };

/**
 * Per-worker gas exposure tracker (personal monitor in the breathing zone).
 * Level: 0 safe, 1 watch, 2 warning, 3 danger.
 */
export class GasExposure {
  constructor() {
    this.win = new RollingMean(10);
    this.peak = 0;
    this.doseMinPpm = 0; // integrated exposure, ppm*min
  }
  push(ppm) {
    if (ppm == null) return { level: 0, inst: null, mean10: this.win.mean, peak: this.peak, reasons: [], dose: this.doseMinPpm };
    const mean10 = this.win.push(ppm);
    this.peak = Math.max(this.peak, ppm);
    this.doseMinPpm += ppm;
    let level = 0;
    const reasons = [];
    if (ppm >= H2S.idlh) { level = 3; reasons.push(`H2S ${ppm.toFixed(0)} ppm - at/above the IDLH of ${H2S.idlh} ppm`); }
    else if (ppm >= H2S.oshaCeiling) { level = 3; reasons.push(`H2S ${ppm.toFixed(0)} ppm exceeds the ${H2S.oshaCeiling} ppm OSHA ceiling`); }
    else if (mean10 >= H2S.rel10min) { level = 2; reasons.push(`H2S 10-min average ${mean10.toFixed(1)} ppm exceeds the NIOSH ${H2S.rel10min} ppm limit`); }
    else if (ppm >= H2S.watch || mean10 >= H2S.watch) { level = 1; reasons.push(`H2S ${ppm.toFixed(1)} ppm detected (watch level ${H2S.watch} ppm)`); }
    return { level, inst: ppm, mean10, peak: this.peak, reasons, dose: this.doseMinPpm };
  }
}

/**
 * Particulate advisory (PM10, ug/m3), anchored to US AQI PM10 breakpoints.
 * A *steady* high level is a site advisory (respirator), not a stop-work alarm - otherwise a dusty
 * region would put every worker in WARNING all day and the alarm would be ignored. A worker-level
 * alert needs a sudden surge (a dust front) or an extreme level.
 *   level 0: advisory only   1: surge in progress   2: hazardous surge / extreme level
 */
export function particulateLevel(pm10, surge = false) {
  if (pm10 == null) return { level: 0, label: 'n/a', advisory: false };
  const label = pm10 >= 800 ? 'Hazardous - respirator advised'
    : pm10 >= 355 ? 'Very unhealthy - respirator advised'
    : pm10 >= 155 ? 'Unhealthy for sensitive groups' : 'Acceptable';
  let level = 0;
  if (surge && pm10 >= 355) level = 1;
  if ((surge && pm10 >= 800) || pm10 >= 1500) level = 2;
  return { level, label, advisory: pm10 >= 355, surge };
}
