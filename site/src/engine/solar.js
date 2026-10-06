// Sun position (NOAA low-precision algorithm, ~0.1 deg) and a clear-sky irradiance model.
// Used to turn "time + place" into the cosine of the solar zenith angle that the WBGT
// model needs, so the engine works from a plain weather-station feed (no solar-angle sensor).

import { clamp } from './psychro.js';

const RAD = Math.PI / 180;

/** @param {number} utcMs epoch milliseconds (UTC)
 *  @returns {{cza:number, elevationDeg:number, distanceAU:number}} */
export function solarGeometry(utcMs, latDeg, lonDeg) {
  const jd = utcMs / 86400000 + 2440587.5;
  const T = (jd - 2451545.0) / 36525.0;
  const L0 = (((280.46646 + T * (36000.76983 + T * 0.0003032)) % 360) + 360) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const Mr = M * RAD;
  const C =
    Math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(2 * Mr) * (0.019993 - 0.000101 * T) +
    Math.sin(3 * Mr) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD));

  const y = Math.tan((eps * RAD) / 2) ** 2;
  const L0r = L0 * RAD;
  const eqTime =
    (4 / RAD) *
    (y * Math.sin(2 * L0r) -
      2 * e * Math.sin(Mr) +
      4 * e * y * Math.sin(Mr) * Math.cos(2 * L0r) -
      0.5 * y * y * Math.sin(4 * L0r) -
      1.25 * e * e * Math.sin(2 * Mr)); // minutes

  const utcMin = (((utcMs / 60000) % 1440) + 1440) % 1440;
  const trueSolarMin = (((utcMin + eqTime + 4 * lonDeg) % 1440) + 1440) % 1440;
  const hourAngle = (trueSolarMin / 4 - 180) * RAD;
  const lat = latDeg * RAD;
  const cza = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle);

  const nu = (M + C) * RAD;
  const distanceAU = (1.000001018 * (1 - e * e)) / (1 + e * Math.cos(nu));
  return { cza, elevationDeg: 90 - Math.acos(clamp(cza, -1, 1)) / RAD, distanceAU };
}

/** Haurwitz clear-sky global horizontal irradiance (W/m2). */
export function clearSkyGhi(cza) {
  return cza > 0.02 ? 1098 * cza * Math.exp(-0.057 / cza) : 0;
}
