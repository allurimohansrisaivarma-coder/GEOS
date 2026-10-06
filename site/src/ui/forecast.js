// Tomorrow's forecast card: four day-parts as weather pictograms, a one-line risk read-out and a work plan.

import { $, esc } from './dom.js';

const g = (cls, inner) => `<g class="${cls}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${inner}</g>`;
const SUN = (cx, cy, r, rays = true) => g('sun', `<circle cx="${cx}" cy="${cy}" r="${r}" fill="currentColor" fill-opacity=".22"/>${rays ? [0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
  const rad = (a * Math.PI) / 180, r1 = r + 3.4, r2 = r + 6.4;
  return `<path d="M${(cx + r1 * Math.cos(rad)).toFixed(1)} ${(cy + r1 * Math.sin(rad)).toFixed(1)}L${(cx + r2 * Math.cos(rad)).toFixed(1)} ${(cy + r2 * Math.sin(rad)).toFixed(1)}"/>`;
}).join('') : ''}`);
const MOON = (cx = 24, cy = 24) => g('moon', `<path d="M${cx + 8} ${cy + 6}A11 11 0 1 1 ${cx - 1} ${cy - 11}A8.5 8.5 0 0 0 ${cx + 8} ${cy + 6}z" fill="currentColor" fill-opacity=".2"/>`);
const CLOUD = (dx = 0, dy = 0, op = 0.16) => g('cloud', `<path d="M${14 + dx} ${33 + dy}h20a7 7 0 0 0 .8-13.9 9.5 9.5 0 0 0-18.2 2.3A5.8 5.8 0 0 0 ${14 + dx} ${33 + dy}z" fill="currentColor" fill-opacity="${op}"/>`);
const DROPS = (n) => g('drop', [[17, 38, 14, 45], [25, 38, 22, 45], [33, 38, 30, 45], [21, 41, 18, 47], [29, 41, 26, 47]].slice(0, n).map(([x1, y1, x2, y2]) => `<path d="M${x1} ${y1}L${x2} ${y2}"/>`).join(''));
const FLAKES = g('drop', [[16, 39], [24, 40], [32, 39], [20, 45], [28, 45]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.3" fill="currentColor"/>`).join(''));
const LINES = (ys, x1 = 10, x2 = 38) => g('cloud', ys.map((y, i) => `<path d="M${x1 + (i % 2) * 4} ${y}H${x2 - (i % 2) * 4}"/>`).join(''));

const WI = {
  sunny: () => SUN(24, 24, 8),
  clear: () => MOON(),
  partly: (night) => (night ? MOON(18, 18) : SUN(17, 17, 6)) + CLOUD(4, 3, 0.2),
  cloudy: () => CLOUD(-2, -2, 0.2) + CLOUD(4, 4, 0.14),
  showers: () => CLOUD(0, -4, 0.2) + DROPS(3),
  rain: () => CLOUD(0, -4, 0.2) + DROPS(5),
  snow: () => CLOUD(0, -4, 0.2) + FLAKES,
  storm: () => CLOUD(0, -4, 0.2) + g('bolt', '<path d="M25 33l-5 7h6l-3 7" />'),
  haze: () => SUN(24, 18, 7, false) + LINES([32, 38, 44]),
  dust: () => SUN(24, 17, 7, false) + g('dust', '<path d="M8 31c4-3 8 3 12 0s8 3 12 0 6 1 8 0M10 38c4-3 8 3 12 0s8 3 12 0M8 45c4-3 8 3 12 0s8 3 12 0"/>'),
  fog: () => LINES([20, 28, 36, 44]),
};
const ICON_NAME = { sunny: 'Sunny', clear: 'Clear', partly: 'Partly cloudy', cloudy: 'Cloudy', showers: 'Showers', rain: 'Rain', snow: 'Snow', storm: 'Thunderstorms', haze: 'Hazy', dust: 'Dust', fog: 'Fog' };

export const weatherIcon = (kind, night = false) => `<svg class="wi" viewBox="0 0 48 48" role="img" aria-label="${esc(ICON_NAME[kind] || 'Weather')}">${(WI[kind] || WI.cloudy)(night)}</svg>`;

export function renderForecast(S) {
  const o = S.outlook;
  const host = $('#fc-body');
  if (!host) return;
  if (!o) { host.innerHTML = '<p class="fc-empty">Loading the outlook...</p>'; return; }
  const key = `${S.plantId}|${o.source}|${o.dateLabel}|${S.src}`;
  if (host.dataset.key === key) return;
  host.dataset.key = key;
  const deg = (v) => `${Math.round(v)}°`;
  const parts = o.parts.map((p) => `<li class="fc-part"><span class="fc-lab">${p.label}</span>${weatherIcon(p.icon, p.night)}<b>${deg(p.t)}</b><small>${ICON_NAME[p.icon] || ''}</small></li>`).join('');
  const surface = o.surface ? ' (surface)' : '';
  const src = o.source === 'live' ? 'Live forecast · Open-Meteo' : o.source === 'offline' ? 'Simulated outlook (live forecast unavailable offline)' : 'Simulated outlook';
  $('#fc-date').textContent = o.dateLabel;
  host.innerHTML = `
    <ul class="fc-parts">${parts}</ul>
    <div class="fc-meta"><span>High <b>${deg(o.hi)}</b></span><span>Low <b>${deg(o.lo)}</b></span><span>Wind <b>${Math.round(o.windMax)}</b> m/s</span><span>${/snow|show/i.test(o.parts.map((p) => p.icon).join()) || o.rain ? `${o.rain}% precip.` : 'Dry'}</span></div>
    <div class="fc-risk lv${o.risk.level}"><b>${esc(o.risk.head)}</b><span>${esc(o.risk.sub)}</span></div>
    <p class="fc-plan">${esc(o.risk.plan)}</p>
    <p class="fc-src">${esc(src)}${surface}</p>`;
}
