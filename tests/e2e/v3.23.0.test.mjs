// v3.23.0: statistics (features/stats.js). The store tooltip's lines are statistics — code in the
// macro language, compiled as a statistic (it only reads, and ends with `return`), about the building
// or upgrade hovered (`item`, item.* words) — the built-ins written that way, yours beside them as
// { stat: id } lines. Every statistic is a value word, stat.<key>(…), for macros and other
// statistics. Saved in the "stats" part of the save.
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { boot, sleep, waitFor, makeAssert } from '../harness/game.mjs';
import { cpsModel } from '../harness/cps.mjs';

const { assert, done } = makeAssert();
const g = boot({ idb: { factory: new IDBFactory(), IDBKeyRange } });
const { window: w, Game } = g;
const CA = w.CookieMgr;
await sleep(400);
const S = CA.Script;
const ST = CA.Stats;
const SI = CA.UI.StoreInsight;
const eq = (got, want, what) => assert(JSON.stringify(got) === JSON.stringify(want), `${what}: ${JSON.stringify(got)}${JSON.stringify(got) === JSON.stringify(want) ? '' : ` (wanted ${JSON.stringify(want)})`}`);

const spec = { Cursor: [15, 0.1], Grandma: [100, 1], Farm: [1100, 8] };
Object.keys(spec).forEach((n, i) => {
  const b = Game.Objects[n];
  Object.assign(b, { id: i, basePrice: spec[n][0], free: 0, amount: 5, locked: false });
  b.tooltip = () => `<div class="name">${n}</div>`;
});
const kitten = new Game.Upgrade('Kitten helpers', 5000);
kitten.type = 'upgrade';
Game.UpgradesInStore = [kitten];
Game.crateTooltip = (me) => `<div class="name">${me.name}</div>`;
cpsModel(Game, { base: 1000, each: Object.fromEntries(Object.keys(spec).map((n) => [n, spec[n][1]])), mults: { 'Kitten helpers': 1.5 } });
Game.cookies = 1e4;
Game.buyMode = 1;
Game.buyBulk = 1;
await waitFor(() => /ca-tt/.test(Game.Objects.Farm.tooltip()) && /ca-tt/.test(Game.crateTooltip(kitten, 'store')));
const rowsOf = (html) => [...html.matchAll(/<div class="ca-tt-row"><span>(.*?)<\/span><b([^>]*)>(.*?)<\/b><\/div>/g)].map((m) => [m[1], m[3], m[2]]);
const tip = (n) => Game.Objects[n].tooltip();
const upTip = () => Game.crateTooltip(kitten, 'store');

// ---- the language: statistics ----------------------------------------------------------------
const stat = (src, item = true) => S.compile(src, { mode: 'stat', item, vars: item ? ['item'] : [] });
const errs = (r) => r.errors.map((e) => e.message).join('; ');
eq(errs(stat('return cookies() * 2')), '', 'return a value');
eq(errs(stat('x = 3\nif x > 2:\n  return "big"\nreturn')), '', 'variables, if, an empty return');
eq(errs(stat('return [1, 2, cookies()]')), '', 'a list');
eq(errs(stat('return cps() > 0')), '', 'return a yes / no');
assert(/for statistics/.test(errs(S.compile('return 1'))), `a macro can’t return (${errs(S.compile('return 1'))})`);
assert(/for statistics/.test(errs(S.compile('wait until item.price() > 0'))), 'a macro has no item.* words');
assert(/whole game/.test(errs(stat('return item.price()', false))), 'nor a statistic about the game');
[
  ['pop.golden()', /can’t act/],
  ['wait 5 seconds', /can’t wait/],
  ['wait until cookies() > 1', /can’t wait/],
  ['while cookies() > 1:\n  x = 1', /on and on/],
  ['repeat until cookies() > 1:\n  x = 1', /on and on/],
  ['forever:\n  x = 1', /never ends/],
  ['stop', /ends with “return”/],
  ['parallel:\n  branch a:\n    x = 1', /branches/],
].forEach(([src, re]) => assert(re.test(errs(stat(src))), `a statistic can’t: ${src.split('\n')[0]} (${errs(stat(src))})`));
const run = (src, env = {}) => S.runStat(stat(src, false).flow, env);
eq(run('return 2 + 3').value, 5, 'runs: 2 + 3');
eq(run('x = 0\nfor b in buildings():\n  x = x + 1\nreturn x').value, Object.keys(Game.Objects).length, 'a for over a live list');
eq(run('x = 0\nrepeat 4 times:\n  x = x + 2\nreturn x').value, 8, 'repeat N times');
eq(run('if 1 > 2:\n  return 1').returned, false, 'no return: nothing');
eq(run('return [1, 1 + 1]').value, [1, 2], 'a list');
eq(run('label = "Mine"\nreturn 1').vars.label, 'Mine', 'its variables, as they ended');
const long = run('x = 0\nrepeat 9999 times:\n  x = x + 1\nreturn x');
assert(!long.returned && /steps/.test(long.error), `a step limit (${long.error})`);
eq(S.decompile(stat('x = [1, 2]\nreturn x').flow), 'x = [1, 2]\nreturn x', 'decompiles');
// the libraries
const statLib = S.library({ mode: 'stat' });
const macroLib = S.library();
assert(statLib.some((x) => x.id === 'item.price') && !statLib.some((x) => x.kind === 'action'), 'a statistic’s library: item words, no actions');
assert(!macroLib.some((x) => x.id === 'item.price') && macroLib.some((x) => x.id === 'stat.payback'), 'a macro’s: no item words, the statistics');
assert(statLib.some((x) => x.id === 'return …') && !macroLib.some((x) => x.id === 'return …'), 'return: for statistics');

// ---- the built-ins: today's lines, as statistics --------------------------------------------------
eq(ST.BUILTINS.filter((b) => !b.warn).map((b) => b.id), ['bonus', 'click', 'actualGain', 'payback', 'actual', 'rawCps', 'cps', 'cpsClicking', 'actualIncome', 'paybackRaw', 'paybackCps', 'paybackClicking', 'paybackModes', 'paybackParts', 'income', 'bulks', 'price', 'afford', 'share', 'next', 'nextUpgrade', 'wins'], 'the built-in statistics'); // v3.29: + the bank warnings (warn); v3.35: + nextUpgrade; v3.43: + the payback modes and their lines; actual-income window: the 15 min / 1 h / 3 h depths gone again; upgrade income line: + actualGain
ST.BUILTINS.forEach((b) => assert(!ST.compiled(b).errors.length, `${b.id} compiles`));
CA.UI.StoreInsight.setLines(['bonus', 'actualGain', 'payback', 'actual', 'afford', 'share', 'next', 'nextUpgrade', 'wins']); // the lines before tooltip layouts changed the Default
let r = rowsOf(tip('Farm'));
const farm = CA.Payback.table().buildings[1].Farm;
eq(r[0][0], 'Bonus income (×1)', 'the label a statistic sets');
eq(r[1], ['Payback period', CA.Format.payback(farm.pp), ` class="ca-pp-${farm.color}"`], 'payback: short, in its color');
SI.setLines(['bulks', 'price']);
r = rowsOf(tip('Farm'));
assert(/^<span class="ca-pp-\w+">.+<\/span> · <span/.test(r[0][1]), `×1 / 10 / 100: a list, each in its color (${r[0][1]})`);
eq(r[1][1], CA.Format.beautify(farm.price), 'price');
eq(rowsOf(upTip()).map((x) => x[0]), ['Price'], 'a building’s statistic is left out of an upgrade’s tooltip');

// ---- yours ---------------------------------------------------------------------------------
const mineA = ST.add({ label: 'Price in CpS', scope: 'item', format: 'time', source: 'return item.price() / cps()' });
eq(mineA.key, 'priceInCps', 'a code name from its label');
assert(S.isValue('stat.priceInCps'), 'a value word: stat.priceInCps');
const mineB = ST.add({ label: 'Vs best', key: 'vsBest', scope: 'building', format: 'number', source: 'top = building.payback(best(building))\nnote = "of the best"\nreturn item.payback() / top' });
const mineG = ST.add({ label: 'Twice the CpS', scope: 'game', source: 'return cps() * 2' });
SI.setLines([{ stat: mineA.id }, { stat: mineB.id }, { stat: mineG.id }, { stat: 'st_gone' }]);
r = rowsOf(tip('Farm'));
eq(r.map((x) => x[0]), ['Price in CpS', 'Vs best', 'Twice the CpS'], 'your statistics as lines (a deleted one: left out)');
eq(r[0][1], CA.Format.span(farm.price / Game.cookiesPs), 'read as a time');
assert(/<small>of the best<\/small>$/.test(r[1][1]), `a note (${r[1][1]})`);
eq(r[2][1], CA.Format.beautify(Game.cookiesPs * 2), 'about the game');
eq(rowsOf(upTip()).map((x) => x[0]), ['Price in CpS', 'Twice the CpS'], 'in an upgrade’s: the ones that fit it');
// from a macro
const m = S.compile('wait until stat.priceInCps(Farm) > 0');
assert(!m.errors.length && S.evaluate(m.flow[0].cond).ok, 'a macro can use it: stat.priceInCps(Farm)');
eq(S.value({ v: 'fn', id: 'stat.vsBest', args: [{ v: 'lit', x: 'Kitten helpers' }] }), NaN, 'a building’s statistic, of an upgrade: NaN');
eq(S.value({ v: 'fn', id: 'stat.twiceTheCps', args: [] }), Game.cookiesPs * 2, 'stat.twiceTheCps()');
// a statistic using another
const mineC = ST.add({ label: 'Half that', scope: 'item', source: 'return stat.priceInCps(item) / 2' });
eq(ST.run(mineC, ST.contextOf('Farm')).value, farm.price / Game.cookiesPs / 2, 'a statistic calling another');
const loop = ST.add({ label: 'Loop', key: 'loop', scope: 'game', source: 'return stat.loop() + 1' });
eq(ST.run(loop, null).returned, true, 'one that calls itself stops (too deep: NaN) instead of hanging');
ST.remove(loop.id);
// a broken one: left out, nothing thrown
const bad = ST.add({ label: 'Broken', scope: 'item', source: 'return item.price(' });
SI.setLines([{ stat: bad.id }, 'price']);
eq(rowsOf(tip('Farm')).map((x) => x[0]), ['Price'], 'one that doesn’t compile: left out');
// change one: its word follows its new name
ST.update(mineA.id, { key: 'priceHours', source: 'return item.price() / cps() / 3600', format: 'number' });
assert(S.isValue('stat.priceHours') && !S.isValue('stat.priceInCps'), 'renamed: stat.priceHours');
// a built-in, your way — and back
ST.update('price', { label: 'Costs', source: 'return item.price() * 2' });
SI.setLines(['price']);
eq(rowsOf(tip('Farm'))[0].slice(0, 2), ['Costs', CA.Format.beautify(farm.price * 2)], 'a built-in, changed');
ST.remove('price');
eq(rowsOf(tip('Farm'))[0].slice(0, 2), ['Price', CA.Format.beautify(farm.price)], 'reset: as it came');

// ---- saved ---------------------------------------------------------------------------------
ST.update('payback', { label: 'PP' });
Game.WriteSave();
const save = JSON.parse(Game.modSaveData.CookieMgr);
eq(save.stats.mine.map((s) => s.key), ['priceHours', 'vsBest', 'twiceTheCps', 'halfThat', 'broken'], 'yours, in the save');
eq(save.stats.builtin, { payback: { label: 'PP' } }, 'and your changes to built-ins');
const g2 = boot({ idb: { factory: new IDBFactory(), IDBKeyRange }, save: Game.modSaveData.CookieMgr });
await sleep(400);
const ST2 = g2.window.CookieMgr.Stats;
eq(ST2.all().filter((s) => !s.builtin).map((s) => s.label), ['Price in CpS', 'Vs best', 'Twice the CpS', 'Half that', 'Broken'], 'loaded back');
eq(ST2.get('payback').label, 'PP', 'a built-in, as you had it');
assert(g2.window.CookieMgr.Script.isValue('stat.vsBest'), 'their words, back');
eq(g2.errors.length, 0, 'loads without errors');
g2.window.close();
SI.setLines(null);

assert(g.errors.length === 0, 'no runtime errors' + (g.errors.length ? `: ${g.errors.slice(0, 3).join(' | ')}` : ''));
done();
process.exit();
