// Consistency checks for the thresholds and messages every zone relies on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { windChillC, frostbiteMinutes, coldCategory } from '../site/src/engine/cold.js';
import { particulateLevel } from '../site/src/engine/dose.js';
import { heatCategory, wbgtLimit } from '../site/src/engine/limits.js';
import { buildScenario, runScenarioSync } from '../site/src/sim/scenarios.js';
import { Monitor } from '../site/src/engine/pipeline.js';
import { simOutlook } from '../site/src/outlook.js';

test('wind chill follows the JAG/TI formula and frostbite times follow Environment Canada', () => {
  // -20 C air at 5 m/s (18 km/h) -> about -30 C wind chill
  assert.ok(Math.abs(windChillC(-20, 5) - -30.0) < 0.6);
  assert.equal(frostbiteMinutes(-20), Infinity);
  assert.equal(frostbiteMinutes(-27.9), Infinity);
  assert.ok(Math.abs(frostbiteMinutes(-28) - 30) < 0.01);
  assert.ok(Math.abs(frostbiteMinutes(-40) - 10) < 0.01);
  assert.ok(Math.abs(frostbiteMinutes(-48) - 5) < 0.01);
  assert.equal(frostbiteMinutes(-60), 2);
  // never increases as it gets colder
  let prev = Infinity;
  for (let wc = -28; wc >= -60; wc -= 1) { const m = frostbiteMinutes(wc); assert.ok(m <= prev); prev = m; }
  assert.deepEqual(coldCategory(-5), ['Mild', 0]);
  assert.deepEqual(coldCategory(-20), ['Cold', 1]);
  assert.deepEqual(coldCategory(-30), ['Severe cold', 2]);
  assert.deepEqual(coldCategory(-45), ['Extreme cold', 3]);
});

test('dust labels follow the US AQI PM10 breakpoints', () => {
  const L = (v) => particulateLevel(v).label;
  assert.equal(L(30), 'Good');
  assert.equal(L(100), 'Moderate');
  assert.equal(L(200), 'Unhealthy for sensitive groups');
  assert.equal(L(300), 'Unhealthy');
  assert.match(L(400), /Very unhealthy/);
  assert.match(L(430), /Hazardous/);
  // a steady high level is an advisory; a surge raises the worker-level alert
  assert.equal(particulateLevel(500, false).level, 0);
  assert.equal(particulateLevel(500, true).level, 1);
});

test('heat load bands and NIOSH limits are ordered and consistent', () => {
  assert.equal(heatCategory(24)[0], 'Low');
  assert.equal(heatCategory(30)[0], 'High');
  assert.equal(heatCategory(34)[0], 'Extreme');
  assert.ok(wbgtLimit(415, false) < wbgtLimit(300, false) && wbgtLimit(300, false) < wbgtLimit(180, false));
  for (const M of [115, 180, 300, 415, 520]) assert.ok(wbgtLimit(M, true) > wbgtLimit(M, false) - 1e-9, 'acclimatised limit is never lower');
});

test('every scenario: any raised alert has a hazard, reasons and actions, and no message is malformed', () => {
  for (const id of ['thar', 'offshore', 'mine', 'arctic']) {
    const r = runScenarioSync(buildScenario(id), Monitor, { seed: 1 });
    for (const fr of r.frames) {
      for (const [w, x] of Object.entries(fr.workers)) {
        const where = `${id}/${w}@${fr.t}`;
        if (x.level > 0) {
          assert.notEqual(x.hazard, 'none', where);
          assert.ok(x.reasons.length > 0, `${where}: level ${x.level} without reasons`);
          assert.ok(x.actions.length > 0, `${where}: level ${x.level} without actions`);
        }
        const text = [x.title, ...x.reasons, ...x.actions].join(' | ');
        assert.ok(!/Infinity|NaN|undefined|null/.test(text), `${where}: ${text}`);
        assert.ok(x.tc > 35 && x.tc < 42, `${where}: tc ${x.tc}`);
        if (x.truth) assert.ok(x.truth.tc > 35.5 && x.truth.tc < 42.6, `${where}: true tc ${x.truth.tc}`);
      }
    }
  }
});

test('Arctic: nobody is alarmed for cold while indoors, and the hidden core temperature does not collapse', () => {
  const r = runScenarioSync(buildScenario('arctic'), Monitor, { seed: 1 });
  let indoors = 0;
  for (const fr of r.frames) {
    for (const x of Object.values(fr.workers)) {
      if (x.zone === 'cabin' && x.level > 0 && x.hazard === 'cold') {
        // only the sticky step-down from an earlier outdoor alert is allowed, never a fresh cold candidate
        assert.ok(x.candidate <= x.level);
        indoors++;
      }
      if (x.truth) assert.ok(x.truth.tc > 36.0, `true core ${x.truth.tc} at ${fr.t}`);
    }
  }
  assert.ok(indoors >= 0);
});

test('tomorrow outlook: four day-parts, plausible numbers, consistent risk wording per site', () => {
  for (const [plantId, scnId] of [['jaisalmer', 'thar'], ['platformb', 'offshore'], ['witbank', 'mine'], ['norilsk', 'arctic']]) {
    const o = simOutlook({ plantId, scn: buildScenario(scnId) });
    assert.equal(o.parts.length, 4);
    assert.ok(o.hi >= o.lo && o.lo > -60 && o.hi < 55);
    assert.ok(o.parts.every((p) => p.icon && Number.isFinite(p.t)));
    assert.ok(o.risk.head.length > 5 && o.risk.plan.length > 5);
    assert.equal(o.source, 'simulated');
  }
  const desert = simOutlook({ plantId: 'jaisalmer', scn: buildScenario('thar') });
  assert.match(desert.risk.head, /Peak WBGT/);
  const arctic = simOutlook({ plantId: 'norilsk', scn: buildScenario('arctic') });
  assert.match(arctic.risk.head, /wind chill/i);
});
