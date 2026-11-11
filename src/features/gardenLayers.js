// What the auto-gardener keeps and what it does, in four layers you pick separately — and profiles
// that pick all four at once:
//
//   gardener   what it does: algorithmic code run from the top every second (features/script.js,
//              with the garden's words from features/garden.js) — it calls garden.soilRule() where
//              it deals with the soil
//   soil       the soil rule: a little code of its own that picks the soil (garden.soil(…)), run
//              when the gardener calls garden.soilRule()
//   template   where the seeds go: a 6×6 grid of letters (A, B, C…) or nothing. "Fill" (A on every
//              tile) is every garden of one seed; "Mutation rows" two parents with a row of empty
//              tiles between them. It sits on the unlocked part of the plot from its top-left
//              corner (a smaller garden uses its top-left part); one taken as it is on the plot
//              (abs) stays where it was
//   seeds      which seed each letter is: { A: 'bakerWheat', B: 'thumbcorn' }
//   profile    a combination: { gardener, soil, template, seeds } — loading one picks all four
//
// Every layer has built-ins (editable — your edit is kept apart and Revert brings the built-in
// back) and yours (made with Save as new; renamed, deleted). The "Current garden" template and
// "As planted" seeds are live: what's planted now (features/garden.js keeps that memory).

CA.GardenLayers = (() => {
  const SIZE = 6;
  const S = () => CA.Settings;
  const changed = () => CA.Events.emit('garden');
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  // ---- the built-ins -------------------------------------------------------------------------

  // A built-in's **knobs**: how its variables show above its code (ui/codeKnobs.js) —
  // { name: { kind: 'percent' | 'number' | 'toggle' | 'hidden', min, max, step, unit } }; a variable
  // without one gets a knob that suits its value.
  const PCT = { kind: 'percent' };
  const TOGGLE = { kind: 'toggle' };
  const SECONDS = { kind: 'number', min: 1, max: 120, step: 1, unit: 's' };

  /** The Steady replanter, with the numbers of the old settings (seconds before the tick, the death-chance threshold, unlocking new seeds). */
  function effectsGardener() {
    const lead = Math.max(1, Number(S().get('gardenLead')) || 15);
    const thr = Math.max(0, Math.min(100, Number(S().get('gardenThreshold')))) / 100;
    const unlock = S().get('gardenUnlockNew') !== false;
    const lines = [
      '# Steady replanter: keeps the layout planted, replanting each plant as it dies (or just before,',
      '# when it is likely to die on the coming tick) — so the garden is always in full, its plants at',
      '# every age. It plants only where the layout has a seed, and only clears the tiles the layout uses.',
      '# Your numbers (used below):',
      `tickWindow = ${lead}   # the last seconds before a garden tick, when old plants are dealt with`,
    ];
    if (thr < 1) lines.push(`dyingOver = ${thr}   # replant mature plants more likely than this to die on the tick (the new one grows at it)`);
    lines.push(
      `unlockNewSeeds = ${unlock}   # a seed you haven't unlocked yet: let it grow, harvest it once mature (that unlocks it)`,
      "# Plant the layout's seed on every empty tile it has one for, right away.",
      'garden.plantEmpty()',
      'if unlockNewSeeds:',
      '  garden.harvestNew()',
      '# The soil, as the soil rule picks it (its effects count the whole time, not just at the tick).',
      'garden.soilRule()',
      '# In the last tickWindow seconds before a garden tick:',
      'if garden.tickIn() <= tickWindow:',
      "  # clear the layout's tiles of what doesn't belong there (leaving new seeds to grow)",
      '  for tile in garden.tiles():',
      '    if garden.wantAt(tile) != "" and garden.isOff(tile) and not garden.isEmpty(tile) and not (unlockNewSeeds and garden.isNew(tile)):',
      '      garden.harvest(tile)'
    );
    if (thr < 1) lines.push('  # replant mature plants likely to die on the tick', '  garden.harvestDying(dyingOver)', '  garden.plantEmpty()');
    return lines.join('\n') + '\n';
  }
  const WEED_GARDENER = `# Weed collector: keeps the garden bare, so weeds and fungi spring up, and gets their seeds.
# Meddleweed is left to grow old, then harvested — the older it is, the likelier it leaves brown
# mold or crumbspore behind. Anything you haven't unlocked yet grows until it's mature and is
# harvested (that unlocks it); everything else is cleared away. It plants nothing.
oldWeedOver = 0.5   # harvest a meddleweed once it's this likely to die on the next tick
# the soil, as the soil rule picks it (fertilizer: the most weeds, ×1.2)
garden.soilRule()
for tile in garden.tiles():
  if not garden.isEmpty(tile):
    if garden.plantAt(tile) == "meddleweed":
      if garden.decay(tile) > oldWeedOver:
        garden.harvest(tile)
    elif garden.isNew(tile):
      if garden.isMature(tile):
        garden.harvest(tile)
    else:
      garden.harvest(tile)
`;
  const MUTATION_GARDENER = `# Mutation tracker: keeps the layout's plants (the parents) growing, and watches every other tile
# for mutations. A seed you've unlocked already is cleared at once (its tile is another chance); a
# new one is kept — every copy of it — and harvested once mature (that unlocks it). Seeds unlocked
# in the last keepRecentMinutes count as new, so a fresh find's other copies grow on too.
keepRecentMinutes = 60   # a seed unlocked this recently still counts as new
tickWindow = 15   # the last seconds before a garden tick, when parents likely to die are replanted
dyingOver = 0.5   # replant a parent more likely than this to die on the tick
garden.plantEmpty()
# the soil, as the soil rule picks it (wood chips: three times the mutation chances)
garden.soilRule()
for tile in garden.tiles():
  if not garden.isEmpty(tile) and garden.isOff(tile):
    if garden.isNew(tile) or garden.unlockedAgo(garden.plantAt(tile)) < keepRecentMinutes * 60:
      if garden.isMature(tile):
        garden.harvest(tile)
    else:
      garden.harvest(tile)
# In the last tickWindow seconds before a garden tick: replant parents likely to die on it
if garden.tickIn() <= tickWindow:
  garden.harvestDying(dyingOver)
  garden.plantEmpty()
`;
  const COHORT_GARDENER = `# Full-garden replanter: plants the whole layout at once and lets it grow as one round — on
# fertilizer while it grows, clay once a quarter of it is mature (its soil rule, "Grow together, then
# clay") — and doesn't replant plants that die during a round. Once too few mature plants are
# left, a new round: fertilizer first (the next tick within 3 minutes, the old plants working until
# then), and the plants still alive harvested and the whole layout planted again in the last
# seconds before that tick, so the new round grows on it straight away. (Simulated — the real game,
# a level-6 golden clover field, 24 h × 4 seeds: golden cookies +56.0% at the tick against +54.8%
# planting at once, ahead on every seed.) Planted together, the plants are mature together: the
# effects stay near their best for most of each round, and a new round grows fast.
replantBelow = 0.75   # start a new round once fewer than this share of the layout's tiles hold a mature plant
replantAtTick = true   # when a new round is planted — true: fertilizer first, the old plants kept working until the next tick, everything replanted in its last plantWindow seconds; false: at once
plantWindow = 15   # (replantAtTick only) the last seconds before the tick, when the new round is planted
unlockNewSeeds = true   # a seed you haven't unlocked yet: let it grow, harvest it once mature (that unlocks it)
if unlockNewSeeds:
  garden.harvestNew()
# what doesn't belong on the layout's tiles (weeds, mutations) is cleared, so it can't hold up a round
for tile in garden.tiles():
  if garden.wantAt(tile) != "" and garden.isOff(tile) and not garden.isEmpty(tile) and not (unlockNewSeeds and garden.isNew(tile)):
    garden.harvest(tile)
# a new round is due: nothing of the layout growing, and too few of its plants mature
if garden.layoutYoung() == 0 and garden.layoutMature() < replantBelow * garden.layoutTiles():
  # fertilizer: the next tick within 3 minutes, and quick ticks while the round grows
  garden.soil(fertilizer)
  # Planted now — or, with replantAtTick, in the last seconds before that tick. Even then it plants
  # at once when there's nothing to keep working (an empty plot: the first round, or every plant
  # dead) or no quick tick to wait for (fertilizer held back by its cooldown, or not unlocked).
  # Otherwise the empty tiles wait with the rest (at most ~3 minutes): planted early they'd be a
  # tick ahead of the round — and seedlings among the old plants would make the round look started.
  if not replantAtTick or garden.layoutMature() == 0 or not garden.soilIs(fertilizer) or garden.tickIn() <= plantWindow:
    for tile in garden.tiles():
      if garden.wantAt(tile) != "" and not garden.isEmpty(tile):
        garden.harvest(tile)
    garden.plantEmpty()
else:
  garden.soilRule()
# while a round is still young, fill any tile it couldn't plant (not enough cookies at the time)
if garden.layoutYoung() > 0 and garden.layoutMature() == 0:
  garden.plantEmpty()
`;
  const TULIP_GARDENER = `# Tulip and clover rounds: two seeds, each planted and replanted as a round of its own. The
# nursetulips (tulip) are replanted all together once fewer than half of them are mature, so they're
# mature at the same time — each one makes the plants around it stronger, the most when it's mature.
# The golden clovers (clover) run their own rounds as the Full-garden replanter does, a new round
# planted at once, on fertilizer, once too few of them are left. The soil rule picks the soil the
# rest of the time: "Tulips grow, then clay" (the profile's) keeps fertilizer on while the tulips grow,
# so they're mature sooner and longer; "Clovers grow together, then clay" follows the clovers only,
# for the best average. (Simulated, Farm level 9 (6×6), 8 nursetulips, 1000 h × 3, soil by the
# clovers: golden cookies +107% on average, +140% or more 26% of the time, at CpS ×0.881.)
# Each round goes down whole or not at all: it waits for the cookies to plant all of it, and for
# effects to end (a seed costs minutes of the CpS the game shows: a Frenzy makes it 7 times more expensive).
# The tulips go first: no clover round starts while a tulip round is due.
tulip = nursetulip   # the seed replanted as one round, apart from the clovers
clover = goldenClover   # the seed of the clover rounds
tulipReplantBelow = 0.5   # replant the tulips once fewer than this share of their tiles hold a mature one
replantBelow = 0.75   # start a new clover round once fewer than this share of their tiles hold a mature one
wholeRounds = true   # start a round only once the bank covers all of it (garden.roundCost) — false: plant what it can afford
tulipsFirst = true   # no clover round while a tulip round is due (it waits for the tulips to go down)
waitOutEffects = true   # no new round while an effect makes seeds more expensive and ends within the Payback page's "Wait out effects up to" (10 m: payback.effectWait(); payback.shortBoost() is what those add), even beside a longer one; one with longer left (frenzies back to back) isn't waited out: it plants at that price
unlockNewSeeds = true   # a seed you haven't unlocked yet: let it grow, harvest it once mature (that unlocks it)
if unlockNewSeeds:
  garden.harvestNew()
# what doesn't belong on the layout's tiles (weeds, mutations) is cleared, so it can't hold up a round
for tile in garden.tiles():
  if garden.wantAt(tile) != "" and garden.isOff(tile) and not garden.isEmpty(tile) and not (unlockNewSeeds and garden.isNew(tile)):
    garden.harvest(tile)
# whether a round may go down now: no effect on the prices, and the cookies for all of it
pricesOk = not waitOutEffects or payback.shortBoost() <= 1
# the tulips: a new round is due once none is growing and fewer than tulipReplantBelow are mature
tulipDue = garden.seedYoung(tulip) == 0 and garden.seedMature(tulip) < tulipReplantBelow * garden.seedTiles(tulip)
tulipReady = pricesOk and (not wholeRounds or cookies >= garden.roundCost(tulip))
# …planted at once, all of it
if tulipDue and tulipReady:
  for tile in garden.tiles():
    if garden.wantAt(tile) == tulip and not garden.isEmpty(tile):
      garden.harvest(tile)
  garden.plantEmpty(tulip)
# while a tulip round is still growing, fill any tile it couldn't plant (not enough cookies at the
# time, or a weed cleared) — even with some of it mature already, so a round never sits half planted
if garden.seedYoung(tulip) > 0:
  garden.plantEmpty(tulip)
# the clovers: a new round may go down once the tulips are (tulipsFirst), and the cookies left cover it
tulipDue = garden.seedYoung(tulip) == 0 and garden.seedMature(tulip) < tulipReplantBelow * garden.seedTiles(tulip)
cloverReady = pricesOk and (not wholeRounds or cookies >= garden.roundCost(clover)) and not (tulipsFirst and tulipDue)
# …and is due once none is growing and too few are mature
if cloverReady and garden.seedYoung(clover) == 0 and garden.seedMature(clover) < replantBelow * garden.seedTiles(clover):
  # fertilizer: quick ticks while the round grows
  garden.soil(fertilizer)
  # planted at once, all of it: seedlings only grow at the next tick, so waiting for its last seconds
  # wouldn't start the round any sooner (and the Auto buyer's garden rows plant at once too)
  for tile in garden.tiles():
    if garden.wantAt(tile) == clover and not garden.isEmpty(tile):
      garden.harvest(tile)
  garden.plantEmpty(clover)
else:
  garden.soilRule()
# while a clover round is still growing and none of it is mature yet, fill any tile it couldn't plant
# (not enough cookies at the time). Not later: a clover that died would be replanted while the rest
# still grow, the round would never end, and its clovers would drift apart (never all mature at once)
if garden.seedYoung(clover) > 0 and garden.seedMature(clover) == 0:
  garden.plantEmpty(clover)
`;
  const GARDENERS = [
    {
      id: 'effects',
      name: 'Steady replanter',
      desc: 'Keeps the layout in full: replants each plant as it dies (or just before, when it’s likely to die on the tick), unlocks new seeds. Only touches the tiles the layout uses.',
      data: () => ({ rules: effectsGardener(), knobs: { tickWindow: SECONDS, dyingOver: PCT, unlockNewSeeds: TOGGLE } }),
    },
    {
      id: 'cohort',
      name: 'Full-garden replanter',
      desc: 'Plants the whole layout together, grows it on fertilizer, holds it on clay, and once too few are left, replants everything together on fertilizer just before the next tick (or at once) — so the plants are mature together. The most golden cookies from a golden clover field, in high windows.',
      data: () => ({ rules: COHORT_GARDENER, knobs: { replantBelow: PCT, replantAtTick: TOGGLE, plantWindow: SECONDS, unlockNewSeeds: TOGGLE } }),
    },
    {
      id: 'tulipRounds',
      name: 'Tulip and clover rounds',
      desc: 'Nursetulips and golden clovers, each replanted all together on rounds of its own. The tulips first, once fewer than half are mature, the clovers as the Full-garden replanter does — so the tulips are mature at the same time, boosting the clovers around them. A round goes down whole, once the bank covers it, and it waits out an effect that makes seeds more expensive if it ends within 2 minutes.',
      data: () => ({ rules: TULIP_GARDENER, knobs: { tulipReplantBelow: PCT, replantBelow: PCT, wholeRounds: TOGGLE, tulipsFirst: TOGGLE, waitOutEffects: TOGGLE, unlockNewSeeds: TOGGLE } }),
    },
    { id: 'weeds', name: 'Weed collector', desc: 'Keeps the garden bare so weeds and fungi spring up; harvests old meddleweed (for brown mold and crumbspore) and new seeds once mature, clears everything else. Plants nothing.', data: () => ({ rules: WEED_GARDENER, knobs: { oldWeedOver: PCT } }) },
    {
      id: 'mutations',
      name: 'Mutation tracker',
      desc: 'Grows the layout’s parents and watches the other tiles: a seed you have is cleared at once, a new one (or one unlocked in the last hour) is kept until mature and harvested.',
      data: () => ({ rules: MUTATION_GARDENER, knobs: { keepRecentMinutes: { kind: 'number', min: 0, max: 240, step: 5, unit: 'min' }, tickWindow: SECONDS, dyingOver: PCT } }),
    },
  ];

  const FERTILIZER_VAR = 'fertilizerAbove';
  const SOIL_EFFECTS = `# Fertilizer while nearly everything is still growing (a freshly planted garden: quicker ticks),
# clay (effects ×1.25) otherwise. Once plants are replanted one at a time, fertilizer doesn't help:
# a plant spends the same share of its ticks growing on either soil, at 0.75 instead of 1.25.
${FERTILIZER_VAR} = 0.9   # fertilizer while more than this share of the planted tiles is still growing
if garden.youngShare() > ${FERTILIZER_VAR}:
  garden.soil(fertilizer)
else:
  garden.soil(clay)
`;
  const SOIL_COHORT = `# Grow together, then clay: fertilizer while a new round of the layout's plants grows (quick ticks),
# clay (effects ×1.25) once clayAt of its tiles hold a mature plant — and clay from then until the
# next round (once a plant of the round is gone, the round counts as grown). A tick on clay lasts five
# times as long at ×1.25 instead of ×0.75, so fertilizer only pays while the round is mostly young:
# simulated, a golden clover field (6×6), 1000 h × 3: +104.8% golden cookies switching at 25% mature,
# +98.7% at 75%, and fewer rounds to buy.
clayAt = 0.25   # switch to clay once this share of the layout's tiles hold a mature plant
if garden.layoutYoung() > 0 and (garden.layoutMature() == 0 or (garden.layoutMature() < clayAt * garden.layoutTiles() and garden.layoutYoung() + garden.layoutMature() >= garden.layoutTiles())):
  garden.soil(fertilizer)
else:
  garden.soil(clay)
`;
  const SOIL_CLOVERS = `# Clovers grow together, then clay: as "Grow together, then clay", counting one seed's plants only
# (followSeed) — so plants on rounds of their own (nursetulips) don't keep fertilizer on while they
# grow. Clay from clayAt mature until the next round. (Simulated, 8 nursetulips together at level 9,
# 1000 h × 3: golden cookies +107% on average, +140% or more 26% of the time; "Tulips grow, then
# clay" trades average for longer peaks.)
followSeed = goldenClover   # the seed whose rounds pick the soil
clayAt = 0.25   # switch to clay once this share of its tiles hold a mature plant
if garden.seedYoung(followSeed) > 0 and (garden.seedMature(followSeed) == 0 or (garden.seedMature(followSeed) < clayAt * garden.seedTiles(followSeed) and garden.seedYoung(followSeed) + garden.seedMature(followSeed) >= garden.seedTiles(followSeed))):
  garden.soil(fertilizer)
else:
  garden.soil(clay)
`;
  const SOIL_TULIPS = `# Tulips grow, then clay: fertilizer (quick ticks) while any nursetulip (followSeed) is still
# growing, so they're mature sooner and for longer; clay (effects ×1.25) once they're all mature. With
# cloversToo, fertilizer as well while a round of golden clovers grows (as "Clovers grow together, then
# clay"). Simulated, 8 nursetulips together at level 9 (6×6), 1000 h × 3 (golden cookies on average · the
# share of the time at +140% or more · every tulip mature):
#   soil by the clovers only        +107.0% · 26% · 25% of the time
#   by the tulips only              +91.4% · 30% · 47%
#   by either (cloversToo)          +88.8% · 35% · 41%
followSeed = nursetulip   # the seed whose growing keeps fertilizer on
cloversToo = true   # fertilizer as well while a round of the clovers grows
cloverSeed = goldenClover   # (cloversToo) the seed of the clover rounds
clayAt = 0.25   # (cloversToo) a clover round counts as grown once this share of its tiles hold a mature plant, until the next round
if garden.seedYoung(followSeed) > 0 or (cloversToo and garden.seedYoung(cloverSeed) > 0 and (garden.seedMature(cloverSeed) == 0 or (garden.seedMature(cloverSeed) < clayAt * garden.seedTiles(cloverSeed) and garden.seedYoung(cloverSeed) + garden.seedMature(cloverSeed) >= garden.seedTiles(cloverSeed)))):
  garden.soil(fertilizer)
else:
  garden.soil(clay)
`;
  const SOIL_MUTATIONS = `# Fertilizer to grow the layout's plants; wood chips (three times the mutation chances) once
# they're mature — if you have the 300 farms it needs, else fertilizer (quicker ticks, more chances).
growingOver = 0.34   # fertilizer while more than this share of the layout's plants is still growing
if garden.layoutYoungShare() > growingOver or not garden.soilAvailable(woodchips):
  garden.soil(fertilizer)
else:
  garden.soil(woodchips)
`;
  const fixedSoil = (key, why) => `# Always ${key}${why ? ` — ${why}` : ''}.\ngarden.soil(${key})\n`;
  const SOILS = [
    { id: 'effects', name: 'Fertilizer, then clay', desc: 'Fertilizer for a freshly planted garden, clay (effects ×1.25) the rest of the time.', data: () => ({ rules: SOIL_EFFECTS, knobs: { [FERTILIZER_VAR]: PCT } }) },
    { id: 'cohort', name: 'Grow together, then clay', desc: 'For the Full-garden replanter: fertilizer while a round starts growing, clay once a quarter of it is mature, until the next round.', data: () => ({ rules: SOIL_COHORT, knobs: { clayAt: PCT } }) },
    { id: 'clovers', name: 'Clovers grow together, then clay', desc: 'Fertilizer while a round of golden clovers starts growing, clay once a quarter of it is mature, until the next round — the nursetulips don’t count. For Tulip and clover rounds.', data: () => ({ rules: SOIL_CLOVERS, knobs: { clayAt: PCT } }) },
    { id: 'tulips', name: 'Tulips grow, then clay', desc: 'Fertilizer while any nursetulip grows (and, with cloversToo, while a round of golden clovers grows), clay once they’re mature — the nursetulips mature sooner and stay mature longer: longer peaks, a lower average. For Tulip and clover rounds.', data: () => ({ rules: SOIL_TULIPS, knobs: { cloversToo: TOGGLE, clayAt: PCT } }) },
    { id: 'mutations', name: 'Fertilizer, then wood chips', desc: 'Fertilizer while the layout’s plants grow, wood chips (×3 mutation chances) once they’re mature.', data: () => ({ rules: SOIL_MUTATIONS, knobs: { growingOver: PCT } }) },
    { id: 'fertilizer', name: 'Always fertilizer', desc: 'Quickest ticks, the most weeds (×1.2); effects ×0.75.', data: () => ({ rules: fixedSoil('fertilizer', 'the quickest ticks and the most weeds') }) },
    { id: 'clay', name: 'Always clay', desc: 'Effects ×1.25; slow ticks.', data: () => ({ rules: fixedSoil('clay', 'effects ×1.25, slow ticks') }) },
    { id: 'woodchips', name: 'Always wood chips', desc: 'Three times the mutation chances; needs 300 farms.', data: () => ({ rules: fixedSoil('woodchips', 'three times the mutation chances') }) },
    { id: 'none', name: 'Leave the soil', desc: 'Doesn’t change the soil.', data: () => ({ rules: '# Leaves the soil as it is.\n' }) },
  ];

  const grid = (rows) => rows.map((r) => r.split('').map((c) => (c === '.' ? null : c)));
  const TEMPLATES = [
    { id: 'current', name: 'Current garden', desc: 'Whatever is planted, kept as it is: a plant that dies is replanted; it follows what you plant or harvest by hand, not weeds or mutations that spring up.', live: true, data: () => ({ plot: currentLetters().plot, abs: true }) },
    { id: 'fill', name: 'Fill', desc: 'One seed on every tile.', data: () => ({ plot: grid(Array(SIZE).fill('AAAAAA')), abs: false }) },
    { id: 'bare', name: 'Bare', desc: 'Nothing planted (for weeds).', data: () => ({ plot: grid(Array(SIZE).fill('......')), abs: false }) },
    { id: 'checker', name: 'Checkerboard', desc: 'Two seeds, alternating.', data: () => ({ plot: grid(['ABABAB', 'BABABA', 'ABABAB', 'BABABA', 'ABABAB', 'BABABA']), abs: false }) },
    { id: 'tulipRows', name: 'Two rows of four', desc: 'Two rows of four B with A all around them: each A touches as many B as it can on a 6×5 or 6×6 plot — 8 nursetulips among golden clovers.', data: () => ({ plot: grid(['AAAAAA', 'ABBBBA', 'AAAAAA', 'ABBBBA', 'AAAAAA', 'AAAAAA']), abs: false }) },
    { id: 'rows', name: 'Mutation rows', desc: 'A row of A, an empty row, a row of B: every empty tile has three of each around it — for two-parent mutations (A = B for a seed with itself).', data: () => ({ plot: grid(['AAAAAA', '......', 'BBBBBB', 'AAAAAA', '......', 'BBBBBB']), abs: false }) },
    { id: 'rings', name: 'Rings', desc: 'Rings of A around empty tiles: eight around each — for mutations that need many of one plant (Juicy queenbeet: 8 queenbeets).', data: () => ({ plot: grid(['AAAAAA', 'A.AA.A', 'AAAAAA', 'AAAAAA', 'A.AA.A', 'AAAAAA']), abs: false }) },
  ];

  const NAMES = {
    bakerWheat: 'Baker’s wheat', thumbcorn: 'Thumbcorn', cronerice: 'Cronerice', gildmillet: 'Gildmillet', clover: 'Ordinary clover', goldenClover: 'Golden clover',
    shimmerlily: 'Shimmerlily', elderwort: 'Elderwort', bakeberry: 'Bakeberry', chocoroot: 'Chocoroot', whiteChocoroot: 'White chocoroot', whiteMildew: 'White mildew',
    brownMold: 'Brown mold', whiskerbloom: 'Whiskerbloom', chimerose: 'Chimerose', nursetulip: 'Nursetulip', drowsyfern: 'Drowsyfern', wardlichen: 'Wardlichen',
    keenmoss: 'Keenmoss', queenbeet: 'Queenbeet', queenbeetLump: 'Juicy queenbeet', duketater: 'Duketater', crumbspore: 'Crumbspore', doughshroom: 'Doughshroom',
    glovemorel: 'Glovemorel', cheapcap: 'Cheapcap', foolBolete: 'Fool’s bolete', wrinklegill: 'Wrinklegill', greenRot: 'Green rot', shriekbulb: 'Shriekbulb',
    tidygrass: 'Tidygrass', everdaisy: 'Everdaisy', ichorpuff: 'Ichorpuff',
  };
  // the game's mutations from two mature parents (minigameGarden.js M.getMuts): [what grows, A, B, chance a tick]
  const RECIPES = [
    ['thumbcorn', 'bakerWheat', 'bakerWheat', '5%'], ['cronerice', 'bakerWheat', 'thumbcorn', '1%'], ['gildmillet', 'cronerice', 'thumbcorn', '3%'],
    ['clover', 'bakerWheat', 'gildmillet', '3%; Golden clover 0.07%'], ['shimmerlily', 'clover', 'gildmillet', '2%'], ['elderwort', 'shimmerlily', 'cronerice', '1%'],
    ['chocoroot', 'bakerWheat', 'brownMold', '10%'], ['whiteChocoroot', 'chocoroot', 'whiteMildew', '10%'], ['whiskerbloom', 'shimmerlily', 'whiteChocoroot', '1%'],
    ['chimerose', 'shimmerlily', 'whiskerbloom', '5%'], ['nursetulip', 'whiskerbloom', 'whiskerbloom', '5%'], ['greenRot', 'whiteMildew', 'clover', '5%'],
    ['keenmoss', 'greenRot', 'brownMold', '10%'], ['drowsyfern', 'chocoroot', 'keenmoss', '0.5%'], ['wardlichen', 'cronerice', 'keenmoss', '0.5%'],
    ['queenbeet', 'chocoroot', 'bakeberry', '1%'], ['duketater', 'queenbeet', 'queenbeet', '0.1%'], ['tidygrass', 'bakerWheat', 'whiteChocoroot', '0.2%'],
    ['everdaisy', 'tidygrass', 'elderwort', '0.2% (3 of each)'], ['wrinklegill', 'crumbspore', 'brownMold', '6%'], ['doughshroom', 'crumbspore', 'crumbspore', '0.5%'],
    ['glovemorel', 'crumbspore', 'thumbcorn', '2%'], ['cheapcap', 'crumbspore', 'shimmerlily', '4%'], ['foolBolete', 'doughshroom', 'greenRot', '4%'],
    ['shriekbulb', 'wrinklegill', 'elderwort', '0.1%'], ['ichorpuff', 'elderwort', 'crumbspore', '0.2%'],
    ['whiteMildew', 'brownMold', 'brownMold', '50%'],
  ];
  // seeds a recipe grows as its rare second outcome (Baker's wheat × Gildmillet: Golden clover 0.07% a tick)
  const ALSO = { goldenClover: 'clover' };
  const one = (id, key, desc) => ({ id, name: NAMES[key], desc, group: 'For their effects', data: () => ({ map: { A: key } }) });
  const SEEDS = [
    { id: 'current', name: 'As planted', desc: 'The seeds of the Current garden: A is the first seed on the plot (left to right, top to bottom), B the next…', live: true, data: () => ({ map: currentLetters().map }) },
    one('goldenClover', 'goldenClover', 'Golden cookies more often (+3% each).'),
    { id: 'goldenTulips', name: 'Golden clover + nursetulip', desc: 'A: golden clover (golden cookies more often), B: nursetulip (the plants around it +20% stronger, CpS −2%).', group: 'For their effects', data: () => ({ map: { A: 'goldenClover', B: 'nursetulip' } }) },
    one('bakerWheat', 'bakerWheat', 'CpS +1% each.'),
    one('bakeberry', 'bakeberry', 'CpS +1% each; a harvest of a mature one pays 30 minutes of CpS.'),
    one('whiskerbloom', 'whiskerbloom', 'Milk effects +0.2% each.'),
    one('queenbeet', 'queenbeet', 'Golden cookie effects +0.3% each; eight around an empty tile can grow a Juicy queenbeet.'),
    ...RECIPES.map(([out, a, b, p]) => ({
      id: `to-${out}`,
      name: `→ ${NAMES[out]}`,
      desc: `${NAMES[a]} × ${NAMES[b]} → ${NAMES[out]} (${p} a tick, on an empty tile next to both, mature).`,
      group: 'Mutation recipes',
      data: () => ({ map: { A: a, B: b } }),
    })),
  ];

  const PROFILES = [
    { id: 'maxEffects', name: 'Max effects · current garden', desc: 'Keeps what you’ve planted, its effects as high as they go.', data: () => ({ gardener: 'effects', soil: 'effects', template: 'current', seeds: 'current' }) },
    { id: 'goldenClovers', name: 'Golden clover field', desc: 'Golden clover on every tile, for golden cookies.', data: () => ({ gardener: 'effects', soil: 'effects', template: 'fill', seeds: 'goldenClover' }) },
    { id: 'goldenCombos', name: 'Golden clover combos', desc: 'Golden clover on every tile, planted and replanted all together: the field is mature at once, for the most golden cookies in long high windows.', data: () => ({ gardener: 'cohort', soil: 'cohort', template: 'fill', seeds: 'goldenClover' }) },
    {
      id: 'tulipCombos',
      name: '8 nursetulips together + clover combos',
      desc: 'Two rows of four nursetulips replanted all together, golden clovers around them replanted all together on rounds of their own; fertilizer while the tulips or a clover round grow, clay once they’re mature. The longest high peaks (+140% or more 17% of the time), golden cookies +70% on average, CpS −12%.',
      data: () => ({ gardener: 'tulipRounds', soil: 'tulips', template: 'tulipRows', seeds: 'goldenTulips' }),
    },
    { id: 'mutationHunt', name: 'Mutation hunt', desc: 'Two parents in rows, wood chips once they’re mature; new seeds kept until unlocked. Pick the recipe in Seeds.', data: () => ({ gardener: 'mutations', soil: 'mutations', template: 'rows', seeds: 'to-cronerice' }) },
    { id: 'juicyQueenbeet', name: 'Juicy queenbeet', desc: 'Rings of queenbeets on wood chips: each empty center can grow a Juicy queenbeet (a sugar lump).', data: () => ({ gardener: 'mutations', soil: 'mutations', template: 'rings', seeds: 'queenbeet' }) },
    { id: 'weedFarm', name: 'Weed farm', desc: 'A bare garden on fertilizer, for meddleweed, brown mold and crumbspore.', data: () => ({ gardener: 'weeds', soil: 'fertilizer', template: 'bare', seeds: 'current' }) },
  ];

  // ---- the stores ----------------------------------------------------------------------------

  const KINDS = ['percent', 'number', 'toggle', 'hidden'];
  /** Knobs as saved: { name: { kind, min?, max?, step?, unit? } }. */
  function cleanKnobs(k) {
    const out = {};
    Object.keys(k && typeof k === 'object' ? k : {})
      .slice(0, 60)
      .forEach((name) => {
        const v = k[name];
        if (!/^[A-Za-z_]\w{0,40}$/.test(name) || !v || !KINDS.includes(v.kind)) return;
        const o = { kind: v.kind };
        ['min', 'max', 'step'].forEach((f) => Number.isFinite(Number(v[f])) && v[f] !== '' && v[f] != null && (o[f] = Number(v[f])));
        if (typeof v.unit === 'string' && v.unit) o.unit = v.unit.slice(0, 8);
        out[name] = o;
      });
    return out;
  }
  const cleanRules = (d) => ({ rules: String((d && d.rules) || '').slice(0, 20000), knobs: cleanKnobs(d && d.knobs) });
  const cleanPlot = (plot) => Array.from({ length: SIZE }, (_, y) => Array.from({ length: SIZE }, (_, x) => (plot && plot[y] && typeof plot[y][x] === 'string' && /^[A-Z]$/.test(plot[y][x]) ? plot[y][x] : null)));
  const cleanMap = (m) => {
    const out = {};
    Object.keys(m || {}).forEach((k) => /^[A-Z]$/.test(k) && typeof m[k] === 'string' && m[k] && (out[k] = m[k].slice(0, 40)));
    return out;
  };
  const LAYERS = {
    gardener: { opt: 'gardenGardener', def: 'effects', builtins: GARDENERS, clean: cleanRules, noun: 'gardener' },
    soil: { opt: 'gardenSoil', def: 'effects', builtins: SOILS, clean: cleanRules, noun: 'soil rule' },
    template: { opt: 'gardenTemplate', def: 'current', builtins: TEMPLATES, clean: (d) => ({ plot: cleanPlot(d && d.plot), abs: !!(d && d.abs) }), noun: 'template' },
    seeds: { opt: 'gardenSeeds', def: 'current', builtins: SEEDS, clean: (d) => ({ map: cleanMap(d && d.map) }), noun: 'seed set' },
    profile: {
      opt: 'gardenProfile',
      def: 'maxEffects',
      builtins: PROFILES,
      clean: (d) => ({ gardener: String((d && d.gardener) || 'effects'), soil: String((d && d.soil) || 'effects'), template: String((d && d.template) || 'current'), seeds: String((d && d.seeds) || 'current') }),
      noun: 'profile',
    },
  };
  const PARTS = ['gardener', 'soil', 'template', 'seeds'];
  // yours: { id, name, data }; a built-in you edited: { id, data }
  let saved = { gardener: [], soil: [], template: [], seeds: [], profile: [] };

  const builtinOf = (layer, id) => LAYERS[layer].builtins.find((b) => b.id === id) || null;
  /** An item: { id, name, desc, builtin, live, edited, group, data }, or null. */
  function get(layer, id) {
    const b = builtinOf(layer, id);
    const own = saved[layer].find((x) => x.id === id);
    if (b) {
      const def = b.data();
      // an edit saved before its knobs were: the built-in's
      const data = own && !b.live ? (def.knobs && own.data.rules != null && !Object.keys(own.data.knobs || {}).length ? { ...own.data, knobs: def.knobs } : own.data) : def;
      return { id, name: b.name, desc: b.desc || '', builtin: true, live: !!b.live, edited: !!own && !b.live, group: b.group || '', data };
    }
    if (own) return { id, name: own.name, desc: '', builtin: false, live: false, edited: false, group: '', data: own.data };
    return null;
  }
  /** Every item of a layer (built-ins first, then yours), without their data. */
  function list(layer) {
    const L = LAYERS[layer];
    return L.builtins
      .map((b) => ({ id: b.id, name: b.name, desc: b.desc || '', builtin: true, live: !!b.live, group: b.group || '', edited: !b.live && saved[layer].some((x) => x.id === b.id) }))
      .concat(saved[layer].filter((x) => !builtinOf(layer, x.id)).map((x) => ({ id: x.id, name: x.name, desc: '', builtin: false, live: false, group: '', edited: false })));
  }
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  /** Changes an item (a built-in: your version, kept apart; null, or its own data, brings it back). */
  function set(layer, id, data) {
    const L = LAYERS[layer];
    const b = builtinOf(layer, id);
    const i = saved[layer].findIndex((x) => x.id === id);
    if (b) {
      if (b.live) return;
      const d = data == null ? null : L.clean(data);
      if (!d || same(d, L.clean(b.data()))) {
        if (i >= 0) saved[layer].splice(i, 1);
      } else if (i >= 0) saved[layer][i].data = d;
      else saved[layer].push({ id, data: d });
    } else if (i >= 0 && data != null) saved[layer][i].data = L.clean(data);
    changed();
  }
  const newId = (layer) => `${layer[0]}${Date.now().toString(36)}${Math.floor(Math.random() * 46656).toString(36)}`;
  /** A new item of yours; returns its id. */
  function add(layer, name, data) {
    let id = newId(layer);
    while (get(layer, id)) id += 'x';
    saved[layer].push({ id, name: String(name || `My ${LAYERS[layer].noun}`).trim().slice(0, 40) || `My ${LAYERS[layer].noun}`, data: LAYERS[layer].clean(data) });
    changed();
    return id;
  }
  function rename(layer, id, name) {
    const own = saved[layer].find((x) => x.id === id && !builtinOf(layer, id));
    if (!own || !String(name).trim()) return;
    own.name = String(name).trim().slice(0, 40);
    changed();
  }
  function remove(layer, id) {
    if (builtinOf(layer, id)) return;
    saved[layer] = saved[layer].filter((x) => x.id !== id);
    if (S().get(LAYERS[layer].opt) === id) S().set(LAYERS[layer].opt, LAYERS[layer].def);
    changed();
  }

  // ---- what's picked -------------------------------------------------------------------------

  /** Whether a layer has an item with this id. */
  const has = (layer, id) => !!builtinOf(layer, id) || saved[layer].some((x) => x.id === id);
  /** The id picked in a layer (its default when the pick is gone). */
  const picked = (layer) => (has(layer, S().get(LAYERS[layer].opt)) ? S().get(LAYERS[layer].opt) : LAYERS[layer].def);
  const picks = () => ({ gardener: picked('gardener'), soil: picked('soil'), template: picked('template'), seeds: picked('seeds') });
  /** Picks one item of a layer (the Current garden: taken afresh). A profile: loads its four. */
  function pick(layer, id) {
    if (!has(layer, id)) return;
    if (layer === 'profile') return loadProfile(id);
    S().set(LAYERS[layer].opt, id);
    if (layer === 'template' && id === 'current' && CA.Garden.captureCurrent) CA.Garden.captureCurrent();
  }
  function loadProfile(id, opts = {}) {
    const p = get('profile', id);
    if (!p) return;
    PARTS.forEach((k) => S().set(LAYERS[k].opt, has(k, p.data[k]) ? p.data[k] : LAYERS[k].def));
    S().set(LAYERS.profile.opt, id);
    if (picked('template') === 'current' && !opts.lazy && CA.Garden.captureCurrent) CA.Garden.captureCurrent();
  }
  /**
   * The seeds a profile plants that the garden can't yet (not unlocked), by name: [] when it can plant them
   * all (or plants what's there already), null with no garden.
   */
  function missingSeeds(id) {
    const M = CA.Util.minigame('Farm');
    if (!M || !M.plot) return null;
    const plants = M.plants || {};
    const p = get('profile', id);
    const seeds = p && get('seeds', p.data.seeds);
    if (!seeds || seeds.live) return [];
    return Object.values(seeds.data.map || {})
      .filter((key, i, all) => all.indexOf(key) === i && plants[key] && !plants[key].unlocked)
      .map((key) => NAMES[key] || plants[key].name);
  }
  /** The seeds (game keys) a profile plants that aren't unlocked yet: [] when none, null with no garden. */
  function missingKeys(id) {
    const M = CA.Util.minigame('Farm');
    if (!M || !M.plot) return null;
    const plants = M.plants || {};
    const p = get('profile', id);
    const seeds = p && get('seeds', p.data.seeds);
    if (!seeds || seeds.live) return [];
    return Object.values(seeds.data.map || {}).filter((key, i, all) => all.indexOf(key) === i && plants[key] && !plants[key].unlocked);
  }
  /**
   * The next mutation to breed toward the seeds a profile is missing: { seeds: 'to-<x>', grows: key, for: key } —
   * the first recipe on the way whose two parents are unlocked (Nursetulip: Whiskerbloom × Whiskerbloom, or
   * first Whiskerbloom, or first Shimmerlily…) — or null: nothing missing, no garden, or a step only weeds
   * bring (Brown mold, Meddleweed, Crumbspore: the weed farm's).
   */
  function seedHunt(id) {
    const missing = missingKeys(id);
    if (!missing || !missing.length) return null;
    const plants = CA.Util.minigame('Farm').plants || {};
    const unlocked = (k) => !!(plants[k] && plants[k].unlocked);
    const stepTo = (key, seen) => {
      if (seen.includes(key)) return null;
      const r = RECIPES.find((x) => x[0] === (ALSO[key] || key));
      if (!r) return null;
      const locked = [r[1], r[2]].filter((k) => !unlocked(k));
      if (!locked.length) return { seeds: `to-${r[0]}`, grows: key };
      return stepTo(locked[0], [...seen, key]);
    };
    for (const key of missing) {
      const s = stepTo(key, []);
      if (s && has('seeds', s.seeds)) return { ...s, for: key };
    }
    return null;
  }
  /** Loads a profile with another seeds pick (the Mutation hunt on a recipe of its own), unless it's in already. */
  function loadWithSeeds(id, seedsId) {
    if (picked('profile') === id && picked('seeds') === seedsId) return 0;
    loadProfile(id, { lazy: true });
    if (has('seeds', seedsId)) S().set(LAYERS.seeds.opt, seedsId);
    return 1;
  }
  /** Whether the four picks differ from the loaded profile's. */
  function profileChanged() {
    const p = get('profile', picked('profile'));
    return !!p && PARTS.some((k) => (has(k, p.data[k]) ? p.data[k] : LAYERS[k].def) !== picked(k));
  }
  /** The loaded profile, set to the four picks. */
  const saveProfile = () => set('profile', picked('profile'), picks());
  /** A new profile of yours from the four picks, loaded. */
  function newProfile(name) {
    const id = add('profile', name, picks());
    S().set(LAYERS.profile.opt, id);
    return id;
  }

  // ---- layouts: a template's letters on the plot, each its seed --------------------------------

  /** The Current garden as letters: { plot, map } (A: the first seed, left to right, top to bottom). */
  function currentLetters() {
    const mem = (CA.Garden.currentPlot && CA.Garden.currentPlot()) || null;
    return lettersOf(mem);
  }
  /** Seeds per tile → { plot of letters, map letter → seed } (letters by first appearance). */
  function lettersOf(seedPlot) {
    const map = {};
    const back = {};
    const plot = Array.from({ length: SIZE }, (_, y) =>
      Array.from({ length: SIZE }, (_, x) => {
        const k = seedPlot && seedPlot[y] && seedPlot[y][x];
        if (!k) return null;
        if (!back[k]) {
          const l = LETTERS[Object.keys(map).length] || 'Z';
          back[k] = l;
          map[l] = k;
        }
        return back[k];
      })
    );
    return { plot, map };
  }
  /** The letters a template uses, in order. */
  const lettersIn = (plot) => [...new Set((plot || []).flat().filter(Boolean))].sort();
  /**
   * Where a template's cell lands on the plot: as it is (abs), or from the top-left unlocked tile
   * (origin) — so a template for the full plot fits a smaller one by its top-left part.
   */
  function seedPlot(templateData, map, origin) {
    const out = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
    const [ox, oy] = templateData.abs ? [0, 0] : origin || [0, 0];
    for (let ty = 0; ty < SIZE; ty++)
      for (let tx = 0; tx < SIZE; tx++) {
        const l = templateData.plot[ty] && templateData.plot[ty][tx];
        const x = tx + ox;
        const y = ty + oy;
        if (l && x < SIZE && y < SIZE) out[y][x] = map[l] || null;
      }
    return out;
  }

  /**
   * A template and seeds for a plot of seeds (what's planted): a template you already have that
   * lays its letters out the same way on the unlocked tiles (Fill for one seed everywhere), else a
   * new one; the same for the seeds. Returns { template, seeds } (ids).
   */
  function adopt(seedPlotNow, name, isOpen, origin) {
    const [ox, oy] = origin;
    // the letters on the unlocked tiles, relative to the origin, labeled by first appearance
    const norm = (letterAt) => {
      const back = {};
      let n = 0;
      const cells = [];
      for (let y = 0; y < SIZE; y++)
        for (let x = 0; x < SIZE; x++) {
          if (!isOpen(x, y)) continue;
          const l = letterAt(x, y);
          if (l && !back[l]) back[l] = LETTERS[n++];
          cells.push(l ? back[l] : '.');
        }
      return { key: cells.join(''), back };
    };
    const mine = lettersOf(seedPlotNow);
    const target = norm((x, y) => mine.plot[y][x]);
    let template = null;
    let relabel = null; // a template's letter → the plot's letter
    for (const t of list('template')) {
      if (t.live) continue;
      const d = get('template', t.id).data;
      const n = norm((x, y) => (d.abs ? d.plot[y] && d.plot[y][x] : d.plot[y - oy] && d.plot[y - oy][x - ox]) || null);
      if (n.key === target.key) {
        template = t.id;
        const toMine = {};
        Object.keys(target.back).forEach((l) => (toMine[target.back[l]] = l)); // normalized → the plot's letter
        relabel = {};
        Object.keys(n.back).forEach((l) => (relabel[l] = toMine[n.back[l]]));
        break;
      }
    }
    let map;
    if (template) {
      map = {};
      Object.keys(relabel).forEach((l) => (map[l] = mine.map[relabel[l]]));
    } else {
      // a new one, from the origin
      const plot = Array.from({ length: SIZE }, (_, y) => Array.from({ length: SIZE }, (_, x) => (x + ox < SIZE && y + oy < SIZE && isOpen(x + ox, y + oy) ? mine.plot[y + oy][x + ox] : null)));
      template = add('template', name, { plot, abs: false });
      map = mine.map;
    }
    const seeds = list('seeds').find((s) => !s.live && same(get('seeds', s.id).data.map, map));
    return { template, seeds: seeds ? seeds.id : add('seeds', name, { map }) };
  }

  // ---- save / load ---------------------------------------------------------------------------

  const serialize = () => {
    const out = { v: 3 };
    Object.keys(LAYERS).forEach((k) => (out[k] = saved[k].map((x) => ({ ...x, data: JSON.parse(JSON.stringify(x.data)) }))));
    return out;
  };
  function loadV3(data) {
    saved = { gardener: [], soil: [], template: [], seeds: [], profile: [] };
    Object.keys(LAYERS).forEach((k) => {
      (Array.isArray(data[k]) ? data[k] : []).forEach((x) => {
        if (!x || !x.id || !x.data || saved[k].some((y) => y.id === x.id)) return;
        const b = builtinOf(k, String(x.id));
        if (b && b.live) return;
        saved[k].push({ id: String(x.id), ...(b ? {} : { name: String(x.name || LAYERS[k].noun).slice(0, 40) }), data: LAYERS[k].clean(x.data) });
      });
    });
  }
  /**
   * Garden profiles from before v3.3 — a plot of seeds each (and, before v3.2, its own rules) —
   * become a template and seeds each (or ones you have, laid out the same), and a profile of them
   * with the same id; the profile that was in use is loaded (or Max effects for the Current garden).
   */
  function migrate(oldProfiles, oldGardeners, liftSoil) {
    saved = { gardener: [], soil: [], template: [], seeds: [], profile: [] };
    (oldGardeners || []).forEach((g) => {
      if (!g || !g.id || typeof g.rules !== 'string') return;
      const b = builtinOf('gardener', g.id);
      saved.gardener.push({ id: String(g.id), ...(b ? {} : { name: String(g.name || 'My gardener').slice(0, 40) }), data: cleanRules(g) });
    });
    const was = S().get('gardenProfile');
    const wasGardener = S().get('gardenGardener');
    let load = null;
    (oldProfiles || []).forEach((p) => {
      if (!p || !p.id || !Array.isArray(p.plot)) return;
      const name = String(p.name || 'Garden').slice(0, 40);
      let gardener = has('gardener', wasGardener) ? wasGardener : 'effects';
      if (typeof p.rules === 'string') {
        gardener = `r${String(p.id)}`;
        saved.gardener.push({ id: gardener, name: `${name.slice(0, 30)} rules`, data: { rules: liftSoil(p.rules.slice(0, 20000)) } });
      }
      const seedsAt = Array.from({ length: SIZE }, (_, y) => Array.from({ length: SIZE }, (_, x) => (p.plot[y] && typeof p.plot[y][x] === 'string' ? p.plot[y][x] : null)));
      const keys = [...new Set(seedsAt.flat().filter(Boolean))];
      let template;
      let seeds;
      if (keys.length === 1 && seedsAt.flat().every(Boolean)) template = 'fill';
      const lt = lettersOf(seedsAt);
      if (!template) {
        const t = saved.template.find((x) => same(x.data.plot, lt.plot) && x.data.abs);
        template = t ? t.id : `t${String(p.id)}`;
        if (!t) saved.template.push({ id: template, name, data: { plot: lt.plot, abs: true } });
      }
      const s = saved.seeds.find((x) => same(x.data.map, lt.map));
      seeds = s ? s.id : `s${String(p.id)}`;
      if (!s) saved.seeds.push({ id: seeds, name, data: { map: lt.map } });
      saved.profile.push({ id: String(p.id), name, data: { gardener, soil: 'effects', template, seeds } });
      if (String(p.id) === was) load = String(p.id);
    });
    if (load) loadProfile(load, { lazy: true });
    else {
      loadProfile('maxEffects', { lazy: true });
      if (has('gardener', wasGardener)) S().set('gardenGardener', wasGardener);
    }
  }

  /** The options of every layer (garden.js defines them with its own). */
  function defineOptions() {
    Object.keys(LAYERS).forEach((k) => S().defineOption({ key: LAYERS[k].opt, group: 'garden-hidden', name: `Auto-gardener: ${LAYERS[k].noun}`, desc: '', default: LAYERS[k].def }));
  }

  return {
    LAYERS,
    PARTS,
    LETTERS,
    NAMES,
    FERTILIZER_VAR,
    get,
    has,
    list,
    set,
    add,
    rename,
    remove,
    picked,
    picks,
    pick,
    loadProfile,
    missingSeeds,
    missingKeys,
    seedHunt,
    loadWithSeeds,
    profileChanged,
    saveProfile,
    newProfile,
    lettersOf,
    lettersIn,
    seedPlot,
    adopt,
    effectsGardener,
    serialize,
    loadV3,
    migrate,
    defineOptions,
  };
})();
