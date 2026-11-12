---
bump: minor
---

- **Grimoire in the computed model:** the fast golden cookie walk now casts spells. Force the Hand of Fate,
  Stretch Time, Diminish Ineptitude and Conjure Baked Goods are worked out from the game's own spell code (costs,
  backfire odds, magic refill frame by frame), and each cast is credited its expected payoff over every outcome
  (Frenzy, Lucky, Click frenzy, storm, Building special, blab; Clot, Ruin, Cursed finger, Elder frenzy on a
  backfire). Natural golden cookies and casts are both events of the walk, so the timer keeps running between them.
- **Grimoire plans:** `models/grimoire.mjs` describes when to cast the way the add-on's cast tiers do (combos of
  running buffs, each with a magic threshold), with named plans (never, whenever affordable, at a full bar, the
  add-on's Default, regulars only at 0% / 50%, singles, Stretch Time, Diminish Ineptitude, Conjure Baked Goods) and
  a sweep over thresholds.
- **`grimoire-plans` experiment and Grimoire page:** scores each plan on a save across golden cookie frequencies
  and for the add-on's two garden profiles, with the walk following the garden's frequency and CpS over time
  (`--follow`), so garden and Grimoire are scored together. The GUI's new Grimoire page shows the scores, income
  by frequency, what each plan casts on and what its casts bring. `garden-score --grimoire <plan>` scores
  gardens with a plan; `--play` checks a plan in the played game.
