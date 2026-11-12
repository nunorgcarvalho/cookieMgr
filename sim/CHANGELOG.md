# Simulator changelog

The simulator is versioned apart from the add-on (`SIM_VERSION` in `sim.mjs`, `sim-v*` tags). Each entry
says which add-on version it was brought in step with.

## Unreleased

## 0.8.1 — 2026-11-12 (add-on v4.40.2)

- **American English:** the garden model's `neighbours()` is now `neighbors()`.

## 0.8.0 — 2026-11-12 (add-on v4.40.1)

- **Score garden strategies for your game:** the Garden page's new *Score for your game* card takes a save and
  ranks each gardener by the income it implies, in multiples of a baseline (unbuffed CpS + clicks a second), with
  golden cookies clicked as they appear. The save's income curve comes first: the game's own golden cookies played
  at steady frequencies for thousands of hours each (`models/goldenIncome.mjs`, jumping from one event to the next
  instead of playing every frame), smoothed by a fit; then each gardener's time at each frequency, its CpS cost
  included, goes through it (`models/gardenScore.mjs`). Also as experiments: `golden-income`, `garden-score`.
- **A save as a game state:** the few variables golden cookie income depends on, read from a save and each one
  changeable: buildings, clicks a second, a click's share of CpS, dragon auras, Grandmapocalypse, season, Pantheon
  and the golden cookie upgrades (the card's form; `golden-state`, `--state file.json`, `--set key=value`).
- **Garden model in step with the add-on:** clover rounds switch to clay once a quarter of them are mature (was 75%),
  as the add-on's soil rules have since PR #131.

## 0.7.0 — 2026-11-11 (add-on v4.39.0)

- The add-on's Best building and Best upgrade became the **Auto buyer** (`autoBuyer`): the GUI lists it with the
  built-ins, and the docs name it. `cmBuildings` / `cmUpgrades` still switch it on.
- **`experiment stock-market`:** the Stock market autobuyer's trader profiles in the game's own market code, run as
  the add-on runs them: profit per hour, what a market tick spends (gross and net, by percentile), the capital in
  stocks, and how much of the profit a bank keeping only so much for stocks still makes. `--search` finds Trends and
  prices' thresholds (price paths from the game, a coordinate search, checked on held-out seeds).

## 0.6.0 — 2026-10-28 (add-on v3.39.0)

- **The Garden page's model, checked against the real game.** `models/gardenExact.mjs` keeps each of the
  Garden page's gardeners in the game's own garden code (planting, harvesting and the soil through the
  game's functions, by the model's rules) and reads the golden cookie frequency bonus off the game every
  simulated second, in the model's bookkeeping. The experiment `garden-frequency-exact` runs gardeners ×
  seeds in parallel and prints them beside the model. On the level-8 plot, 1000 h × 3 seeds each, every
  gardener's mean is within a point of the model's (clover field +73.1% / +73.2%, combos +83.6% / +83.5%,
  4 nursetulips + combos +85.0% / +85.1%).
- **Fixed: a nursetulip's CpS cost wasn't boosted by the nursetulips next to it** in the garden models
  (`models/garden.mjs`, `models/gardenFrequency.mjs`) — the game boosts it as it boosts a clover's bonus.
  With 8 nursetulips (they touch) the Garden page said CpS ×0.904; the game, and now the model, ×0.886.
- **Fixed: `fps` was ignored** (`createSim({ fps })`, `--fps`): the game's `Game.Init` set it back to 30.
  The garden only reads the clock, so the exact garden runs at 1 frame a second — 1000 h in ~9 minutes.

## 0.5.0 — 2026-10-27 (add-on v3.34.0)

- **CookieSimMgr's Garden page: golden cookie frequency over game time, gardener by gardener.** For a
  Farm level (8 by default: the 6×5 plot), each gardener's histogram of the time by its golden cookie
  frequency bonus (5-point bars), a line at its mean, and — hovering any of them — the share of the
  time at that bonus or more, on every chart at once (they share their scales, so they compare side by
  side). The gardeners: the Golden clover field, Golden clover combos, and nursetulips with clover
  combos (left to grow at their own pace, fertilizer for the clovers only), the same with fertilizer for
  the nursetulips too, and the nursetulips replanted together; 2, 4, 6 or 8 nursetulips, placed where
  they boost the most clovers. With nursetulips, the golden zone: how much of the time every one of
  them is fully grown, for how long at a stretch, and how much of it has every clover mature as well.
  A summary table above. `/api/garden/frequency` serves it.
- A fast model for it, `models/gardenFrequency.mjs` (the game's garden rules as `models/garden.mjs`
  has them, the built-in gardeners' policies, a time-weighted histogram), and the experiment
  `garden-frequency` that prints the same.
- **CookieSimMgr looks like Cookie Clicker**: the game's framed panels for cards, its section
  headings for page titles, its wooden beams along the top and down the menu, store tiles for the menu
  and its option buttons for chips and buttons — all with the game's own pictures.

## 0.4.0 — 2026-10-27 (add-on v3.34.0)

- **CookieMgr starts in the simulator as it does in the game.** Which modules start is read from the
  add-on's init list in `src/main.js` (all but the UI's, the update check and the Cookie Monster
  loader), instead of a copy of it in `mgr/host.mjs` that had fallen behind: **the dragon** (`dragon.*`,
  Auto dragon, aura profiles) and **the statistics' words** (`stat.*`) were missing, so SeasonCompletion's
  dragon steps did nothing here. `sim.failed` lists any module whose start threw.
- CookieSimMgr's macro lists: Auto dragon, Pet the dragon and SeasonCompletion are in them; the
  Force the Hand of Fate combo macro is listed by its id (`fthofOnClickFrenzy`; `fthof` had been gone
  since add-on v3.13.0).
- **Tests that can't run say so.** Without the game's scripts (offline, a blocked CDN) the simulator's
  tests used to print "ALL CHECKS PASSED" with 0 checks. Now they say SKIPPED and why, the test runner
  lists them as skipped, and in CI a skip is a failure. A new `tests/sim/host.test.mjs` (no game
  needed) checks the init list against `src/main.js`.
- README: what it loads, staging (empty — `payback.js` is in the add-on), what's not yet driven.

## 0.3.2 — 2026-10-16

- Measured Force the Hand of Fate's forecast mode (the experiment was removed with the forecast in add-on
  v3.13.0).

## 0.3.1 — 2026-10-16

- `run()` carries part frames; the Full-garden replanter's two modes measured (`garden-replant-modes`).

## 0.3.0 — 2026-10-16

- CookieSimMgr shows the add-on's own Graphs and Events pages.
