// Scenario definitions + the Simulator that turns them into noisy sensor streams.
//
// The Simulator knows the hidden truth (a heat-balance body model per worker); the engine only
// ever receives what real sensors would give it: noisy weather readings, a wrist/chest heart-rate
// signal with artefacts and dropouts, an accelerometer activity class and (offshore) a personal
// gas monitor. With `followAdvice` the simulated workers react to the alerts, which lets us show
// the closed loop: warning -> rest in shade -> core temperature stays out of the danger zone.

import { Rng, ramp } from './rng.js';
import { Person } from './physiology.js';
import { solarGeometry, clearSkyGhi } from '../engine/solar.js';
import { solarComponents } from '../engine/wbgt.js';
import { rhFromDewPointC, clamp } from '../engine/psychro.js';
import { ACTIVITY, ACTIVITY_ORDER } from '../engine/limits.js';

const seg = (list, base) => (i) => {
  for (const [a, b, act, zone] of list) if (i >= a && i < b) return { activity: act, zone: zone || 'sun' };
  return typeof base === 'function' ? base(i) : { activity: base, zone: 'sun' };
};
const cycle = (period, workMin, a, b) => (i) => ({ activity: i % period < workMin ? a : b, zone: 'sun' });
const withBreaks = (inner, list) => (i) => {
  for (const [a, b, zone] of list) if (i >= a && i < b) return { activity: 'rest', zone };
  return inner(i);
};

const localStartMs = (L, tzMin) => Date.UTC(L.y, L.mo - 1, L.d, L.h, L.mi) - tzMin * 60000;

// ------------------------------------------------------------------------------------------
// Environment generator (shared by every scenario and by the random benchmark cohort)
// ------------------------------------------------------------------------------------------
export function makeEnv(P, scn, seed) {
  const r = new Rng(seed * 4099 + 11);
  const N = scn.durationMin + 2;
  const ar = (phi, sd) => {
    const a = new Float64Array(N);
    let x = 0;
    for (let i = 0; i < N; i++) { x = phi * x + r.normal(0, sd * Math.sqrt(1 - phi * phi)); a[i] = x; }
    return a;
  };
  const nT = ar(0.9, 0.3), nW = ar(0.95, 1.0), nK = ar(0.9, 0.03), nD = ar(0.98, 0.8), nP = ar(0.9, 0.15);
  const { dust, gas, machinery } = P;
  return (i) => {
    const h = scn.startLocalH + i / 60;
    const T = P.tMean + P.tAmp * Math.cos((2 * Math.PI * (h - P.tPeakH)) / 24) + nT[i];
    const d = dust ? ramp(i, dust.t0, dust.t1) * (1 - ramp(i, dust.t1 + 15, dust.t2)) : 0;
    // ventilation failure (mines): temperature and humidity climb while airflow drops, then the fans are restored
    const vt = P.vent ? ramp(i, P.vent.t0, P.vent.t1) * (1 - ramp(i, P.vent.t2, P.vent.t3)) : 0;
    const Ta = T - (dust ? dust.dT * d : 0) + (P.vent ? P.vent.dT * vt : 0);
    const Td = Math.min(P.dewC + nD[i] + (dust ? 2 * d : 0) + (P.vent ? P.vent.dDew * vt : 0), Ta - 1.0); // dew point can never exceed air temperature
    const wind10 = Math.max(0.3, P.wind10 + nW[i] + (dust ? dust.dWind * d : 0) - (P.vent ? P.vent.dWind * vt : 0));
    const g = solarGeometry(scn.startUtcMs + i * 60000, scn.site.lat, scn.site.lon);
    const kt = clamp(P.kt + nK[i] - (dust ? dust.dKt * d : 0), 0.05, 1);
    const pm10 = Math.max(5, P.pm0 * (1 + nP[i]) + (dust ? dust.dPm * d : 0));

    let gasProfile = 0, h2sAreaPpm = null;
    if (gas) {
      const a = gas.t0, b = a + gas.rise, c = b + gas.hold;
      gasProfile = i < a ? 0 : i < b ? (i - a) / gas.rise : i < c ? 1 : Math.exp(-(i - c) / gas.decay);
      h2sAreaPpm = gas.areaBase + gas.areaPeak * gasProfile;
    }
    let zoneEnv;
    if (machinery) {
      const Tm = Ta + machinery.dT;
      zoneEnv = { machinery: { tAirC: Tm, rhPct: rhFromDewPointC(Tm, Td), windMs: 0.4, pressureHpa: P.pressure ?? 1005 } };
    }
    return {
      tAirC: Ta, rhPct: rhFromDewPointC(Ta, Td), pressureHpa: P.pressure ?? 1005, wind10m: wind10,
      solarWm2: P.underground ? 0 : clearSkyGhi(g.cza) * kt, pm10, h2sAreaPpm, gasProfile, zoneEnv,
    };
  };
}

// ------------------------------------------------------------------------------------------
// Simulator
// ------------------------------------------------------------------------------------------
export class Simulator {
  constructor(scn, seed = 1, { followAdvice = false } = {}) {
    this.scn = scn;
    this.followAdvice = followAdvice;
    this.envFn = scn.liveEnv ? scn.liveEnv : makeEnv(scn.env, scn, seed);
    this.rngEnv = new Rng(seed * 31 + 7);
    this.workers = scn.workers.map((w, k) => ({
      w,
      person: new Person(w.person, new Rng(seed * 1009 + k * 17 + 3)),
      rng: new Rng(seed * 2003 + k * 29 + 5),
      st: { onBreak: false, breakStart: 0, calm: 0, high: 0, delay: 2 + (k % 3), resumeUntil: -1, zone: 'shade', evac: false, gasCalm: 0, dropLeft: 0 },
    }));
  }

  _behaviour(wk, i, prev) {
    const base = wk.w.schedule(i);
    if (!this.followAdvice || !prev) return base;
    const st = wk.st;
    st.high = prev.level >= 2 ? st.high + 1 : 0;
    if (!st.onBreak && st.high >= st.delay) { st.onBreak = true; st.breakStart = i; st.zone = prev.level >= 3 || prev.hazard === 'cold' || this.scn.restZone === 'cabin' ? 'cabin' : 'shade'; }
    if (st.onBreak) {
      st.calm = i - st.breakStart >= 20 && prev.level <= 1 ? st.calm + 1 : 0;
      if (st.calm >= 5) { st.onBreak = false; st.resumeUntil = i + 30; }
      else return { activity: 'rest', zone: st.zone };
    }
    if (i < st.resumeUntil && base.activity !== 'rest') {
      const k = Math.max(1, ACTIVITY_ORDER.indexOf(base.activity) - 1); // resume one class lighter
      return { activity: ACTIVITY_ORDER[k], zone: base.zone };
    }
    return base;
  }

  /** Produce the raw sensor sample for minute i (plus hidden truth). */
  sample(i, prev = {}) {
    const scn = this.scn;
    const utcMs = scn.startUtcMs + i * 60000;
    const e = this.envFn(i);
    const geom = solarGeometry(utcMs, scn.site.lat, scn.site.lon);
    const { solar: ghi, fdir } = solarComponents(e.solarWm2, geom.cza, geom.distanceAU);
    const wind2m = Math.max(0.2, e.wind10m * Math.pow(0.2, 0.15));
    const body = { Ta: e.tAirC, rh: e.rhPct, wind2m, ghi, fdir, cza: geom.cza, elevDeg: geom.elevationDeg, zoneEnv: e.zoneEnv };

    const s = this.rngEnv;
    const env = {
      tAirC: e.tAirC + s.normal(0, 0.25),
      rhPct: clamp(e.rhPct + s.normal(0, 1.5), 3, 100),
      pressureHpa: e.pressureHpa + s.normal(0, 0.4),
      wind10m: Math.max(0, e.wind10m * (1 + s.normal(0, 0.08))),
      solarWm2: Math.max(0, e.solarWm2 * (1 + s.normal(0, 0.03))),
      pm10: e.pm10 * Math.exp(s.normal(0, 0.05)),
      h2sAreaPpm: e.h2sAreaPpm == null ? null : Math.max(0, e.h2sAreaPpm + s.normal(0, 0.15)),
    };
    const nz = [s.normal(0, 0.3), s.normal(0, 1.5)];
    const zoneEnv = e.zoneEnv
      ? { machinery: { ...e.zoneEnv.machinery, tAirC: e.zoneEnv.machinery.tAirC + nz[0], rhPct: clamp(e.zoneEnv.machinery.rhPct + nz[1], 3, 100) } }
      : undefined;

    const workers = {};
    for (const wk of this.workers) {
      const id = wk.w.profile.id;
      const pv = prev[id];
      const beh = this._behaviour(wk, i, pv);
      const truth = wk.person.step(1, { ...body, zone: beh.zone }, beh.activity);

      // fixed number of random draws per step keeps open- and closed-loop runs comparable
      const r = wk.rng;
      const u = [r.next(), r.next(), r.next(), r.next(), r.next(), r.next()];
      const hrNoise = r.normal(0, 2.5);
      const gasNoise = r.normal(0, 0.25);

      let hr = truth.hrTrue + hrNoise;
      if (u[0] < 0.012) hr += (u[1] < 0.5 ? -1 : 1) * (25 + 20 * u[2]);
      const st = wk.st;
      let dropped = (wk.w.hrDropouts || []).some(([a, b]) => i >= a && i < b);
      if (st.dropLeft > 0) { dropped = true; st.dropLeft--; }
      else if (u[3] < 0.004) { dropped = true; st.dropLeft = 2 + Math.floor(u[2] * 6); }
      if (dropped) hr = null; else hr = Math.round(hr);

      // the accelerometer reports what the worker is actually doing (after self-pacing)
      let activity = ACTIVITY_ORDER.reduce((best, k) => (Math.abs(ACTIVITY[k].M - truth.M) < Math.abs(ACTIVITY[best].M - truth.M) ? k : best), 'rest');
      if (u[4] < 0.12) {
        const k = ACTIVITY_ORDER.indexOf(activity) + (u[5] < 0.5 ? -1 : 1);
        activity = ACTIVITY_ORDER[clamp(k, 0, ACTIVITY_ORDER.length - 1)];
      }

      let gasPpm = null;
      if (scn.hasGas) {
        if (this.followAdvice && pv && pv.gasLevel >= 2) st.evac = true;
        if (st.evac && e.gasProfile < 0.02) { st.gasCalm++; if (st.gasCalm > 10) st.evac = false; }
        gasPpm = Math.max(0, e.gasProfile * (wk.w.gasCoupling || 0) * (st.evac ? 0.08 : 1) * Math.exp(gasNoise));
      }
      workers[id] = { hr, activity, zone: beh.zone, gasPpm, truth: { tc: truth.tc, tsk: truth.tsk, dehydPct: truth.dehydPct, sweatL: truth.sweatL, hrTrue: truth.hrTrue, trueActivity: beh.activity } };
    }
    return { t: i, utcMs, env, zoneEnv, workers };
  }
}

// ------------------------------------------------------------------------------------------
// Scenario catalogue
// ------------------------------------------------------------------------------------------
const mkWorker = (profile, person, schedule, extra = {}) => ({ profile, person, schedule, ...extra });

/** The five-person desert crew; `lunchAt` is the minute (from shift start) of the 30-min lunch. */
export function desertCrew(lunchAt = 180, roles = null) {
  const lunch = [lunchAt, lunchAt + 30, 'shade'];
  const breaks = (list) => list.map(([a, b, z]) => [a, b, z]);
  const crew = [
    mkWorker({ id: 'arjun', name: 'Arjun Mehta', role: 'Panel installer (new hire)', acclimatized: false, restHr: 72, age: 24, clothing: 'doubleLayer' },
      { massKg: 72, heightCm: 175, age: 24, restHr: 72, fit: 1.0, acclimatized: false, clothing: 'doubleLayer', metScale: 1.0, drinkLph: 0.3, kth: 24, sweatSens: 1.0 },
      seg([[lunch[0], lunch[1], 'rest', 'shade']], 'heavy')),
    mkWorker({ id: 'meera', name: 'Meera Rao', role: 'Electrician (acclimatised)', acclimatized: true, restHr: 62, age: 32, clothing: 'coverall' },
      { massKg: 58, heightCm: 163, age: 32, restHr: 62, fit: 1.1, acclimatized: true, clothing: 'coverall', metScale: 0.97, drinkLph: 0.8, kth: 20, sweatSens: 1.05 },
      withBreaks(seg([[lunch[0], lunch[1], 'rest', 'shade']], 'moderate'), breaks([[90, 100, 'shade'], [lunchAt + 90, lunchAt + 100, 'shade']]))),
    mkWorker({ id: 'ravi', name: 'Ravi Singh', role: 'Site supervisor', acclimatized: true, restHr: 78, age: 45, clothing: 'light' },
      { massKg: 84, heightCm: 178, age: 45, restHr: 78, fit: 0.9, acclimatized: true, clothing: 'light', metScale: 1.0, drinkLph: 0.6, kth: 22, sweatSens: 0.95 },
      withBreaks(seg([[lunch[0], lunch[1], 'rest', 'shade']], 'light'), [[60, 75, 'cabin'], [150, 165, 'cabin']]),
      { hrDropouts: [[150, 185]] }),
    mkWorker({ id: 'kiran', name: 'Kiran Das', role: 'Cable crew (new hire)', acclimatized: false, restHr: 68, age: 29, clothing: 'doubleLayer' },
      { massKg: 80, heightCm: 180, age: 29, restHr: 68, fit: 1.05, acclimatized: false, clothing: 'doubleLayer', metScale: 1.0, drinkLph: 0.35, kth: 23, sweatSens: 1.0 },
      withBreaks(cycle(60, 20, 'heavy', 'moderate'), [lunch])),
    mkWorker({ id: 'sana', name: 'Sana Iqbal', role: 'Surveyor (acclimatised)', acclimatized: true, restHr: 65, age: 28, clothing: 'coverall' },
      { massKg: 55, heightCm: 160, age: 28, restHr: 65, fit: 1.0, acclimatized: true, clothing: 'coverall', metScale: 1.0, drinkLph: 0.7, kth: 21, sweatSens: 1.0 },
      withBreaks(cycle(60, 30, 'moderate', 'light'), [lunch, [55, 60, 'shade'], [115, 120, 'shade'], [lunchAt + 55, lunchAt + 60, 'shade'], [lunchAt + 115, lunchAt + 120, 'shade']])),
  ];
  // job titles can be swapped to suit the site (the physiology and schedules stay the same)
  if (roles) crew.forEach((w, i) => { if (roles[i]) w.profile.role = roles[i]; });
  return crew;
}

function thar() {
  const tz = 330;
  const L = { y: 2026, mo: 5, d: 21, h: 10, mi: 0 };
  return {
    id: 'thar',
    title: 'Thar Desert solar farm',
    subtitle: 'Jaisalmer, Rajasthan - 43 C dry heat, then a dust front',
    site: { name: 'Jaisalmer Solar Park', lat: 26.92, lon: 70.9 },
    tzMin: tz,
    startLocalH: L.h,
    startUtcMs: localStartMs(L, tz),
    durationMin: 360,
    hasGas: false,
    env: {
      tMean: 37.5, tAmp: 7.5, tPeakH: 15.5, dewC: 9, wind10: 2.6, kt: 0.97, pm0: 85,
      dust: { t0: 300, t1: 312, t2: 352, dT: 7, dWind: 11, dPm: 1000, dKt: 0.6 },
    },
    narrative: [
      { t: 0, text: 'Shift starts: crew leaves the shaded camp' },
      { t: 180, text: 'Planned lunch break (30 min)' },
      { t: 300, text: 'Dust front approaching from the west' },
    ],
    workers: desertCrew(180),
  };
}

/**
 * Live-data scenario: REAL hourly weather (Open-Meteo) drives the environment, the crew is simulated.
 * `day` comes from live/openmeteo.js; `offsetC` raises air temperature at constant moisture (a stress test).
 */
export function buildLiveScenario(day, offsetC = 0, { crew = 'solar' } = {}) {
  const startH = 8;
  const kind = CREW_KINDS[crew] || CREW_KINDS.solar;
  const [y, mo, d] = day.dateStr.split('-').map(Number);
  const tzMin = day.tzSec / 60;
  const lerp = (arr, hf) => {
    const k = Math.min(arr.length - 2, Math.max(0, Math.floor(hf)));
    const fr = Math.min(1, Math.max(0, hf - k));
    return arr[k] * (1 - fr) + arr[k + 1] * fr;
  };
  return {
    id: 'live',
    title: `Live weather: ${day.name}`,
    subtitle: `Real hourly conditions for ${day.dateStr} (${day.source}) with a simulated crew`,
    site: { name: day.name, lat: day.lat, lon: day.lon },
    tzMin,
    startLocalH: startH,
    startUtcMs: Date.UTC(y, mo - 1, d, startH, 0) - tzMin * 60000,
    durationMin: 540,
    hasGas: false,
    live: { offsetC, day },
    liveEnv: (i) => {
      const hf = startH + i / 60;
      const T0 = lerp(day.temp, hf), RH0 = lerp(day.rh, hf);
      // raise temperature at constant moisture: keep the dew point, recompute RH
      const e = (RH0 / 100) * 6.1121 * Math.exp((17.502 * T0) / (240.97 + T0));
      const lnr = Math.log(e / 6.1121);
      const Td = (240.97 * lnr) / (17.502 - lnr);
      const Ta = T0 + offsetC;
      const es = 6.1121 * Math.exp((17.502 * Ta) / (240.97 + Ta));
      const rh = Math.min(100, Math.max(5, (100 * e) / es));
      return {
        tAirC: Ta, rhPct: rh, pressureHpa: lerp(day.pres, hf), wind10m: Math.max(0.3, lerp(day.wind, hf)),
        solarWm2: Math.max(0, lerp(day.ghi, hf)), pm10: Math.max(5, lerp(day.pm10, hf)), h2sAreaPpm: null, gasProfile: 0,
        zoneEnv: kind.machineryDT != null
          ? { machinery: { tAirC: Ta + kind.machineryDT, rhPct: rhFromDewPointC(Ta + kind.machineryDT, Math.min(Td, Ta + kind.machineryDT - 1)), windMs: 0.4, pressureHpa: lerp(day.pres, hf) } }
          : undefined,
      };
    },
    narrative: [
      { t: 0, text: 'Shift starts 08:00 local' },
      { t: 300, text: 'Planned lunch break (30 min)' },
    ],
    cold: !!kind.cold,
    workers: kind.crew(300),
  };
}

// ------------------------------------------------------------------------------------------
// Crews. Each kind of site has its own people, jobs and routines.
// ------------------------------------------------------------------------------------------
const body = (massKg, heightCm, age, restHr, o = {}) => ({ massKg, heightCm, age, restHr, fit: 1.0, acclimatized: false, clothing: 'coverall', metScale: 1.0, drinkLph: 0.6, kth: 22, sweatSens: 1.0, ...o });
const person = (id, name, role, b, schedule, extra = {}) =>
  mkWorker({ id, name, role, acclimatized: b.acclimatized, restHr: b.restHr, age: b.age, clothing: b.clothing }, b, schedule, extra);

/** Offshore platform crew (humid heat, a hot engine room, sour gas). */
export function offshoreCrew() {
  return [
    mkWorker({ id: 'deepak', name: 'Deepak Nair', role: 'Roustabout, deck crew', acclimatized: true, restHr: 66, age: 38, clothing: 'coverall' },
      { massKg: 78, heightCm: 172, age: 38, restHr: 66, fit: 1.0, acclimatized: true, clothing: 'coverall', metScale: 1.0, drinkLph: 0.7, kth: 21, sweatSens: 1.0 },
      withBreaks(() => ({ activity: 'heavy', zone: 'sun' }), [[90, 100, 'shade'], [180, 195, 'shade'], [260, 270, 'shade']]),
      { gasCoupling: 45 }),
    mkWorker({ id: 'farah', name: 'Farah Khan', role: 'Engine-room mechanic (new)', acclimatized: false, restHr: 70, age: 27, clothing: 'doubleLayer' },
      { massKg: 62, heightCm: 166, age: 27, restHr: 70, fit: 1.0, acclimatized: false, clothing: 'doubleLayer', metScale: 1.0, drinkLph: 0.5, kth: 24, sweatSens: 1.0 },
      (i) => (i >= 30 && i < 220 ? { activity: 'moderate', zone: 'machinery' } : { activity: 'light', zone: 'shade' }),
      { gasCoupling: 4 }),
    mkWorker({ id: 'joseph', name: "Joseph D'Souza", role: 'Crane operator', acclimatized: true, restHr: 76, age: 50, clothing: 'light' },
      { massKg: 88, heightCm: 176, age: 50, restHr: 76, fit: 0.9, acclimatized: true, clothing: 'light', metScale: 1.0, drinkLph: 0.6, kth: 22, sweatSens: 0.95 },
      () => ({ activity: 'light', zone: 'cabin' }),
      { gasCoupling: 6 }),
    mkWorker({ id: 'neha', name: 'Neha Iyer', role: 'HSE officer, deck rounds', acclimatized: false, restHr: 64, age: 34, clothing: 'coverall' },
      { massKg: 60, heightCm: 164, age: 34, restHr: 64, fit: 1.05, acclimatized: false, clothing: 'coverall', metScale: 1.0, drinkLph: 0.7, kth: 21, sweatSens: 1.0 },
      (i) => ({ activity: i % 40 < 25 ? 'moderate' : 'light', zone: i % 40 < 25 ? 'sun' : 'shade' }),
      { gasCoupling: 15 }),
  ];
}

/** Underground coal mine crew: no sun, hot and humid air, dust; the refuge chamber is the cool zone. */
export function mineCrew(lunchAt = 180) {
  const ug = (act) => () => ({ activity: act, zone: 'shade' });
  const lunch = [lunchAt, lunchAt + 30, 'cabin'];
  return [
    person('thabo', 'Thabo Mokoena', 'Roof bolter (new hire)', body(78, 175, 23, 70, { clothing: 'doubleLayer', drinkLph: 0.3, kth: 24 }),
      withBreaks(ug('heavy'), [lunch])),
    person('lerato', 'Lerato Dlamini', 'Electrician (acclimatised)', body(62, 165, 34, 62, { acclimatized: true, fit: 1.1, drinkLph: 0.8, kth: 20 }),
      withBreaks(ug('moderate'), [lunch, [80, 90, 'cabin'], [lunchAt + 90, lunchAt + 100, 'cabin']])),
    person('pieter', 'Pieter van Wyk', 'Shift boss', body(88, 180, 49, 76, { acclimatized: true, fit: 0.9, clothing: 'light', drinkLph: 0.6, kth: 22 }),
      withBreaks(ug('light'), [lunch, [60, 75, 'cabin'], [150, 165, 'cabin'], [260, 275, 'cabin']]), { hrDropouts: [[120, 150]] }),
    person('sipho', 'Sipho Ndlovu', 'Continuous-miner operator (new hire)', body(82, 178, 28, 68, { clothing: 'doubleLayer', fit: 1.05, drinkLph: 0.35, kth: 23 }),
      withBreaks((i) => ({ activity: i % 60 < 40 ? 'heavy' : 'moderate', zone: 'shade' }), [lunch])),
    person('nomsa', 'Nomsa Khumalo', 'Ventilation technician (acclimatised)', body(57, 160, 30, 65, { acclimatized: true, drinkLph: 0.7, kth: 21 }),
      withBreaks((i) => ({ activity: i % 60 < 30 ? 'moderate' : 'light', zone: 'shade' }), [lunch, [55, 60, 'cabin'], [115, 120, 'cabin'], [lunchAt + 55, lunchAt + 60, 'cabin']])),
  ];
}

/** Arctic plant crew: outdoor work in arctic parkas with warm-up breaks in a heated cabin. */
export function arcticCrew() {
  const rota = (period, outMin, act) => (i) => (i % period < outMin ? { activity: act, zone: 'sun' } : { activity: 'rest', zone: 'cabin' });
  return [
    person('dmitri', 'Dmitri Volkov', 'Rigger (new hire)', body(84, 182, 26, 70, { clothing: 'arctic', kth: 24, drinkLph: 0.3 }), rota(50, 42, 'heavy')),
    person('irina', 'Irina Sokolova', 'Welder (acclimatised)', body(60, 167, 36, 64, { clothing: 'arctic', acclimatized: true, kth: 20, drinkLph: 0.6 }), rota(40, 22, 'moderate')),
    person('pavel', 'Pavel Orlov', 'Site foreman', body(90, 180, 48, 76, { clothing: 'arctic', acclimatized: true, fit: 0.9 }), rota(40, 18, 'light')),
    person('anya', 'Anya Petrova', 'Crane operator', body(58, 164, 31, 66, { clothing: 'arctic', acclimatized: true }), rota(60, 10, 'light')),
    person('maxim', 'Maxim Kozlov', 'Pipe fitter (new hire)', body(80, 177, 24, 69, { clothing: 'arctic', kth: 24, drinkLph: 0.3 }), rota(60, 54, 'heavy')),
  ];
}

const CREW_KINDS = {
  solar: { crew: desertCrew },
  offshore: { crew: offshoreCrew, machineryDT: 6 },
  mine: { crew: mineCrew },
  arctic: { crew: arcticCrew, cold: true },
};

function offshore() {
  const tz = 330;
  const L = { y: 2026, mo: 5, d: 12, h: 11, mi: 0 };
  const scn = {
    id: 'offshore',
    title: 'Offshore platform',
    subtitle: 'Arabian Sea - humid 34 C, hot engine room and a sour-gas leak',
    site: { name: 'Platform B, Mumbai High', lat: 19.46, lon: 71.33 },
    tzMin: tz,
    startLocalH: L.h,
    startUtcMs: localStartMs(L, tz),
    durationMin: 300,
    hasGas: true,
    env: {
      tMean: 31.0, tAmp: 1.5, tPeakH: 14.5, dewC: 25.0, wind10: 6.5, kt: 0.72, pm0: 40, pressure: 1006,
      machinery: { dT: 6 },
      gas: { t0: 140, rise: 4, hold: 3, decay: 5, areaBase: 0.2, areaPeak: 7.5 },
    },
    narrative: [
      { t: 0, text: 'Shift handover on the platform' },
      { t: 30, text: 'Mechanic enters the engine room for pump overhaul' },
      { t: 140, text: 'Seal failure near wellhead B: H2S release' },
    ],
    workers: offshoreCrew(),
  };
  return scn;
}

function mine() {
  const tz = 120;
  const L = { y: 2026, mo: 8, d: 18, h: 7, mi: 0 };
  return {
    id: 'mine',
    title: 'Underground coal mine',
    subtitle: 'Mpumalanga - 31 C and humid at the face, a dust surge after blasting and a ventilation failure',
    site: { name: 'Witbank Coal Mine', lat: -25.87, lon: 29.23 },
    tzMin: tz,
    startLocalH: L.h,
    startUtcMs: localStartMs(L, tz),
    durationMin: 360,
    hasGas: false,
    underground: true,
    restZone: 'cabin',
    zoneLabels: { shade: 'At the coal face', cabin: 'Refuge chamber', sun: 'Surface' },
    env: {
      tMean: 30.5, tAmp: 0.4, tPeakH: 14, dewC: 25.0, wind10: 1.5, kt: 0.05, pm0: 260, pressure: 1060, underground: true,
      dust: { t0: 190, t1: 194, t2: 235, dT: 0, dWind: 1.2, dPm: 1800, dKt: 0 },
      vent: { t0: 235, t1: 242, t2: 285, t3: 305, dT: 3.2, dWind: 0.8, dDew: 1.4 },
    },
    narrative: [
      { t: 0, text: 'Shift descends into the mine' },
      { t: 180, text: 'Planned meal break in the refuge chamber' },
      { t: 190, text: 'Blast at the face: dust surge' },
      { t: 235, text: 'Main fan trips: ventilation failure' },
    ],
    workers: mineCrew(180),
  };
}

function arctic() {
  const tz = 420;
  const L = { y: 2026, mo: 1, d: 21, h: 8, mi: 0 };
  return {
    id: 'arctic',
    title: 'Arctic plant',
    subtitle: 'Norilsk - minus 20 C in the polar night, then a blizzard front',
    site: { name: 'Norilsk Arctic Plant', lat: 69.35, lon: 88.2 },
    tzMin: tz,
    startLocalH: L.h,
    startUtcMs: localStartMs(L, tz),
    durationMin: 360,
    hasGas: false,
    cold: true,
    zoneLabels: { sun: 'Outdoors', shade: 'Outdoors', cabin: 'Heated cabin' },
    env: {
      tMean: -20, tAmp: 2.5, tPeakH: 14, dewC: -25, wind10: 4.2, kt: 0.1, pm0: 12, pressure: 1012,
      dust: { t0: 200, t1: 210, t2: 270, dT: 10, dWind: 8.5, dPm: 0, dKt: 0 },
    },
    narrative: [
      { t: 0, text: 'Shift starts in the polar night' },
      { t: 200, text: 'Blizzard front approaching from the north' },
    ],
    workers: arcticCrew(),
  };
}

export const SCENARIO_LIST = [
  { id: 'thar', build: thar },
  { id: 'offshore', build: offshore },
  { id: 'mine', build: mine },
  { id: 'arctic', build: arctic },
];

export function buildScenario(id) {
  const entry = SCENARIO_LIST.find((s) => s.id === id);
  if (!entry) throw new Error(`Unknown scenario ${id}`);
  return entry.build();
}

/** Run a scenario end to end through the engine. Returns every frame (for playback / scrubbing). */
export async function runScenario(scn, { seed = 1, followAdvice = false, monitor = {} } = {}) {
  const { Monitor } = await import('../engine/pipeline.js');
  return runScenarioSync(scn, Monitor, { seed, followAdvice, monitor });
}

export function runScenarioSync(scn, Monitor, { seed = 1, followAdvice = false, monitor = {} } = {}) {
  const sim = new Simulator(scn, seed, { followAdvice });
  const mon = new Monitor(scn.site, scn.workers.map((w) => w.profile), monitor);
  const frames = [];
  let prev = {};
  for (let i = 0; i < scn.durationMin; i++) {
    const fr = mon.step(sim.sample(i, prev));
    prev = {};
    for (const [id, w] of Object.entries(fr.workers)) prev[id] = { level: w.level, gasLevel: w.gas.level, hazard: w.hazard };
    frames.push(fr);
  }
  return { scn, seed, followAdvice, frames };
}
