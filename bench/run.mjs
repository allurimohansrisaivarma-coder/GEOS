// Synthetic benchmark: GEOS vs conventional alarms on randomised worker-shifts.
//   node bench/run.mjs                 evaluate on the held-out seeds (1000+) and write bench/results.json
//   node bench/run.mjs --n 300         a different number of cases (default 600, matches the README)
//   node bench/run.mjs --tune          coordinate-descent calibration on the *calibration* seeds (1..120)
//
// Calibration seeds and evaluation seeds never overlap.

import { writeFileSync, mkdirSync } from 'node:fs';
import { runBenchmark, runClosedLoopComparison, evaluateCase, summarise } from '../site/src/sim/cohort.js';
import { DEFAULT_PARAMS } from '../site/src/engine/estimator.js';
import { DEFAULT_POLICY } from '../site/src/engine/alerts.js';

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const val = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? Number(args[i + 1]) : d; };

const fmt = (x, d = 1) => (x == null ? 'n/a' : x.toFixed(d));
const pc = (x) => (x == null ? 'n/a' : (100 * x).toFixed(0) + '%');

function printSummary(s) {
  console.log(`cases: ${s.n}  (unsafe >= 38.5 C: ${s.nUnsafe} | near-miss 38.0-38.5 C: ${s.nNearMiss} | clearly safe < 38.0 C: ${s.nSafe})`);
  console.log('method'.padEnd(42), 'detected'.padStart(9), '>=10 min early'.padStart(15), 'median lead'.padStart(12), 'false-alarm rate'.padStart(17));
  for (const m of Object.values(s.methods)) {
    console.log(m.label.padEnd(42), pc(m.sensitivity).padStart(9), pc(m.sensitivity10).padStart(15), (m.medianLead == null ? 'n/a' : fmt(m.medianLead, 0) + ' min').padStart(12), `${pc(m.falseAlarmRate)} (${m.falseAlarmCount}/${s.nSafe})`.padStart(17));
  }
  console.log(`Core-temp RMSE vs truth: fusion ${fmt(s.rmse.fusion, 2)} C | HR-only Kalman ${fmt(s.rmse.hrOnly, 2)} C | environment-only prior ${fmt(s.rmse.prior, 2)} C`);
  console.log(`GEOS WARNING episodes: ${fmt(s.alertsPerWorkerHour, 2)} per worker-hour`);
}

// Candidate = estimator params + the alert thresholds we tune alongside them.
function toOpts(c) {
  return {
    estimator: { tau: c.tau, tcAtLimit: c.tcAtLimit, eqCap: c.eqCap, gUp: c.gUp, gLo: c.gLo, qTc: c.qTc, rSigma: c.rSigma, actK: c.actK, acclHrBoost: c.acclHrBoost, rhrK: c.rhrK, rhrRef: c.rhrRef, tauBias: c.tauBias, qBias: c.qBias },
    policy: {
      nUp: [0, 3, c.nUp2, 2],
      heat: {
        danger: DEFAULT_POLICY.heat.danger,
        warning: { tc: c.warnTc, ttt385: c.warnTtt, psi: 6.5 },
        watch: DEFAULT_POLICY.heat.watch,
      },
    },
  };
}

function score(c, seeds) {
  const res = [];
  const opts = toOpts(c);
  for (const sd of seeds) res.push(evaluateCase(sd, opts));
  const s = summarise(res);
  const m = s.methods.geos;
  // objective: accurate, early, quiet - false alarms are weighted heavily on purpose.
  const loss = 2.0 * s.rmse.fusion + 1.5 * (1 - (m.sensitivity10 ?? 0)) + 3.0 * (m.falseAlarmRate ?? 0) + 0.02 * Math.max(0, 20 - (m.medianLead ?? 0));
  return { loss, s };
}

if (flag('tune')) {
  const seeds = Array.from({ length: val('cal', 300) }, (_, i) => 1 + i);
  let best = { ...DEFAULT_PARAMS, warnTc: DEFAULT_POLICY.heat.warning.tc, warnTtt: DEFAULT_POLICY.heat.warning.ttt385, nUp2: DEFAULT_POLICY.nUp[2] };
  const grid = {
    tau: [30, 45, 60, 90],
    tcAtLimit: [37.3, 37.5, 37.7],
    eqCap: [1.5, 2.3, 3.0],
    gUp: [0.2, 0.3, 0.4],
    gLo: [0.06, 0.1, 0.14],
    qTc: [0.015, 0.025, 0.04],
    rSigma: [14, 18.88, 24],
    actK: [0.04, 0.08, 0.12],
    acclHrBoost: [0, 6, 12],
    rhrK: [0.6, 0.8, 1.0, 1.2],
    rhrRef: [65, 69, 73],
    tauBias: [60, 120, 240],
    qBias: [0.0004, 0.0007, 0.0012],
    warnTc: [38.2, 38.3, 38.4],
    warnTtt: [12, 20, 30],
    nUp2: [2, 3, 5],
  };
  let cur = score(best, seeds);
  console.log('start loss', cur.loss.toFixed(3));
  for (let pass = 0; pass < 3; pass++) {
    for (const [k, options] of Object.entries(grid)) {
      for (const v of options) {
        if (best[k] === v) continue;
        const cand = { ...best, [k]: v };
        const r = score(cand, seeds);
        if (r.loss < cur.loss - 1e-4) { best = cand; cur = r; console.log(`pass ${pass} ${k}=${v} -> loss ${r.loss.toFixed(3)}  rmse ${r.s.rmse.fusion.toFixed(2)}  sens10 ${pc(r.s.methods.geos.sensitivity10)}  FA ${pc(r.s.methods.geos.falseAlarmRate)}  lead ${fmt(r.s.methods.geos.medianLead, 0)}`); }
      }
    }
  }
  const out = {};
  for (const k of Object.keys(grid)) out[k] = best[k];
  console.log('\nBEST PARAMS:', JSON.stringify(out));
  printSummary(cur.s);
} else {
  const n = val('n', 600);
  const t0 = performance.now();
  const { results, summary } = runBenchmark({ n, seedStart: 1000 });
  console.log(`held-out evaluation (seeds 1000..${999 + n}) in ${((performance.now() - t0) / 1000).toFixed(1)} s\n`);
  printSummary(summary);
  let closed = null;
  if (!flag('no-closed')) {
    const cl = runClosedLoopComparison({ n: Math.min(n, 150), seedStart: 1000 });
    closed = cl;
    const f = (a) => `${a.exceed385}/${a.n} workers >= 38.5 C, ${a.exceed39}/${a.n} >= 39.0 C, mean minutes above 38.5 C ${(a.minutes385 / a.n).toFixed(1)}`;
    console.log('\nClosed loop (same shifts): advice ignored  ->', f(cl.open));
    console.log('Closed loop (same shifts): advice followed ->', f(cl.closed));
  }
  const payload = {
    generated: new Date().toISOString(), n, seeds: `${1000}..${999 + n}`, calibrationSeeds: '1..300',
    params: DEFAULT_PARAMS, policy: DEFAULT_POLICY, summary, closedLoop: closed,
    closedLoopN: Math.min(n, 150),
  };
  writeFileSync(new URL('./results.json', import.meta.url), JSON.stringify(payload, null, 2));
  mkdirSync(new URL('../site/data/', import.meta.url), { recursive: true });
  writeFileSync(new URL('../site/data/benchmark.json', import.meta.url), JSON.stringify(payload));
  console.log('\nwrote bench/results.json and site/data/benchmark.json');
}

