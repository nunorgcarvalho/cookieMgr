---
bump: minor
---

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
