import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HampelFilter, HrChannelQC, EnvChannelQC } from '../site/src/engine/qc.js';
import { Cusum } from '../site/src/engine/cusum.js';
import { Rng } from '../site/src/sim/rng.js';
import {
  CoreTempEstimator, BullerKalman, hrFromTc, dHrdTc, HR_OBS,
} from '../site/src/engine/estimator.js';
import { AlertPolicy } from '../site/src/engine/alerts.js';
import { workRestPlan } from '../site/src/engine/limits.js';

test('Buller observation model matches the published coefficients', () => {
  assert.equal(HR_OBS.b2, -4.5714);
  assert.equal(HR_OBS.b1, 384.4286);
  assert.equal(HR_OBS.b0, -7887.1);
  const hr37 = hrFromTc(37), hr385 = hrFromTc(38.5), hr39 = hrFromTc(39);
  assert.ok(hr37 > 70 && hr37 < 90, `HR at 37C ${hr37}`);
  assert.ok(hr385 > 130 && hr385 < 150);
  assert.ok(hr39 > hr385, 'monotonic in the physiological range');
  assert.ok(dHrdTc(38) > 30 && dHrdTc(38) < 45);
});

test('Hampel: isolated spike is removed, genuine level shift passes within two samples', () => {
  const f = new HampelFilter();
  for (let i = 0; i < 8; i++) f.push(90 + (i % 3));
  const spike = f.push(150);
  assert.equal(spike.flagged, true);
  assert.ok(spike.value < 100, 'replaced by the median');
  // level shift 90 -> 140: first sample(s) flagged, but it must lock on, not stay stuck at 90
  const g = new HampelFilter();
  for (let i = 0; i < 8; i++) g.push(90);
  let last;
  for (let i = 0; i < 6; i++) last = g.push(140 + (i % 2));
  assert.ok(last.value > 135, `stuck at stale median: ${last.value}`);
});

test('HR channel QC: dropouts, range, flat-line and quality score', () => {
  const qc = new HrChannelQC();
  for (let i = 0; i < 5; i++) qc.process(100 + i);
  assert.ok(qc.process(null).flags.includes('dropout'));
  assert.ok(qc.process(400).flags.includes('out-of-range'));
  const flat = new HrChannelQC();
  let r;
  for (let i = 0; i < 12; i++) r = flat.process(88);
  assert.ok(r.flags.includes('flatline'), 'stuck sensor must be flagged');
  const bad = new HrChannelQC();
  for (let i = 0; i < 15; i++) r = bad.process(null);
  assert.equal(r.quality, 0);
  assert.equal(r.minutesSinceGood, 15);
});

test('env QC holds the last good value through a gap', () => {
  const qc = new EnvChannelQC();
  qc.process({ tAirC: 40, rhPct: 20 });
  const r = qc.process({ tAirC: null, rhPct: 250 });
  assert.equal(r.env.tAirC, 40);
  assert.equal(r.env.rhPct, 20);
  assert.ok(r.flags.length >= 2);
});

test('CUSUM: detects a step change, stays quiet on stationary noise', () => {
  const rng = new Rng(7);
  const quiet = new Cusum({ sigmaMin: 0.3, h: 6 });
  let alarms = 0;
  for (let i = 0; i < 600; i++) if (quiet.push(30 + rng.normal(0, 0.3)).started) alarms++;
  assert.ok(alarms <= 1, `false alarms ${alarms}`);

  const c = new Cusum({ sigmaMin: 0.3, h: 6 });
  let detectedAt = null;
  for (let i = 0; i < 200; i++) {
    const x = (i < 100 ? 30 : 33) + rng.normal(0, 0.3);
    if (c.push(x).started && detectedAt == null) detectedAt = i;
  }
  assert.ok(detectedAt != null && detectedAt >= 100 && detectedAt < 110, `detected at ${detectedAt}`);

  // a realistic diurnal heating ramp (~0.25 C/h) is tracked by the adaptive baseline: with a
  // materiality gate (as used in the pipeline) it never raises an event
  let slowAlarms = 0;
  for (const seed of [1, 2, 3, 7, 11]) {
    const r2 = new Rng(seed);
    const slow = new Cusum({ sigmaMin: 0.3, h: 6, minShift: 1.0 });
    for (let i = 0; i < 360; i++) if (slow.push(30 + 0.004 * i + r2.normal(0, 0.3)).started) slowAlarms++;
  }
  assert.equal(slowAlarms, 0, 'a slow drift is tracked, not alarmed');

  // and the detector can never get stuck: after a persistent step it re-baselines, then catches the next one
  const d = new Cusum({ sigmaMin: 0.3, h: 6, minShift: 1.0, maxActive: 40 });
  const starts = [];
  for (let i = 0; i < 400; i++) {
    const level = i < 100 ? 30 : i < 250 ? 34 : 38;
    if (d.push(level + rng.normal(0, 0.3)).started) starts.push(i);
  }
  assert.equal(starts.length, 2, `expected two detections, got ${starts}`);
});

test('estimator: converges to the HR-implied temperature and learns when HR is informative', () => {
  const est = new CoreTempEstimator({ acclimatized: false });
  // neutral prior (WBGT exactly at the limit) + steady HR that implies 38.0 C at moderate work
  const hr = hrFromTc(38.0);
  let r;
  for (let i = 0; i < 150; i++) r = est.step({ M: 300, wbgtEff: 25, hr });
  assert.ok(Math.abs(r.tc - 38.0) < 0.25, `converged to ${r.tc}`);
  assert.ok(r.sd < 0.3);
});

test('estimator: without heart rate it keeps predicting and uncertainty grows', () => {
  const est = new CoreTempEstimator({ acclimatized: false });
  for (let i = 0; i < 30; i++) est.step({ M: 300, wbgtEff: 25, hr: hrFromTc(37.4) });
  const sdBefore = Math.sqrt(est.P[0][0]);
  let r;
  for (let i = 0; i < 40; i++) r = est.step({ M: 300, wbgtEff: 30, hr: null });
  assert.ok(r.sd > sdBefore, 'uncertainty must grow while blind');
  assert.ok(r.tc > 37.4, 'environment model keeps the estimate moving when WBGT exceeds the limit');
  assert.ok(est.minutesWithoutHr >= 40);
});

test('estimator: forecast is monotone toward equilibrium and time-to-threshold is consistent', () => {
  const est = new CoreTempEstimator({ acclimatized: false });
  for (let i = 0; i < 10; i++) est.step({ M: 415, wbgtEff: 32, hr: hrFromTc(37.3) });
  const fc = est.forecast(90, { M: 415, wbgtEff: 32 });
  for (let i = 1; i < fc.tc.length; i++) assert.ok(fc.tc[i] >= fc.tc[i - 1] - 1e-9, 'rising toward a hotter equilibrium');
  const t385 = fc.ttt(38.5);
  assert.ok(t385 != null && t385 > 0);
  const idx = Math.round(t385);
  assert.ok(Math.abs(fc.tc[idx] - 38.5) < 0.1, 'forecast actually crosses at the reported time');
  assert.ok(fc.ttt(38.5, 1) <= t385, 'earliest plausible crossing is never later than the expected one');
  assert.equal(fc.ttt(10), 0, 'already above a low threshold');
  const cool = new CoreTempEstimator({ acclimatized: true });
  assert.equal(cool.forecast(60, { M: 115, wbgtEff: 20 }).ttt(38.5), null, 'no crossing at rest in cool air');
});

test('estimator: fusion beats HR-only on a biased heart-rate stream with a good environment prior', () => {
  // truth: Tc ramps 37.1 -> 38.6 over 60 min. HR is biased low by 15 bpm (e.g. a fit, acclimatised worker).
  const fusion = new CoreTempEstimator({ acclimatized: false });
  const buller = new BullerKalman();
  const rng = new Rng(3);
  let eF = 0, eB = 0, n = 0;
  for (let i = 0; i < 60; i++) {
    const tc = 37.1 + (1.5 * i) / 60;
    const hr = hrFromTc(tc) - 15 + rng.normal(0, 4);
    const a = fusion.step({ M: 300, wbgtEff: 31, hr });
    const b = buller.step(hr);
    if (i >= 15) { eF += (a.tc - tc) ** 2; eB += (b.tc - tc) ** 2; n++; }
  }
  assert.ok(Math.sqrt(eF / n) < Math.sqrt(eB / n), `fusion ${Math.sqrt(eF / n)} vs hr-only ${Math.sqrt(eB / n)}`);
});

const base = (o = {}) => ({
  t: 0, tcEst: 37.2, tcSd: 0.15, ttt385: null, ttt385early: null, ttt39: null, ttt39early: null, psi: 1,
  wbgtEff: 24, limit: 28, plan: workRestPlan(24, 300, true), M: 300, activityLabel: 'Moderate',
  hr: 100, hrRest: 65, minutesWithoutHr: 0, slopePerHour: 0.2,
  gas: { level: 0, reasons: [] }, pm: { level: 0, label: '' }, pm10: 50, ...o,
});

test('alert policy: persistence, DANGER speed, sticky de-escalation', () => {
  const p = new AlertPolicy();
  assert.equal(p.step(base()).level, 0);
  // one noisy sample must not trigger a WARNING
  assert.equal(p.step(base({ t: 1, ttt385: 10, ttt385early: 8 })).level, 0);
  p.step(base({ t: 2 })); // back to normal resets the counter
  // WARNING needs 3 consecutive risky samples
  let r;
  for (let t = 3; t < 6; t++) r = p.step(base({ t, ttt385: 12, ttt385early: 9 }));
  assert.equal(r.level, 2);
  assert.ok(r.change && r.change.to === 2 && r.reasons.length > 0 && r.actions.length > 0);
  // DANGER escalates after two samples
  p.step(base({ t: 6, tcEst: 39.1 }));
  r = p.step(base({ t: 7, tcEst: 39.1 }));
  assert.equal(r.level, 3);
  // de-escalation: one level at a time, only after sustained improvement
  for (let t = 8; t < 8 + 11; t++) assert.equal(p.step(base({ t })).level, 3, 'still sticky');
  r = p.step(base({ t: 19 }));
  assert.equal(r.level, 2, 'steps down exactly one level');
});

test('alert policy: acute gas alarms immediately; sensor loss never fails silent', () => {
  const p = new AlertPolicy();
  const r = p.step(base({ gas: { level: 3, reasons: ['H2S 31 ppm exceeds the 20 ppm OSHA ceiling'] } }));
  assert.equal(r.level, 3);
  assert.equal(r.hazard, 'gas');
  const q = new AlertPolicy();
  let s;
  for (let t = 0; t < 6; t++) s = q.step(base({ t, minutesWithoutHr: 12, wbgtEff: 29, limit: 28 }));
  assert.ok(s.level >= 1, 'blind in the heat -> at least WATCH');
  assert.ok(s.reasons.some((x) => /GEOS-Strap.*signal lost/i.test(x)));
});

test('alert policy: uncertain estimates use the earliest plausible crossing time', () => {
  const p = new AlertPolicy();
  let r;
  for (let t = 0; t < 4; t++) r = p.step(base({ t, tcSd: 0.6, ttt385: 40, ttt385early: 15 }));
  assert.equal(r.level, 2, 'low confidence -> be conservative');
  const q = new AlertPolicy();
  for (let t = 0; t < 4; t++) r = q.step(base({ t, tcSd: 0.15, ttt385: 40, ttt385early: 15 }));
  assert.ok(r.level < 2, 'high confidence -> do not over-react');
});
