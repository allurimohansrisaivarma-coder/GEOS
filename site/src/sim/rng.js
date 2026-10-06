// Small seeded PRNG so every demo, test and benchmark is exactly reproducible.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  constructor(seed = 1) {
    this.next = mulberry32(seed * 2654435761);
    this.spare = null;
    for (let i = 0; i < 4; i++) this.next(); // decorrelate nearby seeds
  }
  uniform(a = 0, b = 1) { return a + (b - a) * this.next(); }
  int(a, b) { return Math.floor(this.uniform(a, b + 1)); }
  chance(p) { return this.next() < p; }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  normal(mu = 0, sd = 1) {
    if (this.spare != null) { const z = this.spare; this.spare = null; return mu + sd * z; }
    let u = 0, v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    const r = Math.sqrt(-2 * Math.log(u));
    this.spare = r * Math.sin(2 * Math.PI * v);
    return mu + sd * r * Math.cos(2 * Math.PI * v);
  }
}

/** Smooth 0..1 ramp between t0 and t1 (smoothstep). */
export function ramp(t, t0, t1) {
  if (t <= t0) return 0;
  if (t >= t1) return 1;
  const x = (t - t0) / (t1 - t0);
  return x * x * (3 - 2 * x);
}
