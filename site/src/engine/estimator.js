// Core-temperature estimation and forecasting - the heart of GEOS.
//
// IDEA: "predict with the environment, correct with the body".
//   * Prediction step  - a reduced-order heat-strain model driven by what the site sensors see
//     (WBGT, clothing) and what the worker is doing (metabolic rate). It is anchored to the NIOSH
//     criteria, which are themselves built so that WBGT = limit(M) <=> core temp plateaus at 38.0 C.
//     This is what lets us warn BEFORE the body has visibly responded.
//   * Correction step  - heart rate, a noisy but continuous window onto core temperature, through
//     the quadratic observation model of Buller et al. (2013) inside an extended Kalman filter.
//   * A second state learns a per-worker drift bias online (this person heats faster / slower
//     than the population model), which is what makes the forecast personal.
//
// State x = [Tc, b]   Tc: core temperature (C)   b: unexplained drift (C/min)
//   Tc' = (Tc_eq(M, WBGT) - Tc)/tau + b   ;   b' = -b/tau_b            (+ process noise)
//   HR  = b0 + b1 Tc + b2 Tc^2  + activity offset (+ measurement noise)
//
// If heart rate is missing the filter simply keeps predicting (uncertainty grows) - graceful
// degradation instead of a blind spot.

import { wbgtLimit } from './limits.js';
import { clamp } from './psychro.js';

/** Observation model and noise from Buller et al. (2013), as published in US patent 10,702,165. */
export const HR_OBS = { b0: -7887.1, b1: 384.4286, b2: -4.5714, sigma: 18.88, qVar: 0.000484 };
export const hrFromTc = (tc) => HR_OBS.b0 + HR_OBS.b1 * tc + HR_OBS.b2 * tc * tc;
export const dHrdTc = (tc) => HR_OBS.b1 + 2 * HR_OBS.b2 * tc;

// Free parameters were calibrated on synthetic calibration seeds (bench/run.mjs --tune) and then
// frozen; all reported results use different, held-out seeds. rSigma is Buller's published value.
export const DEFAULT_PARAMS = {
  tau: 45,        // min  - how fast core temperature relaxes toward its equilibrium
  tauBias: 240,   // min  - decay of the learned per-worker drift
  tcAtLimit: 37.7, // C - typical core temperature when WBGT sits exactly at the NIOSH limit
  eqCap: 3.0,     // C - ceiling on how far above tcAtLimit the equilibrium can rise
  gUp: 0.30,      // C of equilibrium core temp per C of WBGT above the limit (small excess)
  gLo: 0.06,      // C per C below the limit (gentler)
  qTc: 0.04,      // process noise, C per sqrt(min)
  qBias: 0.0012,  // process noise on drift, (C/min) per sqrt(min)
  rSigma: 14,     // bpm - HR noise (Buller's published 18.88 is for HR-only; tuned lower once resting HR is modelled)
  actK: 0.04,     // bpm per watt of workload relative to the moderate-work reference
  acclHrBoost: 0, // bpm added back for acclimatised workers (acclimatisation lowers HR at equal core temp)
  restHr: null,   // bpm - the worker's resting heart rate (set per worker by the pipeline)
  rhrK: 0.8,      // fraction of the resting-HR difference passed into the HR observation
  rhrRef: 69,     // bpm - resting HR the population observation model corresponds to
  tc0: 37.1,
  p0Tc: 0.15,
  p0Bias: 0.004,
  tcMin: 35.5,
  tcMax: 42.0,
};

export class CoreTempEstimator {
  constructor(opts = {}) {
    const { acclimatized = false, ...params } = opts;
    this.p = { ...DEFAULT_PARAMS, ...params };
    this.acclimatized = acclimatized;
    this.reset();
  }

  reset() {
    this.tc = this.p.tc0;
    this.b = 0;
    this.P = [[this.p.p0Tc ** 2, 0], [0, this.p.p0Bias ** 2]]; // [[p00,p01],[p01,p11]]
    this.minutesWithoutHr = 0;
    this.lastInnovation = 0;
  }

  /** Equilibrium core temperature for sustained (M, WBGT) - the physiology-informed prior. */
  equilibrium(M, wbgtEff) {
    const dW = wbgtEff - wbgtLimit(M, this.acclimatized);
    // Above the limit the equilibrium rises ~gUp C per C of WBGT excess but saturates (tanh):
    // people self-pace, sweating adapts, and the model must not forecast absurd temperatures.
    const eq = dW >= 0
      ? this.p.tcAtLimit + this.p.eqCap * Math.tanh((this.p.gUp * dW) / this.p.eqCap)
      : this.p.tcAtLimit + this.p.gLo * dW;
    const floor = 36.4 + 0.0012 * (M - 115); // in the cold the body settles a little below 37 C (shivering holds it near 36.5)
    return clamp(eq, floor, 41.5);
  }

  _propagate(tc, b, P, dt, eq) {
    const { tau, tauBias, qTc, qBias } = this.p;
    const a = 1 - dt / tau;
    const ab = 1 - dt / tauBias;
    const tcN = a * tc + (dt * eq) / tau + dt * b;
    const bN = ab * b;
    const [p00, p01, p11] = [P[0][0], P[0][1], P[1][1]];
    const n00 = a * a * p00 + 2 * a * dt * p01 + dt * dt * p11 + qTc * qTc * dt;
    const n01 = a * ab * p01 + dt * ab * p11;
    const n11 = ab * ab * p11 + qBias * qBias * dt;
    return { tc: clamp(tcN, this.p.tcMin, this.p.tcMax), b: bN, P: [[n00, n01], [n01, n11]] };
  }

  /** Heart-rate offset (bpm) to remove before inverting the HR->Tc map: workload relative to the
   *  moderate-work reference, minus the acclimatisation effect. */
  hrActivityOffset(M) {
    // A worker's own resting heart rate moves the whole HR curve; Buller's map is for an average person.
    const rest = this.p.restHr == null ? 0 : this.p.rhrK * (this.p.restHr - this.p.rhrRef);
    return this.p.actK * (M - 300) + rest - (this.acclimatized ? this.p.acclHrBoost : 0);
  }

  /**
   * One filter step.
   * @param {{dt?:number, M:number, wbgtEff:number, hr?:number|null}} u
   */
  step({ dt = 1, M, wbgtEff, hr = null }) {
    const eq = this.equilibrium(M, wbgtEff);
    const pr = this._propagate(this.tc, this.b, this.P, dt, eq);
    let { tc, b, P } = pr;
    let usedHr = false;
    let innovation = 0;

    if (hr != null) {
      const z = hr - this.hrActivityOffset(M);
      const H = dHrdTc(tc);
      const R = this.p.rSigma ** 2;
      const S = H * H * P[0][0] + R;
      innovation = clamp(z - hrFromTc(tc), -60, 60);
      const k0 = (P[0][0] * H) / S;
      const k1 = (P[0][1] * H) / S;
      tc = clamp(tc + k0 * innovation, this.p.tcMin, this.p.tcMax);
      b = b + k1 * innovation;
      const p00 = P[0][0] * (1 - k0 * H);
      const p01 = P[0][1] * (1 - k0 * H);
      const p11 = P[1][1] - k1 * H * P[0][1];
      P = [[p00, p01], [p01, Math.max(p11, 1e-10)]];
      usedHr = true;
      this.minutesWithoutHr = 0;
    } else {
      this.minutesWithoutHr += dt;
    }

    this.tc = tc;
    this.b = clamp(b, -0.05, 0.05);
    this.P = P;
    this.lastInnovation = innovation;
    return {
      tc: this.tc,
      sd: Math.sqrt(this.P[0][0]),
      bias: this.b,
      eq,
      slopePerHour: 60 * ((eq - this.tc) / this.p.tau + this.b),
      usedHr,
      innovation,
    };
  }

  /**
   * Forecast core temperature assuming workload and environment persist.
   * @returns {{t:number[], tc:number[], sd:number[], ttt:(thr:number)=>number|null}}
   *   ttt(thr) = minutes until the mean forecast reaches `thr` (0 if already above, null if not within horizon)
   */
  forecast(horizonMin, { M, wbgtEff }, stepMin = 1) {
    const eq = this.equilibrium(M, wbgtEff);
    let { tc, b } = this;
    let P = this.P.map((r) => r.slice());
    const t = [0], mean = [tc], sd = [Math.sqrt(P[0][0])];
    for (let k = stepMin; k <= horizonMin; k += stepMin) {
      const n = this._propagate(tc, b, P, stepMin, eq);
      tc = n.tc; b = n.b; P = n.P;
      t.push(k); mean.push(tc); sd.push(Math.sqrt(P[0][0]));
    }
    const ttt = (thr, k = 0) => {
      // k: number of standard deviations added to the mean (0 = expected, 1 = earliest plausible)
      if (mean[0] + k * sd[0] >= thr) return 0;
      for (let i = 1; i < mean.length; i++) {
        const v = mean[i] + k * sd[i];
        if (v >= thr) {
          const v0 = mean[i - 1] + k * sd[i - 1];
          return t[i - 1] + ((thr - v0) / (v - v0)) * (t[i] - t[i - 1]);
        }
      }
      return null;
    };
    return { t, tc: mean, sd, ttt };
  }
}

/** Heart-rate-only Kalman filter exactly as published (baseline for comparison). */
export class BullerKalman {
  constructor(tc0 = 37.1, p0 = 0.1) {
    this.tc = tc0;
    this.P = p0 * p0;
  }
  step(hr) {
    this.P += HR_OBS.qVar;
    if (hr != null) {
      const H = dHrdTc(this.tc);
      const K = (this.P * H) / (H * H * this.P + HR_OBS.sigma ** 2);
      this.tc = clamp(this.tc + K * (hr - hrFromTc(this.tc)), 35.5, 42);
      this.P = (1 - K * H) * this.P;
    }
    return { tc: this.tc, sd: Math.sqrt(this.P) };
  }
}

