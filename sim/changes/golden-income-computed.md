---
bump: minor
---

- **Golden cookie income, computed:** a save's income curve now takes seconds instead of minutes, and its points
  are within a few tenths of a percent instead of ±5–25%. Golden cookies are a renewal process (the spawn timer
  doesn't care what's running) and their effects a Markov chain over what's running (each buff's time left, the
  last effect), so `models/goldenExpected.mjs` walks that chain a million golden cookies a frequency and credits
  each one its *expected* payoff: every effect it could pick (with the game's own odds from `popFunc`, Dragonflight
  and the last effect included), what it pays, and what CpS, clicks and storm drops earn until the next one,
  averaged over the wait's exact distribution. Rare stacks (Click frenzy or Dragonflight on Frenzy, Dragon Harvest
  and building specials) are then counted at their odds every time their makings come up, instead of the few
  times the dice land on them. `exactIncome` solves the same chain outright on a time grid (no noise, but only
  up to +50% or so before its states run away): the walk agrees with it within 0.1%. Checked against the game
  played event to event: golden cookies and effects an hour, the time each mix of buffs runs, CpS and Lucky
  payouts.
- **Score for your game** (Garden page) computes the curve by default; *Played 2,000 h* / *8,000 h* still play it.
  A computed curve goes through its points (a smooth monotone interpolation) instead of a fit. The bank is held
  at the save's (Lucky and chains read it); `golden-income --bank` sets another. `golden-income` and
  `garden-score` compute too (`--pops`), or play with `--play`.
- **Fixed, the played income model:** a free sugar lump no longer lifts CpS for the rest of a run (with Sugar
  baking each one added 1% against a baseline taken at the start: ~4% too much over 2,000 h), and the 1% second
  golden cookie now sees the first one's buff (it used CpS from before it).
