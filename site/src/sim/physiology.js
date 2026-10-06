// Ground-truth human heat-balance model, used ONLY by the simulator to generate hidden "true"
// core temperature that the engine never sees (it only gets noisy sensors).
//
// It is deliberately a *different* model from the estimator's prior: a lumped single-node heat
// balance (ISO 7933-style terms: dry exchange, solar gain, respiration, evaporative capacity) with
// core-temperature-driven sweating, dehydration and heart-rate drift. So the estimator has to
// cope with genuine model mismatch rather than being graded on its own homework.
//
//   storage = M + Hsolar - Hdry - Eres - Evap          dTc/dt = storage / C

import { ACTIVITY } from '../engine/limits.js';
import { vapourPressureKpa, satVapourPressureKpa, clamp } from '../engine/psychro.js';

export const dubois = (massKg, heightCm) => 0.007184 * Math.pow(massKg, 0.425) * Math.pow(heightCm, 0.725);

export const CLOTHING_PHYS = {
  light: { clo: 0.5, im: 0.40, alpha: 0.40 },
  coverall: { clo: 0.7, im: 0.38, alpha: 0.45 },
  doubleLayer: { clo: 0.95, im: 0.34, alpha: 0.45 },
  vaporBarrier: { clo: 1.4, im: 0.08, alpha: 0.45 },
};

export class Person {
  /**
   * @param {object} pr {massKg,heightCm,age,restHr,fit,acclimatized,clothing,metScale,drinkLph,kth,sweatSens}
   */
  constructor(pr, rng) {
    this.pr = pr;
    this.rng = rng;
    this.cl = CLOTHING_PHYS[pr.clothing] || CLOTHING_PHYS.coverall;
    this.A = dubois(pr.massKg, pr.heightCm);
    // Effective thermal inertia (J/K): body heat capacity plus core<->periphery coupling, which
    // slows the rise of *core* temperature relative to mean body temperature.
    this.C = 1.3 * pr.massKg * 3470;
    this.tc = 37.05 + rng.normal(0, 0.05);
    this.tsk = 33.5;
    this.sweatL = 0;
    this.drunkL = 0;
    this.hrState = pr.restHr;
    this.hrNoise = 0;
  }

  get dehydPct() { return Math.max(0, ((this.sweatL - this.drunkL) / this.pr.massKg) * 100); }

  /**
   * @param {number} dt minutes
   * @param {{zone:string, Ta:number, rh:number, wind2m:number, ghi:number, fdir:number, cza:number, elevDeg:number, zoneEnv?:object}} env
   */
  step(dt, env, activity) {
    const pr = this.pr, cl = this.cl;
    // Behavioural self-pacing: people slow down as they overheat (and eventually stop).
    const pace = 1 - clamp((this.tc - 38.4) / 1.0, 0, 0.8);
    const M = activity === 'rest' ? ACTIVITY.rest.M * pr.metScale : Math.max(ACTIVITY.rest.M, ACTIVITY[activity].M * pr.metScale * pace);
    const zone = env.zone;

    let Ta = env.Ta, rh = env.rh, wind = env.wind2m, radOffset = 6;
    if (zone === 'shade') { wind = Math.max(0.3, wind * 0.7); radOffset = 2; }
    else if (zone === 'cabin') { Ta = 25; rh = 50; wind = 0.2; radOffset = 0; }
    else if (zone === 'machinery' && env.zoneEnv?.machinery) {
      ({ tAirC: Ta, rhPct: rh, windMs: wind } = env.zoneEnv.machinery); radOffset = 3;
    }

    const Pa = vapourPressureKpa(Ta, rh);
    const vRel = Math.max(0.2, wind + (M > 200 ? 0.5 : 0.1));
    const hc = 8.3 * Math.pow(vRel, 0.6);
    const hrad = 4.7;
    const hdry = hc + hrad;
    const Top = (hc * Ta + hrad * (Ta + radOffset)) / hdry;
    // Clothing insulation is reduced by walking and wind (ISO 9920 / 7933 "dynamic" correction).
    const Icl = 0.155 * cl.clo * clamp(1 - 0.14 * vRel, 0.5, 1);
    const fcl = 1 + 0.3 * cl.clo;
    const Rdry = Icl + 1 / (fcl * hdry);

    const tskTarget = clamp(33.0 + 0.19 * (Top - 25) + 0.6 * (this.tc - 37.0), 31.0, 37.3);
    this.tsk += (tskTarget - this.tsk) * (1 - Math.exp(-dt / 6));
    const Hdry = (this.A * (this.tsk - Top)) / Rdry;

    // solar heat gain on a clothed standing person (direct on projected area + diffuse + reflected)
    let Hsol = 0;
    if (zone === 'sun' || zone === 'shade') {
      const cza = Math.max(env.cza, 0.05);
      const idirN = Math.min(1000, (env.fdir * env.ghi) / cza);
      const idiff = (1 - env.fdir) * env.ghi;
      const fp = 0.28 * Math.pow(Math.max(0, Math.cos((env.elevDeg * Math.PI) / 180)), 0.7) + 0.04;
      const sun = cl.alpha * this.A * 0.62 * (fp * idirN + 0.5 * idiff + 0.25 * 0.35 * env.ghi);
      const shade = cl.alpha * this.A * 0.62 * 0.12 * (0.5 * idiff + 0.25 * 0.35 * env.ghi);
      Hsol = zone === 'sun' ? sun : shade;
    }

    const Eres = 0.0014 * M * (34 - Ta) + 0.0173 * M * (5.87 - Pa);

    // evaporative capacity of the environment/clothing system
    const psk = satVapourPressureKpa(this.tsk);
    const he = 16.5 * hc;
    const ReT = Icl / (cl.im * 16.5) + 1 / (fcl * he);
    const Emax = Math.max(0, (this.A * (psk - Pa)) / ReT);

    // sweat demand driven by core and skin temperature
    // Sweating is driven by core temperature (with an exercise-intensity set-point shift) and by
    // skin temperature, which is what makes sweat start quickly when a person walks into the sun.
    const accl = pr.acclimatized;
    const sens = 470 * pr.sweatSens * (accl ? 1.25 : 1);
    // Dehydration raises the sweating threshold and eventually caps sweat output (Sawka et al.).
    const thr = 36.8 + 0.0035 * (M - 115) - (accl ? 0.1 : 0) + 0.2 * this.dehydPct;
    const cap = Math.max(200, (accl ? 1400 : 1000) * (1 - 0.12 * Math.max(0, this.dehydPct - 1.5)));
    const Esw = Math.min(Math.max(0, sens * (this.tc - thr) + 150 * (this.tsk - 34)), cap);
    const evap = Math.min(Esw, Emax);

    const storage = M + Hsol - Hdry - Eres - evap;
    this.tc = clamp(this.tc + (storage * 60 * dt) / this.C, 35.8, 42.5);

    this.sweatL += (Esw * 60 * dt) / 2430 / 1000;
    this.drunkL += (pr.drinkLph * (zone === 'sun' ? 1 : 1.8) * dt) / 60;

    // heart rate: workload + thermal drive + dehydration drift, with first-order lag and AR(1) variability
    const thermal = pr.kth * Math.max(0, this.tc - 37.0) * (accl ? 0.65 : 1);
    const target = pr.restHr + pr.fit * 0.17 * (M - 115) + thermal + 3.5 * this.dehydPct + 0.5 * Math.max(0, this.tsk - 35);
    this.hrState += (target - this.hrState) * (1 - Math.exp(-dt / 1.5));
    this.hrNoise = 0.8 * this.hrNoise + this.rng.normal(0, 2.2);
    const hrTrue = clamp(this.hrState + this.hrNoise, 40, 0.98 * (220 - pr.age));

    return { tc: this.tc, tsk: this.tsk, hrTrue, M, dehydPct: this.dehydPct, sweatL: this.sweatL, Hsol, Hdry, evap, Emax, storage };
  }
}
