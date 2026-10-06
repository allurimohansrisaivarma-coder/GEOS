// Signal-quality layer. Field sensors lie: straps slip, PPG picks up motion artefacts, links drop.
// Everything downstream is told how much to trust each sample instead of assuming clean data.

import { median } from './psychro.js';

/**
 * Hampel identifier over a short sliding window: replaces isolated outliers by the window median.
 * A *sustained* jump (two consecutive, mutually consistent samples) is treated as a real level
 * shift - e.g. a worker starting heavy work - and passed through, so the filter cannot lock onto
 * a stale median while the signal genuinely moves.
 */
export class HampelFilter {
  constructor(window = 7, nSigma = 3, floor = 4, shiftTol = 12) {
    this.window = window;
    this.nSigma = nSigma;
    this.floor = floor; // minimum scatter (signal units) so a flat window does not flag everything
    this.shiftTol = shiftTol;
    this.buf = [];
    this.prevRaw = null;
    this.prevFlagged = false;
  }
  push(x) {
    const prevRaw = this.prevRaw, prevFlagged = this.prevFlagged;
    this.prevRaw = x;
    this.buf.push(x); // raw values stay in the window so the median can follow genuine shifts
    if (this.buf.length > this.window) this.buf.shift();
    if (this.buf.length < 4) { this.prevFlagged = false; return { value: x, flagged: false }; }
    const med = median(this.buf);
    const mad = median(this.buf.map((v) => Math.abs(v - med)));
    const scatter = Math.max(1.4826 * mad, this.floor);
    const outlier = Math.abs(x - med) > this.nSigma * scatter;
    const consistentShift = outlier && prevFlagged && prevRaw != null && Math.abs(x - prevRaw) <= this.shiftTol;
    if (outlier && !consistentShift) {
      this.prevFlagged = true;
      return { value: med, flagged: true };
    }
    this.prevFlagged = false;
    return { value: x, flagged: false };
  }
}

/**
 * Heart-rate channel QC: range check, spike rejection, flat-line (stuck sensor) detection,
 * dropout tracking and a rolling 0..1 quality score.
 */
export class HrChannelQC {
  constructor({ min = 35, max = 225, flatRun = 8, qualityWindow = 15 } = {}) {
    this.min = min;
    this.max = max;
    this.flatRun = flatRun;
    this.qualityWindow = qualityWindow;
    this.hampel = new HampelFilter();
    this.history = []; // 1 = good sample, 0 = bad/missing
    this.lastRaw = null;
    this.sameCount = 0;
    this.minutesSinceGood = 0;
  }
  process(raw) {
    const flags = [];
    let value = null;
    let good = 0;

    if (raw == null || Number.isNaN(raw)) {
      flags.push('dropout');
    } else if (raw < this.min || raw > this.max) {
      flags.push('out-of-range');
    } else {
      this.sameCount = raw === this.lastRaw ? this.sameCount + 1 : 0;
      this.lastRaw = raw;
      if (this.sameCount >= this.flatRun) {
        flags.push('flatline');
      } else {
        const r = this.hampel.push(raw);
        value = r.value;
        if (r.flagged) flags.push('spike');
        good = r.flagged ? 0.5 : 1;
      }
    }

    this.history.push(good);
    if (this.history.length > this.qualityWindow) this.history.shift();
    const quality = this.history.reduce((a, b) => a + b, 0) / this.history.length;
    this.minutesSinceGood = good > 0 ? 0 : this.minutesSinceGood + 1;
    return { value, flags, quality, minutesSinceGood: this.minutesSinceGood };
  }
}

/** Range-checks the environmental feed and holds the last good value for short gaps. */
export class EnvChannelQC {
  constructor() {
    this.limits = {
      tAirC: [-60, 65], rhPct: [0, 100], pressureHpa: [500, 1100],
      wind10m: [0, 60], solarWm2: [0, 1500], pm10: [0, 10000], h2sAreaPpm: [0, 1000],
    };
    this.last = {};
  }
  process(env) {
    const out = {};
    const flags = [];
    for (const [k, v] of Object.entries(env)) {
      const lim = this.limits[k];
      const ok = v != null && !Number.isNaN(v) && (!lim || (v >= lim[0] && v <= lim[1]));
      if (ok) {
        out[k] = v;
        this.last[k] = v;
      } else {
        if (v != null) flags.push(`${k}:invalid`);
        else if (k in this.last) flags.push(`${k}:held`);
        out[k] = k in this.last ? this.last[k] : null;
      }
    }
    return { env: out, flags };
  }
}
