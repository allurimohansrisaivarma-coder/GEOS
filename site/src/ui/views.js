// Rendering. State lives in main.js (S); these functions turn (S, frame) into DOM.

import { $, esc, f1, clock } from './dom.js';
import { ICON, LEVEL_ICON, LEVEL_LABEL, badge } from './icons.js';
import { LineChart, sparkline } from './charts.js';
import { CLOTHING, wbgtLimit } from '../engine/limits.js';
import { coldCategory } from '../engine/cold.js';
import { sensorList } from './sensors.js';

const ZONE = { sun: 'In full sun', shade: 'In shade', cabin: 'Cool cabin', machinery: 'Engine room' };
const zoneLabel = (S, z) => S.scn.zoneLabels?.[z] || ZONE[z] || z;
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const LV_COLOR = ['var(--good)', 'var(--warn)', 'var(--serious)', 'var(--crit)'];
const first = (name) => String(name).split(' ')[0];

export const frames = (S) => S.runs[S.mode].frames;
export const profileOf = (S, id) => S.scn.workers.find((w) => w.profile.id === id).profile;

// ------------------------------------------------------------------ plant chip (top bar)
export function renderPlantChip(S, fr) {
  const p = S.plant;
  if (S._chip !== p.id) {
    S._chip = p.id;
    $('#pc-ico').innerHTML = ICON[p.icon];
    $('#pc-name').textContent = p.name;
    $('#pc-sub').textContent = `${p.kind} · ${p.place}`;
  }
  const ws = Object.values(fr.workers);
  const top = Math.max(...ws.map((w) => w.level));
  const n = ws.filter((w) => w.level >= 2).length;
  const st = $('#pc-state');
  st.className = `pc-state lv${top}`;
  st.textContent = n ? `${n} need${n > 1 ? '' : 's'} attention` : top === 1 ? 'Watching' : 'All clear';
}

// ------------------------------------------------------------------ pipeline strip
export function renderStrip(S, fr) {
  const ws = Object.values(fr.workers);
  const avgQ = mean(ws.map((w) => w.hrQuality));
  const faults = ws.filter((w) => w.hrFlags.some((f) => f !== 'spike') || w.hrQuality < 0.8).length;
  const sens = sensorList(S, fr);
  const online = sens.filter((s) => s.bars > 0).length;
  setStage('st1', online < sens.length ? 1 : avgQ > 0.9 ? 0 : avgQ > 0.6 ? 1 : 2, online === sens.length ? `${sens.length} sensors online` : `${online} of ${sens.length} online`,
    `Signal ${Math.round(avgQ * 100)}%${faults ? ` · ${faults} fault${faults > 1 ? 's' : ''} handled` : ''}`, (online / sens.length) * 100);

  const wb = fr.site.thermal.sun.wbgt;
  if (S.scn.cold) {
    const wc = fr.site.windChill, cc = coldCategory(wc);
    setStage('st2', cc[1], `Wind chill ${Math.round(wc)} °C`, `${cc[0]}${fr.site.pm.level ? ' + dust' : ''}`, clamp(-wc / 55, 0, 1) * 100);
  } else {
    const cat = wb < 25 ? ['Low', 0] : wb < 28 ? ['Moderate', 0] : wb < 31 ? ['High', 1] : wb < 33 ? ['Very high', 2] : ['Extreme', 3];
    setStage('st2', cat[1], `WBGT ${f1(wb)} °C`, `${cat[0]} heat load${fr.site.pm.level ? ' + dust' : ''}`, clamp((wb - 20) / 16, 0, 1) * 100);
  }

  const top = ws.reduce((a, b) => (b.psi > a.psi ? b : a), ws[0]);
  const maxLv = Math.max(...ws.map((w) => w.level));
  setStage('st3', maxLv, `Peak strain ${f1(top.psi)} / 10`, `${first(profileOf(S, top.id).name)} · core ${f1(top.tc)} °C`, top.psi * 10);

  const nW = ws.filter((w) => w.level === 2).length, nD = ws.filter((w) => w.level === 3).length;
  setStage('st4', maxLv, `${nW} warning · ${nD} danger`,
    S.blackout ? `Link down · ${S.relay.queued} queued` : `Link ok · ${S.relay.sent} relayed`, (ws.filter((w) => w.level >= 2).length / ws.length) * 100);
}
function setStage(id, lvl, metric, sub, pct) {
  const el = $('#' + id);
  el.className = `stage lv${lvl}`;
  $('#' + id + '-m').textContent = metric;
  $('#' + id + '-s').textContent = sub;
  el.style.setProperty('--pct', `${clamp(pct, 0, 100)}%`);
}

// ------------------------------------------------------------------ crew list
export function buildCrew(S) {
  const root = $('#crew-list');
  root.innerHTML = '';
  for (const w of S.scn.workers) {
    const p = w.profile;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ci lv0';
    b.dataset.id = p.id;
    b.setAttribute('aria-pressed', 'false');
    b.innerHTML = `<span class="av">${esc(p.name[0])}</span>
      <span class="ci-l"><span class="nm">${esc(p.name)}</span><span class="rl">${esc(p.role)}</span><span class="bdg"></span></span>
      <span class="ci-r"><span class="ci-tc"><span class="hrx" hidden>${ICON.wifiOff}</span><span class="tcv">--</span><small>°C</small></span><span class="ttt"></span><span class="sp"></span></span>`;
    root.append(b);
  }
}

export function updateCrew(S, fr) {
  const fs = frames(S);
  let nAlert = 0;
  for (const card of $('#crew-list').children) {
    const id = card.dataset.id;
    const w = fr.workers[id];
    card.className = `ci lv${w.level}`;
    card.setAttribute('aria-pressed', String(id === S.sel));
    $('.bdg', card).innerHTML = badge(w.level);
    $('.tcv', card).textContent = f1(w.tc);
    const silent = Math.round(w.minutesWithoutHr || 0);
    const hrx = $('.hrx', card);
    hrx.hidden = silent < 3;
    if (silent >= 3) hrx.title = `Heart-rate strap silent for ${agoText(silent)}. The estimate is running on the environment model.`;
    const t = w.ttt385;
    $('.ttt', card).textContent = w.tc >= 38.5 ? 'over 38.5' : t != null && t <= 60 ? `38.5 in ${Math.max(1, Math.round(t))} min` : '';
    const from = Math.max(0, S.idx - 90);
    const vals = [];
    for (let i = from; i <= S.idx; i += 3) vals.push(fs[i].workers[id].tc);
    $('.sp', card).innerHTML = sparkline(vals, { color: 'var(--lvl)' });
    if (w.level >= 2) nAlert++;
  }
  $('#crew-sum').textContent = nAlert ? `${nAlert} need attention` : 'All within range';
}

// ------------------------------------------------------------------ selected worker
export function renderDetail(S, fr) {
  const id = S.sel;
  const w = fr.workers[id];
  const p = profileOf(S, id);
  const cl = CLOTHING[p.clothing] || CLOTHING.coverall;
  const lv = w.level;

  const tags = [
    p.acclimatized ? 'Acclimatised' : 'Not acclimatised',
    cl.label,
    `${w.activityLabel} work`,
    zoneLabel(S, w.zone),
  ];
  const detail = `Age ${p.age} · resting heart rate ${p.restHr} bpm · ${w.M} W metabolic rate${cl.adj ? ` · clothing adds ${cl.adj} °C to WBGT` : ''}`;
  $('#d-head').className = `d-head lv${lv}`;
  $('#d-head').innerHTML = `<span class="av lg lv${lv}">${esc(p.name[0])}</span>
    <div class="d-who"><h2>${esc(p.name)}</h2><p>${esc(p.role)}</p></div>${badge(lv, { big: true })}
    <p class="d-tags" title="${esc(detail)}">${tags.map(esc).join(' · ')}</p>`;

  // hero + KPIs
  const t = w.ttt385;
  let val, unit = 'min', heroLabel = 'Time to 38.5 °C', note;
  if (w.tc >= 38.5) { val = 'Now'; unit = ''; note = 'Estimated core temperature is at or above 38.5 °C'; }
  else if (t != null && t <= 60) { val = String(Math.max(1, Math.round(t))); note = 'Forecast if work and conditions stay the same'; }
  else { val = '60+'; note = 'No crossing forecast in the next hour'; }
  if (S.scn.cold) {
    heroLabel = 'Frostbite window'; unit = 'min';
    const left = w.coldTf != null ? Math.max(0, Math.round(w.coldTf - w.coldMin)) : null;
    if (w.zone === 'cabin') { val = 'Warm'; unit = ''; note = `Heated cabin. Wind chill outside ${Math.round(w.coldWc)} °C`; }
    else if (w.coldWc > -15) { val = 'None'; unit = ''; note = 'Wind chill is above -15 °C'; }
    else if (left == null) { val = '30+'; note = `Wind chill ${Math.round(w.coldWc)} °C; ${w.coldMin} min outdoors`; }
    else { val = left === 0 ? 'Now' : String(left); if (left === 0) unit = ''; note = `Exposed skin at wind chill ${Math.round(w.coldWc)} °C; ${w.coldMin} min outdoors`; }
  }
  if (w.hazard === 'gas' && lv >= 2 && w.gas.inst != null) {
    heroLabel = 'Breathing-zone H<sub>2</sub>S';
    val = f1(w.gas.inst, w.gas.inst >= 10 ? 0 : 1); unit = 'ppm';
    note = `10-min average ${f1(w.gas.mean10)} ppm. OSHA ceiling 20 ppm`;
  }
  const diff = w.wbgtEff - w.limit;
  const slope = `${w.slopePerHour >= 0 ? '+' : '-'}${f1(Math.abs(w.slopePerHour))} °C/h`;
  const kpis = [
    kpi('Core temp', f1(w.tc), '°C', `±${f1(1.645 * w.tcSd, 2)} · ${slope}`),
    hrKpi(S, w, id),
    kpi('Strain', f1(w.psi), '/ 10', w.psiCat, w.psi * 10, lv),
    S.scn.cold
      ? kpi('Wind chill', String(Math.round(w.coldWc)), '°C', w.coldTf != null ? `Frostbite in ~${Math.round(w.coldTf)} min` : 'No frostbite risk')
      : kpi('Heat vs limit', `${diff >= 0 ? '+' : ''}${f1(diff)}`, '°C', `WBGT ${f1(w.wbgtEff)} · limit ${f1(w.limit)}`),
  ];
  if (S.scn.hasGas) kpis.push(kpi('H<sub>2</sub>S now', f1(w.gas.inst ?? 0), 'ppm', `Avg ${f1(w.gas.mean10)} · peak ${f1(w.gas.peak)}`));
  const hero = $('#d-hero');
  hero.style.setProperty('--n', String(kpis.length));
  hero.innerHTML = `<div class="kpi hero lv${lv}"><span class="k-lab">${heroLabel}</span><span class="k-val">${val}<small>${unit}</small></span><span class="k-note">${note}</span></div>${kpis.join('')}`;

  // why / what to do
  const why = lv === 0
    ? '<li class="none">No active alert.</li>'
    : w.reasons.slice(0, 3).map((r) => `<li>${esc(r)}</li>`).join('');
  $('#d-why').className = `d-box lv${lv}`;
  $('#d-why').innerHTML = `<h3 class="eyebrow">Why</h3><ul class="bul">${why}</ul>`;
  let acts = w.actions.slice(0, 3);
  if (lv === 0 && S.scn.cold) acts = ['Keep skin covered, stay dry and take warm-up breaks on schedule.'];
  else if (lv === 0) acts = [diff > -2 ? `Hydrate regularly. If conditions worsen, work ${w.plan.workMin} / rest ${w.plan.restMin} min per hour.` : 'Nothing needed. Keep hydrating.'];
  $('#d-act').className = `d-box lv${lv}`;
  $('#d-act').innerHTML = `<h3 class="eyebrow">What to do</h3><ul class="bul">${acts.map((a) => `<li${lv === 0 ? ' class="none"' : ''}>${esc(a)}</li>`).join('')}</ul>`;

  // wearable preview
  const clk = clock(S.scn.startLocalH, S.idx);
  let wv, wa;
  const over = w.tc >= 38.5;
  if (lv === 3) { wv = w.hazard === 'gas' ? 'EVACUATE' : w.hazard === 'cold' ? 'GET INSIDE' : w.hazard === 'air' ? 'MASK UP' : 'COOL NOW'; wa = w.actions[0] || ''; }
  else if (lv === 2) { wv = w.hazard === 'gas' ? 'MOVE' : w.hazard === 'cold' ? 'WARM UP' : w.hazard === 'air' ? 'MASK UP' : over ? 'NOW' : t != null && t <= 60 ? `T-${Math.max(1, Math.round(t))}` : 'REST'; wa = w.actions[0] || ''; }
  else if (lv === 1) { wv = over ? 'NOW' : t != null && t <= 60 ? `T-${Math.max(1, Math.round(t))}` : 'WATCH'; wa = 'Hydrate; plan a shade break'; }
  else { wv = 'OK'; wa = 'All clear'; }
  $('#d-watch').innerHTML = `<div class="watch lv${lv}${lv >= 2 ? ' pulse' : ''}" role="img" aria-label="Wearable alert preview: ${LEVEL_LABEL[lv]}">
      <div class="wt">${clk}</div><div class="wl">${ICON[LEVEL_ICON[lv]]}${LEVEL_LABEL[lv]}</div>
      <div class="wv">${esc(wv)}</div><div class="wa">${esc(wa.length > 62 ? wa.slice(0, 60) + '...' : wa)}</div></div>`;

  // the lead-time comparison is scored against the true core temperature, so it only applies to heat strain
  const lower = $('#d-lower');
  lower.classList.toggle('solo', !!S.scn.cold);
  $('#d-race').parentElement.hidden = !!S.scn.cold;
  if (!S.scn.cold) $('#d-race').innerHTML = raceSvg(S, id);
}

const agoText = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`);

/**
 * Heart-rate card. The headline is the latest accepted reading (not a smoothed average), a micro-trace shows the last
 * half hour with a gap wherever the strap was silent, and the last line says how long ago the reading arrived.
 * The strap reports once a minute, so "now" means "this minute's reading".
 */
function hrKpi(S, w, id) {
  const fs = frames(S);
  const age = Math.max(0, Math.round(w.minutesWithoutHr || 0));
  const state = age === 0 ? 'fresh' : age < 3 ? 'late' : 'lost';
  const lastT = Math.max(0, S.idx - age);
  const val = age === 0 ? w.hr : fs[lastT]?.workers[id]?.hr;
  const shown = val != null ? String(Math.round(val)) : '--';
  const text = state === 'fresh' ? 'Updated now' : state === 'late' ? `Updated ${age} min ago` : `Last update ${agoText(age)} ago`;
  const pts = [];
  for (let i = Math.max(0, S.idx - 29); i <= S.idx; i++) pts.push(fs[i].workers[id].hr);
  const known = pts.filter((v) => v != null);
  const mid = known.length ? (Math.min(...known) + Math.max(...known)) / 2 : 100;
  const half = Math.max(10, known.length ? (Math.max(...known) - Math.min(...known)) / 2 + 3 : 10);
  const spark = sparkline(pts, { w: 100, h: 20, color: state === 'lost' ? 'var(--muted)' : 'var(--s2)', lo: mid - half, hi: mid + half, ref: null });
  const tip = `Last reading ${clock(S.scn.startLocalH, lastT)}${val != null ? `: ${shown} bpm` : ''}. The strap reports once a minute.`;
  const phase = -Math.round(performance.now() % 1600); // keeps the pulse continuous although the card is redrawn every frame
  return `<div class="kpi hr ${state}" title="${esc(tip)}"><span class="k-lab">Heart rate${state === 'lost' ? '<span class="tag">No signal</span>' : ''}</span>
    <span class="k-val">${shown}<small>bpm</small></span><span class="k-spark">${spark}</span>
    <span class="k-note live"><i class="live-dot" style="animation-delay:${phase}ms"></i>${esc(text)}</span></div>`;
}

function kpi(lab, val, unit, sub, meter, lvl) {
  return `<div class="kpi${lvl != null ? ' lv' + lvl : ''}"><span class="k-lab">${lab}</span><span class="k-val">${val}<small>${unit}</small></span><span class="k-note">${esc(sub)}</span>${meter != null ? `<span class="meter"><i style="width:${clamp(meter, 0, 100)}%"></i></span>` : ''}</div>`;
}

// ------------------------------------------------------------------ warning lead time ("how early?")
function raceSvg(S, id) {
  const fs = frames(S), idx = S.idx, dur = S.scn.durationMin;
  const w = fs[idx].workers[id];
  let tTrue = null;
  for (let i = 0; i <= idx; i++) if (fs[i].workers[id].truth && fs[i].workers[id].truth.tc >= 38.5) { tTrue = i; break; }
  const g = w.first.geos;
  let sum;
  if (g == null) sum = tTrue != null ? '<div class="race-sum late"><b>No warning</b> was raised before the true crossing</div>' : '<div class="race-sum">No heat warning yet</div>';
  else if (tTrue != null) {
    const lead = tTrue - g;
    sum = lead > 0 ? `<div class="race-sum">Warned <b>${lead} min</b> before the true 38.5 °C crossing</div>`
      : lead < 0 ? `<div class="race-sum late">Warned <b>${-lead} min</b> after the true crossing</div>` : '<div class="race-sum">Warned at the true crossing</div>';
  } else sum = `<div class="race-sum">Warned at <b>${clock(S.scn.startLocalH, g)}</b></div>`;

  const rows = [
    ['geos', 'GEOS', 'var(--accent)'],
    ['staticWbgt', 'Static WBGT', 'var(--ink-2)'],
    ['hr', 'HR ≥ 85% max', 'var(--ink-2)'],
    ['buller', 'HR-only Kalman', 'var(--ink-2)'],
  ];
  const W = 560, labW = 112, x0 = labW + 12, x1 = W - 14, rowH = 31, top = 24, H = top + rows.length * rowH + 20;
  const X = (t) => x0 + (t / dur) * (x1 - x0);
  let o = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="When each method first raised an alarm for ${esc(profileOf(S, id).name)}" style="display:block;overflow:visible">`;
  for (let m = 0; m <= dur; m += 60) {
    o += `<line x1="${X(m)}" x2="${X(m)}" y1="${top - 6}" y2="${top + rows.length * rowH - 4}" stroke="var(--grid)"/><text class="ax" x="${X(m)}" y="${H - 5}" text-anchor="middle">${clock(S.scn.startLocalH, m)}</text>`;
  }
  const crewN = Object.keys(fs[idx].workers).length;
  rows.forEach(([k, label, color], i) => {
    const y = top + i * rowH + rowH / 2 - 4;
    const hit = Object.values(fs[idx].workers).filter((x) => x.first[k] != null).length;
    o += `<text class="${k === 'geos' ? 'lbl-strong' : 'lbl'}" x="0" y="${y + 1}">${esc(label)}</text>`;
    o += `<text class="ax" x="0" y="${y + 13}">alarmed ${hit} of ${crewN}</text>`;
    o += `<line x1="${x0}" x2="${X(idx)}" y1="${y}" y2="${y}" stroke="var(--axis)"/>`;
    const t = w.first[k];
    if (t != null) {
      const x = X(t);
      const lead = tTrue != null ? tTrue - t : null;
      const txt = `${clock(S.scn.startLocalH, t)}${lead != null ? (lead > 0 ? ` · ${lead} min early` : lead < 0 ? ` · ${-lead} min late` : ' · at crossing') : ''}`;
      const left = x > x1 - 140;
      o += `<path d="M${x} ${y - 7}l7 7l-7 7l-7 -7z" fill="${color}" stroke="var(--surface-2)" stroke-width="2"/>`;
      o += `<text class="${k === 'geos' ? 'lbl-strong' : 'lbl'}" x="${left ? x - 12 : x + 12}" y="${y + 4}" text-anchor="${left ? 'end' : 'start'}">${esc(txt)}</text>`;
    } else {
      o += `<text class="ax" x="${x0 + 6}" y="${y + 4}">no alarm yet</text>`;
    }
  });
  if (tTrue != null) {
    const x = X(tTrue);
    o += `<line x1="${x}" x2="${x}" y1="${top - 8}" y2="${top + rows.length * rowH - 4}" stroke="var(--crit)" stroke-width="2"/><text class="lbl" x="${x}" y="${top - 11}" text-anchor="${x > x1 - 110 ? 'end' : 'middle'}" style="fill:var(--ink)">true 38.5 °C crossing</text>`;
  }
  return sum + o + '</svg>';
}

// ------------------------------------------------------------------ charts (one card, three tabs)
export function buildCharts(S) {
  const fmtX = (v) => clock(S.scn.startLocalH, v);
  S.charts.core = new LineChart($('#ch-core'), { height: 292, xFormat: fmtX, yFormat: (v) => v.toFixed(1), yUnit: ' °C', ariaLabel: 'Estimated core temperature with one-hour forecast' });
  S.charts.hr = new LineChart($('#ch-hr'), { height: 292, margin: { l: 44, r: 62, t: 12, b: 26 }, xFormat: fmtX, yFormat: (v) => String(Math.round(v)), yUnit: ' bpm', ariaLabel: 'Heart rate' });
  S.charts.exp = new LineChart($('#ch-exp'), { height: 292, margin: { l: 44, r: 62, t: 12, b: 26 }, xFormat: fmtX, yFormat: (v) => v.toFixed(1), yUnit: ' °C', ariaLabel: 'Heat exposure against personal limit' });
}

export function updateCharts(S) {
  const fs = frames(S), idx = S.idx, id = S.sel, dur = S.scn.durationMin;
  const ws = [];
  for (let i = 0; i <= idx; i++) ws.push(fs[i].workers[id]);
  const cur = ws[idx];
  const p = profileOf(S, id);
  // rolling window: 150 min of history + 75 min of forecast, shared by all tabs so time axes line up
  let wx0 = Math.max(0, idx - 150), wx1 = wx0 + 225;
  if (wx1 > dur + 60) { wx1 = dur + 60; wx0 = Math.max(0, wx1 - 225); }

  if (S.tab === 'core') {
    const tcPts = ws.map((w, i) => [i, w.tc]);
    const band = ws.map((w, i) => [i, w.tc - 1.645 * w.tcSd, w.tc + 1.645 * w.tcSd]);
    const fPts = cur.forecast.map((q) => [idx + q.t, q.tc]);
    const fBand = cur.forecast.map((q) => [idx + q.t, q.tc - 1.645 * q.sd, q.tc + 1.645 * q.sd]);
    const vlines = [];
    ws.forEach((w, i) => { if (w.change && w.change.to > w.change.from && w.change.to >= 1) vlines.push({ x: i, color: LV_COLOR[w.change.to], label: `${LEVEL_LABEL[w.change.to]} ${clock(S.scn.startLocalH, i)}` }); });
    const series = [
      { id: 'est', label: 'Estimated core temp', color: 'var(--s1)', points: tcPts, primary: true, endDot: true },
      { id: 'fc', label: 'Forecast (conditions persist)', color: 'var(--s1)', points: fPts, dash: '2 5', width: 2, opacity: 0.9 },
    ];
    if (S.showTruth) series.push({ id: 'truth', label: 'True core temp (simulator)', color: 'var(--s2)', points: ws.map((w, i) => [i, w.truth ? w.truth.tc : null]), width: 1.5 });
    S.charts.core.setData({
      series, xDomain: [wx0, wx1], xTick: 30, yDomain: [36.6, 40.4], yTicks: [37, 38, 39, 40], nowX: idx, vlines,
      bands: [{ id: 'b', label: '90% band', color: 'var(--s1)', points: band, opacity: 0.14, tip: true }, { id: 'fb', label: 'Forecast band', color: 'var(--s1)', points: fBand, opacity: 0.08 }],
      hlines: [{ y: 38.0, label: '38.0', color: 'var(--warn)' }, { y: 38.5, label: '38.5', color: 'var(--serious)' }, { y: 39.0, label: '39.0', color: 'var(--crit)' }],
      tipSuffix: () => '',
    });
    $('#chart-legend').innerHTML = `<span style="--c:var(--s1)"><i></i>Estimated</span><span style="--c:var(--s1)"><i class="dotted"></i>Forecast</span><span style="--c:var(--s1)"><i class="wash"></i>90% band</span>${S.showTruth ? '<span style="--c:var(--s2)"><i></i>True (simulator)</span>' : ''}`;
  } else if (S.tab === 'hr') {
    const hrRaw = ws.map((w, i) => [i, w.hrRaw]);
    const hrSm = ws.map((w, i) => [i, w.hrSmooth]);
    const lostBands = [];
    let s0 = null;
    ws.forEach((w, i) => {
      const lost = w.hrRaw == null;
      if (lost && s0 == null) s0 = i;
      if ((!lost || i === ws.length - 1) && s0 != null) { if (i - s0 >= 3) lostBands.push({ id: 'l' + s0, label: 'Sensor lost', color: 'var(--muted)', opacity: 0.18, points: [[s0, 40, 210], [i, 40, 210]] }); s0 = null; }
    });
    S.charts.hr.setData({
      series: [
        { id: 'raw', label: 'Raw sensor', color: 'var(--muted)', points: hrRaw, dots: true, r: 1.8, opacity: 0.7 },
        { id: 'filt', label: 'Filtered', color: 'var(--s2)', points: hrSm, primary: true, endDot: true },
      ],
      xDomain: [wx0, wx1], xTick: 30, yDomain: [40, 210], yTicks: [60, 100, 140, 180], nowX: idx, bands: lostBands, vlines: [],
      hlines: [{ y: 0.85 * (220 - p.age), label: '85%', color: 'var(--axis)' }],
    });
    $('#chart-legend').innerHTML = '<span style="--c:var(--s2)"><i></i>Filtered</span><span style="--c:var(--muted)"><i class="dotk"></i>Raw</span><span style="--c:var(--muted)"><i class="wash"></i>Sensor lost</span>';
  } else if (S.scn.cold) {
    S.charts.exp.setData({
      series: [{ id: 'wc', label: 'Wind chill', color: 'var(--s1)', points: ws.map((_, i) => [i, fs[i].site.windChill]), primary: true, endDot: true }],
      xDomain: [wx0, wx1], xTick: 30, yDomain: [-56, -4], yTicks: [-50, -40, -30, -20, -10], nowX: idx, vlines: [], bands: [],
      hlines: [{ y: -15, label: '-15', color: 'var(--warn)' }, { y: -27, label: '-27', color: 'var(--serious)' }, { y: -40, label: '-40', color: 'var(--crit)' }],
    });
    $('#chart-legend').innerHTML = '<span style="--c:var(--s1)"><i></i>Wind chill (°C)</span><span style="--c:var(--serious)"><i></i>Frostbite in 30 min</span><span style="--c:var(--crit)"><i></i>in 10 min</span>';
  } else {
    const wb = ws.map((w, i) => [i, w.wbgtEff]);
    const lim = ws.map((w, i) => [i, w.limit]);
    const over = ws.map((w, i) => [i, w.limit, Math.max(w.limit, w.wbgtEff)]);
    S.charts.exp.setData({
      series: [
        { id: 'w', label: 'WBGT felt (incl. clothing)', color: 'var(--s1)', points: wb, primary: true, endDot: true },
        { id: 'l', label: 'NIOSH limit for current work', color: 'var(--s2)', points: lim, dash: '6 4' },
      ],
      xDomain: [wx0, wx1], xTick: 30, yDomain: [15, 38], yTicks: [20, 25, 30, 35], nowX: idx, vlines: [],
      bands: [{ id: 'o', label: 'Over limit', color: 'var(--serious)', points: over, opacity: 0.24 }],
      hlines: [],
    });
    $('#chart-legend').innerHTML = '<span style="--c:var(--s1)"><i></i>WBGT felt</span><span style="--c:var(--s2)"><i class="dash"></i>Limit</span><span style="--c:var(--serious)"><i class="wash"></i>Over limit</span>';
  }
}

// ------------------------------------------------------------------ site card
export function renderSite(S, fr) {
  const e = fr.site.env, th = fr.site.thermal;
  const cold = !!S.scn.cold;
  const wb = th.sun.wbgt;
  const wc = fr.site.windChill;
  const heatCat = wb < 25 ? ['Low', 0] : wb < 28 ? ['Moderate', 0] : wb < 31 ? ['High', 1] : wb < 33 ? ['Very high', 2] : ['Extreme', 3];
  const cat = cold ? coldCategory(wc) : heatCat;
  const big = cold ? wc : wb;
  const lo = cold ? -50 : 18, hi = cold ? 0 : 38, W = 284;
  const X = (v) => 6 + ((clamp(v, lo, hi) - lo) / (hi - lo)) * (W - 12);
  const marks = cold
    ? [[-15, 'Cold'], [-27, 'Severe'], [-40, 'Extreme']]
    : [[wbgtLimit(415, false), 'Heavy'], [wbgtLimit(300, false), 'Mod.'], [wbgtLimit(300, true), 'Mod. acc.'], [wbgtLimit(180, true), 'Light acc.']];
  const fillX = cold ? W - 6 - (X(big) - 6) : X(big); // wind chill fills from the cold end
  let scale = `<svg viewBox="0 0 ${W} 72" role="img" aria-label="${cold ? 'Wind chill' : 'WBGT'} ${f1(big)} on its risk scale">
    <rect x="6" y="20" width="${W - 12}" height="8" rx="4" fill="var(--surface-3)"/>
    ${cold ? `<rect x="${X(big)}" y="20" width="${W - 6 - X(big)}" height="8" rx="4" fill="${LV_COLOR[cat[1]]}"/>` : `<rect x="6" y="20" width="${fillX - 6}" height="8" rx="4" fill="${LV_COLOR[cat[1]]}"/>`}
    <circle cx="${X(big)}" cy="24" r="8" fill="var(--surface)"/><circle cx="${X(big)}" cy="24" r="5.5" fill="${LV_COLOR[cat[1]]}"/>`;
  marks.forEach(([v, lab], i) => {
    const row = i % 2;
    scale += `<line x1="${X(v)}" x2="${X(v)}" y1="32" y2="${42 + row * 12}" stroke="var(--axis)"/><text class="ax" x="${X(v)}" y="${53 + row * 12}" text-anchor="middle">${lab} ${f1(v, 0)}</text>`;
  });
  scale += '</svg>';
  const stat = (l, v, u, sub) => `<div class="stat"><span class="st-lab">${l}</span><span class="st-val">${sub ? `<em>${esc(sub)}</em>` : ''}${v}<small>${u}</small></span></div>`;
  const zl = S.scn.zoneLabels || {};
  const chips = cold
    ? `<span class="chip">${zl.cabin || 'Cabin'} ${f1(fr.site.zones.cabin)} °C</span>`
    : `<span class="chip">${zl.shade || 'Shade'} ${f1(th.shade.wbgt)} °C</span><span class="chip">${zl.cabin || 'Cabin'} ${f1(fr.site.zones.cabin)} °C</span>${fr.site.zones.machinery != null ? `<span class="chip">Engine room ${f1(fr.site.zones.machinery)} °C</span>` : ''}`;
  const cap = cold ? 'Wind chill, what exposed skin feels' : S.scn.underground ? 'WBGT at the coal face, what a worker feels' : 'WBGT in full sun, what a worker feels';
  const rows = cold
    ? [stat('Air temperature', f1(e.tAirC), '°C'), stat('Wind', f1(e.wind10m), 'm/s'), stat('Humidity', Math.round(e.rhPct), '%'), stat('Sun elevation', Math.round(fr.site.geom.elevationDeg), '°')]
    : S.scn.underground
      ? [stat('Air temperature', f1(e.tAirC), '°C'), stat('Humidity', Math.round(e.rhPct), '%'), stat('Airflow', f1(e.wind10m), 'm/s'), stat('Dust PM10', Math.round(e.pm10), 'µg/m³', fr.site.pm.advisory ? fr.site.pm.label : ''), stat('Pressure', Math.round(e.pressureHpa), 'hPa')]
      : [stat('Air temperature', f1(e.tAirC), '°C'), stat('Humidity', Math.round(e.rhPct), '%'), stat('Wind', f1(e.wind10m), 'm/s'), stat('Sunshine', Math.round(e.solarWm2), 'W/m²'),
        stat('Dust PM10', Math.round(e.pm10), 'µg/m³', fr.site.pm.advisory ? fr.site.pm.label : ''), S.scn.hasGas ? stat('Area H<sub>2</sub>S', f1(e.h2sAreaPpm ?? 0), 'ppm') : stat('Sun elevation', Math.round(fr.site.geom.elevationDeg), '°')];
  $('#site-body').innerHTML = `
    <div class="site-main">
      <div><div class="wb-row"><span class="wb-num">${cold ? Math.round(big) : f1(big)}<small>°C</small></span>${badge(cat[1], { label: cat[0].toUpperCase() })}</div>
      <div class="wb-cap">${cap}</div></div>
      <div class="scale">${scale}</div>
      <div class="chips">${chips}</div>
    </div>
    <div class="stats">${rows.join('')}</div>`;
  $('#site-place').textContent = S.plant.place;
}
// ------------------------------------------------------------------ run log (feeds the notifications and the scrubber ticks)
export function buildRunLog(run) {
  const log = [];
  for (const n of run.scn.narrative || []) log.push({ t: n.t, kind: 'narr', text: n.text });
  for (const fr of run.frames) {
    for (const ev of fr.site.events) log.push({ t: fr.t, kind: 'site', text: ev.text, severity: ev.severity, ev: ev.kind });
    for (const [id, w] of Object.entries(fr.workers)) {
      if (w.change) log.push({ t: fr.t, kind: 'alert', id, from: w.change.from, to: w.change.to, title: w.change.title, hazard: w.change.hazard, reasons: w.change.reasons, actions: w.change.actions });
    }
  }
  log.sort((a, b) => a.t - b.t || (a.kind === 'narr' ? -1 : 1));
  return log;
}

// ------------------------------------------------------------------ benchmark dialog
export function renderBench(body, data, { onRerun, busy } = {}) {
  if (!data) { body.innerHTML = '<p>Benchmark data not found. Run <code>npm run bench</code>.</p>'; return; }
  const m = data.summary.methods, s = data.summary;
  const pc = (x) => (x == null ? 'n/a' : Math.round(100 * x) + '%');
  const cl = data.closedLoop;
  const reduction = cl && cl.open.exceed385 ? Math.round((100 * (cl.open.exceed385 - cl.closed.exceed385)) / cl.open.exceed385) : null;
  const nice = (s) => String(s).replace(/>=/g, '≥').replace(/(\d) C\b/g, '$1 °C');
  const rows = ['geos', 'staticWbgt', 'buller', 'hr'].map((k) => {
    const r = m[k];
    return `<tr class="${k === 'geos' ? 'me' : ''}"><td>${esc(nice(r.label))}</td><td>${pc(r.sensitivity)}</td><td>${pc(r.sensitivity10)}</td><td>${r.medianLead == null ? 'n/a' : Math.round(r.medianLead) + ' min'}</td><td>${pc(r.falseAlarmRate)}</td></tr>`;
  }).join('');
  const bins = new Array(10).fill(0);
  for (const l of m.geos.leads || []) bins[Math.min(9, Math.floor(l / 10))]++;
  const bMax = Math.max(1, ...bins);
  const hist = bins.map((c, i) => `<div class="col" title="${c} cases"><span>${c || ''}</span><i style="height:${(c / bMax) * 78}px"></i><span>${i * 10}${i === 9 ? '+' : ''}</span></div>`).join('');
  body.innerHTML = `
    <p>${s.n} randomised worker-shifts across 7 sites, scored against the simulator's hidden core temperature. Parameters were tuned on seeds ${esc(data.calibrationSeeds)} and tested on held-out seeds ${esc(data.seeds)}.</p>
    <div class="bkpis">
      <div class="bk"><div class="v">${pc(m.geos.sensitivity)}</div><div class="l">of unsafe episodes warned <b>before</b> they happened (${s.nUnsafe} episodes)</div></div>
      <div class="bk"><div class="v">${m.geos.medianLead == null ? 'n/a' : Math.round(m.geos.medianLead) + ' min'}</div><div class="l">median head start</div></div>
      <div class="bk"><div class="v">${pc(m.geos.falseAlarmRate)}</div><div class="l">false alarms on safe workers, against <b>${pc(m.staticWbgt.falseAlarmRate)}</b> for a static WBGT alarm</div></div>
      ${reduction != null ? `<div class="bk"><div class="v">${reduction}% fewer</div><div class="l">workers reached unsafe temperatures when they followed the advice (${cl.open.exceed385} to ${cl.closed.exceed385} of ${data.closedLoopN})</div></div>` : ''}
    </div>
    <table class="cmp"><thead><tr><th>Method</th><th>Warned in advance</th><th>≥ 10 min early</th><th>Median head start</th><th>False alarms</th></tr></thead><tbody>${rows}</tbody></table>
    <h3>Head start (minutes before the true crossing)</h3>
    <div class="hist" role="img" aria-label="Histogram of GEOS lead times">${hist}</div>
    <p class="small muted" style="margin-top:10px">Core-temperature error against truth (RMSE): fusion <b>${s.rmse.fusion.toFixed(2)} °C</b>, heart-rate-only ${s.rmse.hrOnly.toFixed(2)} °C, environment-only ${s.rmse.prior.toFixed(2)} °C.</p>
    <div class="note"><b>Read this honestly.</b> The benchmark is synthetic: a separate heat-balance simulator stands in for reality. It tests the algorithm's logic under noise, sensor faults and model mismatch. It is not clinical validation, and real wearables will be noisier.</div>
    <div style="margin-top:14px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">
      <button class="btn primary" type="button" id="bench-rerun" ${busy ? 'disabled' : ''}>Re-run in this browser (about 5 s)</button>
      <span class="small muted">Generated ${esc((data.generated || '').slice(0, 19).replace('T', ' '))} UTC. Seeds are fixed, so the numbers reproduce.</span>
    </div>
    <div class="progress" id="bench-prog" hidden><i></i></div>`;
  const btn = body.querySelector('#bench-rerun');
  if (btn) btn.onclick = onRerun;
}
