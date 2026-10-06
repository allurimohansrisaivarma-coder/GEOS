// Sensor inventory and link strength for the "sensors online" dialog.
// Signal strength is simulated: each link has a typical strength for the site, wobbles a little over time,
// and a heart-rate strap that stops reporting drops to no signal.

import { $, esc } from './dom.js';

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
function hash01(s) { let x = 2166136261; for (const c of s) { x ^= c.charCodeAt(0); x = Math.imul(x, 16777619); } return (x >>> 0) / 4294967296; }

const LINKS = {
  solar: { station: 'LoRaWAN', wear: 'BLE to LoRa gateway', base: 4 },
  offshore: { station: 'Platform Wi-Fi', wear: 'UHF mesh', base: 3 },
  mine: { station: 'Leaky-feeder radio', wear: 'Leaky-feeder radio', base: 3 },
  arctic: { station: 'Private LTE', wear: 'Private LTE', base: 3 },
};
const kindOf = (scn) => (scn.underground ? 'mine' : scn.cold ? 'arctic' : scn.hasGas ? 'offshore' : 'solar');

export function sensorList(S, fr) {
  const scn = S.scn, kind = kindOf(scn), L = LINKS[kind], t = S.idx;
  const wob = (id, spread = 2.2) => (hash01(id + Math.floor(t / 20)) - 0.5) * spread;
  const station = (id, name, offset = 0) => ({ id, group: 'Weather station', name, link: L.station, bars: clamp(Math.round(L.base + offset + wob(id)), 1, 4) });
  const out = [
    station('air', 'Air temperature'),
    station('rh', 'Humidity'),
    station('pres', 'Barometric pressure', -0.4),
    station('wind', kind === 'mine' ? 'Airflow' : 'Wind speed', kind === 'arctic' ? -0.6 : 0),
  ];
  if (kind !== 'mine') out.push(station('sun', 'Solar radiation', 0.2));
  out.push(station('pm', 'Dust PM10', -0.7));
  if (scn.hasGas) out.push(station('h2s', 'Area H₂S monitor', 0.3));

  for (const w of scn.workers) {
    const fw = fr.workers[w.profile.id];
    const first = w.profile.name.split(' ')[0];
    let bars = clamp(Math.round(3.2 + wob('hr' + w.profile.id, 2.6)), 1, 4);
    if (Math.round(fw.minutesWithoutHr || 0) >= 3) bars = 0;
    else if (fw.hrQuality < 0.8) bars = Math.min(bars, 2);
    out.push({ id: 'hr-' + w.profile.id, group: 'Wearables', name: `Heart-rate strap · ${first}`, link: L.wear, bars, silent: Math.round(fw.minutesWithoutHr || 0) });
    if (scn.hasGas) out.push({ id: 'gas-' + w.profile.id, group: 'Wearables', name: `Gas monitor · ${first}`, link: L.wear, bars: clamp(Math.round(3 + wob('g' + w.profile.id)), 1, 4) });
  }
  return withBattery(S, out);
}

export const barsSvg = (n) => `<svg class="bars b${n}" viewBox="0 0 22 16" role="img" aria-label="${n} of 4 bars">${[0, 1, 2, 3].map((i) => {
  const h = 5 + i * 3.6;
  return `<rect x="${i * 6}" y="${(16 - h).toFixed(1)}" width="4" height="${h.toFixed(1)}" rx="1"${i < n ? ' class="on"' : ''}/>`;
}).join('')}</svg>`;

// ------------------------------------------------------------------ battery (simulated drain; straps start lower and run down within a shift)
function withBattery(S, list) {
  const t = S.idx;
  return list.map((s) => {
    const strap = s.group === 'Wearables';
    const start = strap ? 28 + 72 * hash01('b' + S.plantId + s.id) : 70 + 30 * hash01('b' + S.plantId + s.id);
    const rate = strap ? 5.2 : 0.8; // % per hour
    const since = S.replaced[s.id];
    const level = since == null ? start - (rate * t) / 60 : 100 - (rate * (t - since)) / 60;
    const battery = Math.round(clamp(level, 0, 100));
    return { ...s, battery, low: battery < 20, strap };
  });
}

const batteryIcon = (pct) => `<svg class="batt${pct < 10 ? ' crit' : pct < 20 ? ' low' : ''}" viewBox="0 0 26 14" role="img" aria-label="Battery ${pct}%"><rect x="1" y="1.5" width="21" height="11" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="23" y="5" width="2" height="4" rx="1" fill="currentColor"/><rect x="3" y="3.5" width="${(17 * pct) / 100}" height="7" rx="1" fill="currentColor"/></svg>`;

const WORD = ['No signal', 'Weak', 'Fair', 'Good', 'Excellent'];
const ISSUES = ['Low battery', 'No signal', 'Poor skin contact', 'Inaccurate readings', 'Strap damaged', 'Other'];
const openFor = (S, id) => S.tickets.find((k) => k.sensor === id && k.status !== 'Resolved');

export function renderSensors(S, fr) {
  const list = sensorList(S, fr);
  const online = list.filter((s) => s.bars > 0).length;
  const lowN = list.filter((s) => s.low).length;
  $('#sensors-sum').textContent = `${online} of ${list.length} online${lowN ? ` · ${lowN} low battery` : ''}`;
  let html = '';
  for (const group of ['Weather station', 'Wearables']) {
    const rows = list.filter((s) => s.group === group);
    html += `<h3 class="eyebrow">${group}</h3><ul class="srows">${rows.map((s) => {
      const tk = openFor(S, s.id);
      const flag = s.bars === 0 || s.low;
      return `<li class="srow${s.bars === 0 ? ' off' : ''}">
      ${barsSvg(s.bars)}<span class="s-n"><b>${esc(s.name)}</b><small>${esc(s.link)} · ${s.bars === 0 ? `no signal for ${s.silent} min` : WORD[s.bars].toLowerCase()}</small></span>
      <span class="s-bat${s.low ? ' lowb' : ''}">${batteryIcon(s.battery)}<i>${s.battery}%</i></span>
      ${tk ? `<span class="s-tk">${tk.id} ${tk.status.toLowerCase()}</span>` : `<button type="button" class="btn sm${flag ? ' warn' : ' ghost'}" data-ticket="${esc(s.id)}">${flag ? 'Raise ticket' : 'Ticket'}</button>`}</li>`;
    }).join('')}</ul>`;
  }
  $('#sensors-body').innerHTML = html;
  const open = S.tickets.filter((k) => k.status !== 'Resolved').length;
  $('#tab-tickets').textContent = `Tickets${open ? ` (${open})` : ''}`;
  // keep the form's sensor list in step with the plant
  const sel = $('#tk-sensor');
  if (sel.dataset.plant !== S.plantId) {
    sel.dataset.plant = S.plantId;
    sel.innerHTML = list.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
    $('#tk-issue').innerHTML = ISSUES.map((i) => `<option>${i}</option>`).join('');
  }
}

export function renderTickets(S) {
  const rows = [...S.tickets].reverse();
  $('#tk-list').innerHTML = rows.length ? rows.map((k) => `<li class="tk ${k.status.replace(' ', '').toLowerCase()}">
    <div class="tk-top"><b>${k.id}</b><span class="tk-st">${k.status}</span><span class="tk-pr p-${k.priority.toLowerCase()}">${k.priority}</span><time>${k.when}</time></div>
    <div class="tk-body"><b>${esc(k.name)}</b>: ${esc(k.issue)}${k.note ? `<small>${esc(k.note)}</small>` : ''}</div>
    ${k.status === 'Resolved' ? '' : `<div class="tk-act">${k.status === 'Open' ? `<button type="button" class="btn sm" data-adv="${k.id}">Start work</button>` : ''}<button type="button" class="btn sm primary" data-adv="${k.id}" data-done="1">Resolve${k.issue === 'Low battery' ? ' and swap battery' : ''}</button></div>`}</li>`).join('')
    : '<li class="n-empty">No tickets yet. Use "Raise ticket" on a sensor, or the form above.</li>';
}

export function initTickets(S, { clockText, onChange }) {
  const goto = (tab) => {
    $('#pane-sensors').hidden = tab !== 'sensors'; $('#pane-tickets').hidden = tab !== 'tickets';
    $('#tab-sensors').setAttribute('aria-selected', String(tab === 'sensors')); $('#tab-tickets').setAttribute('aria-selected', String(tab === 'tickets'));
    if (tab === 'tickets') renderTickets(S);
  };
  $('#tab-sensors').onclick = () => goto('sensors');
  $('#tab-tickets').onclick = () => goto('tickets');
  $('#sensors-body').onclick = (e) => {
    const b = e.target.closest('[data-ticket]'); if (!b) return;
    const s = sensorList(S, S._fr).find((x) => x.id === b.dataset.ticket);
    $('#tk-sensor').value = s.id;
    $('#tk-issue').value = s.bars === 0 ? 'No signal' : s.low ? 'Low battery' : 'Other';
    $('#tk-priority').value = s.battery < 10 || (s.strap && s.bars === 0) ? 'High' : 'Normal';
    goto('tickets'); $('#tk-note').focus();
  };
  $('#tk-form').onsubmit = (e) => {
    e.preventDefault();
    const s = sensorList(S, S._fr).find((x) => x.id === $('#tk-sensor').value);
    const n = S.tickets.length + 1;
    S.tickets.push({ id: `T-${String(n).padStart(3, '0')}`, sensor: s.id, name: s.name, issue: $('#tk-issue').value, priority: $('#tk-priority').value, note: $('#tk-note').value.trim(), status: 'Open', when: clockText(), t: S.idx });
    $('#tk-note').value = '';
    onChange(`Ticket ${S.tickets.at(-1).id} raised`, `${s.name}: ${$('#tk-issue').value}`);
    renderTickets(S); renderSensors(S, S._fr);
  };
  $('#tk-list').onclick = (e) => {
    const b = e.target.closest('[data-adv]'); if (!b) return;
    const k = S.tickets.find((x) => x.id === b.dataset.adv);
    k.status = b.dataset.done ? 'Resolved' : 'In progress';
    if (b.dataset.done) { if (k.issue === 'Low battery' || k.issue === 'Strap damaged') S.replaced[k.sensor] = S.idx; onChange(`Ticket ${k.id} resolved`, k.name); }
    renderTickets(S); renderSensors(S, S._fr);
  };
  return { goto };
}