// The computed golden cookie income (sim/models/goldenExpected.mjs): its effect odds against the
// game's own popFunc, the walk against the chain solved outright, both against the game played, and
// the smooth curve through computed points (gardenScore.mjs throughPoints).
import { makeAssert } from '../harness/game.mjs';
import { gameOrSkip } from '../harness/sim.mjs';
import { goldenIncomeGame } from '../../sim/models/goldenIncome.mjs';
import { goldenParams, choiceOdds, expectedIncome, exactIncome, expectedAt } from '../../sim/models/goldenExpected.mjs';
import { throughPoints, curveFrom } from '../../sim/models/gardenScore.mjs';

const { assert, done } = makeAssert();
await gameOrSkip();

const state = {
  buildings: { Cursor: 300, Grandma: 300, Farm: 250, Mine: 200, Factory: 150 },
  upgrades: { 'Lucky day': true, Serendipity: true, 'Get lucky': true, 'Distilled essence of redoubled luck': true },
  auras: ['Reaper of Fields', 'Dragonflight'],
  season: '',
};
const g = await goldenIncomeGame({ seed: 3, state });
const G = g.Game;

// --- the walk against the chain solved outright (no noise, on a 3 s grid), at +0%
{
  g.setFrequency(1);
  G.killBuffs();
  const P = goldenParams(G, { clicks: 20 });
  const exact = exactIncome(P, { grid: 90 });
  const walk = expectedIncome(P, { pops: 150000, seed: 2 });
  assert(Math.abs(walk.mult / exact.mult - 1) < Math.max(0.005, (3 * walk.se) / walk.mult), `the walk ×${walk.mult.toFixed(2)} ± ${walk.se.toFixed(2)}, the chain ×${exact.mult.toFixed(2)}`);
  assert(Math.abs(walk.golden / exact.golden - 1) < 0.01, `golden cookies an hour (${walk.golden.toFixed(2)} vs ${exact.golden.toFixed(2)})`);
  for (const k of ['frenzy', 'multiply cookies', 'building special'])
    assert(Math.abs(walk.effects[k] / exact.effects[k] - 1) < 0.01, `${k} an hour (${walk.effects[k].toFixed(3)} vs ${exact.effects[k].toFixed(3)})`);
  const sum = Object.values(walk.parts).reduce((a, b) => a + b, 0);
  assert(Math.abs(sum - walk.mult) < 1e-9 * walk.mult, 'the parts add up to the income');
  const again = expectedIncome(P, { pops: 20000, seed: 7 });
  assert(again.mult === expectedIncome(P, { pops: 20000, seed: 7 }).mult, 'the same seed, the same answer');
  const steady = expectedIncome(P, { pops: 20000, seed: 7, timer: () => ({ minTime: P.minTime, maxTime: P.maxTime }) });
  assert(steady.mult === again.mult, 'a timer that never changes: the same answer');
  const half = expectedIncome(P, { pops: 20000, seed: 7, timer: () => ({ minTime: P.minTime, maxTime: P.maxTime, weight: 0.5 }) });
  assert(Math.abs(half.mult / again.mult - 0.5) < 1e-9, 'a CpS factor on the timer scales what is earned');
}

// --- what the game says, read back: buffs popped for real
{
  g.setFrequency(1);
  const earned = G.cookiesEarned;
  const P = goldenParams(G, { clicks: 20 });
  assert(P.frenzy.power === 7 && P.clickFrenzy.power === 777 && P.flight.power === 1111 && P.harvest.power === 15, `the buffs' powers (Frenzy ×${P.frenzy.power}, Click frenzy ×${P.clickFrenzy.power}, Dragonflight ×${P.flight.power}, Harvest ×${P.harvest.power})`);
  assert(P.frenzy.frames === Math.ceil(77 * 2) * G.fps && P.special.frames === 60 * G.fps, `Get lucky doubles them (Frenzy ${P.frenzy.frames / G.fps} s, building special ${P.special.frames / G.fps} s)`);
  assert(P.special.powers.length === 5 && P.special.powers.includes(31), `a building special per building with 10 or more, ×(1 + amount/10): ${P.special.powers.join(', ')}`);
  assert(P.pReaper === 1 && P.pFlight === 1 && P.pExtra === 0.01, 'the auras and Distilled essence of redoubled luck read');
  assert(P.cpsShare >= 0 && P.cpsShare <= 1 && Math.abs(P.luckyMult - 1) < 1e-9, `a click's CpS share (${P.cpsShare.toFixed(3)}) and Lucky's multiplier (×${P.luckyMult.toFixed(3)})`);
  assert(P.minTime === g.Game.shimmerTypes.golden.getMinTime({ wrath: 0 }), 'the timer is the game’s');
  assert(!Object.keys(G.buffs).length && G.cookiesEarned === earned, 'reading leaves no buff or cookie behind');

  // the odds add up, and Dragonflight makes Click frenzy rarer
  for (const last of ['', 'frenzy', 'multiply cookies', 'dragonflight'])
    for (const fly of [0, 1]) {
      const sum = choiceOdds(P, last, fly).reduce((a, [, p]) => a + p, 0);
      assert(Math.abs(sum - 1) < 1e-12, `the odds add up to 1 (last "${last}", Dragonflight ${fly})`);
    }
  const odds = (last, fly) => Object.fromEntries(choiceOdds(P, last, fly));
  assert(odds('', 1)['click frenzy'] < 0.06 * odds('', 0)['click frenzy'], 'Dragonflight running: Click frenzy 20 times rarer');
  assert(odds('frenzy', 0).frenzy < 0.3 * odds('', 0).frenzy, 'the last effect: mostly struck off');

  // against the game's own popFunc: golden cookies popped with a last effect set, their picks counted
  const T = G.shimmerTypes.golden;
  const N = 6000;
  const seen = {};
  for (let i = 0; i < N; i++) {
    T.last = 'frenzy';
    T.chain = 0;
    G.killBuffs();
    new G.shimmer('golden', 0, 1).pop();
    seen[T.last] = (seen[T.last] || 0) + 1;
  }
  G.killBuffs();
  T.last = '';
  const want = odds('frenzy', 0);
  for (const c of ['frenzy', 'multiply cookies', 'building special', 'click frenzy', 'dragon harvest', 'dragonflight']) {
    const p = want[c];
    const got = (seen[c] || 0) / N;
    const sd = Math.sqrt((p * (1 - p)) / N);
    assert(Math.abs(got - p) < 4 * sd + 1e-3, `"${c}" after a Frenzy: the game's ${(got * 100).toFixed(1)}%, the odds' ${(p * 100).toFixed(1)}%`);
  }
}

// --- against the game played (event to event, the bank held still; by now it has baked enough for
// chains and storms): rates exact, income within its noise
{
  const bank = G.cookies;
  const walk = expectedAt(g, 1.5, { pops: 150000, seed: 1, bank });
  const played = g.at(1.5, { hours: 400, seed: 4, bank });
  assert(Math.abs(walk.golden / played.golden - 1) < 0.03, `golden cookies an hour: computed ${walk.golden.toFixed(1)}, played ${played.golden.toFixed(1)}`);
  assert(Math.abs(walk.effects.frenzy / played.effects.frenzy - 1) < 0.08, `Frenzies an hour: computed ${walk.effects.frenzy.toFixed(1)}, played ${played.effects.frenzy.toFixed(1)}`);
  assert(Math.abs(walk.parts.cps / played.parts.cps - 1) < 0.06, `CpS's share (Frenzy and the rest running): computed ×${walk.parts.cps.toFixed(2)}, played ×${played.parts.cps.toFixed(2)}`);
  assert(Math.abs(walk.mult / played.mult - 1) < Math.max(0.25, 3 * played.se / played.mult), `income: computed ×${walk.mult.toFixed(1)}, played ×${played.mult.toFixed(1)} ± ${played.se.toFixed(1)}`);
}

// --- the curve through computed points
{
  const pts = [1, 1.5, 2, 2.5, 3].map((f) => ({ f, mult: 150 * f ** (3 + f) }));
  const c = throughPoints(pts);
  assert(pts.every((p) => Math.abs(c.at(p.f) / p.mult - 1) < 1e-12), 'it goes through every point');
  let up = true;
  for (let f = 1; f < 3.5; f += 0.01) if (c.at(f + 0.01) < c.at(f)) up = false;
  assert(up, 'rising points, a rising curve');
  assert(Math.abs(c.at(1.75) / (150 * 1.75 ** 4.75) - 1) < 0.02, `between points, close to the truth (${c.at(1.75).toFixed(0)} vs ${(150 * 1.75 ** 4.75).toFixed(0)})`);
  const back = curveFrom({ expected: true, points: pts, a: 0, b: 0, c: 0 });
  assert(Math.abs(back.at(2.2) - c.at(2.2)) < 1e-9 * c.at(2.2) && back.slope(2) > 4, 'a computed curve kept as JSON reads back through its points');
}
done();
