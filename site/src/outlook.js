// Tomorrow's outlook for the site: four day-parts with a weather pictogram, plus what it means for work.
//   * Live mode: the real Open-Meteo forecast for tomorrow (falls back to the simulated outlook when offline).
//   * Simulated mode: a made-up but physically consistent "tomorrow" built from the same diurnal model the
//     simulated shift uses, so the numbers agree with what the crew is experiencing today.
// Heat risk is computed with the same WBGT engine and NIOSH limits as the live pipeline; cold risk with the same
// wind-chill and frostbite tables. Nothing here is hand-typed except the weather types of the simulated day.

import { thermalEnvironment } from './engine/wbgt.js';
import { solarGeometry, clearSkyGhi } from './engine/solar.js';
import { rhFromDewPointC } from './engine/psychro.js';
import { wbgtLimit, heatCategory } from './engine/limits.js';
import { windChillC, frostbiteMinutes, FROSTBITE_START_C } from './engine/cold.js';

const WIND_10M_TO_2M = Math.pow(2 / 10, 0.15);
const HOUR = 3600000;

// Four day-parts: [label, sample hour, first hour, last hour]
const PARTS = [['Night', 3, 22, 5], ['Morning', 9, 6, 11], ['Afternoon', 15, 12, 17], ['Evening', 20, 18, 21]];
const partOf = (h) => (h >= 22 || h <= 5 ? 0 : h <= 11 ? 1 : h <= 17 ? 2 : 3);

/** Weather types: sunny, clear (night), partly, cloudy, haze, dust, showers, rain, snow, storm, fog. */
const SOLAR_FACTOR = { sunny: 1, clear: 1, partly: 0.7, cloudy: 0.35, haze: 0.8, dust: 0.65, showers: 0.3, rain: 0.2, snow: 0.1, storm: 0.15, fog: 0.4 };

// What tomorrow looks like at each simulated site (the diurnal numbers sit next to today's in sim/scenarios.js).
const SIM = {
  jaisalmer: { P: { tMean: 38.5, tAmp: 7.5, tPeakH: 15.5, dewC: 8, wind10: 3.0, kt: 0.97, pressure: 1003 }, conds: ['clear', 'sunny', 'sunny', 'haze'], rain: 0, note: 'Hot, dry and hazy by evening' },
  platformb: { P: { tMean: 31.0, tAmp: 1.5, tPeakH: 14.5, dewC: 25.0, wind10: 7.5, kt: 0.72, pressure: 1006 }, conds: ['partly', 'partly', 'showers', 'cloudy'], rain: 45, note: 'Humid with afternoon showers' },
  witbank: { P: { tMean: 13.0, tAmp: 9.5, tPeakH: 14.5, dewC: -2, wind10: 3.0, kt: 0.9, pressure: 850 }, conds: ['clear', 'sunny', 'sunny', 'clear'], rain: 0, note: 'Surface: dry and sunny', underground: { tAirC: 30.5, dewC: 25.0, wind: 1.5, pressure: 1060 } },
  norilsk: { P: { tMean: -22.0, tAmp: 2.5, tPeakH: 14, dewC: -26, wind10: 6.0, kt: 0.1, pressure: 1008 }, conds: ['snow', 'snow', 'cloudy', 'clear'], rain: 60, note: 'Snow showers, then clearing' },
};

function analyse({ hours, lat, lon, midnightUtcMs, cold, undergroundWbgt }) {
  const rows = hours.map((x, h) => {
    const geom = solarGeometry(midnightUtcMs + h * HOUR, lat, lon);
    const th = thermalEnvironment({ tAirC: x.t, rhPct: x.rh, pressureHpa: x.pres, wind2m: Math.max(0.2, x.wind * WIND_10M_TO_2M), solarWm2: x.ghi, geom });
    return { h, t: x.t, wbgt: th.sun.wbgt, wc: windChillC(x.t, x.wind) };
  });
  const day = rows.filter((r) => r.h >= 5 && r.h <= 20);
  const hh = (h) => `${String(h).padStart(2, '0')}:00`;
  if (undergroundWbgt != null) {
    const cat = heatCategory(undergroundWbgt);
    return { kind: 'underground', head: `Coal face WBGT ~${undergroundWbgt.toFixed(1)} °C`, level: cat[1], sub: `${cat[0]} heat load, steady all day if ventilation holds`, plan: 'Underground temperature barely changes with the weather; ventilation is what matters.' };
  }
  if (cold) {
    const low = day.reduce((a, b) => (b.wc < a.wc ? b : a));
    const tf = frostbiteMinutes(low.wc);
    const level = low.wc > -10 ? 0 : low.wc > FROSTBITE_START_C ? 1 : low.wc > -40 ? 2 : 3;
    const head = `Lowest wind chill ${Math.round(low.wc)} °C at ${hh(low.h)}`;
    const sub = Number.isFinite(tf) ? `Exposed skin can freeze in ~${Math.round(tf)} min` : `No frostbite expected (above ${FROSTBITE_START_C} °C)`;
    const mild = day.filter((r) => r.wc > FROSTBITE_START_C);
    const plan = !Number.isFinite(tf) ? 'Normal warm-up breaks are enough.'
      : mild.length ? `Outdoor work is easiest around ${hh(mild[0].h)} (wind chill ${Math.round(mild[0].wc)} °C). Keep outdoor stints short at other times.`
        : 'Wind chill stays in the frostbite range all day: short outdoor stints with warm-up breaks.';
    return { kind: 'cold', head, level, sub, plan };
  }
  const peak = day.reduce((a, b) => (b.wbgt > a.wbgt ? b : a));
  const cat = heatCategory(peak.wbgt);
  const lim = wbgtLimit(415, true); // heavy work, acclimatised
  const ok = day.filter((r) => r.wbgt < lim);
  let plan;
  if (!ok.length) plan = `No hour is inside the ${lim.toFixed(1)} °C heavy-work limit: use rest cycles all day.`;
  else {
    let a = ok[0].h, b = ok[0].h;
    const blocks = [];
    for (const r of ok.slice(1)) { if (r.h === b + 1) b = r.h; else { blocks.push([a, b]); a = b = r.h; } }
    blocks.push([a, b]);
    const best = blocks.reduce((x, y) => (y[1] - y[0] > x[1] - x[0] ? y : x));
    plan = `Heavy work stays inside the limit ${hh(best[0])} to ${hh(best[1] + 1)}; plan the hard tasks then.`;
  }
  return { kind: 'heat', head: `Peak WBGT ${peak.wbgt.toFixed(1)} °C at ${hh(peak.h)}`, level: cat[1], sub: `${cat[0]} heat load`, plan };
}

function summarise(hours, conds, rainPct, source, note, dateLabel, extra) {
  const temps = hours.map((x) => x.t);
  const parts = PARTS.map(([label, sample], i) => ({ label, icon: conds[i], t: hours[sample].t, night: i === 0 || i === 3 }));
  return {
    source, note, dateLabel, parts,
    hi: Math.max(...temps), lo: Math.min(...temps), windMax: Math.max(...hours.map((x) => x.wind)), rain: rainPct,
    ...extra,
  };
}

/** The simulated outlook for the current plant (works offline, deterministic). */
export function simOutlook(S) {
  const spec = SIM[S.plantId] || SIM.jaisalmer;
  const scn = S.scn;
  const P = spec.P;
  const midnightUtcMs = scn.startUtcMs - scn.startLocalH * HOUR + 24 * HOUR;
  const { lat, lon } = scn.site;
  const hours = Array.from({ length: 24 }, (_, h) => {
    const t = P.tMean + P.tAmp * Math.cos((2 * Math.PI * (h - P.tPeakH)) / 24);
    const geom = solarGeometry(midnightUtcMs + h * HOUR, lat, lon);
    const f = SOLAR_FACTOR[spec.conds[partOf(h)]] ?? 0.7;
    return { t, rh: rhFromDewPointC(t, Math.min(P.dewC, t - 1)), wind: P.wind10, ghi: scn.env?.underground ? 0 : clearSkyGhi(geom.cza) * P.kt * f, pres: P.pressure };
  });
  let undergroundWbgt = null;
  if (spec.underground) {
    const u = spec.underground;
    const g = solarGeometry(midnightUtcMs, lat, lon);
    undergroundWbgt = thermalEnvironment({ tAirC: u.tAirC, rhPct: rhFromDewPointC(u.tAirC, u.dewC), pressureHpa: u.pressure, wind2m: Math.max(0.2, u.wind * WIND_10M_TO_2M), solarWm2: 0, geom: g }).sun.wbgt;
  }
  const dateLabel = new Date(midnightUtcMs + scn.tzMin * 60000 + 12 * HOUR).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const risk = analyse({ hours, lat, lon, midnightUtcMs, cold: !!scn.cold, undergroundWbgt });
  return summarise(hours, spec.conds, spec.rain, 'simulated', spec.note, dateLabel, { risk, surface: !!spec.underground });
}

// ---- live (Open-Meteo, tomorrow) ----
const WMO = (c) => (c === 0 ? 'sunny' : c <= 2 ? 'partly' : c === 3 ? 'cloudy' : c <= 48 ? 'fog' : c <= 57 ? 'showers' : c <= 67 ? 'rain' : c <= 77 ? 'snow' : c <= 82 ? 'showers' : c <= 86 ? 'snow' : 'storm');

export async function liveOutlook(S, loc) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&timezone=auto&wind_speed_unit=ms&forecast_days=2&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,shortwave_radiation,surface_pressure,weather_code,precipitation_probability`;
  const ctl = new AbortController();
  const tm = setTimeout(() => ctl.abort(), 9000);
  let w;
  try { const r = await fetch(url, { signal: ctl.signal }); if (!r.ok) throw new Error(`HTTP ${r.status}`); w = await r.json(); } finally { clearTimeout(tm); }
  const H = w.hourly;
  if (!H || H.time.length < 48) throw new Error('forecast too short');
  const tz = w.utc_offset_seconds ?? 0;
  const [y, m, d] = H.time[24].slice(0, 10).split('-').map(Number);
  const midnightUtcMs = Date.UTC(y, m - 1, d) - tz * 1000;
  const at = (k) => 24 + k;
  const hours = Array.from({ length: 24 }, (_, h) => ({
    t: H.temperature_2m[at(h)], rh: H.relative_humidity_2m[at(h)] ?? 50, wind: H.wind_speed_10m[at(h)] ?? 1,
    ghi: H.shortwave_radiation[at(h)] ?? 0, pres: H.surface_pressure[at(h)] ?? 1005,
  }));
  const conds = PARTS.map(([, sample], i) => { const c = WMO(H.weather_code[at(sample)] ?? 0); return i === 0 || i === 3 ? (c === 'sunny' ? 'clear' : c) : c; });
  const rain = Math.max(...H.precipitation_probability.slice(24, 48).map((v) => v ?? 0));
  const dateLabel = new Date(midnightUtcMs + tz * 1000 + 12 * HOUR).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const risk = analyse({ hours, lat: loc.lat, lon: loc.lon, midnightUtcMs, cold: !!S.scn.cold });
  return summarise(hours, conds, rain, 'live', 'Real forecast from Open-Meteo', dateLabel, { risk });
}
