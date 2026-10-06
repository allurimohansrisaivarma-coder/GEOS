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
  return out;
}

export const barsSvg = (n) => `<svg class="bars b${n}" viewBox="0 0 22 16" role="img" aria-label="${n} of 4 bars">${[0, 1, 2, 3].map((i) => {
  const h = 5 + i * 3.6;
  return `<rect x="${i * 6}" y="${(16 - h).toFixed(1)}" width="4" height="${h.toFixed(1)}" rx="1"${i < n ? ' class="on"' : ''}/>`;
}).join('')}</svg>`;

const WORD = ['No signal', 'Weak', 'Fair', 'Good', 'Excellent'];

export function renderSensors(S, fr) {
  const list = sensorList(S, fr);
  const online = list.filter((s) => s.bars > 0).length;
  $('#sensors-sum').textContent = `${online} of ${list.length} online`;
  let html = '';
  for (const group of ['Weather station', 'Wearables']) {
    const rows = list.filter((s) => s.group === group);
    html += `<h3 class="eyebrow">${group}</h3><ul class="srows">${rows.map((s) => `<li class="srow${s.bars === 0 ? ' off' : ''}">
      ${barsSvg(s.bars)}<span class="s-n"><b>${esc(s.name)}</b><small>${esc(s.link)}</small></span>
      <span class="s-st">${s.bars === 0 ? `No signal for ${s.silent} min` : WORD[s.bars]}</span></li>`).join('')}</ul>`;
  }
  $('#sensors-body').innerHTML = html;
}
