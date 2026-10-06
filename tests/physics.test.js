import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solarGeometry, clearSkyGhi } from '../site/src/engine/solar.js';
import { wbgtOutdoor, wbgtIndoor, wbgtSimple, solarComponents } from '../site/src/engine/wbgt.js';
import { wbgtLimit, workRestPlan, allowedMetabolicRate, ACTIVITY } from '../site/src/engine/limits.js';
import { rhFromDewPointC, esatHpa } from '../site/src/engine/psychro.js';
import { psi, psiCategory } from '../site/src/engine/strain.js';
import { GasExposure, RollingMean, particulateLevel } from '../site/src/engine/dose.js';

const IST = 330 * 60000;

test('sun position: Jaisalmer solar noon elevation matches 90 - |lat - decl|', () => {
  // 21 May: declination ~ +20.2 deg, latitude 26.92 -> noon elevation ~ 83.3 deg
  const g = solarGeometry(Date.UTC(2026, 4, 21, 12, 30) - IST, 26.92, 70.9);
  assert.ok(Math.abs(g.elevationDeg - 83.3) < 1.5, `elevation ${g.elevationDeg}`);
  assert.ok(g.cza > 0.98);
  const night = solarGeometry(Date.UTC(2026, 4, 21, 3, 0) - IST, 26.92, 70.9);
  assert.ok(night.cza < 0);
  assert.equal(clearSkyGhi(night.cza), 0);
});

test('NIOSH limits reproduce the published class values', () => {
  const near = (a, b, tol = 0.4) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);
  near(wbgtLimit(ACTIVITY.light.M, false), 28.0);   // RAL light
  near(wbgtLimit(ACTIVITY.moderate.M, false), 25.0); // RAL moderate
  near(wbgtLimit(ACTIVITY.heavy.M, false), 23.0);    // RAL heavy
  near(wbgtLimit(ACTIVITY.moderate.M, true), 28.0);  // REL moderate
  near(wbgtLimit(ACTIVITY.light.M, true), 31.0, 0.5); // REL light
  assert.ok(wbgtLimit(300, true) > wbgtLimit(300, false), 'acclimatised limit is higher');
});

test('work/rest plan inverts the limit: time-weighted M sits on the NIOSH limit', () => {
  const wbgt = 30, M = 415;
  const plan = workRestPlan(wbgt, M, false);
  const twaM = plan.workFraction * M + (1 - plan.workFraction) * ACTIVITY.rest.M;
  if (plan.workFraction > 0 && plan.workFraction < 1) {
    assert.ok(Math.abs(wbgtLimit(twaM, false) - wbgt) < 0.05);
  }
  assert.equal(workRestPlan(15, 180, true).restMin, 0, 'cool day: no rest needed');
  assert.equal(workRestPlan(36, 415, false).workMin, 0, 'extreme WBGT: no safe work');
  assert.ok(allowedMetabolicRate(25, false) > allowedMetabolicRate(30, false));
});

test('WBGT: physically ordered and converges', () => {
  const g = solarGeometry(Date.UTC(2026, 4, 21, 12, 30) - IST, 26.92, 70.9);
  const base = { tAirC: 40, rhPct: 15, pressureHpa: 1000, windMs: 2, solarWm2: 950, cza: g.cza };
  const sun = wbgtOutdoor(base);
  const shade = wbgtOutdoor({ ...base, solarWm2: 0 });
  const humid = wbgtOutdoor({ ...base, rhPct: 60 });
  const hotter = wbgtOutdoor({ ...base, tAirC: 44 });
  const windy = wbgtOutdoor({ ...base, windMs: 6 });
  for (const r of [sun, shade, humid, hotter, windy]) assert.ok(r.converged && Number.isFinite(r.wbgt));
  assert.ok(sun.wbgt > shade.wbgt + 2, 'sun adds several degrees');
  assert.ok(humid.wbgt > sun.wbgt + 2, 'humidity raises WBGT');
  assert.ok(hotter.wbgt > sun.wbgt, 'hotter air raises WBGT');
  assert.ok(windy.tg < sun.tg, 'wind cools the globe');
  assert.ok(sun.tg > sun.tnwb + 20, 'globe far above wet bulb in dry sun');
  assert.ok(sun.tnwb >= sun.tpsy, 'natural wet bulb >= psychrometric wet bulb in sun');
});

test('WBGT: night, indoor and fallbacks are finite and sensible', () => {
  const night = wbgtOutdoor({ tAirC: 28, rhPct: 60, pressureHpa: 1000, windMs: 1, solarWm2: 0, cza: -0.4 });
  assert.ok(night.converged && night.wbgt > 20 && night.wbgt < 30);
  const room = wbgtIndoor({ tAirC: 25, rhPct: 50 });
  assert.ok(room.wbgt > 15 && room.wbgt < 24, `cabin ${room.wbgt}`);
  assert.ok(Math.abs(wbgtSimple(30, 50) - 27) < 3);
  const s = solarComponents(2000, 0.9, 1);
  assert.ok(s.solar < 1367, 'irradiance clipped to physical limit');
  assert.ok(s.fdir >= 0 && s.fdir <= 0.9);
});

test('psychrometrics', () => {
  assert.ok(Math.abs(esatHpa(303.15) - 42.5) < 1.0); // 30 C -> ~42.4 hPa (Buck formula range is -80..50 C)
  assert.ok(esatHpa(313.15) > esatHpa(303.15) * 1.6, 'strongly increasing with temperature');
  assert.ok(Math.abs(rhFromDewPointC(30, 30) - 100) < 1e-6);
  assert.ok(rhFromDewPointC(40, 5) < 15);
});

test('PSI follows Moran et al. and is bounded', () => {
  assert.equal(psi(37.1, 70, 37.1, 70), 0);
  const mid = psi(38.3, 140, 37.1, 70);
  assert.ok(mid > 4 && mid < 7, `psi ${mid}`);
  assert.equal(psi(41, 220, 37.1, 70), 10);
  assert.equal(psiCategory(8), 'high');
});

test('gas exposure: instantaneous ceiling, 10-minute dose and IDLH', () => {
  let g = new GasExposure();
  assert.equal(g.push(0.2).level, 0);
  assert.equal(g.push(6).level, 1);
  assert.equal(new GasExposure().push(25).level, 3, 'OSHA ceiling 20 ppm');
  assert.equal(new GasExposure().push(120).level, 3, 'IDLH');
  g = new GasExposure();
  let last;
  for (let i = 0; i < 10; i++) last = g.push(12); // never above 20 ppm, but 10-min mean over 10 ppm
  assert.equal(last.level, 2, 'dose-based warning without an instantaneous breach');
  const r = new RollingMean(3);
  [1, 2, 3, 10].forEach((x) => r.push(x));
  assert.equal(r.mean, 5);
  assert.equal(particulateLevel(900, true).level, 2, 'dust front in progress at hazardous level');
  assert.equal(particulateLevel(900, false).level, 0, 'steady high dust is a site advisory, not a worker alarm');
  assert.equal(particulateLevel(900, false).advisory, true);
  assert.equal(particulateLevel(2000, false).level, 2, 'extreme level always alarms');
  assert.equal(particulateLevel(60).level, 0);
});
