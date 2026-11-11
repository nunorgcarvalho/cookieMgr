// The stock market autobuyer's trader profiles in the game's own market code: profit, what a market tick spends, and the bank that funds it.
//
//   npm run sim -- experiment stock-market [--days 10] [--seeds 4] [--brokers 60] [--bank 10] [--cap 1000]
//                                          [--profiles trendsAndPrices,trends] [--reserves 10,25,50,100,200] [--jobs N]
//   npm run sim -- experiment stock-market --search [--days 30] [--seeds 8] [--test 4] [--brokers 60]
//
// The market is the game's (minigameMarket.js: M.tick, M.buyGood, M.sellGood — its trends, prices,
// warehouses and broker overhead); the trading is the add-on's (each built-in trader profile's own
// code, run by the Stock market autobuyer once per market tick, right after it). The market is set up
// late-game: every stock open, the Bank at level `--bank`, `--cap` warehouse space per stock, `--brokers`
// stockbrokers (overhead 20% × 0.95^brokers), settled for 2000 ticks first. Raw CpS is held at 1, so a
// cookie is a $ — and a $ is a second of your highest raw CpS, the unit everything below is in (h: an
// hour of it). Trading moves no prices (the market's random numbers don't depend on it), so profiles
// on the same seed see the same market.
//
// Per profile: profit per hour of play; how often a tick buys and what it spends (gross, and net of
// what it sold that tick); the capital in stocks (at cost); and, with a bank that keeps only R for
// stocks (topped up by 1 min of raw CpS a tick, anything over R spent elsewhere), the share of the
// unlimited profit it keeps — the reserve that funds most purchases.
//
// --search finds Trends and prices' thresholds: price paths recorded from the game (M.tick), then a
// coordinate search over "buy when this far under the resting value / sell when this far over",
// for each trend, on the first seeds, checked on `--test` more (the game's buy/sell rules in JavaScript).
import { fork } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const arg = (k, d) => (process.argv.includes(`--${k}`) ? process.argv[process.argv.indexOf(`--${k}`) + 1] : d);
const days = Number(arg('days', process.argv.includes('--search') ? 30 : 10));
const brokers = Number(arg('brokers', 60));
const bankLevel = Number(arg('bank', 10));
const cap = Number(arg('cap', 1000));
const TICKS = Math.round(days * 1440);
const h = (x) => `${(x / 3600).toFixed(1)}h`;

/** The game with its market open late-game; M.tick() moves it one market tick. */
async function market(seed) {
  const { createSim } = await import('../sim.mjs');
  const sim = await createSim({ seed, sampleEvery: 0 });
  const G = sim.Game;
  G.cookies = 1e30;
  G.cookiesEarned = 1e30;
  for (const o of Object.values(G.Objects)) o.getFree(100);
  G.Objects.Bank.level = bankLevel;
  G.LoadMinigames();
  sim.run({ seconds: 1 }); // the minigames' scripts load on a short timer
  const M = G.Objects.Bank.minigame;
  if (!M) throw new Error('The stock market did not load');
  M.getGoodMaxStock = () => cap;
  M.brokers = brokers;
  for (let i = 0; i < 2000; i++) M.tick();
  G.cookiesPsRawHighest = 1;
  return { sim, G, M };
}

const pct = (xs, q) => {
  const a = Float64Array.from(xs).sort();
  return a.length ? a[Math.min(a.length - 1, Math.floor(q * a.length))] : 0;
};

/** One profile on one seed, with a bank that keeps `pool` for stocks (Infinity: unlimited). */
async function exact(profile, seed, pool) {
  const { G, M, sim } = await market(seed);
  const T = sim.CA.StockTrader;
  if (!T.use(profile) && T.activeId() !== profile) throw new Error(`no trader profile ${profile}`);
  sim.CA.Macros.setInput('stockTrader', 'brokers', false); // the brokers stay as set
  const goods = M.goodsById;
  const ov = 1 + 0.01 * (20 * Math.pow(0.95, M.brokers));
  const paid = goods.map(() => 0);
  let bought = 0;
  let sold = 0;
  const buy = M.buyGood;
  const sell = M.sellGood;
  M.buyGood = (id, n) => {
    const g = goods[id];
    const s0 = g.stock;
    const ok = buy(id, n);
    if (ok) {
      const k = g.stock - s0;
      paid[id] = (paid[id] * s0 + k * g.val * ov) / g.stock;
      bought += k * g.val * ov;
    }
    return ok;
  };
  M.sellGood = (id, n) => {
    const g = goods[id];
    const s0 = g.stock;
    const ok = sell(id, n);
    if (ok) sold += (s0 - g.stock) * g.val;
    return ok;
  };
  const BIG = 1e15;
  let bank = pool;
  let cash = 0;
  const spends = [];
  const nets = [];
  const capital = [];
  for (let t = 0; t < TICKS; t++) {
    M.tick();
    bought = 0;
    sold = 0;
    if (pool !== Infinity) bank = Math.min(pool, bank + 60); // a minute of raw CpS comes in each tick
    const c0 = pool === Infinity ? BIG : bank;
    G.cookies = c0;
    sim.CA.Macros.runOnce('stockTrader');
    if (pool !== Infinity) bank = Math.min(pool, G.cookies); // anything over the pool: spent elsewhere
    cash += sold - bought;
    spends.push(bought);
    nets.push(Math.max(0, bought - sold));
    capital.push(goods.reduce((a, g, i) => a + g.stock * paid[i], 0));
  }
  const held = goods.reduce((a, g) => a + g.stock * g.val, 0);
  const perHour = (cash + held) / (TICKS / 60);
  if (pool !== Infinity) return { profile, seed, pool, perHour };
  const buys = spends.filter((x) => x > 0);
  const netBuys = nets.filter((x) => x > 0);
  const q = (xs) => [0.5, 0.75, 0.9, 0.95, 0.99].map((p) => pct(xs, p));
  return {
    profile,
    seed,
    pool: 'unlimited',
    perHour,
    buyShare: buys.length / spends.length,
    meanSpend: spends.reduce((a, b) => a + b, 0) / spends.length,
    spendQ: q(buys),
    spendMax: buys.reduce((a, b) => Math.max(a, b), 0),
    netShare: netBuys.length / nets.length,
    netQ: q(netBuys),
    capMean: capital.reduce((a, b) => a + b, 0) / capital.length,
    capQ: q(capital),
  };
}

// ---- --search: the thresholds ---------------------------------------------------------------

/** Price paths from the game: vals[t × N + i], modes. */
async function record(seed) {
  const { M } = await market(seed);
  const N = M.goodsById.length;
  const vals = new Float64Array(TICKS * N);
  const modes = new Uint8Array(TICKS * N);
  for (let t = 0; t < TICKS; t++) {
    M.tick();
    M.goodsById.forEach((g, i) => {
      vals[t * N + i] = g.val;
      modes[t * N + i] = g.mode;
    });
  }
  return { N, vals: Array.from(vals), modes: Array.from(modes), rest: M.goodsById.map((g) => M.getRestingVal(g.id)) };
}

/** Profit per hour of "buy under b[mode], sell over s[mode]" ($ from the resting value) — the game's buy/sell rules, unlimited bank. */
function evaluate(p, b, s) {
  const { N, vals, modes, rest } = p;
  const ov = 1 + 0.2 * Math.pow(0.95, brokers);
  const stock = new Float64Array(N);
  let cash = 0;
  const n = vals.length / N;
  for (let t = 0; t < n; t++) {
    const o = t * N;
    const sold = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const x = vals[o + i] - rest[i];
      if (stock[i] > 0 && x > s[modes[o + i]]) {
        cash += stock[i] * vals[o + i];
        stock[i] = 0;
        sold[i] = 1;
      }
    }
    for (let i = 0; i < N; i++) {
      const x = rest[i] - vals[o + i];
      if (!sold[i] && x > b[modes[o + i]] && stock[i] < cap) {
        cash -= (cap - stock[i]) * vals[o + i] * ov;
        stock[i] = cap;
      }
    }
  }
  let held = 0;
  for (let i = 0; i < N; i++) held += stock[i] * vals[(n - 1) * N + i];
  return (cash + held) / (n / 60);
}

async function search() {
  const seeds = Number(arg('seeds', 8));
  const test = Number(arg('test', 4));
  const t0 = Date.now();
  const paths = await runAll(
    Array.from({ length: seeds + test }, (_, k) => ['record', k + 1]),
    (r) => r
  );
  const train = paths.slice(0, seeds);
  const held = paths.slice(seeds);
  const I = Infinity;
  const mean = (ps, b, s) => ps.reduce((a, p) => a + evaluate(p, b, s), 0) / ps.length;
  // Ride the trends, as thresholds: buy rises at any price, never sell them; sell everything else
  const b = [-I, I, -I, I, -I, -I];
  const s = [-I, I, -I, I, -I, -I];
  console.log(`Ride the trends: ${h(mean(train, b, s))}/h (train), ${h(mean(held, b, s))}/h (test)`);
  const GRID = [-I, -150, -100, -80, -60, -40, -30, -20, -10, 0, 10, 20, 30, 40, 60, 80, 100, 150, I];
  let best = mean(train, b, s);
  for (let round = 1; round <= 3; round++) {
    for (const arr of [b, s])
      for (let m = 0; m < 6; m++) {
        let bv = arr[m];
        for (const v of GRID) {
          const old = arr[m];
          arr[m] = v;
          const sc = mean(train, b, s);
          if (sc > best + 1) {
            best = sc;
            bv = v;
          }
          arr[m] = old;
        }
        arr[m] = bv;
      }
    const f = (xs, hi, lo) => xs.map((x) => (x === I ? hi : x === -I ? lo : `$${x}`)).join(' ');
    console.log(`round ${round}: ${h(best)}/h (train), ${h(mean(held, b, s))}/h (test) — by mode 0–5, buy under [${f(b, 'always', 'never')}], sell over [${f(s, 'never', 'always')}]`);
  }
  console.log(`\n${seeds}+${test} seeds of ${days} days in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

// ---- runs in parallel ---------------------------------------------------------------------------

async function runAll(specs, keep) {
  const jobs = Number(arg('jobs', Math.max(1, Math.min(6, Math.floor(os.cpus().length / 2)))));
  const me = fileURLToPath(import.meta.url);
  const results = [];
  let next = 0;
  const t0 = Date.now();
  const pass = ['--days', String(days), '--brokers', String(brokers), '--bank', String(bankLevel), '--cap', String(cap)];
  await new Promise((resolve) => {
    let running = 0;
    const launch = () => {
      if (next >= specs.length) return running || resolve();
      const [what, seed, profile, pool] = specs[next];
      const at = next++;
      running++;
      const c = fork(me, ['--one', what, '--seed', String(seed), '--profile', String(profile || ''), '--pool', String(pool == null ? 'Infinity' : pool), ...pass], { silent: true });
      c.on('message', (r) => (results[at] = keep(r)));
      c.on('exit', () => {
        running--;
        process.stderr.write(`\r  ${results.filter(Boolean).length}/${specs.length} runs (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
        launch();
      });
    };
    for (let k = 0; k < jobs; k++) launch();
  });
  process.stderr.write('\n');
  return results;
}

if (process.argv.includes('--one')) {
  const what = arg('one');
  const seed = Number(arg('seed', 1));
  const r = what === 'record' ? await record(seed) : await exact(arg('profile'), seed, Number(arg('pool', 'Infinity')));
  process.send(r, () => process.exit(0));
} else if (process.argv.includes('--search')) {
  await search();
} else {
  const seeds = Number(arg('seeds', 4));
  const profiles = arg('profiles', 'trendsAndPrices,trends').split(',');
  const reserves = arg('reserves', '10,25,50,100,200')
    .split(',')
    .map((x) => Number(x) * 3600);
  const specs = [];
  profiles.forEach((p) => {
    for (let s = 1; s <= seeds; s++) [Infinity, ...reserves].forEach((pool) => specs.push(['exact', s, p, pool]));
  });
  const t0 = Date.now();
  const results = await runAll(specs, (r) => r);
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  console.log(`The stock market, ${days} days × ${seeds} seeds: Bank level ${bankLevel}, ${cap} warehouse space per stock, ${brokers} brokers (overhead ${(20 * Math.pow(0.95, brokers)).toFixed(2)}%)`);
  console.log('Units: hours of your highest raw CpS (a $ is a second of it). Spends scale with warehouse space.\n');
  profiles.forEach((p) => {
    const rs = results.filter((r) => r && r.profile === p && r.pool === 'unlimited');
    if (!rs.length) return;
    const qs = (k) => [0, 1, 2, 3, 4].map((i) => mean(rs.map((r) => r[k][i])));
    const prof = mean(rs.map((r) => r.perHour));
    const sd = Math.sqrt(rs.reduce((a, r) => a + (r.perHour - prof) ** 2, 0) / Math.max(1, rs.length - 1) / rs.length);
    const [s50, s75, s90, s95, s99] = qs('spendQ');
    const [n50, , n90, n95, n99] = qs('netQ');
    const [c50, , c90, , c99] = qs('capQ');
    console.log(`${p}: profit ${h(prof)} per hour of play (± ${h(sd)})`);
    console.log(`  ticks that buy: ${(mean(rs.map((r) => r.buyShare)) * 100).toFixed(1)}% (one every ${(1 / mean(rs.map((r) => r.buyShare))).toFixed(0)} min); mean spend per tick ${h(mean(rs.map((r) => r.meanSpend)))}`);
    console.log(`  spend on a tick that buys: median ${h(s50)}, 75% ${h(s75)}, 90% ${h(s90)}, 95% ${h(s95)}, 99% ${h(s99)}, most ${h(Math.max(...rs.map((r) => r.spendMax)))}`);
    console.log(`  net of that tick's sales (${(mean(rs.map((r) => r.netShare)) * 100).toFixed(1)}% of ticks): median ${h(n50)}, 90% ${h(n90)}, 95% ${h(n95)}, 99% ${h(n99)}`);
    console.log(`  capital in stocks (at cost): mean ${h(mean(rs.map((r) => r.capMean)))}, median ${h(c50)}, 90% ${h(c90)}, 99% ${h(c99)}`);
    reserves.forEach((pool) => {
      const kept = mean(results.filter((r) => r && r.profile === p && r.pool === pool).map((r) => r.perHour));
      console.log(`  a bank keeping ${h(pool)} for stocks: ${h(kept)}/h, ${((kept / prof) * 100).toFixed(0)}% of the unlimited profit`);
    });
    console.log('');
  });
  console.log(`${results.length} runs in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
