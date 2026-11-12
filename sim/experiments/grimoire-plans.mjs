// The best Grimoire play for a garden: spell plans (Force the Hand of Fate's cast tiers, other spells) scored with each of the add-on's golden cookie gardens, in multiples of a baseline.
//
//   npm run sim -- experiment grimoire-plans --save mysave.txt [--plans default,regular0,…] [--sweep] [--pops 300000] [--f 1,1.5,2,2.5,3] [--jobs 4] [--level 9] [--state state.json] [--set key=value …] [--json]
//   npm run sim -- experiment grimoire-plans --save mysave.txt --follow [--follow-pops 2000000] [--follow-seeds 1] …   (the walk follows each garden over time)
//   npm run sim -- experiment grimoire-plans --save mysave.txt --play [--hours 2000] [--plans none,default]  (the game's own spells, played: the slow check)
//
// Everything comes from the fast computed model (models/goldenExpected.mjs), the Grimoire inside it:
// magic refilling as the game refills it, and each plan (models/grimoire.mjs) casting when its rule
// says, every spell's outcome at its odds (Force the Hand of Fate's golden cookie and its backfire's
// wrath cookie, Stretch Time, Diminish Ineptitude, Conjure Baked Goods). For each plan, the save's
// income curve with that plan (income at each golden cookie frequency, kept in sim/out/income/), then
// each garden's time at each frequency, CpS cost included (models/gardenFrequency.mjs), through it
// (models/gardenScore.mjs). The gardens are the add-on's two golden cookie profiles: Golden clover
// combos and 8 nursetulips together (golden tulips). --follow walks each garden's own frequency and
// CpS over game time with the plan casting (the garden and the Grimoire together, no shortcut).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { cachedIncomeCurve, goldenIncomeGame, stateFromArgs } from '../models/goldenIncome.mjs';
import { expectedAt, goldenParams } from '../models/goldenExpected.mjs';
import { PLANS, sweepPlans, planById } from '../models/grimoire.mjs';
import { gardenData } from '../models/gardenData.mjs';
import { ADDON_GARDENS, BIN, frequencyStudy, runGarden } from '../models/gardenFrequency.mjs';
import { curveFrom, scoreGarden } from '../models/gardenScore.mjs';

const arg = (k, d) => (process.argv.includes(`--${k}`) ? process.argv[process.argv.indexOf(`--${k}`) + 1] : d);
const json = process.argv.includes('--json');
const play = process.argv.includes('--play');
const log = (s) => (json ? process.stderr : process.stdout).write(s + '\n');
if (!arg('save')) throw new Error('--save file: a save string (Options → Export save)');
const save = fs.readFileSync(arg('save'), 'utf8').trim();
const state = stateFromArgs(process.argv, (f) => fs.readFileSync(f, 'utf8'));
let plans = arg('plans') ? String(arg('plans')).split(',').map((id) => planById(id) || sweepPlans().find((p) => p.id === id)) : PLANS;
if (plans.some((p) => !p)) throw new Error(`--plans: ids from ${PLANS.map((p) => p.id).join(', ')} (or a sweep's)`);
if (process.argv.includes('--sweep')) plans = [...plans, ...sweepPlans().filter((s) => !plans.some((p) => p.id === s.id))];
const fsList = String(arg('f', '1,1.25,1.5,1.75,2,2.25,2.5,2.75,3')).split(',').map(Number);
const pops = Number(arg('pops', 300000));
const hours = Number(arg('hours', 2000));
const jobs = Number(arg('jobs', 4));

// the gardens: the add-on's two profiles, on the Farm level's plot
const data = await gardenData();
const level = Number(arg('level', 9));
const study = frequencyStudy(data, { level, hours: Number(arg('garden-hours', 1000)), seeds: Number(arg('seeds', 3)), tulips: [8], only: ADDON_GARDENS.map((g) => g.id) });
const gardens = ADDON_GARDENS.map((a) => {
  const r = study.results.find((x) => x.id === a.id);
  const atLeast = (x) => r.bins.reduce((s, v, k) => s + (k * BIN >= x - 1e-9 ? v : 0), 0);
  return { ...r, name: a.name, profile: a.profile, at140: atLeast(1.4), at100: atLeast(1) };
});
const none = { id: 'noGarden', name: 'No garden', fine: [1], mean: 0, cps: 1, at140: 0, at100: 0 };

// the game's Grimoire, as the plans see it
const g0 = await goldenIncomeGame({ save, state });
const P0 = goldenParams(g0.Game, { clicks: g0.clicks });
if (!P0.grimoire) throw new Error('this save has no Grimoire (a Wizard tower with its minigame)');
const grimoire = { magicM: P0.grimoire.magicM, fail: P0.grimoire.fail, costs: P0.grimoire.costs, refill: P0.grimoire.regen.length / P0.fps };

const t0 = Date.now();
const results = [];
for (const [i, plan] of plans.entries()) {
  const curve = curveFrom(
    await cachedIncomeCurve({
      save,
      state,
      fs: fsList,
      expected: !play,
      pops,
      hours,
      jobs,
      grimoire: plan.spec,
      bank: play ? g0.Game.cookies : null,
      onPoint: (p, done, total) => log(`  ${plan.name}: ${done}/${total} f ${p.f} ×${p.mult.toFixed(0)} (${((Date.now() - t0) / 1000).toFixed(0)} s)`),
    })
  );
  const scores = Object.fromEntries([none, ...gardens].map((gd) => [gd.id, scoreGarden(gd.fine, curve)]));
  results.push({ id: plan.id, group: plan.group, name: plan.name, desc: plan.desc, spec: plan.spec, points: curve.points, scores, cached: !!curve.cached });
  log(`${i + 1}/${plans.length} ${plan.name}: ${gardens.map((gd) => `${gd.name} ×${scores[gd.id].income.toFixed(0)}`).join(', ')}`);
}

// --follow: the walk follows each garden over game time, the plan casting (no steady-frequency shortcut):
// the garden and the Grimoire together, and the scores the ranking uses (no garden: a steady +0%)
if (process.argv.includes('--follow')) {
  const fh = Number(arg('follow-hours', 20000));
  const seeds = Number(arg('follow-seeds', 1));
  const fpops = Number(arg('follow-pops', 2000000));
  // each followed walk kept in sim/out/income/ (as the curves are), so the GUI shows a long run made once
  const dir = new URL('../out/income/', import.meta.url).pathname;
  const followed = (gd, seed, spec, run) => {
    const inputs = { v: 1, kind: 'grimoire-follow', save, state, level, garden: gd.id, fh, seed, pops: fpops, spec };
    const file = path.join(dir, `follow-${crypto.createHash('sha1').update(JSON.stringify(inputs)).digest('hex').slice(0, 16)}.json`);
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
    const { mult, se, casts, spells, parts } = run();
    const out = { mult, se, casts: casts || null, spells: spells || null, parts };
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(out));
    return out;
  };
  for (const gd of [none, ...gardens]) {
    let schedule = () => ({ f: 1, cps: 1 });
    if (gd !== none) {
      const T = [];
      const B = [];
      const C = [];
      runGarden(data, { ...gd, w: study.w, h: study.h, hours: fh, seed: 1, onStretch: (t, d, gc, cps) => (T.push(t), B.push(gc), C.push(cps)) });
      const end = fh * 3600;
      schedule = (secs) => {
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
    }
    for (const r of results) {
      const runs = [];
      for (let s = 1; s <= seeds; s++) runs.push(followed(gd, s, r.spec, () => expectedAt(g0, 1, { pops: fpops, seed: s, schedule, grimoire: r.spec })));
      const mean = runs.reduce((a, x) => a + x.mult, 0) / seeds;
      r.scores[gd.id].followed = mean;
      r.scores[gd.id].followedSe = Math.sqrt(runs.reduce((a, x) => a + x.se * x.se, 0)) / seeds;
      r.scores[gd.id].followedCasts = runs[0].casts || null;
      r.scores[gd.id].followedSpells = runs[0].spells || null;
      r.scores[gd.id].followedParts = runs[0].parts;
      log(`  followed ${gd.name}, ${r.name}: ×${mean.toFixed(0)} ± ${r.scores[gd.id].followedSe.toFixed(0)} (curve ×${r.scores[gd.id].income.toFixed(0)})`);
    }
  }
}

// a score: the followed walk's when there is one, else the curve's
const score = (r, id) => (r.scores[id].followed != null ? r.scores[id].followed : r.scores[id].income);
const best = Object.fromEntries([none, ...gardens].map((gd) => [gd.id, [...results].sort((a, b) => score(b, gd.id) - score(a, gd.id))[0].id]));
const out = { state: g0.state, base: g0.base, grimoire, level, w: study.w, h: study.h, expected: !play, pops: play ? null : pops, hours: play ? hours : null, fs: fsList, gardens: [none, ...gardens].map(({ fine, bins, ...g }) => ({ ...g, bins: bins || null })), plans: results, best };
if (json) process.stdout.write(JSON.stringify(out));
else {
  console.log(`\nmagic ${grimoire.magicM}, Force the Hand of Fate ${grimoire.costs.fthof} (backfires ${(grimoire.fail * 100).toFixed(0)}%), Stretch Time ${grimoire.costs.stretch}, Diminish Ineptitude ${grimoire.costs.adept}, Conjure Baked Goods ${grimoire.costs.conjure}`);
  for (const gd of [none, ...gardens]) {
    console.log(`\n${gd.name}${gd.mean ? ` (golden cookies +${(gd.mean * 100).toFixed(0)}% on average, ≥ +140% ${(gd.at140 * 100).toFixed(0)}% of the time, CpS ×${gd.cps.toFixed(3)})` : ''}`);
    const rows = [...results].sort((a, b) => score(b, gd.id) - score(a, gd.id));
    const ref = results.find((r) => r.id === 'default') || rows[0];
    for (const r of rows) {
      const s = r.scores[gd.id];
      const casts = r.points[0].casts ? Object.entries(r.points[0].casts).map(([k, v]) => `${k} ${v.toFixed(2)}/h`).join(', ') : '';
      console.log(`  ${r.name.slice(0, 52).padEnd(54)} ×${score(r, gd.id).toFixed(0).padStart(7)}  ${((score(r, gd.id) / score(ref, gd.id) - 1) * 100).toFixed(1).padStart(6)}% vs Default${s.followed != null ? `  (followed; curve ×${s.income.toFixed(0)})` : ''}   ${casts}`);
    }
  }
}
