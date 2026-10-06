// The streaming pipeline:  Monitor -> Detect -> Assess -> Warn
//
//   SiteMonitor    one per site : env QC, sun position, WBGT per exposure zone, sudden-change detection
//   WorkerMonitor  one per person: HR QC, fusion estimator, strain, dose, forecast, alert policy
//   Monitor        wires them together; call step(sample) once per sample period (here: 1 min)
//
// Every step is O(1) in the length of the history, dependency-free, and runs on a phone.

import { solarGeometry } from './solar.js';
import { thermalEnvironment, wbgtIndoor } from './wbgt.js';
import { ACTIVITY, CLOTHING, wbgtLimit, workRestPlan } from './limits.js';
import { EnvChannelQC, HrChannelQC } from './qc.js';
import { Cusum } from './cusum.js';
import { CoreTempEstimator, BullerKalman } from './estimator.js';
import { psi, psiCategory, HeatDose } from './strain.js';
import { GasExposure, particulateLevel } from './dose.js';
import { AlertPolicy } from './alerts.js';
import { median } from './psychro.js';
import { windChillC, frostbiteMinutes } from './cold.js';

const WIND_10M_TO_2M = Math.pow(2 / 10, 0.15); // neutral rural power-law profile (Liljegren 2008)

export class SiteMonitor {
  constructor(site) {
    this.site = site; // { lat, lon, name }
    this.qc = new EnvChannelQC();
    this.cusum = {
      pm10: new Cusum({ log: true, sigmaMin: 0.06, h: 6, minShift: 0.3 }),  // >= 2x change
      wbgt: new Cusum({ sigmaMin: 0.35, h: 6, minShift: 2.2 }),             // >= 2.2 C (wind-lull swings are not "events")
      h2s: new Cusum({ log: true, sigmaMin: 0.15, h: 5, minShift: 0.2 }),
    };
    this.cabin = wbgtIndoor({ tAirC: 25, rhPct: 50, windMs: 0.2 }).wbgt;
    this.announced = { pm10: false, wbgt: false, h2s: false };
  }

  step(t, utcMs, rawEnv, zoneEnv = {}) {
    const { env, flags } = this.qc.process(rawEnv);
    const geom = solarGeometry(utcMs, this.site.lat, this.site.lon);
    const wind2m = Math.max(0.2, (env.wind10m ?? 1) * WIND_10M_TO_2M);
    const thermal = thermalEnvironment({
      tAirC: env.tAirC, rhPct: env.rhPct, pressureHpa: env.pressureHpa ?? 1005,
      wind2m, solarWm2: env.solarWm2 ?? 0, geom,
    });
    const zones = { cabin: this.cabin };
    for (const [name, z] of Object.entries(zoneEnv)) zones[name] = wbgtIndoor(z).wbgt;

    // Change-point events. The CUSUM finds *statistical* shifts; we only surface the ones that are
    // also *material* (big enough to matter to a worker) and pair every "ended" with a real "started".
    const events = [];
    const a = this.announced;
    if (env.pm10 != null) {
      const r = this.cusum.pm10.push(env.pm10);
      if (r.started && r.direction > 0 && env.pm10 >= Math.max(120, 2 * r.baseline)) {
        a.pm10 = true;
        events.push({ t, kind: 'pm10', severity: 1, text: `Dust front detected: PM10 ${Math.round(r.baseline)} to ${Math.round(env.pm10)} ug/m3 (CUSUM change-point)` });
      }
      if (r.ended && a.pm10) { a.pm10 = false; if (!r.rebased) events.push({ t, kind: 'pm10', severity: 0, text: 'Dust settling: PM10 back toward baseline' }); }
    }
    const w = this.cusum.wbgt.push(thermal.sun.wbgt);
    if (w.started && Math.abs(thermal.sun.wbgt - w.baseline) >= 2.2) {
      a.wbgt = true;
      events.push({ t, kind: 'wbgt', severity: 1, text: w.direction > 0 ? `Heat load jump: sun WBGT ${w.baseline.toFixed(1)} to ${thermal.sun.wbgt.toFixed(1)} C` : `Cooling front: sun WBGT ${w.baseline.toFixed(1)} to ${thermal.sun.wbgt.toFixed(1)} C` });
    }
    if (w.ended && a.wbgt) { a.wbgt = false; if (!w.rebased) events.push({ t, kind: 'wbgt', severity: 0, text: 'Heat load stabilised' }); }
    if (env.h2sAreaPpm != null) {
      const r = this.cusum.h2s.push(env.h2sAreaPpm);
      if (r.started && r.direction > 0 && env.h2sAreaPpm >= 1.0) {
        a.h2s = true;
        events.push({ t, kind: 'h2s', severity: 2, text: `Gas release detected by area monitor (H2S ${env.h2sAreaPpm.toFixed(1)} ppm, CUSUM change-point)` });
      }
      if (r.ended && a.h2s) { a.h2s = false; if (!r.rebased) events.push({ t, kind: 'h2s', severity: 0, text: 'Area H2S back to baseline' }); }
    }
    const pm = particulateLevel(env.pm10, a.pm10); // a.pm10 = a dust-front surge is currently in progress
    const windChill = windChillC(env.tAirC, env.wind10m ?? 0);
    return { t, utcMs, env, flags, geom, wind2m, thermal, zones, pm, events, windChill };
  }
}

const nearestActivity = (M) =>
  Object.entries(ACTIVITY).reduce((best, [k, v]) => (Math.abs(v.M - M) < Math.abs(ACTIVITY[best].M - M) ? k : best), 'rest');

export class WorkerMonitor {
  /**
   * @param {{id:string,name:string,role?:string,acclimatized:boolean,restHr:number,age:number,clothing:string}} profile
   */
  constructor(profile, opts = {}) {
    this.profile = profile;
    this.hrQc = new HrChannelQC();
    const ep = { acclimatized: profile.acclimatized, ...(opts.estimator || {}) };
    this.est = new CoreTempEstimator(ep);
    this.prior = new CoreTempEstimator(ep); // environment-only shadow (never sees heart rate)
    this.buller = new BullerKalman();
    this.dose = new HeatDose(38.0);
    this.gas = new GasExposure();
    this.policy = new AlertPolicy(opts.policy);
    this.mHist = [];
    this.coldMin = 0;
    this.hrSmooth = null;
    this.hrRun = 0;
    this.first = { geos: null, staticWbgt: null, hr: null, buller: null };
    this.clothAdj = (CLOTHING[profile.clothing] || CLOTHING.coverall).adj;
  }

  step(t, site, s) {
    const p = this.profile;
    const zone = s.zone || 'sun';
    const zoneWbgt = zone === 'sun' ? site.thermal.sun.wbgt
      : zone === 'shade' ? site.thermal.shade.wbgt
      : site.zones[zone] ?? site.thermal.shade.wbgt;
    let wbgtEff = zoneWbgt + this.clothAdj;

    // --- workload from the accelerometer-derived activity class, median-smoothed over 5 min ---
    const Mraw = ACTIVITY[s.activity]?.M ?? (this.mHist.at(-1) ?? ACTIVITY.rest.M);
    this.mHist.push(Mraw);
    if (this.mHist.length > 5) this.mHist.shift();
    const activity = nearestActivity(median(this.mHist));
    const M = ACTIVITY[activity].M;

    // --- cold: under insulating clothing the heat load is not the outdoor WBGT, so keep a microclimate floor ---
    const wc = site.windChill ?? site.env.tAirC;
    if (site.env.tAirC < 5) wbgtEff = Math.max(wbgtEff, 14 + 0.03 * (M - 115));
    // minutes outdoors, with a faster recovery indoors, against the frostbite window at the current wind chill
    const outdoor = zone === 'sun' || zone === 'shade';
    this.coldMin = wc <= -15 && outdoor ? this.coldMin + 1 : Math.max(0, this.coldMin - 2);
    const cold = wc <= -15 ? { wc, minOut: this.coldMin, tf: frostbiteMinutes(wc) } : null;

    // --- heart rate QC and smoothing ---
    const q = this.hrQc.process(s.hr ?? null);
    if (q.value != null) this.hrSmooth = this.hrSmooth == null ? q.value : 0.7 * this.hrSmooth + 0.3 * q.value;

    // --- fusion estimator, prior-only shadow and HR-only baseline ---
    const E = this.est.step({ dt: 1, M, wbgtEff, hr: q.value });
    const priorE = this.prior.step({ dt: 1, M, wbgtEff, hr: null });
    const B = this.buller.step(q.value);

    // --- assess exposure ---
    const ps = psi(E.tc, this.hrSmooth ?? p.restHr, 37.1, p.restHr);
    const dose = this.dose.push(E.tc);
    const fc = this.est.forecast(60, { M, wbgtEff }, 1);
    const ttt385 = fc.ttt(38.5), ttt385early = fc.ttt(38.5, 1), ttt39 = fc.ttt(39.0), ttt39early = fc.ttt(39.0, 1);
    const forecast = [];
    for (let k = 0; k <= 60; k += 5) forecast.push({ t: k, tc: fc.tc[k], sd: fc.sd[k] });
    const limit = wbgtLimit(M, p.acclimatized);
    const plan = workRestPlan(wbgtEff, M, p.acclimatized);
    const gas = this.gas.push(s.gasPpm ?? null);

    // --- warn ---
    const a = this.policy.step({
      t, tcEst: E.tc, tcSd: E.sd, ttt385, ttt385early, ttt39, ttt39early, psi: ps,
      wbgtEff, limit, plan, M, activityLabel: ACTIVITY[activity].label,
      hr: this.hrSmooth, hrRest: p.restHr, minutesWithoutHr: q.minutesSinceGood, slopePerHour: E.slopePerHour,
      gas, pm: site.pm, pm10: site.env.pm10, cold,
    });

    // --- baselines used for comparison (what typical systems would do) ---
    const hrMax = 220 - p.age;
    this.hrRun = q.value != null && q.value >= 0.85 * hrMax ? this.hrRun + 1 : 0;
    const base = {
      staticWbgt: zoneWbgt >= 28,
      hr: this.hrRun >= 5,
      buller: B.tc >= 38.3, // HR-only Kalman with the same trigger temperature as GEOS's WARNING
    };
    if (a.level >= 2 && a.hazard === 'heat' && this.first.geos == null) this.first.geos = t;
    for (const k of ['staticWbgt', 'hr', 'buller']) if (base[k] && this.first[k] == null) this.first[k] = t;

    return {
      t, id: p.id, zone, activity, activityLabel: ACTIVITY[activity].label, M,
      hrRaw: s.hr ?? null, hr: q.value, hrSmooth: this.hrSmooth, hrQuality: q.quality, hrFlags: q.flags,
      minutesWithoutHr: q.minutesSinceGood,
      wbgt: zoneWbgt, wbgtEff, limit, plan,
      tc: E.tc, tcSd: E.sd, tcPrior: priorE.tc, tcHrOnly: B.tc, slopePerHour: E.slopePerHour, bias: E.bias,
      ttt385, ttt385early, ttt39, forecast,
      psi: ps, psiCat: psiCategory(ps), dose,
      coldWc: wc, coldMin: this.coldMin, coldTf: cold ? cold.tf : null,
      gas, level: a.level, candidate: a.candidate, title: a.title, hazard: a.hazard, reasons: a.reasons, actions: a.actions, change: a.change,
      base, first: { ...this.first },
      truth: s.truth ?? null,
    };
  }
}

export class Monitor {
  constructor(site, profiles, opts = {}) {
    this.site = new SiteMonitor(site);
    this.workers = profiles.map((p) => new WorkerMonitor(p, opts));
  }
  /** @param {{t:number, utcMs:number, env:object, zoneEnv?:object, workers:Object<string,object>}} sample */
  step(sample) {
    const site = this.site.step(sample.t, sample.utcMs, sample.env, sample.zoneEnv);
    const workers = {};
    for (const w of this.workers) workers[w.profile.id] = w.step(sample.t, site, sample.workers[w.profile.id] || {});
    return { t: sample.t, utcMs: sample.utcMs, site, workers };
  }
}
