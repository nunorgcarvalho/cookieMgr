# cookieMgr simulator

*v0.6.0 (in step with add-on v3.39.0) — versioned apart from the add-on (`sim-v*` tags; `SIM_VERSION` in `sim.mjs`; [CHANGELOG](CHANGELOG.md)).*

A Cookie Clicker simulator for trying out strategies over long timescales — written in cookieMgr's
own words, so what works here can be pasted into the add-on and run on the real game.

It isn't a re-implementation. The simulator runs **the real game** — Orteil's own `main.js` and
minigame scripts — headless in Node, and loads **cookieMgr itself** into it (the add-on's
`src/core` and `src/features`, straight from this repo). The simulator only owns three things: the
clock, the random seed, and the bookkeeping. Cookies, CpS, upgrades, golden cookies, buffs, the
garden, spells: all the game's code. Actions, values, macros, the Auto-gardener, the event log: all
cookieMgr's code.

Which of cookieMgr's modules start is read from the add-on's own init list in `src/main.js` (all of it
but the UI's, the update check and the Cookie Monster loader), and which files load from `MODULES`
in `build.mjs` — so a module the add-on gains starts here too, with nothing to keep in step. That
includes the dragon (`dragon.*`, Auto dragon, aura profiles), the Pantheon's profiles, SeasonCompletion
and the statistics' words (`stat.*`).

```
npm run sim:gui                                      # CookieSimMgr: all of it in your browser (below)
npm run sim -- list                                  # strategies, scenarios, experiments
npm run sim -- run payback --span 2h --seed 3        # one game, 2 simulated hours
npm run sim -- compare payback cheapest --span 4h --seeds 5   # side by side, in parallel
npm run sim -- run payback --save mysave.txt --span 8h        # from your own game (Export save)
npm run sim -- vocab                                 # cookieMgr's actions / values / conditions
npm run sim -- experiment garden-clover-cohort       # a fast model
```

The game's scripts are downloaded the first time (from the game's CDN, into `sim/.game/`, which
git ignores — they're © Orteil, not ours to commit). The version the simulator is checked against is
pinned in `game/fetch.mjs`.

## CookieSimMgr — the GUI

`npm run sim:gui` starts CookieSimMgr at http://localhost:8091 and opens it (`--port 9000`,
`--no-open`). It looks like Cookie Clicker (the game's framed panels, headings, beams and buttons, from its own pictures) and is the add-on's own UI — its stylesheet, icons, components, tooltips, plotting engine,
**its Graphs and Events pages**, code editor and library, and the code knobs, served straight from
`src/` — so it looks and reads like cookieMgr, and stays in step with it.

- **Simulate** — start from a new game, a scenario, or your own save (paste Options → Export save),
  with a strategy (or your own code, or nothing) and a seed. Then watch it play and take part:
  play / pause, speed (1× to as fast as it goes), *play for* 10 min … 1 day; the stats; **the
  add-on's Graphs page** — CpS, Actual CpS by source, the cookie bank, prestige: drag across a chart
  to zoom in, window chips, smoothing, % of total, active time, effect bands and lanes, event
  markers, the averages tables — on what cookieMgr's recorder recorded in the simulated game;
  buildings with their share of the CpS; effects running; upgrades bought and in the store; the
  garden tile by tile; **cookieMgr's macros, switchable while it plays**; any cookieMgr action, by
  picking it; code run once, or kept running as a macro; every action cookieMgr took (by its
  action ids, with a tally); and **the add-on's Events page** (income outside CpS, the event log
  with its filters, search and CSV).
  **Export save** downloads the game as it is — import it in the game, or start another
  simulation from it. Simulations keep running on the server while the page is closed; *Running*
  lists them.
- **Compare** — pick strategies (or combinations, `golden+payback`), how long each game plays, how many
  seeds, where they start; they run in parallel processes and come in one by one: a table (mean,
  spread, worst … best, final CpS, golden cookies, speed) and the mean of the seeds over time with
  the worst–best range shaded.
- **Strategies** — the files in `strategies/`, in cookieMgr's code editor with its library beside
  it; the `# with:` built-ins as chips, the pass interval and garden profile as fields, the code's
  top-level numbers as knobs (sliders that rewrite their line). Save (checked by cookieMgr's
  compiler), new, delete, *Simulate it*, *Compare*, *Copy for the add-on*.
- **Garden** — golden cookie frequency over game time, gardener by gardener, on a Farm level's plot
  (8 by default): a histogram each of how the time splits by the garden's golden cookie frequency bonus,
  a line at its mean, and — hover any chart — the share of the time at that bonus or more, on all of
  them at once. Golden clovers alone (replanted one by one, or all together) and with 2–8 nursetulips
  (left to grow at their own pace, fertilizer for the clovers only or for the tulips too, or replanted
  together), with their golden zone: how long every nursetulip is fully grown. A fast model
  (`models/gardenFrequency.mjs`, the `garden-frequency` experiment), so thousands of hours take seconds.
- **Experiments** — each with its explanation and arguments; its output streams in as it runs.
- **Vocabulary** — every action, value and condition a strategy can use (cookieMgr's library,
  searchable, click to copy), staging words marked, and the built-in macros.

The server (`gui/server.mjs`, no dependencies) runs live simulations in its own process, a slice at
a time so it stays responsive, and streams them to the page (server-sent events); comparisons and
experiments run in child processes. The game's pictures come from its CDN once and are cached in
`sim/.game/assets/`.

**How the add-on's pages run on a simulation.** Live simulations record (`createSim({ record: true })`:
cookieMgr's own Recorder and History running in the simulated game, on an in-memory IndexedDB). The
server streams what they recorded — recorder frames (only what changed: new frames, and the stretch
the recorder merges into coarser frames past 3 hours of play), golden cookie effects, events — and
the page puts it where the add-on's code looks for it (`gui/public/mirrors.js`): the add-on's own
recorder loads the frames (its queries are the real ones), the event log and effects are mirrored,
and inside the add-on's code `Date.now()` is the simulated moment. Then the add-on's Graphs and
Events pages are mounted as the add-on mounts them, and tick on each snapshot as they do on each
recorded second in the game.

## How fast

At the game's own 30 logic frames a second, an hour of game takes about 10–20 seconds of computer
time (200–400× real time), depending on what's running. Runs are independent, so `compare` runs
them side by side in separate processes. For questions that need thousands of hours, there are fast
models (`models/`) that reduce the game's rules to what matters for one question — use them to sweep
parameters, then check the winner in the exact simulator.

Lower frame rates (`--fps`) are faster but **not faithful**: the game rolls a golden cookie's
appearance once per frame, so fewer frames mean fewer golden cookies.

## Strategies

A strategy is what cookieMgr does during a simulation:

- **`name.cmgr`** — cookieMgr's algorithmic code, run as an algorithmic macro (from the top every
  `every` ms). Paste it into an algorithmic macro in the add-on and it does the same there. Header
  comments set it up:

  ```
  # Buys whatever has the lowest payback period — and clicks, and pops golden cookies.
  # with: bigCookie, golden          ← built-in macros switched on alongside
  # every: 500                       ← a pass every 500 ms (default 1000)
  # profile: goldenClovers           ← a garden profile loaded (for the Auto-gardener)
  buy.best(all)
  ```

- **`name.mjs`** — `export default { name, desc, setup(sim) }`, for anything `sim` can do.
- a built-in macro's id (`golden`, `bigCookie`, `gardener`, `autoBuyer`, `autoDragon`, `seasonCompletion`…), or several joined with
  `+` (`golden+payback`).

Every `.cmgr` in `strategies/` is checked by the tests to compile with cookieMgr's own compiler.

## Scenarios

Where a simulation starts: `fresh` (a new game), a file in `scenarios/` (`export default { name,
prepare(sim) }` — e.g. `garden6`, a level-6 garden with golden clovers unlocked), or your own game:
`--save file` takes a save string from Options → Export save — and since the game's save carries
its mods' data, cookieMgr's settings, macros and gardeners come along. `--save-out file` writes where
a run ended up, to start the next one from.

## In code

```js
import { createSim } from './sim/sim.mjs';

const sim = await createSim({ seed: 1 });          // { save, mgrSave, fps, cookieMonster, record }
sim.act('click.bigCookie');                         // any cookieMgr action, by id
sim.value('building.payback', 'Grandma');           // any cookieMgr value
sim.code('for s in shimmers():\n  shimmer.pop(s)\n');        // algorithmic code, one pass
sim.macro('golden');                                // a built-in macro, on
sim.macro({ name: 'buyer', source: 'buy.best(all)\n', every: 500 });   // your own
sim.run({ hours: 2 });                              // or sim.until((s) => s.Game.cookiesPs > 1e6)
sim.stats(); sim.samples; sim.actions; sim.events(); sim.exportSave();
sim.Game; sim.CA;                                   // the game and cookieMgr themselves
```

- `sim.actions` — every action that did something: `{ t, id, params, n }` (simulated time, the
  cookieMgr action id, its parameters, how many things it did). `logAll: true` logs the ones that did
  nothing too.
- `sim.events()` — cookieMgr's own event log (golden cookies and their effects, purchases,
  achievements, garden unlocks, spells…), exactly as the add-on's Events page has it.
- `sim.samples` — `stats()` every simulated minute (`sampleEvery`).

## Staging: new words for the add-on

Some strategies need words the add-on doesn't have yet. Those live in `mgr/staging/` — cookieMgr
feature modules written in the add-on's style (a `CA.*` module with `init()`, registering actions
and values in cookieMgr's registries, headless). The simulator loads them after the add-on's own;
`vocab` marks them `[staging]`. **Promoting one** to the add-on: move the file to `src/features/`,
add it to `MODULES` in `build.mjs` and to the init list in `src/main.js` — the simulator then starts it
from there.

There are none right now: the last one, `payback.js` (`building.buy`, `buy.best`, payback periods asked
of the game itself), is the add-on's `src/features/payback.js` now.

Cookie Monster can be loaded too (`createSim({ cookieMonster: true })`, for the add-on's Best
building / Best upgrade macros), but it recomputes everything every frame — the simulation runs at
a few times real time with it.

## Layout

```
sim/
  cli.mjs            the command line (npm run sim -- …)
  gui/
    server.mjs       CookieSimMgr's server (npm run sim:gui): live simulations, jobs, the add-on's UI bundle
    public/          the page: app.js (the pages), chart.js, app.css (layout on the add-on's styles)
  sim.mjs            createSim(): the game + cookieMgr + the clock, in one object
  runner.mjs         runOne / runMany (parallel) / reports
  strategy.mjs       loading strategies (.cmgr, .mjs, built-in ids)
  game/
    fetch.mjs        downloads the game's scripts (pinned version) into sim/.game/
    boot.mjs         the real game, headless: a vm context with a do-nothing page
    dom.mjs          the do-nothing page (and the <script> loading the game uses for minigames)
    clock.mjs        virtual time: Date, setTimeout, setInterval
    rng.mjs          the seeded Math.random
  mgr/
    host.mjs         cookieMgr (src/core + src/features) loaded into the game, the action log
    staging/         add-on modules written for the simulator first
  strategies/        .cmgr / .mjs strategies
  scenarios/         starting states
  models/            fast models (the garden), numbers taken from the game
  experiments/       questions answered with the models and the simulator
tests/sim/           the simulator's tests (part of npm test; SKIPPED where the game's scripts can't be
                     downloaded, a failure in CI)
```

## What it found so far

- **`shimmer.pop` could count a golden cookie twice** — a clicked one stays on screen while it
  fades, and the action counted a call on it as a pop. Fixed in the add-on (v3.4.1: popped shimmers
  are skipped). Careful reading the numbers, though: the game's own count of golden cookies
  (`Game.goldenClicks`, the stats' "golden cookies") only counts the first of a **cookie storm** or
  **chain** — its drops and links are golden cookies too, popped one by one. An hour of `payback`
  (seed 3) pops 117 golden cookies, all distinct and live, for 8 counted by the game: a storm.
- **The garden models hold up.** `experiment garden-exact` runs cookieMgr's Auto-gardener with the
  Golden clover field profile in the real game (level 6, the built-in soil rule) and compares it to
  `models/garden.mjs`: over 28 simulated hours the real game averaged **+48.9%** golden cookie
  frequency, the model **+48.4%** (planting 12.5 vs 11.7 an hour — the difference is the first 20).
  30 hours of game took 400 s.
- **The Garden page's model holds up in the real game.** `experiment garden-frequency-exact` keeps each of
  its gardeners in the game's garden code (Farm level 8, 1000 h × 3 seeds, fps 1) and compares: every
  mean within a point of the model's, and the share of time at +100% or more within 1.5 points. It caught
  one model bug (a nursetulip's CpS cost is boosted by the nursetulips next to it: 8 tulips cost ×0.886,
  not ×0.904), fixed in v0.6.0.
- **The Full-garden replanter does better replanting just before a tick.** `experiment
  garden-replant-modes` (level-6 golden clover field, 24 h × 4 seeds each, the add-on's built-ins):

  | way | golden cookie frequency | (1 + bonus)² | at +60% or more | plantings/h |
  | --- | --- | --- | --- | --- |
  | Full-garden, a new round at once (`replantAtTick = false`, the default) | +54.8% ± 0.5 | 2.465 | 68% of the time | 19.4 |
  | Full-garden, a new round just before the tick (`replantAtTick = true`) | **+56.0% ± 0.3** | **2.495** | 69% | 19.0 |
  | Steady replanter | +48.7% ± 0.7 | 2.224 | 13% | 9.6 |

  Seed by seed, replanting at the tick wins every time: by 1.19 ± 0.29 points.
- **Force the Hand of Fate on combos needs Serendipity and Get lucky.** Without them the next golden
  cookie comes 150 s at the soonest, and a Frenzy lasts 77 s, so cookies popped on sight never overlap.

- **The stock market autobuyer earned ~60% more with prices in the rules.** `experiment stock-market` runs the
  add-on's trader profiles in the game's own market code (30 days × 4 seeds, Bank level 10, 1000 warehouse space per
  stock, 60 brokers; in hours of your highest raw CpS, the market's own unit): Ride the trends (buy rising stocks
  at any price, sell the rest) made **55.1 h per hour of play**; Trends and prices, whose thresholds `--search` found,
  **88.4 h**. With no brokers (20% overhead) Ride the trends loses money. A tick that buys (one in 12–13) spends a
  median of 27 h with Trends and prices (50 h with Ride the trends); the stocks hold ~165 h on average, and a bank
  keeping 50 h for stocks makes 97% of the profit, 100 h 99%. Rules on price alone (without the trend) made ~24 h.

## Not yet

- Ascension, prestige and heavenly upgrades (the game's code is there; nothing drives it yet).
- The minigames beyond the garden and the stock market as strategy targets (spells, the Pantheon and the dragon
  run, and cookieMgr's words for them work — `pantheon.profile`, `dragon.train`, Auto dragon,
  SeasonCompletion — but no strategies or scenarios use them yet).
- A search loop — strategies with knobs, tuned automatically over many seeds.
