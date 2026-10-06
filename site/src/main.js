// GEOS dashboard controller: loads a plant, runs the engine over it, plays it back.
// The engine is the same streaming code you would run on a phone: monitor.step(sample) once a minute.

import { $, $$, f1, clock, safeStorage } from './ui/dom.js';
import { ICON } from './ui/icons.js';
import { Monitor } from './engine/pipeline.js';
import { buildScenario, buildLiveScenario, runScenarioSync } from './sim/scenarios.js';
import { evaluateCase, summarise } from './sim/cohort.js';
import { LIVE_LOCATIONS, loadDay } from './live/openmeteo.js';
import { PLANTS, plantById, hasShift, hasLive, legacyScenario } from './plants.js';
import { renderSensors, initTickets, loadTickets, updateTicketBadge } from './ui/sensors.js';
import {
  frames, profileOf, renderPlantChip, renderStrip, buildCrew, updateCrew, renderCrewTemps, renderDetail, buildCharts, updateCharts, renderSite,
  buildRunLog, renderBench,
} from './ui/views.js';
import { renderForecast } from './ui/forecast.js';
import { simOutlook, liveOutlook } from './outlook.js';
import { initSimPanel, initPlantPicker } from './ui/simpanel.js';
import { collectNotifications, renderNotifications, resetNotifications, initNotifications } from './ui/notifications.js';

const store = safeStorage();
const params = new URLSearchParams(location.search);
const RING = 175.93; // circumference of the minimised button's progress ring (r = 28)

const S = {
  plantId: 'jaisalmer', plant: PLANTS[0], src: 'sim', scn: null, seed: 1,
  runs: { ignored: null, followed: null }, mode: 'ignored',
  idx: 0, playing: false, speed: 6, acc: 0,
  sel: 'arjun', tab: 'core',
  showTruth: false, sound: false, blackout: false,
  relay: { queued: 0, sent: 0 },
  charts: {}, tableOn: {},
  read: new Set(), sys: [], nFilter: 'all', tickets: [], replaced: {}, tkFilter: 'all', sensorOpen: new Set(), outlook: null, _fr: null,
  live: { offset: 0, day: null },
};
let sim, picker, notif, loadToken = 0;

// ------------------------------------------------------------------ boot (init() is invoked at the end of this file)
async function init() {
  $('#logo').innerHTML = ICON.geos;
  $('#btn-bench').innerHTML = `${ICON.chart}<span>Benchmark</span>`;
  $('#btn-how').innerHTML = ICON.info;
  $('#bell-ico').innerHTML = ICON.bell;
  $('#tk-ico').innerHTML = ICON.ticket;
  $('#restart').innerHTML = ICON.reset;
  $('#chart-table').innerHTML = `${ICON.table}<span>Table</span>`;
  $$('[data-close]').forEach((b) => { b.innerHTML = ICON.close; b.onclick = () => b.closest('dialog').close(); });

  if (params.get('focus')) document.body.dataset.focus = params.get('focus');
  if (params.get('anim') === '0') document.documentElement.classList.add('no-anim');
  applyTheme(params.get('theme') || store.get('theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));

  sim = initSimPanel({ onOpenChange: () => notif && sim.avoid(notif.isOpen() ? $('#notif').offsetWidth : 0) });
  picker = initPlantPicker({
    plants: PLANTS,
    onPick: (id) => loadPlant(id, S.src === 'live' && hasLive(plantById(id)) ? 'live' : 'sim'),
  });
  notif = initNotifications({
    S, list: () => collectNotifications(S), redraw: renderAll,
    onJump: (t, id) => { S.idx = Math.min(maxIdx(), t); S.acc = 0; if (id) S.sel = id; renderAll(); },
    onToggle: (open) => sim.avoid(open ? $('#notif').offsetWidth : 0),
  });
  bind();

  S.speed = [2, 6, 15, 40].includes(Number(params.get('speed'))) ? Number(params.get('speed')) : 6;
  S.showTruth = params.get('truth') === '1';
  S.mode = params.get('follow') === '1' ? 'followed' : 'ignored';
  if (['core', 'hr', 'exp'].includes(params.get('tab'))) S.tab = params.get('tab');

  // ?plant=jaisalmer|platformb|shaybah|deathvalley&mode=sim|live (old ?scenario=thar|offshore|live links still work)
  let plantId = params.get('plant'), src = params.get('mode');
  const legacy = legacyScenario(params.get('scenario'));
  if (!plantId && legacy) { plantId = legacy.plant; src = src || legacy.src; }
  await loadPlant(PLANTS.some((p) => p.id === plantId) ? plantId : 'jaisalmer', src === 'live' ? 'live' : 'sim');

  if (params.get('worker') && S.scn.workers.some((w) => w.profile.id === params.get('worker'))) S.sel = params.get('worker');
  if (params.get('t')) S.idx = Math.min(maxIdx(), Math.max(0, Number(params.get('t')) | 0));
  if (params.get('blackout') === '1') setBlackout(true);
  syncControls();
  setTab(S.tab);
  renderAll();
  if (params.get('notif') === '1') notif.open();
  if (params.get('bench') === '1') openBench();
  if (params.get('how') === '1') $('#dlg-how').showModal();
  if (params.get('sensors') === '1') $('#st1').click();
  if (params.get('tickets') === '1') $('#btn-tickets').click();
  // A cold visitor should see the story unfold: autoplay unless a specific moment / paused state was requested.
  const auto = params.get('autoplay');
  if (auto === '1' || (auto == null && params.get('paused') !== '1' && !params.get('t') && !params.get('bench') && !params.get('how') && !params.get('notif'))) {
    setTimeout(() => setPlaying(true), 900);
  }

  requestAnimationFrame(loop);
  if ('serviceWorker' in navigator && location.protocol.startsWith('http') && params.get('nosw') !== '1') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  store.set('theme', t);
  $('#btn-theme').innerHTML = t === 'dark' ? ICON.sun : ICON.moon;
  $('#btn-theme').dataset.theme = t;
  if (S.scn) renderAll();
}

const maxIdx = () => (S.scn ? frames(S).length - 1 : 0);

// ------------------------------------------------------------------ plant loading
function setLiveStatus(text) { $('#live-status').textContent = text; }

async function loadPlant(plantId, src = 'sim') {
  const token = ++loadToken;
  setPlaying(false);
  let plant = plantById(plantId);
  const wantLive = hasLive(plant) && (src === 'live' || !hasShift(plant));
  let scn = null, usedSrc = 'sim';
  if (wantLive) {
    S.plant = plant; S.plantId = plant.id; S.src = 'live';
    syncControls();
    setLiveStatus('Fetching real conditions...');
    try {
      const loc = LIVE_LOCATIONS.find((l) => l.key === plant.live);
      const day = await loadDay(loc);
      if (token !== loadToken) return;
      S.live.day = { ...day, name: plant.name };
      scn = buildLiveScenario(S.live.day, plant.cold ? -S.live.offset : S.live.offset, { crew: plant.crew });
      usedSrc = 'live';
      const cur = day.current;
      setLiveStatus(`${day.offline ? `Offline snapshot, ${day.dateStr}` : `Live data, ${day.dateStr}`}. Replaying 08:00 to 17:00 local with a simulated crew.${cur ? ` At the site: ${f1(cur.temp)} °C, ${Math.round(cur.rh)}% RH, wind ${f1(cur.wind)} m/s.` : ''}`);
    } catch (e) {
      if (token !== loadToken) return;
      if (!hasShift(plant)) plant = plantById('jaisalmer');
      scn = buildScenario(plant.scenario);
      setLiveStatus(`Could not load live weather (${e.message}). Showing the simulated shift instead.`);
    }
  } else {
    scn = buildScenario(plant.scenario);
  }
  S.plant = plant; S.plantId = plant.id; S.src = usedSrc;
  S.scn = scn;
  const t0 = performance.now();
  S.runs.ignored = runScenarioSync(scn, Monitor, { seed: S.seed, followAdvice: false });
  S.runs.followed = runScenarioSync(scn, Monitor, { seed: S.seed, followAdvice: true });
  S.runs.ignored.log = buildRunLog(S.runs.ignored);
  S.runs.followed.log = buildRunLog(S.runs.followed);
  S.runMs = performance.now() - t0;
  S.idx = 0; S.acc = 0; S.relay = { queued: 0, sent: 0 }; S.read = new Set(); S.sys = []; S._chip = null; S.sensorOpen = new Set();
  loadTickets(S); // tickets are kept per plant in this browser
  resetNotifications();
  // tomorrow's outlook: simulated straight away, replaced by the real forecast when live weather is in use and reachable
  S.outlook = simOutlook(S);
  if (usedSrc === 'live') {
    const loc = LIVE_LOCATIONS.find((l) => l.key === plant.live);
    liveOutlook(S, loc).then((o) => { if (token === loadToken) { S.outlook = o; renderAll(); } })
      .catch(() => { if (token === loadToken) { S.outlook = { ...S.outlook, source: 'offline' }; renderAll(); } });
  }
  if (!scn.workers.some((w) => w.profile.id === S.sel)) S.sel = scn.workers[0].profile.id;
  $('#scrub').max = String(scn.durationMin - 1);
  buildCrew(S);
  if (!S.charts.core) buildCharts(S);
  buildTicks();
  syncControls();
  renderAll();
}

function buildTicks() {
  const el = $('#ticks');
  el.innerHTML = '';
  const dur = S.scn.durationMin;
  for (const l of S.runs[S.mode].log) {
    let cls = '', lv = null;
    if (l.kind === 'narr') cls = 'narr';
    else if (l.kind === 'alert' && l.to >= 2 && l.to > l.from) lv = l.to;
    else continue;
    const d = document.createElement('i');
    d.className = `tick ${cls}${lv != null ? ' lv' + lv : ''}`;
    d.style.left = `${(l.t / (dur - 1)) * 100}%`;
    d.title = l.kind === 'narr' ? l.text : `${l.title}`;
    el.append(d);
  }
}

// ------------------------------------------------------------------ rendering
let pending = false;
function renderAll() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => { pending = false; draw(); });
}

const hm = (m) => `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, '0')}`;

function draw() {
  if (!S.scn) return;
  const fr = frames(S)[S.idx];
  if (!fr) return;
  const dur = S.scn.durationMin;
  S._fr = fr;
  $('#clock').textContent = clock(S.scn.startLocalH, S.idx);
  const date = new Date(S.scn.startUtcMs + S.scn.tzMin * 60000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  $('#clock-sub').textContent = `${date} · ${hm(S.idx)} of ${hm(dur)}`;
  const scrub = $('#scrub');
  scrub.value = String(S.idx);
  scrub.style.setProperty('--p', `${(S.idx / (dur - 1)) * 100}%`);
  $('#fab-ring').style.strokeDashoffset = String(RING * (1 - S.idx / (dur - 1)));
  const top = Math.max(...Object.values(fr.workers).map((w) => w.level));
  const fab = $('#sim-fab');
  fab.dataset.level = String(top >= 3 ? 3 : top >= 2 ? 2 : 0);
  fab.classList.toggle('alert', top >= 3);

  renderPlantChip(S, fr);
  renderStrip(S, fr);
  updateCrew(S, fr);
  renderCrewTemps(S, fr);
  renderDetail(S, fr);
  updateCharts(S);
  renderSite(S, fr);
  renderForecast(S);
  updateTicketBadge(S);
  renderNotifications(S, collectNotifications(S));
  if ($('#dlg-sensors').open) renderSensors(S, fr);
}

// ------------------------------------------------------------------ playback
let last = performance.now();
let lastDraw = 0;
function loop(now) {
  const dt = Math.min(250, now - last);
  last = now;
  if (S.playing) {
    S.acc += (dt / 1000) * S.speed;
    const whole = Math.floor(S.acc);
    if (whole >= 1) {
      S.acc -= whole;
      const old = S.idx;
      S.idx = Math.min(S.idx + whole, maxIdx());
      announce(old, S.idx);
      if (now - lastDraw > 45 || S.idx >= maxIdx()) { lastDraw = now; renderAll(); }
      if (S.idx >= maxIdx()) setPlaying(false);
    }
  }
  requestAnimationFrame(loop);
}

function setPlaying(on) {
  if (on && S.scn && S.idx >= maxIdx()) { S.idx = 0; S.relay = { queued: 0, sent: 0 }; S.read = new Set(); S.sys = []; resetNotifications(); }
  S.playing = on;
  const label = on ? 'Pause' : S.scn && S.idx >= maxIdx() ? 'Replay' : S.idx > 0 ? 'Resume' : 'Play';
  $('#play').innerHTML = `${on ? ICON.pause : ICON.play}<span>${label}</span>`;
  $('#fab-play').innerHTML = on ? ICON.pause : ICON.play;
  $('#fab-play').setAttribute('aria-label', label);
  document.body.dataset.playing = String(on);
  if (on && S.sound) audio();
}

function restart() {
  setPlaying(false);
  S.idx = 0; S.acc = 0; S.relay = { queued: 0, sent: 0 }; S.read = new Set(); S.sys = [];
  resetNotifications();
  setPlaying(false);
  renderAll();
}

/** Side-effects for the frames we just played through: sound, haptics, relay counters, a screen-reader message. */
function announce(i0, i1) {
  const fs = frames(S);
  let n = 0, said = '', top = 0;
  for (let i = i0 + 1; i <= i1; i++) {
    const fr = fs[i];
    for (const [id, w] of Object.entries(fr.workers)) {
      const c = w.change;
      if (c && c.to > c.from && c.to >= 2) {
        n++; top = Math.max(top, c.to); said = `${profileOf(S, id).name}: ${c.title}`;
        if (S.blackout) S.relay.queued++; else S.relay.sent++;
      }
    }
    for (const ev of fr.site.events) if ((ev.severity ?? 0) >= 1) { n++; top = Math.max(top, ev.severity >= 2 ? 2 : 1); said = ev.text; }
  }
  if (!n) return;
  if (S.sound && top >= 2) { beep(top); vibrate(top); }
  $('#sr-live').textContent = n === 1 ? said : `${n} new notifications`;
}

// ------------------------------------------------------------------ sound + haptics
let ac = null;
function audio() { try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); ac.resume?.(); } catch { ac = null; } }
function beep(level) {
  if (!ac) return;
  const n = level >= 3 ? 3 : 2, f = level >= 3 ? 1175 : 880;
  for (let k = 0; k < n; k++) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'sine'; o.frequency.value = f;
    const t0 = ac.currentTime + k * 0.22;
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.17);
    o.connect(g).connect(ac.destination); o.start(t0); o.stop(t0 + 0.2);
  }
}
const vibrate = (level) => { try { navigator.vibrate?.(level >= 3 ? [250, 100, 250, 100, 500] : [200, 100, 200]); } catch { /* unsupported */ } };

// ------------------------------------------------------------------ controls
const setSw = (id, on) => $(id).setAttribute('aria-checked', String(!!on));

function syncControls() {
  const plant = S.plant;
  picker?.set(plant);
  const canSim = hasShift(plant);
  $$('#src-seg button').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.src === S.src));
    if (b.dataset.src === 'sim') { b.disabled = !canSim; b.title = canSim ? 'A scripted shift with events' : 'This plant has no scripted shift. Live weather only.'; }
    else { b.disabled = !hasLive(plant); b.title = hasLive(plant) ? "Today's real weather at the plant" : 'No weather feed underground'; }
  });
  $('#live-off-l').textContent = plant.cold ? 'Cold snap' : 'Heat stress test';
  $('#live-box').hidden = S.src !== 'live';
  $$('#speed-seg button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === S.speed)));
  setSw('#sw-follow', S.mode === 'followed');
  setSw('#sw-truth', S.showTruth);
  setSw('#sw-comms', S.blackout);
  setSw('#sw-sound', S.sound);
  $('#live-off').value = String(S.live.offset);
  $('#live-off-v').textContent = plant.cold ? `${S.live.offset ? '-' : ''}${S.live.offset} °C` : `+${S.live.offset} °C`;
  $('#live-off').style.setProperty('--p', `${(S.live.offset / 12) * 100}%`);
}

function setBlackout(on) {
  const was = S.blackout;
  S.blackout = on;
  if (!was && on) {
    S.sys.push({ key: `sys|down|${S.sys.length}`, t: S.idx, title: 'Comms blackout', why: 'Alerts still fire on each device and queue for relay.' });
  } else if (was && !on) {
    const q = S.relay.queued;
    S.sys.push({ key: `sys|up|${S.sys.length}`, t: S.idx, title: q ? `Link restored: ${q} queued alert${q > 1 ? 's' : ''} forwarded` : 'Link restored', why: 'Store-and-forward: nothing was lost while offline.' });
    S.relay.sent += q; S.relay.queued = 0;
  }
  syncControls();
  renderAll();
}

function setTab(tab) {
  S.tab = tab;
  $$('#chart-tabs button').forEach((b) => { const on = b.dataset.tab === tab; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
  for (const k of ['core', 'hr', 'exp']) $('#ch-' + k).hidden = k !== tab;
  const on = !!S.tableOn[tab];
  S.charts[tab]?.setTable(on);
  $('#chart-table').setAttribute('aria-pressed', String(on));
  $('#chart-table span').textContent = on ? 'Chart' : 'Table';
  renderAll();
}

function bind() {
  $('#play').onclick = () => setPlaying(!S.playing);
  $('#fab-play').onclick = () => setPlaying(!S.playing);
  $('#restart').onclick = restart;
  $('#scrub').oninput = (e) => { S.idx = Number(e.target.value); S.acc = 0; renderAll(); };
  $('#btn-theme').onclick = () => applyTheme($('#btn-theme').dataset.theme === 'dark' ? 'light' : 'dark');
  $('#btn-how').onclick = () => $('#dlg-how').showModal();
  $('#btn-bench').onclick = openBench;
  const st1 = $('#st1');
  st1.setAttribute('role', 'button'); st1.tabIndex = 0; st1.title = 'Show every sensor and its signal strength'; st1.classList.add('click');
  const tk = initTickets(S, {
    clockText: () => clock(S.scn.startLocalH, S.idx),
    onChange: (title, why) => { S.sys.push({ key: `sys|tk|${S.sys.length}`, t: S.idx, title, why }); renderAll(); },
  });
  const openSensors = (tab = 'sensors') => {
    renderSensors(S, frames(S)[S.idx]);
    if (!$('#dlg-sensors').open) $('#dlg-sensors').showModal();
    tk.goto(tab);
  };
  st1.onclick = () => openSensors('sensors');
  st1.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSensors('sensors'); } };
  $('#btn-tickets').onclick = () => openSensors('tickets');
  $('#crew-temps').onclick = (e) => { const r = e.target.closest('[data-id]'); if (r) { S.sel = r.dataset.id; renderAll(); } };
  $('#plant-chip').onclick = () => { sim.setOpen(true); picker.open(); };
  $$('#src-seg button').forEach((b) => { b.onclick = () => { if (!b.disabled && b.dataset.src !== S.src) loadPlant(S.plantId, b.dataset.src); }; });
  $$('#speed-seg button').forEach((b) => { b.onclick = () => { S.speed = Number(b.dataset.speed); syncControls(); }; });
  $('#sw-follow').onclick = () => { S.mode = S.mode === 'followed' ? 'ignored' : 'followed'; syncControls(); buildTicks(); renderAll(); };
  $('#sw-truth').onclick = () => { S.showTruth = !S.showTruth; syncControls(); renderAll(); };
  $('#sw-comms').onclick = () => setBlackout(!S.blackout);
  $('#sw-sound').onclick = () => { S.sound = !S.sound; syncControls(); if (S.sound) { audio(); beep(2); } };
  $('#crew-list').onclick = (e) => { const c = e.target.closest('.ci'); if (c) { S.sel = c.dataset.id; renderAll(); } };
  $$('#chart-tabs button').forEach((b) => { b.onclick = () => setTab(b.dataset.tab); });
  $('#chart-tabs').addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    const tabs = $$('#chart-tabs button');
    const i = tabs.findIndex((b) => b.getAttribute('aria-selected') === 'true');
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    e.preventDefault();
    tabs[j].focus();
    setTab(tabs[j].dataset.tab);
  });
  $('#chart-table').onclick = () => { S.tableOn[S.tab] = !S.tableOn[S.tab]; setTab(S.tab); };
  let tmr;
  $('#live-off').oninput = (e) => {
    S.live.offset = Number(e.target.value);
    syncControls();
    clearTimeout(tmr);
    tmr = setTimeout(() => loadPlant(S.plantId, 'live'), 250);
  };
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = document.activeElement?.tagName || '';
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(tag) || document.activeElement?.closest('#plant-list') || document.querySelector('dialog[open]')) return;
    if (e.code === 'Space' && tag !== 'BUTTON') { e.preventDefault(); setPlaying(!S.playing); }
    else if (e.key === 'r' || e.key === 'R') restart();
    else if (e.key === 'n' || e.key === 'N') notif.toggle();
    else if (e.key === 't' || e.key === 'T') $('#btn-tickets').click();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', (ev) => { if (!store.get('theme')) applyTheme(ev.matches ? 'dark' : 'light'); });
}

// ------------------------------------------------------------------ benchmark dialog
let benchData = null;
async function openBench() {
  const dlg = $('#dlg-bench'), body = $('#bench-body');
  if (!dlg.open) dlg.showModal();
  if (!benchData) {
    body.textContent = 'Loading...';
    try { benchData = await (await fetch('data/benchmark.json')).json(); } catch { benchData = null; }
  }
  renderBench(body, benchData, { onRerun: rerunBench });
}

async function rerunBench() {
  const body = $('#bench-body');
  const prog = $('#bench-prog');
  const btn = $('#bench-rerun');
  btn.disabled = true; prog.hidden = false;
  const bar = prog.firstElementChild;
  const n = 300, nClosed = 80;
  const results = [];
  const tick = () => new Promise((r) => setTimeout(r, 0));
  for (let k = 0; k < n; k++) {
    results.push(evaluateCase(1000 + k));
    if (k % 8 === 0) { bar.style.width = `${(k / (n + nClosed * 2)) * 100}%`; await tick(); }
  }
  const open = { exceed385: 0, exceed39: 0, minutes385: 0, n: 0 }, closed = { exceed385: 0, exceed39: 0, minutes385: 0, n: 0 };
  for (let k = 0; k < nClosed; k++) {
    const a = evaluateCase(1000 + k, {}, { followAdvice: false }), b = evaluateCase(1000 + k, {}, { followAdvice: true });
    for (const [acc, r] of [[open, a], [closed, b]]) { acc.n++; acc.minutes385 += r.minAbove385; if (r.tUnsafe != null) acc.exceed385++; if (r.tSevere != null) acc.exceed39++; }
    if (k % 4 === 0) { bar.style.width = `${((n + k * 2) / (n + nClosed * 2)) * 100}%`; await tick(); }
  }
  benchData = { generated: new Date().toISOString(), n, seeds: `1000..${999 + n} (re-run in this browser)`, calibrationSeeds: '1..150', summary: summarise(results), closedLoop: { open, closed }, closedLoopN: nClosed };
  renderBench(body, benchData, { onRerun: rerunBench });
}

// expose for debugging / screenshots
window.__geos = { S, renderAll };

init();
