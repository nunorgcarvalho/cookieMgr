// Grimoire tier lines: the Magic graph draws a dashed line for each cast tier of the profile in use, at the
// magic its threshold needs now (0% the spell's cost, 100% a full bar), in the tier's color and named.
import { boot, sleep, makeAssert, waitFor } from '../harness/game.mjs';

const { assert, done } = makeAssert();
const g = boot({});
const { window: w, G } = g;
const CA = w.CookieMgr;
await sleep(400);
const T = CA.CastTiers;

CA.UI.Menu.openPage('wizard');
const plot = () => CA.UI.Plot.get('magic');
const lines = () => (plot() && plot().last() ? plot().last().data.hlines || [] : null);
await waitFor(() => lines() && lines().length === 2, 3000);
const cost = G.getSpellCost(G.spells['hand of fate']);
let ls = lines();
assert(ls.map((l) => l.label).join() === 'Strongest combos 0%,Regular combos 100%', `a line per tier, lowest first (${ls.map((l) => l.label)})`);
assert(Math.abs(ls[0].v - cost) < 1e-9 && Math.abs(ls[1].v - G.magicM) < 1e-9, `at the spell's cost and the full bar (${ls.map((l) => l.v)})`);
assert(ls[0].color === '#f2cf73' && ls[1].color === '#c9a6ff' && ls[0].labelColor === ls[0].color, 'in the tiers’ colors, as on the Cast tiers card');

// a tier at 50%: halfway between the cost and the full bar
T.addTier(T.current().id); // "Tier 3" at 50%
assert(await waitFor(() => lines().length === 3, 3000), 'the lines follow a new tier at once');
ls = lines();
assert(ls[1].label === 'Tier 3 50%' && Math.abs(ls[1].v - (cost + (G.magicM - cost) / 2)) < 1e-9, `the new tier in the middle (${ls[1].label} ${ls[1].v})`);

// Saving up: the strongest only
T.use('savingUp');
assert(await waitFor(() => lines().length === 1, 3000), '…and a profile change');
assert(lines()[0].label === 'Strongest combos 0%', 'the profile in use decides the lines');

assert(g.errors.length === 0, 'no runtime errors' + (g.errors.length ? `: ${g.errors.slice(0, 3).join(' | ')}` : ''));
done();
process.exit();
