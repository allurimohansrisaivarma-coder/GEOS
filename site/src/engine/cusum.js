// Sudden-change detection for environmental channels (dust front, gas release, heat spike).
// Two-sided tabular CUSUM on a standardised signal whose baseline is an EWMA that freezes while
// an alarm is active - so a slow diurnal drift is tracked (no alarm) but a step is not absorbed.
//
// Robustness rules (found the hard way):
//   * minShift  - a statistical trigger only counts if the level really moved by a material amount
//   * calm exit - the alarm ends once the signal is back within the slack band for a few samples
//   * timeout   - a persistent new plateau is re-baselined after `maxActive` samples, so the
//                 detector can never get stuck in alarm and miss the next event

export class Cusum {
  /**
   * @param {object} o
   * @param {number} o.k         slack, in standard deviations (0.5 detects ~1 sigma shifts)
   * @param {number} o.h         decision threshold, in standard deviations
   * @param {number} o.alpha     EWMA rate of the baseline mean/variance
   * @param {number} o.sigmaMin  floor for sigma in signal units (avoids divide-by-near-zero)
   * @param {number} o.warmup    samples before alarms are allowed
   * @param {boolean} o.log      operate on log10(x + 1) - for heavy-tailed positive signals (PM10, ppm)
   * @param {number} o.minShift  minimum material shift, in (transformed) signal units
   * @param {number} o.maxActive samples after which a persistent alarm is re-baselined
   */
  constructor({ k = 0.5, h = 5, alpha = 0.05, sigmaMin = 0.3, warmup = 12, log = false, minShift = 0, maxActive = 60 } = {}) {
    Object.assign(this, { k, h, alpha, sigmaMin, warmup, log, minShift, maxActive });
    this.n = 0;
    this.mu = 0;
    this.var = 0;
    this.sHi = 0;
    this.sLo = 0;
    this.active = false;
    this.activeFor = 0;
    this.calm = 0;
  }
  _tx(x) { return this.log ? Math.log10(Math.max(x, 0) + 1) : x; }
  _inv(y) { return this.log ? Math.pow(10, y) - 1 : y; }

  /** @returns {{alarm:boolean, started:boolean, ended:boolean, rebased:boolean, direction:number, baseline:number, value:number}} */
  push(xRaw) {
    const x = this._tx(xRaw);
    let started = false, ended = false, rebased = false;
    if (this.n === 0) { this.mu = x; this.var = this.sigmaMin ** 2; }
    this.n++;
    const sigma = Math.max(Math.sqrt(this.var), this.sigmaMin);
    const z = (x - this.mu) / sigma;

    if (this.n > this.warmup && !this.active) {
      this.sHi = Math.max(0, this.sHi + z - this.k);
      this.sLo = Math.max(0, this.sLo - z - this.k);
      if (this.sHi > this.h || this.sLo > this.h) {
        if (Math.abs(x - this.mu) >= this.minShift) {
          this.active = true;
          this.activeFor = 0;
          this.calm = 0;
          started = true;
        } else {
          this.sHi = this.sLo = 0; // statistically odd but immaterial: ignore and keep tracking
        }
      }
    }

    const baselineBefore = this._inv(this.mu);
    const direction = z > 0 ? 1 : z < 0 ? -1 : 0;

    if (this.active && !started) {
      this.activeFor++;
      this.calm = Math.abs(z) < this.k ? this.calm + 1 : 0;
      if (this.calm >= 5) {
        this.active = false; ended = true; this.sHi = this.sLo = 0;
      } else if (this.activeFor >= this.maxActive) {
        // the new level has persisted: accept it as the new normal
        this.active = false; ended = true; rebased = true;
        this.sHi = this.sLo = 0;
        this.mu = x;
        this.var = this.sigmaMin ** 2;
      }
    }
    if (!this.active) {
      const d = x - this.mu;
      this.mu += this.alpha * d;
      this.var = (1 - this.alpha) * (this.var + this.alpha * d * d);
    }
    return { alarm: this.active, started, ended, rebased, direction, baseline: baselineBefore, value: xRaw };
  }
}
