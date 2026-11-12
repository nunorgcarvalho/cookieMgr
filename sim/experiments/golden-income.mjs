// Golden cookie income against golden cookie frequency, for a save: how many times a baseline (unbuffed CpS + 20 clicks/s) golden cookies make it earn at each frequency multiplier.
//
//   npm run sim -- experiment golden-income --save mysave.txt [--hours 2000] [--f 1,1.5,2,2.5,3] [--jobs 4] [--state state.json] [--set key=value …] [--fresh] [--json]
//
// models/goldenIncome.mjs: the save's game (or its game state changed with --state / --set, see the
// golden-state experiment), golden cookies clicked as they appear, Elder Pledge on, clicking 20 times
// a second, an empty garden; at each frequency multiplier f, `hours` of play with the game's own
// golden cookies, jumping from one event to the next. Then a fit (ln income a quadratic in ln f) that
// smooths the noise: income comes mostly from rare stacks of effects. The local exponent k says how
// steep it is there (income ∝ f^k). Kept in sim/out/income/ (--fresh to run it again). garden-score
// uses it to score gardens.
import fs from 'node:fs';
import { cachedIncomeCurve, stateFromArgs } from '../models/goldenIncome.mjs';
import { curveFrom } from '../models/gardenScore.mjs';

const arg = (k, d) => (process.argv.includes(`--${k}`) ? process.argv[process.argv.indexOf(`--${k}`) + 1] : d);
const file = arg('save');
if (!file) throw new Error('--save file: a save string (Options → Export save)');
const json = process.argv.includes('--json');
const opts = {
  save: fs.readFileSync(file, 'utf8').trim(),
  state: stateFromArgs(process.argv, (f) => fs.readFileSync(f, 'utf8')),
  hours: Number(arg('hours', 2000)),
  fs: String(arg('f', '1,1.25,1.5,1.75,2,2.25,2.5,2.75,3')).split(',').map(Number),
  jobs: Number(arg('jobs', 4)),
  seed: Number(arg('seed', 1)),
  fresh: process.argv.includes('--fresh'),
};
const t0 = Date.now();
const log = (s) => (json ? process.stderr : process.stdout).write(s + '\n');
log(`${opts.fs.length} frequencies × ${opts.hours.toLocaleString()} h, ${opts.jobs} at a time`);
const curve = curveFrom(
  await cachedIncomeCurve({
    ...opts,
    onPoint: (p, done, total) => log(`  ${done}/${total}  f ${p.f}: ×${p.mult.toFixed(0)} ± ${p.se.toFixed(0)}  (${((Date.now() - t0) / 1000).toFixed(0)} s)`),
  })
);
if (json) {
  process.stdout.write(JSON.stringify({ ...curve, at: undefined, slope: undefined }));
} else {
  const s = curve.state;
  console.log(`\n${curve.cached ? '(kept from an earlier run) ' : ''}baseline ${curve.base.toExponential(3)} cookies/s = CpS ${s.cps.toExponential(3)} + ${s.clicks} clicks × ${s.click.toExponential(3)}`);
  console.log(`auras ${s.auras.join(' + ') || 'none'} · season ${s.season || 'none'} · Grandmapocalypse ${s.elderWrath} · gods ${s.gods.join(', ') || 'none'}\n`);
  console.log('   f   income ×baseline      fit   k (income ∝ f^k)   golden cookies / h   from clicks');
  for (const p of curve.points)
    console.log(
      `${p.f.toFixed(2).padStart(5)}   ${p.mult.toFixed(0).padStart(7)} ± ${p.se.toFixed(0).padEnd(6)}  ${curve.at(p.f).toFixed(0).padStart(7)}   ${curve.slope(p.f).toFixed(2).padStart(10)}         ${p.golden.toFixed(1).padStart(10)}          ${((p.parts.clicks / p.mult) * 100).toFixed(0)}%`
    );
  console.log(`\nfit: ln income = ${curve.a.toFixed(3)} + ${curve.b.toFixed(3)}·ln f + ${curve.c.toFixed(3)}·(ln f)²`);
}
