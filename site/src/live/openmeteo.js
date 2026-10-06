// Real weather for Live mode: Open-Meteo (free, no API key, CORS-enabled).
// Falls back to a bundled snapshot if the network is unavailable - the demo must never depend on Wi-Fi.

export const LIVE_LOCATIONS = [
  { key: 'jaisalmer', name: 'Jaisalmer Solar Park', lat: 26.92, lon: 70.9 },
  { key: 'mumbaihigh', name: 'Platform B, Mumbai High', lat: 19.46, lon: 71.33 },
  { key: 'shaybah', name: 'Shaybah Oilfield', lat: 22.51, lon: 53.95 },
  { key: 'deathvalley', name: 'Death Valley Solar', lat: 36.46, lon: -116.87 },
];

const F = 'https://api.open-meteo.com/v1/forecast';
const A = 'https://air-quality-api.open-meteo.com/v1/air-quality';

async function getJson(url, ms = 9000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

/** Normalise API payloads to the compact "day" object the scenario builder expects. */
export function toDay(loc, w, a, source) {
  const n = w.hourly.time.length;
  const pm10 = a?.hourly?.pm10 && a.hourly.pm10.length >= n ? a.hourly.pm10.map((v) => v ?? 60) : new Array(n).fill(60);
  return {
    name: loc.name, lat: loc.lat, lon: loc.lon, tzSec: w.utc_offset_seconds ?? 0,
    dateStr: w.hourly.time[0].slice(0, 10), source, fetchedAt: new Date().toISOString(),
    temp: w.hourly.temperature_2m, rh: w.hourly.relative_humidity_2m, wind: w.hourly.wind_speed_10m,
    ghi: w.hourly.shortwave_radiation, pres: w.hourly.surface_pressure, pm10,
    current: w.current ? { time: w.current.time, temp: w.current.temperature_2m, rh: w.current.relative_humidity_2m, wind: w.current.wind_speed_10m } : null,
  };
}

export async function fetchDay(loc) {
  const base = `latitude=${loc.lat}&longitude=${loc.lon}&timezone=auto&wind_speed_unit=ms&forecast_days=1`;
  const [w, a] = await Promise.allSettled([
    getJson(`${F}?${base}&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,shortwave_radiation,surface_pressure&current=temperature_2m,relative_humidity_2m,wind_speed_10m`),
    getJson(`${A}?${base}&hourly=pm10`),
  ]);
  if (w.status !== 'fulfilled') throw w.reason;
  return toDay(loc, w.value, a.status === 'fulfilled' ? a.value : null, 'live Open-Meteo data');
}

export async function loadDay(loc) {
  try {
    return await fetchDay(loc);
  } catch (err) {
    try {
      const r = await fetch('data/snapshots.json');
      const snaps = await r.json();
      const s = snaps[loc.key];
      if (s) return { ...s, source: `offline snapshot from ${s.fetchedAt?.slice(0, 10) || 'earlier'}`, offline: true };
    } catch { /* fall through */ }
    throw err;
  }
}
