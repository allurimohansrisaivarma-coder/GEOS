// Sensor inventory, device details, battery and maintenance tickets for the "sensors and tickets" dialog.
// Signal strength and battery are simulated: each link has a typical strength for the site and wobbles a little over
// time, a GEOS-Strap that stops reporting drops to no signal, and batteries drain at a fixed rate per hour.
// Tickets are stored in this browser (localStorage), one list per plant.

import { $, esc, safeStorage } from './dom.js';
import { ICON } from './icons.js';

const store = safeStorage();
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
function hash01(s) { let x = 2166136261; for (const c of s) { x ^= c.charCodeAt(0); x = Math.imul(x, 16777619); } return (x >>> 0) / 4294967296; }

const LINKS = {
  solar: { station: 'LoRaWAN', wear: 'BLE to LoRa gateway', base: 4 },
  offshore: { station: 'Platform Wi-Fi', wear: 'UHF mesh', base: 3 },
  mine: { station: 'Leaky-feeder radio', wear: 'Leaky-feeder radio', base: 3 },
  arctic: { station: 'Private LTE', wear: 'Private LTE', base: 3 },
};
const kindOf = (scn) => (scn.underground ? 'mine' : scn.cold ? 'arctic' : scn.hasGas ? 'offshore' : 'solar');

// Device catalogue (sample data: GEOS-branded hardware for the demo). [model, description, serial prefix]
const DEVICES = {
  air: ['GS-T1', 'Air temperature probe', 'GSX'],
  rh: ['GS-H1', 'Humidity sensor', 'GSX'],
  pres: ['GS-P1', 'Barometric pressure sensor', 'GSX'],
  wind: ['GS-W1', 'Ultrasonic anemometer', 'GSX'],
  airflow: ['GS-A1', 'Airflow sensor', 'GSX'],
  sun: ['GS-R1', 'Solar radiation sensor (pyranometer)', 'GSX'],
  pm: ['GS-D1', 'Dust (PM10) monitor', 'GSX'],
  h2s: ['GS-G2', 'Fixed H₂S gas monitor', 'GSX'],
  hr: ['GEOS-Strap S2', 'Heart-rate and motion strap', 'GS2'],
  gas: ['GEOS-Gas G1', 'Personal H₂S monitor', 'GG1'],
};
const BATTERY = { strap: { rate: 4.5, cap: '180 mAh Li-Po, about 22 h per charge' }, station: { rate: 0.8, cap: 'Solar-charged backup battery' } };

export function sensorList(S, fr) {
  const scn = S.scn, kind = kindOf(scn), L = LINKS[kind], t = S.idx;
  const wob = (id, spread = 2.2) => (hash01(id + Math.floor(t / 20)) - 0.5) * spread;
  const station = (id, name, dev, offset = 0) => ({ id, group: 'Weather station', name, dev, link: L.station, bars: clamp(Math.round(L.base + offset + wob(id)), 1, 4) });
  const out = [
    station('air', 'Air temperature', 'air'),
    station('rh', 'Humidity', 'rh'),
    station('pres', 'Barometric pressure', 'pres', -0.4),
    kind === 'mine' ? station('wind', 'Airflow', 'airflow') : station('wind', 'Wind speed', 'wind', kind === 'arctic' ? -0.6 : 0),
  ];
  if (kind !== 'mine') out.push(station('sun', 'Solar radiation', 'sun', 0.2));
  out.push(station('pm', 'Dust PM10', 'pm', -0.7));
  if (scn.hasGas) out.push(station('h2s', 'Area H₂S monitor', 'h2s', 0.3));

  for (const w of scn.workers) {
    const fw = fr.workers[w.profile.id];
    const first = w.profile.name.split(' ')[0];
    let bars = clamp(Math.round(3.2 + wob('hr' + w.profile.id, 2.6)), 1, 4);
    if (Math.round(fw.minutesWithoutHr || 0) >= 3) bars = 0;
    else if (fw.hrQuality < 0.8) bars = Math.min(bars, 2);
    out.push({ id: 'hr-' + w.profile.id, group: 'Wearables', name: `GEOS-Strap · ${first}`, dev: 'hr', worker: `${w.profile.name}, ${w.profile.role}`, link: L.wear, bars, silent: Math.round(fw.minutesWithoutHr || 0) });
    if (scn.hasGas) out.push({ id: 'gas-' + w.profile.id, group: 'Wearables', name: `Gas monitor · ${first}`, dev: 'gas', worker: `${w.profile.name}, ${w.profile.role}`, link: L.wear, bars: clamp(Math.round(3 + wob('g' + w.profile.id)), 1, 4) });
  }
  return withBattery(S, out);
}

export const barsSvg = (n) => `<svg class="bars b${n}" viewBox="0 0 22 16" role="img" aria-label="${n} of 4 bars">${[0, 1, 2, 3].map((i) => {
  const h = 5 + i * 3.6;
  return `<rect x="${i * 6}" y="${(16 - h).toFixed(1)}" width="4" height="${h.toFixed(1)}" rx="1"${i < n ? ' class="on"' : ''}/>`;
}).join('')}</svg>`;

// ------------------------------------------------------------------ battery and device details
function withBattery(S, list) {
  const t = S.idx;
  return list.map((s) => {
    const strap = s.group === 'Wearables';
    const B = strap ? BATTERY.strap : BATTERY.station;
    const start = strap ? 35 + 65 * hash01('b' + S.plantId + s.id) : 70 + 30 * hash01('b' + S.plantId + s.id);
    const since = S.replaced[s.id];
    const level = since == null ? start - (B.rate * t) / 60 : 100 - (B.rate * Math.max(0, t - since)) / 60;
    const battery = Math.round(clamp(level, 0, 100));
    const [model, what, pfx] = DEVICES[s.dev];
    const year = strap ? 2025 + Math.floor(hash01('y' + S.plantId + s.id) * 2) : 2023 + Math.floor(hash01('y' + S.plantId + s.id) * 3);
    const serial = `${pfx}-${String(year).slice(2)}-${String(1000 + Math.floor(hash01('s' + S.plantId + s.id) * 8999))}`;
    const fw = `v2.${3 + Math.floor(hash01('f' + s.id) * 3)}.${Math.floor(hash01('g' + S.plantId + s.id) * 7)}`;
    return {
      ...s, battery, low: battery < 20, strap, hoursLeft: Math.round((battery / B.rate) * 10) / 10,
      spec: { make: 'GEOS', model, what, year, serial, fw, power: B.cap },
    };
  });
}

const batteryIcon = (pct) => `<svg class="batt${pct < 10 ? ' crit' : pct < 20 ? ' low' : ''}" viewBox="0 0 26 14" role="img" aria-label="Battery ${pct}%"><rect x="1" y="1.5" width="21" height="11" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="23" y="5" width="2" height="4" rx="1" fill="currentColor"/><rect x="3" y="3.5" width="${(17 * pct) / 100}" height="7" rx="1" fill="currentColor"/></svg>`;

const WORD = ['No signal', 'Weak', 'Fair', 'Good', 'Excellent'];
const ISSUES = {
  strap: ['Low battery', 'No signal', 'Poor skin contact', 'Inaccurate readings', 'Strap damaged', 'Other'],
  gas: ['Low battery', 'No signal', 'Needs calibration (bump test)', 'Inaccurate readings', 'Device damaged', 'Other'],
  station: ['Low battery', 'No signal', 'Needs calibration', 'Inaccurate readings', 'Device damaged', 'Other'],
};
const typeOf = (s) => (s.dev === 'hr' ? 'strap' : s.dev === 'gas' ? 'gas' : 'station');
const REPLACE_ON = /^(Low battery|Strap damaged|Device damaged)$/;
const openFor = (S, id) => S.tickets.find((k) => k.sensor === id && k.status !== 'Resolved');
const isOpen = (k) => k.status !== 'Resolved';

function suggestion(s) {
  const issue = s.bars === 0 ? 'No signal' : s.low ? 'Low battery' : 'Other';
  const priority = s.battery < 10 || (s.strap && s.bars === 0) ? 'High' : s.low || s.bars === 1 ? 'Normal' : 'Low';
  return { issue, priority };
}

export function renderSensors(S, fr) {
  const list = sensorList(S, fr);
  const online = list.filter((s) => s.bars > 0).length;
  const lowN = list.filter((s) => s.low).length;
  $('#sensors-sum').textContent = `${online} of ${list.length} online${lowN ? ` · ${lowN} low battery` : ''}`;
  const clk = (idx) => { const m = Math.round(S.scn.startLocalH * 60 + idx); return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
  let html = '';
  for (const group of ['Weather station', 'Wearables']) {
    const rows = list.filter((s) => s.group === group);
    html += `<h3 class="eyebrow">${group}</h3><ul class="srows">${rows.map((s) => {
      const tk = openFor(S, s.id);
      const flag = s.bars === 0 || s.low;
      const open = S.sensorOpen.has(s.id);
      const sp = s.spec;
      const status = s.bars === 0 ? `no signal for ${s.silent} min` : WORD[s.bars].toLowerCase();
      const seen = s.bars === 0 ? `${s.silent} min ago` : 'just now';
      return `<li class="srow${s.bars === 0 ? ' off' : ''}${open ? ' open' : ''}${flag ? ' flag' : ''}" data-sid="${esc(s.id)}">
      <button type="button" class="s-head" aria-expanded="${open}" aria-controls="sd-${esc(s.id)}">
        ${barsSvg(s.bars)}<span class="s-n"><b>${esc(s.name)}</b><small>${esc(s.link)} · ${status}</small></span>
        <span class="s-bat${s.low ? ' lowb' : ''}">${batteryIcon(s.battery)}<i>${s.battery}%</i></span>
        ${tk ? `<span class="s-tk">${tk.id}</span>` : ''}<span class="s-chev" aria-hidden="true">${ICON.chevron}</span>
      </button>
      <div class="s-det" id="sd-${esc(s.id)}"${open ? '' : ' hidden'}>
        <div class="bat-big"><div class="bb-top"><b>${s.battery}%</b><span>${s.battery <= 0 ? 'Empty' : `about ${s.hoursLeft} h left`}${S.replaced[s.id] != null ? ` · replaced at ${clk(S.replaced[s.id])}` : ''}</span></div>
          <div class="bb-bar ${s.battery < 10 ? 'crit' : s.battery < 20 ? 'low' : ''}"><i style="width:${s.battery}%"></i></div></div>
        <dl class="spec">
          <div><dt>Make</dt><dd>${sp.make}</dd></div><div><dt>Model</dt><dd>${esc(sp.model)}</dd></div>
          <div><dt>Year</dt><dd>${sp.year}</dd></div><div><dt>Serial no.</dt><dd class="mono">${sp.serial}</dd></div>
          <div><dt>Firmware</dt><dd class="mono">${sp.fw}</dd></div><div><dt>Last seen</dt><dd>${seen}</dd></div>
          <div class="wide"><dt>Type</dt><dd>${esc(sp.what)}</dd></div>
          ${s.worker ? `<div class="wide"><dt>Worn by</dt><dd>${esc(s.worker)}</dd></div>` : ''}
          <div class="wide"><dt>Battery</dt><dd>${esc(sp.power)}</dd></div>
        </dl>
        <div class="s-act">${tk
    ? `<span class="s-tk-l"><b>${tk.id}</b> ${tk.status.toLowerCase()}: ${esc(tk.issue)}</span><button type="button" class="btn sm" data-viewtk="${tk.id}">View ticket</button>`
    : `<button type="button" class="btn sm${flag ? ' warn' : ''}" data-ticket="${esc(s.id)}">Raise ticket</button>`}</div>
      </div>
    </li>`;
    }).join('')}</ul>`;
  }
  $('#sensors-body').innerHTML = html;
  syncTicketUi(S, list);
}

/** Keep the ticket form's sensor list, the tab label and the top-bar badge in step. */
function syncTicketUi(S, list) {
  const sel = $('#tk-sensor');
  if (sel.dataset.plant !== S.plantId) {
    sel.dataset.plant = S.plantId;
    const grp = (g) => `<optgroup label="${g}">${list.filter((s) => s.group === g).map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</optgroup>`;
    sel.innerHTML = grp('Wearables') + grp('Weather station');
    fillIssues(list.find((s) => s.id === sel.value) || list[0]);
  }
  updateTicketBadge(S);
}
function fillIssues(s, pick) {
  const opts = ISSUES[typeOf(s)];
  $('#tk-issue').innerHTML = opts.map((i) => `<option>${esc(i)}</option>`).join('');
  if (pick && opts.includes(pick)) $('#tk-issue').value = pick;
}

export function updateTicketBadge(S) {
  const n = S.tickets.filter(isOpen).length;
  const c = $('#tk-count');
  if (c) { c.hidden = n === 0; c.textContent = String(n); }
  $('#tab-tickets').textContent = `Tickets${n ? ` (${n})` : ''}`;
  const b = $('#btn-tickets');
  if (b) b.setAttribute('aria-label', n ? `Maintenance tickets, ${n} open` : 'Maintenance tickets');
}

export function renderTickets(S) {
  const f = S.tkFilter;
  const nOpen = S.tickets.filter(isOpen).length, nDone = S.tickets.length - nOpen;
  $('#tk-sum').innerHTML = S.tickets.length
    ? `<div class="seg sm" role="group" aria-label="Filter tickets">${[['all', `All ${S.tickets.length}`], ['open', `Open ${nOpen}`], ['resolved', `Resolved ${nDone}`]].map(([k, l]) => `<button type="button" data-f="${k}" aria-pressed="${f === k}">${l}</button>`).join('')}</div>`
    : '';
  const rows = [...S.tickets].reverse().filter((k) => f === 'all' || (f === 'open' ? isOpen(k) : !isOpen(k)));
  $('#tk-list').innerHTML = rows.length ? rows.map((k) => `<li class="tk ${k.status.replace(' ', '').toLowerCase()}" data-tk="${k.id}">
    <div class="tk-top"><b>${k.id}</b><span class="tk-st">${k.status}</span><span class="tk-pr p-${k.priority.toLowerCase()}">${k.priority}</span><time>${k.when}</time></div>
    <div class="tk-body"><b>${esc(k.name)}</b>: ${esc(k.issue)}${k.note ? `<small>${esc(k.note)}</small>` : ''}<small class="mono">${esc(k.model || '')}${k.serial ? ` · ${esc(k.serial)}` : ''}</small></div>
    ${isOpen(k) ? `<div class="tk-act">${k.status === 'Open' ? `<button type="button" class="btn sm" data-adv="${k.id}">Start work</button>` : ''}<button type="button" class="btn sm primary" data-adv="${k.id}" data-done="1">Resolve${REPLACE_ON.test(k.issue) ? ' and swap device' : ''}</button></div>` : `<div class="tk-done">Resolved${k.doneAt ? ` at ${k.doneAt}` : ''}</div>`}</li>`).join('')
    : `<li class="n-empty">${S.tickets.length ? 'Nothing in this view.' : 'No tickets yet. Raise one from a sensor row or the form above.'}</li>`;
}

// ------------------------------------------------------------------ persistence (per plant)
const keyOf = (S) => `geos-tickets-${S.plantId}`;
export function loadTickets(S) {
  try {
    const d = JSON.parse(store.get(keyOf(S), 'null'));
    S.tickets = Array.isArray(d?.tickets) ? d.tickets : [];
    S.replaced = d?.replaced && typeof d.replaced === 'object' ? d.replaced : {};
  } catch { S.tickets = []; S.replaced = {}; }
  S.tkFilter = 'all';
}
function saveTickets(S) { store.set(keyOf(S), JSON.stringify({ tickets: S.tickets, replaced: S.replaced })); }

// ------------------------------------------------------------------ wiring
export function initTickets(S, { clockText, onChange }) {
  const goto = (tab) => {
    $('#pane-sensors').hidden = tab !== 'sensors'; $('#pane-tickets').hidden = tab !== 'tickets';
    $('#tab-sensors').setAttribute('aria-selected', String(tab === 'sensors')); $('#tab-tickets').setAttribute('aria-selected', String(tab === 'tickets'));
    if (tab === 'tickets') { renderTickets(S); $('#tk-msg').textContent = ''; }
  };
  const refresh = () => { saveTickets(S); renderTickets(S); renderSensors(S, S._fr); };
  const find = (id) => sensorList(S, S._fr).find((x) => x.id === id);
  const msg = (t, bad) => { const m = $('#tk-msg'); m.textContent = t; m.className = `tk-msg${bad ? ' bad' : ''}`; };

  $('#tab-sensors').onclick = () => goto('sensors');
  $('#tab-tickets').onclick = () => goto('tickets');
  $('#tk-sensor').onchange = () => { const s = find($('#tk-sensor').value); if (!s) return; const sg = suggestion(s); fillIssues(s, sg.issue); $('#tk-priority').value = sg.priority; msg(''); };

  $('#sensors-body').onclick = (e) => {
    const raise = e.target.closest('[data-ticket]');
    if (raise) {
      const s = find(raise.dataset.ticket); const sg = suggestion(s);
      $('#tk-sensor').value = s.id; fillIssues(s, sg.issue); $('#tk-priority').value = sg.priority;
      goto('tickets'); $('#tk-note').focus(); return;
    }
    const view = e.target.closest('[data-viewtk]');
    if (view) { S.tkFilter = 'all'; goto('tickets'); $(`#tk-list [data-tk="${view.dataset.viewtk}"]`)?.scrollIntoView({ block: 'nearest' }); return; }
    const head = e.target.closest('.s-head');
    if (head) { const id = head.parentElement.dataset.sid; if (S.sensorOpen.has(id)) S.sensorOpen.delete(id); else S.sensorOpen.add(id); renderSensors(S, S._fr); }
  };

  $('#tk-form').onsubmit = (e) => {
    e.preventDefault();
    const s = find($('#tk-sensor').value);
    const issue = $('#tk-issue').value;
    const dup = S.tickets.find((k) => k.sensor === s.id && k.issue === issue && isOpen(k));
    if (dup) { msg(`${dup.id} is already open for this (${issue}).`, true); return; }
    const n = S.tickets.reduce((m, k) => Math.max(m, Number(k.id.slice(2)) || 0), 0) + 1;
    const k = { id: `T-${String(n).padStart(3, '0')}`, sensor: s.id, name: s.name, model: s.spec.model, serial: s.spec.serial, issue, priority: $('#tk-priority').value, note: $('#tk-note').value.trim(), status: 'Open', when: clockText(), t: S.idx };
    S.tickets.push(k);
    $('#tk-note').value = '';
    S.tkFilter = 'all';
    msg(`${k.id} raised.`);
    onChange(`Ticket ${k.id} raised`, `${s.name}: ${issue}`);
    refresh();
  };

  $('#tk-sum').onclick = (e) => { const b = e.target.closest('[data-f]'); if (b) { S.tkFilter = b.dataset.f; renderTickets(S); } };
  $('#tk-list').onclick = (e) => {
    const b = e.target.closest('[data-adv]'); if (!b) return;
    const k = S.tickets.find((x) => x.id === b.dataset.adv);
    if (!k || k.status === 'Resolved') return;
    if (b.dataset.done) {
      k.status = 'Resolved'; k.doneAt = clockText();
      if (REPLACE_ON.test(k.issue)) S.replaced[k.sensor] = S.idx;
      onChange(`Ticket ${k.id} resolved`, REPLACE_ON.test(k.issue) ? `${k.name}: device swapped, battery 100%` : `${k.name}: ${k.issue}`);
    } else { k.status = 'In progress'; onChange(`Ticket ${k.id} in progress`, k.name); }
    refresh();
  };
  return { goto };
}
