// Cold stress: wind chill and the time until exposed skin freezes.
// Wind chill: Joint Action Group for Indices (JAG/TI, 2001), the formula used by Environment Canada and the US NWS.
// Frostbite times follow the NWS chart: roughly 30 min at -27 C, 10 min at -40 C and 2 min at -55 C wind chill.

/** @param {number} tC air temperature (C) @param {number} wind10ms wind at 10 m (m/s) */
export function windChillC(tC, wind10ms) {
  const v = wind10ms * 3.6; // km/h
  if (tC > 10 || v < 4.8) return tC;
  const p = Math.pow(v, 0.16);
  return 13.12 + 0.6215 * tC - 11.37 * p + 0.3965 * tC * p;
}

/** Minutes until exposed skin freezes at this wind chill (Infinity when it is mild enough not to). */
export function frostbiteMinutes(wc) {
  if (wc > -27) return Infinity;
  const pts = [[-27, 30], [-40, 10], [-55, 2]];
  if (wc <= -55) return 2;
  for (let k = 0; k < pts.length - 1; k++) {
    const [a, ta] = pts[k], [b, tb] = pts[k + 1];
    if (wc <= a && wc >= b) {
      const f = (a - wc) / (a - b);
      return Math.exp(Math.log(ta) + f * (Math.log(tb) - Math.log(ta)));
    }
  }
  return 30;
}

/** [label, level 0-3] for a wind chill value. */
export function coldCategory(wc) {
  return wc > -10 ? ['Mild', 0] : wc > -27 ? ['Cold', 1] : wc > -40 ? ['Severe cold', 2] : ['Extreme cold', 3];
}
