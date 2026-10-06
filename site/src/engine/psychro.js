// Psychrometric helpers shared by the whole engine. Pure functions, no dependencies.

export const C2K = 273.15;
export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

/** Saturation vapour pressure over liquid water, hPa. Buck (1981) with the 1.004
 *  moist-air factor, as used by Liljegren et al. (2008). Input in kelvin. */
export function esatHpa(tK) {
  const y = (tK - 273.15) / (tK - 32.18);
  return 1.004 * 6.1121 * Math.exp(17.502 * y);
}

/** Dew point in kelvin from vapour pressure in hPa. */
export function dewPointK(eHpa) {
  const z = Math.log(eHpa / (6.1121 * 1.004));
  return 273.15 + (240.97 * z) / (17.502 - z);
}

/** Relative humidity (%) from air temperature and dew point (both degC). */
export function rhFromDewPointC(tC, tdC) {
  return clamp((100 * esatHpa(tdC + C2K)) / esatHpa(tC + C2K), 1, 100);
}

/** Water-vapour pressure in kPa. */
export function vapourPressureKpa(tC, rhPct) {
  return ((rhPct / 100) * esatHpa(tC + C2K)) / 10;
}

/** Saturation vapour pressure in kPa. */
export function satVapourPressureKpa(tC) {
  return esatHpa(tC + C2K) / 10;
}

/** Median of a numeric array (does not mutate). */
export function median(arr) {
  if (!arr.length) return NaN;
  const a = [...arr].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : 0.5 * (a[m - 1] + a[m]);
}
