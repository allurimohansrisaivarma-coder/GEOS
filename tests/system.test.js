import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScenario, runScenarioSync, SCENARIO_LIST } from '../site/src/sim/scenarios.js';
import { Monitor } from '../site/src/engine/pipeline.js';
import { evaluateCase, summarise } from '../site/src/sim/cohort.js';

const run = (id, opts) => runScenarioSync(buildScenario(id), Monitor, opts);
const peakTrue = (r, id) => Math.max(...r.frames.map((f) => f.workers[id].truth.tc));
const firstTrue = (r, id, thr) => r.frames.find((f) => f.workers[id].truth.tc >= thr)?.t ?? null;

test('every scenario runs end-to-end with finite outputs', () => {
  for (const s of SCENARIO_LIST) {
    const scn = buildScenario(s.id);
    const r = runScenarioSync(scn, Monitor, { seed: 1 });
    assert.equal(r.frames.length, scn.durationMin);
    for (const fr of r.frames) {
      assert.ok(Number.isFinite(fr.site.thermal.sun.wbgt));
      for (const w of Object.values(fr.workers)) {
        assert.ok(Number.isFinite(w.tc) && w.tc > 35 && w.tc < 43, `tc ${w.tc}`);
        assert.ok(w.level >= 0 && w.level <= 3);
        assert.ok(w.forecast.length === 13);
      }
    }
  }
});

test('Arctic: cold exposure is judged by wind chill and time outdoors, so the person who stays out is warned', () => {
  const r = run('arctic', { seed: 1 });
  const lv = (id) => Math.max(...r.frames.map((f) => f.workers[id].level));
  const haz = (id) => r.frames.find((f) => f.workers[id].level >= 2)?.workers[id].hazard;
  assert.equal(haz('maxim'), 'cold', 'the pipe fitter stays outdoors for 54 of every 60 minutes');
  assert.ok(lv('maxim') >= 3);
  assert.ok(lv('anya') <= 1, 'the crane operator spends most of the shift in the cab');
  const wc = r.frames[100].site.windChill;
  assert.ok(wc < -25 && wc > -40, `wind chill ${wc}`);
});

test('Coal mine: no sun, a dust surge is detected and the ventilation failure shows up as a heat-load jump', () => {
  const r = run('mine', { seed: 1 });
  assert.ok(r.frames.every((f) => f.site.env.solarWm2 < 5));
  const texts = r.frames.flatMap((f) => f.site.events.map((e) => e.text));
  assert.ok(texts.some((t) => /Dust front/.test(t)));
  assert.ok(texts.some((t) => /Heat load jump/.test(t)));
  const firstWarned = (id) => r.frames.find((f) => f.workers[id].level >= 2 && f.workers[id].hazard === 'heat')?.t ?? null;
  assert.ok(firstWarned('thabo') != null, 'the new hire on heavy work gets a heat warning');
  assert.equal(firstWarned('pieter'), null, 'the shift boss does not');
});

test('simulation is deterministic for a given seed and differs across seeds', () => {
  const a = run('thar', { seed: 5 }), b = run('thar', { seed: 5 }), c = run('thar', { seed: 6 });
  assert.equal(JSON.stringify(a.frames[200].workers.arjun.tc), JSON.stringify(b.frames[200].workers.arjun.tc));
  assert.notEqual(a.frames[200].workers.arjun.truth.tc, c.frames[200].workers.arjun.truth.tc);
});

test('Thar: the at-risk new hires are warned BEFORE their true core temp crosses 38.5 C', () => {
  const r = run('thar', { seed: 1 });
  for (const id of ['arjun', 'kiran']) {
    const crossing = firstTrue(r, id, 38.5);
    const warn = r.frames.at(-1).workers[id].first.geos;
    assert.ok(crossing != null, `${id} should actually become unsafe in the open-loop run`);
    assert.ok(warn != null && warn < crossing - 10, `${id}: warned ${warn}, crossing ${crossing}`);
  }
});

test('Thar: environment is not exposure - low-risk workers get no heat WARNING', () => {
  const r = run('thar', { seed: 1 });
  for (const id of ['meera', 'ravi', 'sana']) {
    assert.ok(peakTrue(r, id) < 38.3, `${id} peak ${peakTrue(r, id)}`);
    assert.equal(r.frames.at(-1).workers[id].first.geos, null, `${id} must not receive a heat warning`);
  }
  // ...while a static WBGT threshold would have alarmed every single one of them
  for (const id of ['arjun', 'meera', 'ravi', 'kiran', 'sana']) assert.notEqual(r.frames.at(-1).workers[id].first.staticWbgt, null);
});

test('Thar: following the advice keeps at-risk workers out of the danger zone', () => {
  const open = run('thar', { seed: 1, followAdvice: false });
  const closed = run('thar', { seed: 1, followAdvice: true });
  for (const id of ['arjun', 'kiran']) {
    assert.ok(peakTrue(closed, id) < peakTrue(open, id) - 0.3, `${id}: ${peakTrue(open, id)} -> ${peakTrue(closed, id)}`);
    assert.ok(peakTrue(closed, id) < 38.5);
  }
});

test('Thar: dust front is detected by change-point detection within minutes', () => {
  const r = run('thar', { seed: 1 });
  const ev = r.frames.flatMap((f) => f.site.events).find((e) => e.kind === 'pm10' && e.severity === 1);
  assert.ok(ev, 'dust event expected');
  assert.ok(ev.t >= 300 && ev.t <= 310, `detected at ${ev.t}`);
  // and it reaches the crew as an airborne-dust alert while the surge is in progress
  const dustAlerts = r.frames.slice(305, 345).filter((f) => Object.values(f.workers).some((w) => w.hazard === 'air' && w.level >= 2));
  assert.ok(dustAlerts.length >= 5, `dust alerts in ${dustAlerts.length} frames`);
  // before the front arrives, steady background dust must not alarm anyone
  assert.ok(r.frames.slice(0, 290).every((f) => Object.values(f.workers).every((w) => w.hazard !== 'air')));
});

test('Thar: a heart-rate strap failure is survived (graceful degradation, never silent)', () => {
  const r = run('thar', { seed: 1 });
  const during = r.frames[170].workers.ravi; // strap dropped 150-185
  assert.equal(during.hr, null);
  assert.ok(during.minutesWithoutHr >= 15);
  assert.ok(during.tcSd > r.frames[140].workers.ravi.tcSd, 'uncertainty grows while blind');
  assert.ok(Number.isFinite(during.tc));
});

test('Offshore: personal gas dose, not the area reading, drives the warning', () => {
  const r = run('offshore', { seed: 1 });
  const peakArea = Math.max(...r.frames.map((f) => f.site.env.h2sAreaPpm));
  assert.ok(peakArea < 10, `area monitor peaks at ${peakArea} ppm - looks "fine"`);
  const deepak = r.frames.map((f) => f.workers.deepak);
  assert.ok(deepak.some((w) => w.level === 3 && w.hazard === 'gas'), 'worker at the source gets DANGER');
  assert.ok(r.frames.flatMap((f) => f.workers.joseph.gas.inst != null ? [f.workers.joseph.gas.level] : []).every((l) => l < 2), 'crane operator is fine');
  const ev = r.frames.flatMap((f) => f.site.events).find((e) => e.kind === 'h2s');
  assert.ok(ev && ev.t >= 140 && ev.t <= 150);
});

test('Offshore: the engine-room mechanic is warned even though the open-air reading is milder', () => {
  const r = run('offshore', { seed: 1 });
  const farah = r.frames.at(-1).workers.farah;
  const crossing = firstTrue(r, 'farah', 38.5);
  assert.ok(farah.first.geos != null);
  if (crossing != null) assert.ok(farah.first.geos < crossing);
  const machinery = r.frames[120].workers.farah.wbgt;
  assert.ok(machinery > r.frames[120].site.thermal.shade.wbgt + 1.5, `machinery ${machinery} vs shade ${r.frames[120].site.thermal.shade.wbgt}`);
});

test('benchmark harness: GEOS is far quieter than a static WBGT alarm and catches most events', () => {
  const results = [];
  for (let s = 2000; s < 2160; s++) results.push(evaluateCase(s));
  const m = summarise(results);
  assert.ok(m.nUnsafe >= 10 && m.nSafe >= 30, `cohort too small: ${m.nUnsafe}/${m.nSafe}`);
  const geos = m.methods.geos, stat = m.methods.staticWbgt;
  assert.ok(geos.falseAlarmRate < 0.3, `geos FA ${geos.falseAlarmRate}`);
  assert.ok(stat.falseAlarmRate > 0.5, `static FA ${stat.falseAlarmRate}`);
  assert.ok(geos.sensitivity > 0.55, `geos sensitivity ${geos.sensitivity}`);
  assert.ok(geos.sensitivity10 > m.methods.hr.sensitivity10 && geos.sensitivity10 > m.methods.buller.sensitivity10);
  assert.ok(m.rmse.fusion < m.rmse.hrOnly && m.rmse.fusion < m.rmse.prior, 'fusion is the most accurate estimator');
});
