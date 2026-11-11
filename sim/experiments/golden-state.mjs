// What a save is, for golden cookie income: the few variables that matter (buildings, clicks a second, dragon auras, Grandmapocalypse, season, Pantheon, golden cookie upgrades).
//
//   npm run sim -- experiment golden-state --save mysave.txt [--out state.json] [--set key=value …] [--options]
//
// Prints the game state models/goldenIncome.mjs reads from the save (gameState) as JSON — with any
// --set applied, to check them. Edit it and pass it back to golden-income or garden-score with
// --state state.json (or change one variable at a time with --set). Prestige, kittens, milk and
// the other upgrades aren't in it: they scale CpS and clicks together, so they cancel out of income ÷
// baseline, except through clickVsCps (a click's cookies as a share of CpS), which can be set.
import fs from 'node:fs';
import { goldenIncomeGame, stateFromArgs } from '../models/goldenIncome.mjs';

const arg = (k, d) => (process.argv.includes(`--${k}`) ? process.argv[process.argv.indexOf(`--${k}`) + 1] : d);
const file = arg('save');
if (!file) throw new Error('--save file: a save string (Options → Export save)');
const state = stateFromArgs(process.argv, (f) => fs.readFileSync(f, 'utf8'));
const g = await goldenIncomeGame({ save: fs.readFileSync(file, 'utf8').trim(), state });
const text = JSON.stringify(g.state, null, 2);
if (arg('out')) fs.writeFileSync(arg('out'), text + '\n');
if (process.argv.includes('--options')) {
  // with what each variable can be (CookieSimMgr's Garden page builds its form from it)
  const G = g.Game;
  const P = G.Objects.Temple.minigame;
  const options = {
    auras: Object.values(G.dragonAuras).map((a) => a.name).filter((n) => n !== 'No aura'),
    gods: P ? Object.keys(P.gods).map((id) => ({ id, name: P.gods[id].name })) : [],
    seasons: [{ id: '', name: 'None' }, ...Object.keys(G.seasons).map((id) => ({ id, name: G.seasons[id].name }))],
  };
  process.stdout.write(JSON.stringify({ state: g.state, options }));
} else console.log(text);
