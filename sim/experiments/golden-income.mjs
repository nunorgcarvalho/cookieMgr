// Golden cookie income against golden cookie frequency, for a save: how many times a baseline (unbuffed CpS + 20 clicks/s) golden cookies make it earn at each frequency multiplier.
//
//   npm run sim -- experiment golden-income --save mysave.txt [--pops 1000000] [--bank cookies] [--f 1,1.5,2,2.5,3] [--jobs 4] [--state state.json] [--set key=value …] [--fresh] [--json]
//   npm run sim -- experiment golden-income --save mysave.txt --play [--hours 2000] …     (played instead)
//
// The save's game (or its game state changed with --state / --set, see the golden-state experiment),
// golden cookies clicked as they appear, Elder Pledge on, clicking 20 times a second, an empty
// garden. At each frequency multiplier f, computed (models/goldenExpected.mjs): `pops` golden cookies
// walked through, each credited its expected payoff — seconds a point, a few tenths of a percent, the
// bank held at the save's (or --bank). Or, with --play, `hours` of the game's own golden cookies
// played event to event (models/goldenIncome.mjs, the bank growing): minutes a point, ±5–25%, so a
// fit (ln income a quadratic in ln f) smooths it; computed points are joined as they are. The local
// exponent k says how steep it is there (income ∝ f^k). Kept in sim/out/income/ (--fresh to run it
// again). garden-score uses it to score gardens.
import fs from 'node:fs';
import { cachedIncomeCurve, stateFromArgs } from '../models/goldenIncome.mjs';
import { curveFrom } from '../models/gardenScore.mjs';

const arg = (k, d) => (process.argv.includes(`--${k}`) ? process.argv[process.argv.indexOf(`--${k}`) + 1] : d);
const file = arg('save');
if (!file) throw new Error('--save file: a save string (Options → Export save)');
const json = process.argv.includes('--json');
const play = process.argv.includes('--play');
const opts = {
  save: fs.readFileSync(file, 'utf8').trim(),
  expected: !play,
  pops: Number(arg('pops', 1000000)),
  bank: arg('bank') != null ? Number(arg('bank')) : null,
  state: stateFromArgs(process.argv, (f) => fs.readFileSync(f, 'utf8')),
  hours: Number(arg('hours', 2000)),
  fs: String(arg('f', '1,1.25,1.5,1.75,2,2.25,2.5,2.75,3')).split(',').map(Number),
  jobs: Number(arg('jobs', 4)),
  seed: Number(arg('seed', 1)),
  fresh: process.argv.includes('--fresh'),
};
const t0 = Date.now();
const log = (s) => (json ? process.stderr : process.stdout).write(s + '\n');
log(`${opts.fs.length} frequencies × ${play ? `${opts.hours.toLocaleString()} h played` : `${opts.pops.toLocaleString()} golden cookies computed`}, ${opts.jobs} at a time`);
const curve = curveFrom(
  await cachedIncomeCurve({
    ...opts,
    onPoint: (p, done, total) => log(`  ${done}/${total}  f ${p.f}: ×${p.mult.toFixed(0)} ± ${p.se.toFixed(0)}  (${((Date.now() - t0) / 1000).toFixed(0)} s)`),
  })
);
if (json) {
  // a computed curve's interpolation, tabled for the page (ln income every 0.01 of f, 1 to 6)
  const table = curve.expected ? { f0: 1, step: 0.01, ln: Array.from({ length: 501 }, (_, i) => Math.log(curve.at(1 + i * 0.01))) } : undefined;
  process.stdout.write(JSON.stringify({ ...curve, at: undefined, slope: undefined, table }));
} else {
  const s = curve.state;
  console.log(`\n${curve.cached ? '(kept from an earlier run) ' : ''}baseline ${curve.base.toExponential(3)} cookies/s = CpS ${s.cps.toExponential(3)} + ${s.clicks} clicks × ${s.click.toExponential(3)}`);
  console.log(`auras ${s.auras.join(' + ') || 'none'} · season ${s.season || 'none'} · Grandmapocalypse ${s.elderWrath} · gods ${s.gods.join(', ') || 'none'}\n`);
  console.log('   f   income ×baseline      fit   k (income ∝ f^k)   golden cookies / h   from clicks');
  for (const p of curve.points)
    console.log(
      `${p.f.toFixed(2).padStart(5)}   ${p.mult.toFixed(0).padStart(7)} ± ${p.se.toFixed(0).padEnd(6)}  ${curve.at(p.f).toFixed(0).padStart(7)}   ${curve.slope(p.f).toFixed(2).padStart(10)}         ${p.golden.toFixed(1).padStart(10)}          ${((p.parts.clicks / p.mult) * 100).toFixed(0)}%`
    );
  if (curve.expected) console.log(`\ncomputed (${curve.pops.toLocaleString()} golden cookies a point), the bank held at ${curve.points[0].bank.toExponential(3)}: the curve goes through the points`);
  else console.log(`\nfit: ln income = ${curve.a.toFixed(3)} + ${curve.b.toFixed(3)}·ln f + ${curve.c.toFixed(3)}·(ln f)²`);
}
