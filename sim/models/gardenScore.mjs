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
// M(f) is noisy (income comes mostly from rare stacks: Click frenzy or Dragonflight on top of
// Frenzy and building specials), so the points are smoothed by a fit: ln M a quadratic in ln f,
// weighed by each point's precision. Its local slope is the exponent k in "income ∝ f^k".
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

/** A curve as JSON keeps it ({ a, b, c, points, … }): back to one with at() and slope(). */
export function curveFrom(o) {
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
