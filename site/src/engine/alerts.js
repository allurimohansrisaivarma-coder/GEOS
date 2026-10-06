// Alert policy: turns risk estimates into a small number of trustworthy, explainable warnings.
//
// Design goals (alert fatigue kills warning systems):
//   * Predictive - escalate when the *forecast* crosses a limit, not only after it has happened.
//   * Persistent - require a few consecutive samples before escalating (DANGER needs fewer).
//   * Sticky     - de-escalate one level at a time, and only after the risk has stayed lower.
//   * Explainable - every alert carries its reasons and a concrete action.

export const LEVELS = [
  { id: 0, key: 'safe', label: 'SAFE' },
  { id: 1, key: 'watch', label: 'WATCH' },
  { id: 2, key: 'warning', label: 'WARNING' },
  { id: 3, key: 'danger', label: 'DANGER' },
];

export const DEFAULT_POLICY = {
  nUp: [0, 3, 3, 2],   // consecutive samples required to escalate TO level n
  nDown: 12,           // consecutive lower samples before stepping down one level
  heat: {
    danger: { tc: 38.9, ttt39: 10, psi: 8.5 },
    warning: { tc: 38.3, ttt385: 20, psi: 6.5 },
    watch: { tc: 37.8, ttt385: 45 },
  },
  uncertainSd: 0.35,   // above this the filter is "unsure": use the earliest plausible crossing time
  sensorLostMin: 8,
};

const f1 = (x) => x.toFixed(1);

export class AlertPolicy {
  constructor(opts = {}) {
    this.cfg = { ...DEFAULT_POLICY, ...opts, heat: { ...DEFAULT_POLICY.heat, ...(opts.heat || {}) } };
    this.level = 0;
    this.up = 0;
    this.down = 0;
    this.last = { reasons: [], actions: [], title: 'All clear', hazard: 'none' };
  }

  /** Evaluate one sample. Returns the current state plus a `change` object when the level moved. */
  step(inp) {
    const cand = this._candidate(inp);

    // --- persistence / hysteresis ---
    let change = null;
    if (cand.level > this.level) {
      this.up++;
      this.down = 0;
      // acute gas exposure alarms immediately (like a personal monitor); everything else must persist
      const need = cand.hazard === 'gas' ? 1 : this.cfg.nUp[cand.level];
      if (this.up >= need) {
        change = this._move(inp.t, cand.level, cand);
        this.up = 0;
      }
    } else if (cand.level < this.level) {
      this.up = 0;
      this.down++;
      if (this.down >= this.cfg.nDown) {
        const next = Math.max(cand.level, this.level - 1);
        change = this._move(inp.t, next, cand);
        this.down = 0;
      }
    } else {
      this.up = 0;
      this.down = 0;
      if (cand.level > 0) this.last = { ...this.last, reasons: cand.reasons, actions: cand.actions, title: cand.title, hazard: cand.hazard };
    }
    if (this.level === 0 && cand.level === 0) this.last = { reasons: [], actions: [], title: 'All clear', hazard: 'none' };
    return { level: this.level, candidate: cand.level, ...this.last, change };
  }

  _move(t, to, cand) {
    const from = this.level;
    this.level = to;
    const use = to === cand.level ? cand : { ...cand, title: to === 0 ? 'Back to safe range' : cand.title };
    this.last = { reasons: use.reasons, actions: use.actions, title: use.title, hazard: use.hazard };
    return { t, from, to, title: use.title, hazard: use.hazard, reasons: use.reasons, actions: use.actions };
  }

  _candidate(i) {
    const c = this.cfg.heat;
    const reasons = [];
    let level = 0;
    let hazard = 'none';
    const raise = (lv, why, hz) => {
      if (lv > level) { level = lv; hazard = hz; reasons.length = 0; }
      if (lv === level) reasons.push(why);
    };

    // ---- heat strain ----
    const uncertain = i.tcSd > this.cfg.uncertainSd;
    const t385 = uncertain ? i.ttt385early : i.ttt385;
    const t39 = uncertain ? i.ttt39early : i.ttt39;

    if (i.tcEst >= c.danger.tc) raise(3, `Core temperature estimated ${f1(i.tcEst)} °C (heat-stroke risk zone)`, 'heat');
    else if (t39 != null && t39 <= c.danger.ttt39) raise(3, `Predicted to reach 39.0 °C in ~${Math.max(1, Math.round(t39))} min`, 'heat');
    else if (i.psi >= c.danger.psi) raise(3, `Physiological strain index ${f1(i.psi)}/10 (very high)`, 'heat');

    if (level < 3) {
      if (i.tcEst >= c.warning.tc) raise(2, `Core temperature estimated ${f1(i.tcEst)} °C`, 'heat');
      if (t385 != null && t385 <= c.warning.ttt385) raise(2, `Predicted to reach 38.5 °C in ~${Math.max(1, Math.round(t385))} min`, 'heat');
      if (i.psi >= c.warning.psi) raise(2, `Physiological strain index ${f1(i.psi)}/10 (high)`, 'heat');
    }
    if (level < 2) {
      if (i.tcEst >= c.watch.tc) raise(1, `Core temperature estimated ${f1(i.tcEst)} °C and rising`, 'heat');
      if (t385 != null && t385 <= c.watch.ttt385) raise(1, `On course to reach 38.5 °C in ~${Math.round(t385)} min`, 'heat');
      if (i.wbgtEff >= i.limit) raise(1, `WBGT ${f1(i.wbgtEff)} °C exceeds the ${f1(i.limit)} °C limit for ${i.activityLabel.toLowerCase()} work`, 'heat');
    }
    if (hazardIs(hazard, 'heat') && level >= 1) {
      reasons.push(`Workload ${i.activityLabel.toLowerCase()} (${i.M} W): WBGT ${f1(i.wbgtEff)} °C vs limit ${f1(i.limit)} °C`);
      if (i.hr != null) reasons.push(`Heart rate ${Math.round(i.hr)} bpm (resting ${i.hrRest}); core temperature ${i.slopePerHour >= 0 ? 'rising' : 'falling'} ${f1(Math.abs(i.slopePerHour))} °C/h`);
    }

    // ---- sensor loss: never fail silent ----
    if (i.minutesWithoutHr >= this.cfg.sensorLostMin) {
      const lv = i.wbgtEff >= i.limit - 2 ? 1 : 0;
      if (lv) raise(1, `Heart-rate sensor lost for ${Math.round(i.minutesWithoutHr)} min - running on the environment model (confidence reduced)`, 'sensor');
    }

    // ---- toxic gas / air quality (independent hazards; highest wins) ----
    if (i.gas && i.gas.level > 0) {
      i.gas.reasons.forEach((r) => raise(i.gas.level, r, 'gas'));
    }
    // ---- cold: wind chill against how long this person has been outdoors (frostbite window) ----
    if (i.cold) {
      const { wc, minOut, tf } = i.cold;
      const f = Number.isFinite(tf) ? minOut / tf : 0;
      const why = Number.isFinite(tf)
        ? `Wind chill ${Math.round(wc)} °C: exposed skin freezes in ~${Math.round(tf)} min; ${minOut} min outdoors so far`
        : `Wind chill ${Math.round(wc)} °C and ${minOut} min outdoors`;
      if (f >= 1) raise(3, why, 'cold');
      else if (f >= 0.6) raise(2, why, 'cold');
      else if (minOut >= 5) raise(1, why, 'cold');
    }
    if (i.pm && i.pm.level > 0 && level < 2) {
      raise(i.pm.level, `PM10 ${Math.round(i.pm10)} ug/m3: ${i.pm.label}`, 'air');
    }

    const plan = i.plan;
    const planText = plan.workMin === 0
      ? 'No safe work/rest split at this WBGT: stop outdoor work and cool down.'
      : plan.restMin === 0 ? 'Current work rate is inside the NIOSH limit.'
        : `Plan work ${plan.workMin} min / rest ${plan.restMin} min per hour (NIOSH time-weighted limit).`;
    const actions = actionsFor(hazard, level, planText);
    return { level, reasons: dedupe(reasons), actions, title: titleFor(hazard, level), hazard };
  }
}

const hazardIs = (h, x) => h === x;
const dedupe = (a) => [...new Set(a)];

function titleFor(hazard, level) {
  const L = ['All clear', 'WATCH', 'WARNING', 'DANGER'][level];
  if (level === 0) return 'All clear';
  const what = { heat: 'heat strain', gas: 'toxic gas exposure', sensor: 'sensor loss', air: 'airborne dust', cold: 'cold exposure' }[hazard] || 'environmental stress';
  if (level === 1) return `Watch: ${what}`;
  return `${L}: ${what}${level === 2 ? ' rising' : ''}`;
}

function actionsFor(hazard, level, planText) {
  if (level === 0) return [];
  if (hazard === 'gas') {
    if (level >= 3) return ['Evacuate upwind to the muster point NOW', 'Use breathing apparatus; do not go back for others', 'Alert control room'];
    if (level === 2) return ['Move upwind and away from the source', 'Check personal monitor; report to supervisor'];
    return ['Check for source; stay alert upwind', 'H2S dulls the sense of smell - trust the monitor, not your nose'];
  }
  if (hazard === 'air') {
    return level >= 2
      ? ['Seek enclosed shelter; stop vehicle movement if visibility drops', 'Cover nose/mouth; secure loose equipment']
      : ['Put on a dust respirator (N95/FFP2)', 'Protect eyes; keep water for rinsing'];
  }
  if (hazard === 'cold') {
    if (level >= 3) return ['Get into the heated cabin NOW', 'Cover exposed skin; do not rub frostbitten areas', 'Buddy check for numbness, white patches or confusion'];
    if (level === 2) return ['Finish the task and warm up in the heated cabin', 'Cover face and hands; check your buddy\'s skin'];
    return ['Plan a warm-up break', 'Keep skin covered and clothing dry'];
  }
  if (hazard === 'sensor') return ['Re-seat or replace the heart-rate strap', 'Buddy check until the sensor is back'];
  if (level >= 3) return ['Emergency: stop work and cool immediately (shade, wet cloth, ice at neck/armpits/groin)', 'Call medical help; cool first, transport second', 'Never leave the worker alone'];
  if (level === 2) return ['Stop work: move to shade or a cool area', 'Rest at least 15 min; drink 250 ml water', planText, 'Buddy check for dizziness, nausea, confusion'];
  return ['Drink 250 ml every 15-20 min', planText, 'Take shade breaks early'];
}
