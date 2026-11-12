// Scores garden strategies for a save: the income each implies, in multiples of a baseline (unbuffed CpS + 20 clicks/s) — its frequency spread over time, through the save's income curve.
//
//   npm run sim -- experiment garden-score --save mysave.txt [--level 9] [--tulips 4,8] [--garden-hours 1000] [--seeds 3] [--pops 1000000 | --play --hours 2000] [--state state.json] [--set key=value …] [--json]
//   npm run sim -- experiment garden-score --curve curve.json …     (a golden-income --json result)
//   npm run sim -- experiment garden-score --save mysave.txt --follow [--follow-hours 20000] [--follow-seeds 2]
//   npm run sim -- experiment garden-score --save mysave.txt --grimoire default     (a spell plan casting: models/grimoire.mjs)
//
// models/gardenScore.mjs: each gardener's golden cookie frequency and CpS over game time (the Garden
// page's fast model, models/gardenFrequency.mjs), and the save's income curve (golden-income:
// computed, or with --play played and fitted, once per save and state, then kept). The score is the time-average of CpS factor × income(f): an
// expected income over any long stretch of play (24 h or more), golden cookies clicked as they appear.
// Also: the same over the first 24 h from an empty plot, and the share of the income by bonus band.
// --follow checks the curve's shortcut (the frequency treated as steady at each moment): the computed walk
// follows each gardener's own frequency and CpS over game time instead (minutes, not seconds; the two
// agree within about 1% for the gardeners worth having).
import fs from 'node:fs';
import { cachedIncomeCurve, goldenIncomeGame, stateFromArgs } from '../models/goldenIncome.mjs';
import { expectedAt } from '../models/goldenExpected.mjs';
import { gardenData } from '../models/gardenData.mjs';
import { frequencyStudy, runGarden } from '../models/gardenFrequency.mjs';
import { curveFrom, scoreGarden } from '../models/gardenScore.mjs';
import { planById, sweepPlans } from '../models/grimoire.mjs';

const arg = (k, d) => (process.argv.includes(`--${k}`) ? process.argv[process.argv.indexOf(`--${k}`) + 1] : d);
const json = process.argv.includes('--json');
const log = (s) => (json ? process.stderr : process.stdout).write(s + '\n');
// --grimoire: a spell plan's id (or a JSON file with its spec), cast as the plan says
const gArg = arg('grimoire');
const grimoire = !gArg ? null : gArg.endsWith('.json') ? JSON.parse(fs.readFileSync(gArg, 'utf8')) : (planById(gArg) || sweepPlans().find((p) => p.id === gArg) || { spec: undefined }).spec;
if (gArg && grimoire === undefined) throw new Error(`--grimoire: no plan "${gArg}"`);
let curve;
if (arg('curve')) curve = curveFrom(JSON.parse(fs.readFileSync(arg('curve'), 'utf8')));
else {
  if (!arg('save')) throw new Error('--save file (a save string) or --curve file (a golden-income --json result)');
  const t0 = Date.now();
  curve = curveFrom(
    await cachedIncomeCurve({
      save: fs.readFileSync(arg('save'), 'utf8').trim(),
      state: stateFromArgs(process.argv, (f) => fs.readFileSync(f, 'utf8')),
      hours: Number(arg('hours', 2000)),
      expected: !process.argv.includes('--play'),
      pops: Number(arg('pops', 1000000)),
      fs: String(arg('f', '1,1.25,1.5,1.75,2,2.25,2.5,2.75,3')).split(',').map(Number),
      jobs: Number(arg('jobs', 4)),
      grimoire,
      onPoint: (p, done, total) => log(`  income curve ${done}/${total}: f ${p.f} ×${p.mult.toFixed(0)} (${((Date.now() - t0) / 1000).toFixed(0)} s)`),
    })
  );
}
const data = await gardenData();
const level = Number(arg('level', 9));
const tulips = String(arg('tulips', '4,8')).split(',').filter(Boolean).map(Number);
const study = frequencyStudy(data, { level, hours: Number(arg('garden-hours', 1000)), seeds: Number(arg('seeds', 3)), tulips });
const first = frequencyStudy(data, { level, hours: 24, seeds: 50, tulips });
const results = study.results.map((r, i) => ({ ...r, score: scoreGarden(r.fine, curve), first24: scoreGarden(first.results[i].fine, curve) }));
if (process.argv.includes('--follow')) {
  if (!arg('save')) throw new Error('--follow needs --save (it plays the walk on the game)');
  const g = await goldenIncomeGame({ save: fs.readFileSync(arg('save'), 'utf8').trim(), state: stateFromArgs(process.argv, (f) => fs.readFileSync(f, 'utf8')) });
  const hours = Number(arg('follow-hours', 20000));
  const seeds = Number(arg('follow-seeds', 2));
  const pops = Number(arg('pops', 1000000));
  for (const r of results) {
    // the garden's bonus and CpS stretch by stretch, looped, as the walk's timer
    const T = [];
    const B = [];
    const C = [];
    runGarden(data, { ...r, w: study.w, h: study.h, hours, seed: 1, onStretch: (t, d, gc, cps) => (T.push(t), B.push(gc), C.push(cps)) });
    const end = hours * 3600;
    const schedule = (secs) => {
      const x = secs % end;
      let lo = 0;
      let hi = T.length - 1;
      while (lo < hi) {
        const m = (lo + hi + 1) >> 1;
        if (T[m] <= x) lo = m;
        else hi = m - 1;
      }
      return { f: 1 + B[lo], cps: C[lo] };
    };
    const runs = [];
    for (let s = 1; s <= seeds; s++) runs.push(expectedAt(g, 1, { pops, seed: s, schedule, grimoire }));
    r.followed = { income: runs.reduce((a, x) => a + x.mult, 0) / seeds, runs: runs.map((x) => x.mult) };
    log(`  followed ${r.name}: ×${r.followed.income.toFixed(0)} (curve ×${r.score.income.toFixed(0)})`);
  }
}
results.sort((a, b) => b.score.income - a.score.income);
if (json) {
  process.stdout.write(JSON.stringify({ curve: { ...curve, at: undefined, slope: undefined }, level, w: study.w, h: study.h, results }));
} else {
  const none = curve.at(1);
  console.log(`\nFarm level ${level} (${study.w}×${study.h}); no garden: ×${none.toFixed(0)} the baseline\n`);
  const follow = results[0].followed;
  console.log('Gardener'.padEnd(64) + 'income ×baseline   vs no garden   first 24 h   mean bonus   CpS' + (follow ? '      followed' : ''));
  for (const r of results)
    console.log(
      `${r.name.slice(0, 62).padEnd(64)}${r.score.income.toFixed(0).padStart(10)}       ×${r.score.vsNone.toFixed(1).padStart(5)}      ${r.first24.income.toFixed(0).padStart(8)}      +${(r.mean * 100).toFixed(0)}%      ×${r.cps.toFixed(3)}` +
        (follow ? `   ×${r.followed.income.toFixed(0)} (${r.followed.income >= r.score.income ? '+' : ''}${((r.followed.income / r.score.income - 1) * 100).toFixed(1)}%)` : '')
    );
}
