// Scoring gardens (sim/models/goldenIncome.mjs, gardenScore.mjs): the income model's spawn draw
// against the game's own frame-by-frame spawning, a game state read and changed, income that rises
// with the frequency and comes from the game's golden cookies, and the fit and score's arithmetic.
import { makeAssert } from '../harness/game.mjs';
import { gameOrSkip } from '../harness/sim.mjs';
import { createSim } from '../../sim/sim.mjs';
import { goldenIncomeGame, spawnFrame, stateFromArgs } from '../../sim/models/goldenIncome.mjs';
import { fitCurve, scoreGarden, curveFrom } from '../../sim/models/gardenScore.mjs';
import { makeRng } from '../../sim/game/rng.mjs';

const { assert, done } = makeAssert();
await gameOrSkip();

// --- the spawn draw: the same distribution as Game.updateShimmers rolled frame by frame
{
  const sim = await createSim({ seed: 5, mgr: false, sampleEvery: 0 });
  const G = sim.Game;
  const T = G.shimmerTypes.golden;
  const N = 400;
  const play = () => {
    Object.assign(T, { time: 0, minTime: 300, maxTime: 900, spawned: 0 });
    let n = 0;
    while (!T.spawned) {
      G.updateShimmers();
      n++;
    }
    G.killShimmers();
    return n;
  };
  const rnd = makeRng(3);
  const a = Array.from({ length: N }, play);
  const b = Array.from({ length: N }, () => spawnFrame(300, 900, 0, rnd()));
  const mean = (x) => x.reduce((s, v) => s + v, 0) / x.length;
  assert(Math.abs(mean(a) - mean(b)) < 0.03 * mean(a), `the spawn draw's mean wait (${mean(b).toFixed(0)} frames) is the game's (${mean(a).toFixed(0)})`);
  assert(b.every((k) => k > 300), 'never before minTime');
  // a timer already part-way: drawn from what's left
  assert(Array.from({ length: 50 }, () => spawnFrame(300, 900, 700, rnd())).every((k) => k > 700), 'a timer part-way through: later than where it is');
  // a chain cookie's timer (min = max): the frame after
  assert(spawnFrame(90, 90, 0, 0.5) === 91, 'min = max (a chain cookie): the frame after');
}

// --- a game state, read and changed: a new game given buildings and the golden cookie upgrades
{
  const state = {
    buildings: { Cursor: 200, Grandma: 200, Farm: 200, Mine: 150 },
    upgrades: { 'Lucky day': true, Serendipity: true, 'Get lucky': true },
    auras: ['Reaper of Fields', 'Dragonflight'],
    season: '',
  };
  const g = await goldenIncomeGame({ seed: 2, state });
  const s = g.state;
  assert(s.buildings.Farm === 200 && s.upgrades['Get lucky'] && !s.upgrades['Lasting fortune'], 'the buildings and upgrades set');
  assert(s.auras[0] === 'Reaper of Fields' && s.auras[1] === 'Dragonflight' && s.clicks === 20 && s.elderWrath === 0, `the auras, 20 clicks a second, Elder Pledge (${JSON.stringify(s.auras)})`);
  assert(g.base > 0 && Math.abs(g.base - (s.cps + 20 * s.click)) < 1e-9 * g.base, 'the baseline: unbuffed CpS + 20 clicks');
  const r1 = g.at(1, { hours: 60, seed: 1 });
  const r2 = g.at(2, { hours: 60, seed: 1 });
  assert(r1.mult > 1 && r2.mult > r1.mult, `income rises with the frequency (×${r1.mult.toFixed(1)} at +0%, ×${r2.mult.toFixed(1)} at +100%)`);
  assert(r2.golden > 1.7 * r1.golden && r2.golden < 2.3 * r1.golden, `twice the frequency, about twice the golden cookies (${r1.golden.toFixed(1)} → ${r2.golden.toFixed(1)} an hour)`);
  const sum = Object.values(r1.parts).reduce((a, b) => a + b, 0);
  assert(Math.abs(sum - r1.mult) < 1e-6 * r1.mult, 'the parts add up to the income');
  assert(r1.effects.frenzy > 0 && r1.effects['multiply cookies'] > 0 && r1.effects['building special'] > 0, 'the game picks the effects: Frenzy, Lucky, building specials…');
  assert(!r1.effects.clot && !r1.effects['ruin cookies'], 'Elder Pledge: no wrath cookies');
  const again = g.at(1, { hours: 60, seed: 1 });
  assert(Number.isFinite(again.mult) && again.golden > 0, 'measures again on the same game');
  // a bigger click: more of the income from clicks
  const g2 = await goldenIncomeGame({ seed: 2, state: { ...state, clickVsCps: s.clickVsCps * 4 } });
  assert(Math.abs(g2.state.clickVsCps / s.clickVsCps - 4) < 1e-6, `clickVsCps set (${s.clickVsCps.toFixed(4)} → ${g2.state.clickVsCps.toFixed(4)})`);
}

// --- --set words
{
  const st = stateFromArgs(['--set', 'clicks=10', '--set', 'season=', '--set', 'auras=Reaper of Fields, Dragonflight', '--set', 'buildings.You=600', '--set', 'upgrades.Lucky day=false'], () => '{}');
  assert(st.clicks === 10 && st.season === '' && st.auras[1] === 'Dragonflight' && st.buildings.You === 600 && st.upgrades['Lucky day'] === false, `--set: ${JSON.stringify(st)}`);
}

// --- the fit and the score
{
  const pts = [1, 1.5, 2, 2.5, 3].map((f) => ({ f, mult: 150 * f ** 4.5, se: 0.05 * 150 * f ** 4.5 }));
  const c = fitCurve(pts);
  assert(Math.abs(c.slope(2) - 4.5) < 1e-6 && Math.abs(c.at(1) - 150) < 1e-6, `a power law comes back (k ${c.slope(2).toFixed(3)}, ×${c.at(1).toFixed(1)})`);
  const back = curveFrom(JSON.parse(JSON.stringify({ ...c, at: undefined, slope: undefined })));
  assert(Math.abs(back.at(2.2) - c.at(2.2)) < 1e-9 * c.at(2.2), 'a curve kept as JSON reads back');
  // all the time at +100% with CpS ×0.9: 0.9 × M(2.005)
  const fine = [];
  fine[100] = 0.9;
  const s = scoreGarden(fine, c);
  assert(Math.abs(s.income - 0.9 * c.at(2.005)) < 1e-9 * s.income && Math.abs(s.vsNone - s.income / 150) < 1e-9, 'a garden at one frequency: its CpS × the curve there');
  // spread half at +0%, half at +100%: the mean of the two, more than the curve at the mean frequency
  const f2 = [];
  f2[0] = 0.5;
  f2[100] = 0.5;
  assert(scoreGarden(f2, c).income > c.at(1.5), 'a spread-out frequency scores more than its mean (income is convex in f)');
}
done();
