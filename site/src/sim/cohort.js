// Randomised cohort + evaluation harness.
//
// Generates many independent worker-shifts (random weather, site, physiology, clothing, workload,
// break pattern), runs each through the engine with the hidden truth withheld, and scores the
// warnings against the truth. Used by `npm run bench` and by the in-app "Benchmark" panel.
//
// IMPORTANT: this is a *synthetic* benchmark. The simulator is a stand-in for reality built from
// published physiology, not a clinical dataset. It tests whether the algorithm's logic holds up
// under noise, model mismatch, sensor faults and varied conditions - it is not a validation.

import { Rng } from './rng.js';
import { Simulator } from './scenarios.js';
import { Monitor } from '../engine/pipeline.js';

const SITES = [
  { name: 'Thar Desert', lat: 26.9, lon: 70.9, tz: 330, mo: 5, d: 20 },
  { name: 'Rub al Khali', lat: 22.5, lon: 53.9, tz: 240, mo: 7, d: 10 },
  { name: 'Offshore Arabian Sea', lat: 19.5, lon: 71.3, tz: 330, mo: 5, d: 12 },
  { name: 'Persian Gulf coast', lat: 27.0, lon: 49.6, tz: 180, mo: 8, d: 2 },
  { name: 'Death Valley', lat: 36.5, lon: -116.9, tz: -420, mo: 7, d: 15 },
  { name: 'Pilbara, Australia', lat: -22.6, lon: 117.2, tz: 480, mo: 1, d: 14 },
  { name: 'Sahel', lat: 14.5, lon: 2.0, tz: 60, mo: 4, d: 18 },
];

export function randomCase(seed) {
  const r = new Rng(seed * 7 + 1);
  const S = r.pick(SITES);
  const tMax = r.uniform(28, 45);
  const tMin = tMax - r.uniform(7, 15);
  const humid = r.chance(0.4);
  const dewC = humid ? Math.min(tMax - 6, r.uniform(18, 27)) : r.uniform(-2, 12);
  const startH = r.pick([8, 9, 10]);
  const acclimatized = r.chance(0.5);
  const age = Math.round(r.uniform(20, 58));
  const clothing = r.pick(['light', 'coverall', 'coverall', 'doubleLayer']);
  const base = r.pick(['light', 'moderate', 'moderate', 'heavy', 'heavy']);
  const breakEvery = r.int(45, 120), breakLen = r.int(5, 20), lunch = r.chance(0.6);
  const rampUp = r.int(10, 30);
  const person = {
    massKg: r.uniform(52, 98), heightCm: r.uniform(155, 190), age, restHr: Math.round(r.uniform(52, 86)),
    fit: r.uniform(0.85, 1.2), acclimatized, clothing, metScale: r.uniform(0.85, 1.05),
    drinkLph: r.uniform(0.3, 1.0), kth: r.uniform(16, 28), sweatSens: r.uniform(0.8, 1.2),
  };
  const schedule = (i) => {
    if (i < rampUp) return { activity: 'light', zone: 'sun' };
    if (lunch && i >= 180 && i < 210) return { activity: 'rest', zone: 'shade' };
    if ((i - rampUp) % breakEvery >= breakEvery - breakLen) return { activity: 'rest', zone: 'shade' };
    return { activity: base, zone: 'sun' };
  };
  const startLocal = { y: 2026, mo: S.mo, d: S.d, h: startH, mi: 0 };
  return {
    id: `rand-${seed}`,
    title: `Random case ${seed}`,
    site: { name: S.name, lat: S.lat, lon: S.lon },
    tzMin: S.tz,
    startLocalH: startH,
    startUtcMs: Date.UTC(2026, S.mo - 1, S.d, startH, 0) - S.tz * 60000,
    durationMin: 360,
    hasGas: false,
    env: {
      tMean: (tMax + tMin) / 2, tAmp: (tMax - tMin) / 2, tPeakH: 15.5, dewC,
      wind10: r.uniform(1.0, 8.0), kt: r.uniform(0.55, 0.98), pm0: 60,
    },
    workers: [{
      profile: { id: 'w', name: 'Worker', acclimatized, restHr: person.restHr, age, clothing },
      person, schedule,
    }],
    _meta: { base, acclimatized, clothing, tMax, dewC, humid },
  };
}

/** Run one random case open-loop and return a compact result. */
export function evaluateCase(seed, monitorOpts = {}, { followAdvice = false } = {}) {
  const scn = randomCase(seed);
  const sim = new Simulator(scn, seed, { followAdvice });
  const mon = new Monitor(scn.site, scn.workers.map((w) => w.profile), monitorOpts);
  let prev = {};
  let peak = 0, minAbove385 = 0, minAbove39 = 0;
  let tUnsafe = null, tSevere = null;
  let sq = 0, sqHr = 0, sqPrior = 0, n = 0, bias = 0;
  let alerts = 0, lastLevel = 0, minutesWarn = 0;
  let last;
  for (let i = 0; i < scn.durationMin; i++) {
    const fr = mon.step(sim.sample(i, prev));
    const w = fr.workers.w;
    prev = { w: { level: w.level, gasLevel: 0 } };
    const tc = w.truth.tc;
    peak = Math.max(peak, tc);
    if (tc >= 38.5) { minAbove385++; if (tUnsafe == null) tUnsafe = i; }
    if (tc >= 39.0) { minAbove39++; if (tSevere == null) tSevere = i; }
    sq += (w.tc - tc) ** 2; sqHr += (w.tcHrOnly - tc) ** 2; sqPrior += (w.tcPrior - tc) ** 2; bias += w.tc - tc; n++;
    if (w.level >= 2 && lastLevel < 2 && w.hazard === 'heat') alerts++;
    lastLevel = w.level;
    if (w.level >= 2) minutesWarn++;
    last = w;
  }
  const first = last.first;
  // first alarm of each method vs the first true crossing of 38.5 C
  return {
    seed, meta: scn._meta, peak, minAbove385, minAbove39, tUnsafe, tSevere,
    rmse: Math.sqrt(sq / n), rmseHr: Math.sqrt(sqHr / n), rmsePrior: Math.sqrt(sqPrior / n), bias: bias / n,
    first, alerts, minutesWarn, shiftMin: scn.durationMin,
  };
}

const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (a, q) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

/** Aggregate the per-case results into the headline metrics. */
export function summarise(results) {
  const methods = {
    geos: 'GEOS (fusion + forecast)',
    buller: 'HR-only Kalman (same 38.2 C trigger)',
    hr: 'HR >= 85% max for 5 min',
    staticWbgt: 'Static WBGT >= 28 C',
  };
  // unsafe: true core temp reached 38.5 C.  clearly safe: never above 38.0 C (the NIOSH design limit).
  // Cases between the two are near-misses: warning them is reasonable, so they are excluded from
  // the false-alarm rate rather than counted against (or for) the system.
  const unsafe = results.filter((r) => r.tUnsafe != null);
  const safe = results.filter((r) => r.peak < 38.0);
  const out = { n: results.length, nUnsafe: unsafe.length, nSafe: safe.length, nNearMiss: results.length - unsafe.length - safe.length, methods: {} };
  for (const [k, label] of Object.entries(methods)) {
    const leads = [];
    let detected10 = 0, detected0 = 0;
    for (const r of unsafe) {
      const t = r.first[k];
      if (t != null && t <= r.tUnsafe) {
        const lead = r.tUnsafe - t;
        leads.push(lead);
        detected0++;
        if (lead >= 10) detected10++;
      }
    }
    const falseAlarms = safe.filter((r) => r.first[k] != null).length;
    out.methods[k] = {
      label,
      sensitivity: unsafe.length ? detected0 / unsafe.length : null,
      sensitivity10: unsafe.length ? detected10 / unsafe.length : null,
      medianLead: median(leads), p25Lead: pct(leads, 0.25),
      leads,
      falseAlarmRate: safe.length ? falseAlarms / safe.length : null,
      falseAlarmCount: falseAlarms,
    };
  }
  out.rmse = { fusion: Math.sqrt(results.reduce((a, r) => a + r.rmse ** 2, 0) / results.length), hrOnly: Math.sqrt(results.reduce((a, r) => a + r.rmseHr ** 2, 0) / results.length), prior: Math.sqrt(results.reduce((a, r) => a + r.rmsePrior ** 2, 0) / results.length) };
  out.alertsPerWorkerHour = results.reduce((a, r) => a + r.alerts, 0) / (results.length * 6);
  return out;
}

export function runBenchmark({ n = 200, seedStart = 1000, monitorOpts = {} } = {}) {
  const res = [];
  for (let k = 0; k < n; k++) res.push(evaluateCase(seedStart + k, monitorOpts));
  return { results: res, summary: summarise(res) };
}

/** Same cases, with and without workers following the advice. */
export function runClosedLoopComparison({ n = 120, seedStart = 1000, monitorOpts = {} } = {}) {
  let open = { exceed385: 0, exceed39: 0, minutes385: 0, peakSum: 0, n: 0 };
  let closed = { exceed385: 0, exceed39: 0, minutes385: 0, peakSum: 0, n: 0 };
  for (let k = 0; k < n; k++) {
    const a = evaluateCase(seedStart + k, monitorOpts, { followAdvice: false });
    const b = evaluateCase(seedStart + k, monitorOpts, { followAdvice: true });
    for (const [acc, r] of [[open, a], [closed, b]]) {
      acc.n++; acc.peakSum += r.peak; acc.minutes385 += r.minAbove385;
      if (r.tUnsafe != null) acc.exceed385++;
      if (r.tSevere != null) acc.exceed39++;
    }
  }
  return { open, closed };
}

