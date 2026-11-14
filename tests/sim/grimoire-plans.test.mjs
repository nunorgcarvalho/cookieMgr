// The Grimoire in the computed golden cookie model (sim/models/goldenExpected.mjs, models/grimoire.mjs):
// what it reads from the game (costs, backfire chance, the refill frame by frame), Force the Hand of
// Fate's odds against its win()/fail() lists, plans deciding as the add-on's cast tiers do, and the
// walk with spells against the game's own spells played (models/goldenIncome.mjs).
import { makeAssert } from '../harness/game.mjs';
import { gameOrSkip } from '../harness/sim.mjs';
import { goldenIncomeGame } from '../../sim/models/goldenIncome.mjs';
import { goldenParams, expectedIncome, expectedAt, SLOTS } from '../../sim/models/goldenExpected.mjs';
import { makePlan, planById, PLANS, sweepPlans } from '../../sim/models/grimoire.mjs';

const { assert, done } = makeAssert();
await gameOrSkip();

const state = {
  buildings: { Cursor: 300, Grandma: 300, Farm: 250, Mine: 200, Factory: 150, 'Wizard tower': 300 },
  upgrades: { 'Lucky day': true, Serendipity: true, 'Get lucky': true },
  auras: ['Reaper of Fields', 'Dragonflight'],
  season: '',
};
const g = await goldenIncomeGame({ seed: 3, state });
const G = g.Game;
const W = G.Objects['Wizard tower'];
if (!W.minigame) {
  // a fresh game's towers have no level yet: one, and the game loads its Grimoire (on its timer)
  W.level = 1;
  G.LoadMinigames();
  g.sim.run({ seconds: 1 });
}
const M = W.minigame;
assert(M && M.spells && M.spells['hand of fate'], 'the game has its Grimoire');
g.setFrequency(1);
const P = goldenParams(G, { clicks: 20 });

// --- what it reads from the game
{
  const gm = P.grimoire;
  M.computeMagicM();
  assert(gm.magicM === M.magicM && gm.costs.fthof === M.getSpellCost(M.spells['hand of fate']) && gm.costs.stretch === M.getSpellCost(M.spells['stretch time']), `magic ${gm.magicM}, Force the Hand of Fate ${gm.costs.fthof}, Stretch Time ${gm.costs.stretch}: the game's`);
  assert(Math.abs(gm.fail - 0.15) < 1e-12, `a spell backfires 15% of the time (${gm.fail})`);
  // the refill: the game's own M.logic, frame by frame, from an empty bar
  M.magic = 0;
  const T0 = G.T;
  let k = 0;
  for (; k < 2000; k++) {
    G.T = T0 + k + 1;
    M.logic();
  }
  G.T = T0;
  assert(Math.abs(M.magic - gm.regen[2000]) < 1e-9, `the refill frame by frame (${M.magic.toFixed(6)} vs ${gm.regen[2000].toFixed(6)} after 2000 frames)`);
  assert(gm.regen[gm.regen.length - 1] === gm.magicM, 'it ends at a full bar');
  M.magic = M.magicM;
  assert(P.elder.power === 666 && P.clot.power === 0.5 && P.cursed.power > 0, 'the backfires’ wrath cookie effects, popped for real');
}

// --- plans decide as the add-on's cast tiers decide (castTiers.js: lowest tier with a combo on, its threshold)
{
  const plan = makePlan(planById('default').spec, P);
  const fps = P.fps;
  const st = (on) => {
    const s = new Array(SLOTS.B0).fill(0);
    for (const [k, v] of Object.entries(on)) if (k !== 'B') s[SLOTS[k]] = v * fps;
    return [...s, ...(on.B || []).map((v) => v * fps)];
  };
  const full = P.grimoire.magicM;
  const cost = P.grimoire.costs.fthof;
  assert(plan.decide(st({ F: 60, C: 20 }), cost) && plan.decide(st({ F: 60, C: 20 }), cost).spell === 'fthof', 'Frenzy + Click frenzy: cast as soon as affordable (Strongest combos, 0%)');
  assert(!plan.decide(st({ F: 60, C: 20 }), cost - 1), '… not before');
  assert(!plan.decide(st({ F: 60, C: 3 }), full), '… not when an effect has less than 5 s left');
  assert(!plan.decide(st({ F: 60, B: [40] }), full - 1) && plan.decide(st({ F: 60, B: [40] }), full).why === 'F+BS', 'Frenzy + a building special: only at a full bar (Regular combos, 100%)');
  assert(!plan.decide(st({ F: 60 }), full), 'Frenzy alone: nothing');
  assert(!plan.decide(st({ B: [40] }), full) && plan.decide(st({ B: [40, 30] }), full), 'two building specials make a combo, one does not');
  const any = makePlan(planById('atCost').spec, P);
  assert(any.decide(st({}), cost).spell === 'fthof' && !any.decide(st({}), cost - 1), 'Whenever affordable: whatever is on');
  const adept = makePlan(planById('adept').spec, P);
  const both = P.grimoire.costs.adept + cost;
  if (both <= full) assert(adept.decide(st({ F: 60, B: [40] }), full).spell === 'adept' && adept.decide(st({ F: 60, B: [40], A: 300, J: 0 }), full).spell === 'fthof', 'Diminish Ineptitude first, then the spell');
  assert(!adept.decide(st({ F: 60, C: 20, I: 600 }), full), 'never while Magic inept is on');
  assert(sweepPlans().length > 20 && PLANS.length >= 10 && new Set([...PLANS, ...sweepPlans()].map((p) => p.id)).size === PLANS.length + sweepPlans().length, 'plans have ids of their own');
}

// --- the walk with spells: casts as often as magic allows, and income the game's own spells match
{
  const none = expectedIncome(P, { pops: 30000, seed: 1 });
  const plan = makePlan(planById('atFull').spec, P);
  const r = expectedIncome(P, { pops: 30000, seed: 1, plan });
  // a full bar each time: refill from (max − cost) to max, plus the wait for nothing else
  const refill = (P.grimoire.regen.length - P.grimoire.regen.findIndex((m) => m >= P.grimoire.magicM - P.grimoire.costs.fthof)) / P.fps;
  assert(Math.abs(r.casts.fthof - 3600 / refill) < 0.02 * (3600 / refill), `At a full bar: ${r.casts.fthof.toFixed(3)} casts an hour, one per refill (${(3600 / refill).toFixed(3)})`);
  assert(r.mult > none.mult, `spells add income (×${r.mult.toFixed(1)} vs ×${none.mult.toFixed(1)})`);
  const won = Object.entries(r.spells).filter(([k]) => k.startsWith('fthof:')).reduce((a, [, v]) => a + v, 0);
  assert(Math.abs(won - r.casts.fthof) < 1e-6 * won, 'every cast brings a golden cookie (or a wrath one)');
  const back = ['clot', 'ruin cookies', 'cursed finger', 'blood frenzy'].reduce((a, k) => a + (r.spells[`fthof:${k}`] || 0), 0);
  assert(Math.abs(back / r.casts.fthof - 0.15 * 0.9) < 0.002, `15% backfire, a tenth of them a blab (${((back / r.casts.fthof) * 100).toFixed(2)}% wrath effects)`);
  const viaAt = expectedAt(g, 1, { pops: 30000, seed: 1, grimoire: planById('atFull').spec });
  assert(Math.abs(viaAt.mult / r.mult - 1) < 1e-9, 'expectedAt takes a plan’s spec');
  // the game's own spells, played event to event (the slow check), within the noise
  const played = g.at(1, { hours: 400, seed: 5, grimoire: planById('atFull').spec, bank: G.cookies });
  assert(Math.abs(played.casts.fthof / r.casts.fthof - 1) < 0.05, `played: ${played.casts.fthof.toFixed(3)} casts an hour (computed ${r.casts.fthof.toFixed(3)})`);
  assert(Math.abs(played.mult / r.mult - 1) < Math.max(0.25, (4 * played.se) / played.mult), `played ×${played.mult.toFixed(1)} ± ${played.se.toFixed(1)}, computed ×${r.mult.toFixed(1)}`);
}

done();
process.exit();
