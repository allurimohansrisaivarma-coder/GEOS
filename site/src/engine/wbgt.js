// Outdoor Wet Bulb Globe Temperature (WBGT) from standard weather variables.
//
// Independent JavaScript implementation of the physical model in
//   Liljegren, Carhart, Lawday, Tschopp & Sharp (2008), "Modeling the Wet Bulb Globe
//   Temperature Using Standard Meteorological Measurements", J. Occup. Environ. Hyg. 5(10).
// Constants and correlations follow the published algorithm (Argonne National Laboratory
// reference implementation; Bedingfield & Drew for the wick, Bird-Stewart-Lightfoot for
// the globe). Solar geometry comes from ./solar.js instead of the Almanac routine.
//
//   WBGT = 0.7 * Tnwb + 0.2 * Tg + 0.1 * Tair        (outdoors with solar load)
//
// Why not the common "0.567 Ta + 0.393 e + 3.94" shortcut? It assumes moderate sun and light
// wind and under-reads dry, sunny, hot conditions (BoM) - i.e. exactly our desert use case.

import { esatHpa, dewPointK, clamp } from './psychro.js';

const STEFANB = 5.6696e-8;
const CP = 1003.5;
const M_AIR = 28.97;
const M_H2O = 18.015;
const R_GAS = 8314.34;
const R_AIR = R_GAS / M_AIR;
const RATIO = (CP * M_AIR) / M_H2O;
const PR = CP / (CP + 1.25 * R_AIR);

const EMIS_WICK = 0.95, ALB_WICK = 0.4, D_WICK = 0.007, L_WICK = 0.0254;
const EMIS_GLOBE = 0.95, ALB_GLOBE = 0.05, D_GLOBE = 0.0508;
const EMIS_SFC = 0.999, ALB_SFC = 0.45;
const CZA_MIN = 0.00873, NORMSOLAR_MAX = 0.85, MIN_SPEED = 0.13;
const CONVERGENCE = 0.02, MAX_ITER = 500;
const SOLAR_CONST = 1367;

// --- thermophysical properties of air (kelvin in, SI out) -------------------------------
function viscosity(tK) {
  const Tr = tK / 97.0;
  const omega = ((Tr - 2.9) / 0.4) * -0.034 + 1.048;
  return (2.6693e-6 * Math.sqrt(M_AIR * tK)) / (3.617 * 3.617 * omega);
}
const thermalCond = (tK) => (CP + 1.25 * R_AIR) * viscosity(tK);

function diffusivity(tK, pHpa) {
  const Pcrit13 = Math.pow(36.4 * 218.0, 1 / 3);
  const Tcrit512 = Math.pow(132.0 * 647.3, 5 / 12);
  const Tcrit12 = Math.sqrt(132.0 * 647.3);
  const Mmix = Math.sqrt(1 / M_AIR + 1 / M_H2O);
  const Patm = pHpa / 1013.25;
  return ((3.64e-4 * Math.pow(tK / Tcrit12, 2.334) * Pcrit13 * Tcrit512 * Mmix) / Patm) * 1e-4;
}

const latentHeat = (tK) => ((313.15 - tK) / 30) * -71100 + 2.4073e6;
const emisAtm = (tK, rh) => 0.575 * Math.pow(rh * esatHpa(tK), 0.143);

function hSphere(d, tK, pHpa, speed) {
  const density = (pHpa * 100) / (R_AIR * tK);
  const Re = (Math.max(speed, MIN_SPEED) * density * d) / viscosity(tK);
  const Nu = 2.0 + 0.6 * Math.sqrt(Re) * Math.pow(PR, 0.3333);
  return (Nu * thermalCond(tK)) / d;
}

function hCylinder(d, tK, pHpa, speed) {
  const density = (pHpa * 100) / (R_AIR * tK);
  const Re = (Math.max(speed, MIN_SPEED) * density * d) / viscosity(tK);
  const Nu = 0.281 * Math.pow(Re, 1 - 0.4) * Math.pow(PR, 1 - 0.56);
  return (Nu * thermalCond(tK)) / d;
}

// --- solar partitioning ----------------------------------------------------------------
/** Clamp irradiance to physical limits and estimate the direct-beam fraction. */
export function solarComponents(solarWm2, cza, distAU = 1) {
  const toa = cza >= CZA_MIN ? (SOLAR_CONST * Math.max(0, cza)) / (distAU * distAU) : 0;
  if (toa <= 0) return { solar: 0, fdir: 0 };
  const norm = Math.min(Math.max(solarWm2, 0) / toa, NORMSOLAR_MAX);
  const solar = norm * toa;
  let fdir = 0;
  if (norm > 0) fdir = clamp(Math.exp(3 - 1.34 * norm - 1.65 / norm), 0, 0.9);
  return { solar, fdir };
}

// --- globe and natural wet-bulb heat balances ------------------------------------------
function globe(tAirK, rh, pHpa, speed, solar, fdir, cza) {
  const tSfc = tAirK;
  let prev = tAirK, next = tAirK, h = 0, converged = false;
  const czaS = Math.max(cza, CZA_MIN);
  for (let it = 0; it < MAX_ITER && !converged; it++) {
    const tRef = 0.5 * (prev + tAirK);
    h = hSphere(D_GLOBE, tRef, pHpa, speed);
    const rad4 =
      0.5 * (emisAtm(tAirK, rh) * tAirK ** 4 + EMIS_SFC * tSfc ** 4) -
      (h / (STEFANB * EMIS_GLOBE)) * (prev - tAirK) +
      (solar / (2 * STEFANB * EMIS_GLOBE)) * (1 - ALB_GLOBE) * (fdir * (1 / (2 * czaS) - 1) + 1 + ALB_SFC);
    next = Math.pow(Math.max(rad4, 1), 0.25);
    if (Math.abs(next - prev) < CONVERGENCE) converged = true;
    prev = 0.9 * prev + 0.1 * next;
  }
  return converged ? { tK: next, h } : null;
}

function wetBulb(tAirK, rh, pHpa, speed, solar, fdir, cza, radiative) {
  const tSfc = tAirK;
  const sza = Math.acos(clamp(Math.max(cza, CZA_MIN), -1, 1));
  const eAir = rh * esatHpa(tAirK);
  let prev = dewPointK(eAir), next = prev, converged = false;
  for (let it = 0; it < MAX_ITER && !converged; it++) {
    const tRef = 0.5 * (prev + tAirK);
    const h = hCylinder(D_WICK, tRef, pHpa, speed);
    const fatm =
      STEFANB * EMIS_WICK * (0.5 * (emisAtm(tAirK, rh) * tAirK ** 4 + EMIS_SFC * tSfc ** 4) - prev ** 4) +
      (1 - ALB_WICK) * solar *
        ((1 - fdir) * (1 + (0.25 * D_WICK) / L_WICK) + fdir * (Math.tan(sza) / Math.PI + (0.25 * D_WICK) / L_WICK) + ALB_SFC);
    const eWick = esatHpa(prev);
    const density = (pHpa * 100) / (R_AIR * tRef);
    const Sc = viscosity(tRef) / (density * diffusivity(tRef, pHpa));
    next =
      tAirK -
      (latentHeat(tRef) / RATIO) * ((eWick - eAir) / (pHpa - eWick)) * Math.pow(PR / Sc, 0.56) +
      (radiative ? fatm / h : 0);
    if (Math.abs(next - prev) < CONVERGENCE) converged = true;
    prev = 0.9 * prev + 0.1 * next;
  }
  return converged ? next : null;
}

/** BoM-style shade approximation. Only used as a fallback if the iteration fails to converge. */
export function wbgtSimple(tAirC, rhPct) {
  const e = (rhPct / 100) * 6.105 * Math.exp((17.27 * tAirC) / (237.7 + tAirC));
  return 0.567 * tAirC + 0.393 * e + 3.94;
}

/**
 * Outdoor WBGT with radiative load.
 * @param {{tAirC:number, rhPct:number, pressureHpa?:number, windMs:number, solarWm2:number, cza:number, distAU?:number}} p
 *   windMs is the 2 m wind speed; solarWm2 is global horizontal irradiance.
 * @returns {{wbgt:number, tg:number, tnwb:number, tpsy:number, tmrt:number, converged:boolean}}
 */
export function wbgtOutdoor(p) {
  const { tAirC, rhPct, pressureHpa = 1005, windMs, solarWm2, cza, distAU = 1 } = p;
  const tK = tAirC + 273.15;
  const rh = clamp(rhPct, 1, 100) / 100;
  const { solar, fdir } = solarComponents(solarWm2, cza, distAU);
  const g = globe(tK, rh, pressureHpa, windMs, solar, fdir, cza);
  const nwb = wetBulb(tK, rh, pressureHpa, windMs, solar, fdir, cza, true);
  const psy = wetBulb(tK, rh, pressureHpa, windMs, solar, fdir, cza, false);
  if (!g || nwb == null || psy == null) {
    const w = wbgtSimple(tAirC, rhPct);
    return { wbgt: w, tg: tAirC + 3, tnwb: w - 2, tpsy: w - 3, tmrt: tAirC + 3, converged: false };
  }
  const tg = g.tK - 273.15;
  const tnwb = nwb - 273.15;
  const wbgt = 0.7 * tnwb + 0.2 * tg + 0.1 * tAirC;
  // Mean radiant temperature recovered from the globe heat balance (used by the body model).
  const tmrtK = Math.pow(g.tK ** 4 + (g.h / (EMIS_GLOBE * STEFANB)) * (g.tK - tK), 0.25);
  return { wbgt, tg, tnwb, tpsy: psy - 273.15, tmrt: tmrtK - 273.15, converged: true };
}

/**
 * WBGT for the standard exposure zones a site cares about.
 * `sun` has full solar load; `shade` removes direct sun and some wind.
 * Returns plain numbers so the UI and the alert logic can use them directly.
 */
export function thermalEnvironment({ tAirC, rhPct, pressureHpa = 1005, wind2m, solarWm2, geom }) {
  const base = { tAirC, rhPct, pressureHpa, cza: geom.cza, distAU: geom.distanceAU };
  const sun = wbgtOutdoor({ ...base, windMs: wind2m, solarWm2 });
  const shade = wbgtOutdoor({ ...base, windMs: Math.max(0.3, wind2m * 0.7), solarWm2: 0 });
  return { sun, shade };
}

/** Indoor / enclosed-space WBGT (no solar load): WBGT = 0.7 Tnwb + 0.3 Tg. */
export function wbgtIndoor({ tAirC, rhPct, pressureHpa = 1005, windMs = 0.3 }) {
  const r = wbgtOutdoor({ tAirC, rhPct, pressureHpa, windMs, solarWm2: 0, cza: 0.001 });
  return { ...r, wbgt: 0.7 * r.tnwb + 0.3 * r.tg };
}
