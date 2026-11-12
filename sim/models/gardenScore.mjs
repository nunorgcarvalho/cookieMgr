// A garden's score: the income it implies, in multiples of a baseline (unbuffed CpS + 20 clicks a
// second), for one game state.
//
// Two pieces, each from its own model:
//   - the income curve M(f): what golden cookies earn at a steady golden cookie frequency multiplier
//     f, for a save (models/goldenIncome.mjs, the game's own golden cookies, at a handful of f);
//   - the garden: how its frequency bonus g and its CpS multiplier c spread over game time
//     (models/gardenFrequency.mjs: `fine`, the time in each 1-point bin of g, weighed by c).
// The score is the time-average of c × M(1 + g). The CpS cost sits inside the average, since the
// nursetulips take the most CpS exactly when the frequency peaks. A garden changes its frequency
// over tens of minutes to hours, golden cookie effects last a minute or two, so a garden's income
// at each moment is the steady income at its frequency then.
//
// Sampled, M(f) is noisy (income comes mostly from rare stacks: Click frenzy or Dragonflight on top
// of Frenzy and building specials), so the points are smoothed by a fit: ln M a quadratic in ln f,
// weighed by each point's precision. Computed (models/goldenExpected.mjs), the points are within a few
// tenths of a percent, their errors running together (one seed for all), and the curve goes through
// them (a smooth monotone interpolation of ln M in ln f). Either way its local slope is the exponent
// k in "income ∝ f^k".
import { FINE } from './gardenFrequency.mjs';

/** Weighted least squares of ln M = a + b·x + c·x², x = ln f: { a, b, c, at(f), slope(f), points }. */
export function fitCurve(points) {
  const rows = points
    .filter((p) => p.mult > 0)
    .map((p) => {
      const rel = Math.max(0.01, (p.se || 0) / p.mult); // a point's relative error (at least 1%)
      return { x: Math.log(p.f), y: Math.log(p.mult), w: 1 / (rel * rel) };
    });
  if (rows.length < 3) throw new Error('the income curve needs 3 frequencies or more');
  // normal equations, 3×3
  const S = (fn) => rows.reduce((a, r) => a + r.w * fn(r), 0);
  const A = [
    [S(() => 1), S((r) => r.x), S((r) => r.x ** 2)],
    [S((r) => r.x), S((r) => r.x ** 2), S((r) => r.x ** 3)],
    [S((r) => r.x ** 2), S((r) => r.x ** 3), S((r) => r.x ** 4)],
  ];
  const B = [S((r) => r.y), S((r) => r.x * r.y), S((r) => r.x * r.x * r.y)];
  const [a, b, c] = solve3(A, B);
  const at = (f) => Math.exp(a + b * Math.log(f) + c * Math.log(f) ** 2);
  const slope = (f) => b + 2 * c * Math.log(f);
  return { a, b, c, at, slope, points };
}
function solve3(A, B) {
  const m = A.map((row, i) => [...row, B[i]]);
  for (let i = 0; i < 3; i++) {
    let p = i;
    for (let r = i + 1; r < 3; r++) if (Math.abs(m[r][i]) > Math.abs(m[p][i])) p = r;
    [m[i], m[p]] = [m[p], m[i]];
    for (let r = 0; r < 3; r++) {
      if (r === i) continue;
      const k = m[r][i] / m[i][i];
      for (let c = i; c < 4; c++) m[r][c] -= k * m[i][c];
    }
  }
  return m.map((row, i) => row[3] / row[i]);
}

/**
 * Computed points joined smoothly: ln M against ln f, a monotone cubic (Fritsch–Carlson) through every
 * point, straight on past the ends: { at(f), slope(f) }.
 */
export function throughPoints(points) {
  const pts = points.filter((p) => p.mult > 0).sort((a, b) => a.f - b.f);
  if (pts.length < 2) throw new Error('the income curve needs 2 frequencies or more');
  const x = pts.map((p) => Math.log(p.f));
  const y = pts.map((p) => Math.log(p.mult));
  const n = x.length;
  const d = x.slice(1).map((xi, i) => (y[i + 1] - y[i]) / (xi - x[i]));
  const m = x.map((_, i) => (i === 0 ? d[0] : i === n - 1 ? d[n - 2] : d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2));
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const h = a * a + b * b;
    if (h > 9) {
      const t = 3 / Math.sqrt(h);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  const lnAt = (u) => {
    if (u <= x[0]) return { v: y[0] + m[0] * (u - x[0]), s: m[0] };
    if (u >= x[n - 1]) return { v: y[n - 1] + m[n - 1] * (u - x[n - 1]), s: m[n - 1] };
    let i = 0;
    while (u > x[i + 1]) i++;
    const h = x[i + 1] - x[i];
    const t = (u - x[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    const v = (2 * t3 - 3 * t2 + 1) * y[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * y[i + 1] + (t3 - t2) * h * m[i + 1];
    const s = ((6 * t2 - 6 * t) * y[i]) / h + (3 * t2 - 4 * t + 1) * m[i] + ((-6 * t2 + 6 * t) * y[i + 1]) / h + (3 * t2 - 2 * t) * m[i + 1];
    return { v, s };
  };
  return { at: (f) => Math.exp(lnAt(Math.log(f)).v), slope: (f) => lnAt(Math.log(f)).s };
}

/** A curve as JSON keeps it ({ a, b, c, points, expected, … }): back to one with at() and slope(). */
export function curveFrom(o) {
  if (o.expected) return { ...o, ...throughPoints(o.points) };
  const { a, b, c } = o;
  return { ...o, at: (f) => Math.exp(a + b * Math.log(f) + c * Math.log(f) ** 2), slope: (f) => b + 2 * c * Math.log(f) };
}

/**
 * One garden's score against a curve, from its `fine` bins (gardenFrequency.mjs): { income (× the
 * baseline), vsNone (× what no garden earns), share (of the income, by 25-point band of the bonus) }.
 */
export function scoreGarden(fine, curve) {
  let income = 0;
  const share = [];
  fine.forEach((w, k) => {
    if (!w) return;
    const v = w * curve.at(1 + (k + 0.5) * FINE);
    income += v;
    const band = Math.floor((k * FINE) / 0.25 + 1e-9);
    share[band] = (share[band] || 0) + v;
  });
  return { income, vsNone: income / curve.at(1), share: Array.from({ length: share.length }, (_, k) => (share[k] || 0) / income) };
}
