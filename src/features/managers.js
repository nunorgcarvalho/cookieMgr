// **Managers**: a layer above the macros and profiles. A manager plays a whole ascension in
// stages; each stage switches strategies on and off — macros, and the profiles of the Auto buyer,
// the Pantheon, the dragon, the Grimoire and the garden — and lasts until its "until" holds.
//
//   Manager   { id, name, desc, scope, stages, code? } — named, saved with the game; one is the active one.
//             scope 'ascension': its stages start over when you ascend (legacy managers, which carry
//             on from one ascension to the next, are for later — the scope is there for them).
//   Stage     { name, macros: { id: 'on'|'off' }, inputs: { id: { key: value } } (a macro's settings),
//             profiles: { buyer, pantheon, dragon, grimoire, garden }, until } — what the stage
//             CHANGES: stage 1 sets things up, each later stage only lists what it changes, and
//             the rest carries over until a later stage changes it back (effective() adds them up).
//             until is a condition in the macro language (features/script.js); the last stage lasts
//             for good. Older saves (each stage a full list) are turned into changes on loading.
//             watch: [{ label, value, format }] — what the Manager widget shows while the stage is on
//             (not carried over: each stage its own): each value an expression in the macro language,
//             format auto | time (seconds) | percent (0–1) | progress ([have, of], or 0–100).
//
// A manager is code in the macro language (features/script.js), run pass by pass like a garden
// profile's rules. The stage editor writes that code (codeOf) — or you write it yourself (code: then
// the stages are only names). It has a block per stage, `if manager.stage() >= N:`, so a stage's
// changes hold for the stages after it: on the stage's first pass (manager.arriving(N)) the block sets
// its macros' settings and switches its macros, once, so you can still flip one by hand afterwards
// (jumping to a stage runs the blocks before it too, so what they set up is there);
// manager.profile(kind, id) puts a profile in (the last block's wins), retrying each pass until it's in
// and then leaving it alone (a Pantheon profile waits for the worship swaps to do it all at once, a
// dragon one for its aura slots: it's left alone only once all its auras are in); `if <until>: manager.next()` moves on.
//
// The built-in macro `manager` runs the active manager's code each second, so it has a switch, a
// hotkey and macro.set like any other. One seeded manager, Nunix late game:
//   Drops                  the big cookie clicked from the start, but not golden or wrath cookies (Scorn
//                          makes them all wrath cookies); reindeer; the Auto buyer spending freely
//                          (Payback), the Upgrade unlocker (Santa, all the research, the dragon trained and
//                          petted, fortunes, cheap upgrades, golden cookies popped until Lucky day,
//                          Serendipity and Get lucky are unlocked: one click), SeasonCompletion, wrinklers and sugar lumps;
//                          the garden a weed farm (the Auto-gardener harvests mature weeds and new seeds:
//                          the garden isn't ready for combos yet); no spells, stocks or Elder Pledge (the
//                          Grandmapocalypse's wrinklers drop Halloween's cookies); Pantheon wrinklers,
//                          dragon drops — until
//                          Christmas's upgrades, Easter, Halloween and Valentine's are in
//   Reindeer               Christmas again for its cookies, golden cookie combos already: + the elders
//                          pledged, golden and wrath cookies clicked again, the buyer ranking by actual
//                          income and never dipping below the Lucky! and garden rounds banks (buyer
//                          profile combos: the nursetulips' round first, then 1.25 × the golden
//                          clovers' — CpS bought only raises their price), Pantheon golden (no wrinklers left for Scorn), the garden on
//                          8 nursetulips together + clover combos (until their seeds are unlocked, the
//                          Mutation hunt breeds them, or the weed farm while only weeds lead on), FtHoF on
//                          combos; the dragon still on drops & flight
//   Golden cookie combos   for good: dragon Dragonflight & Harvest
//
//   For algorithmic code:
//     manager.use(manager)            makes a manager the active one (an action; its id or name)
//     manager.goTo(stage)             goes to a stage of the active manager (an action; 1 = the first)
//     manager.next()                  on to the next stage (an action)
//     manager.profile(kind, profile)  puts a profile in, once this stage (an action; kind: buyer,
//                                     pantheon, dragon, grimoire or garden)
//     macro.setting(macro, key, v)    changes a macro's setting (an action)
//     manager.active()                the active manager's id ("": none)
//     manager.stage()                 the stage it's on (1 = the first; 0: no manager)
//     manager.entering()              whether this is the stage's first pass
//     manager.arriving(stage)         whether this pass is that stage's first (or a later one's, jumped to)
//     manager.stageName()             that stage's name
//     manager.stages()                how many stages the active manager has

CA.Managers = (() => {
  const MACRO = 'manager';
  const SCOPES = [{ v: 'ascension', label: 'This ascension' }];
  const KINDS = ['buyer', 'pantheon', 'dragon', 'grimoire', 'garden'];
  const FORMATS = [
    { v: 'auto', label: 'as it is', tip: 'the value as it is' },
    { v: 'time', label: 'a time', tip: 'a time: the value in seconds' },
    { v: 'percent', label: 'a share', tip: 'a share: the value from 0 to 1, shown as a percentage' },
    { v: 'progress', label: 'progress', tip: 'progress, with a bar: [have, of], or 0–100' },
  ];
  const WATCH_MAX = 8;

  const WEED_FARM = 'weedFarm';
  const SEED_HUNT = 'mutationHunt';
  const gardenReady = (id) => {
    const missing = CA.GardenLayers.missingSeeds(id);
    return !!missing && !missing.length;
  };
  // the profiles a stage can pick, by kind: their list, whether one is in, and putting it in
  const P = {
    buyer: {
      label: 'Auto buyer',
      icon: 'dollar',
      list: () => (CA.AutoBuyer ? CA.AutoBuyer.list() : []),
      isIn: (id) => CA.AutoBuyer.activeProfile() === id,
      use: (id) => CA.AutoBuyer.use(id),
    },
    pantheon: {
      label: 'Pantheon',
      icon: 'pantheon',
      list: () => (CA.Pantheon ? CA.Pantheon.profiles() : []),
      isIn: (id) => CA.Pantheon.isActive(id),
      // all of it at once: wait until the worship swaps are back for every spirit it moves
      use: (id) => (CA.Pantheon.minigame() && (CA.Pantheon.minigame().swaps || 0) >= CA.Pantheon.swapsFor(id) ? CA.Pantheon.apply(id) : 0),
      waits: (id) => (!CA.Pantheon.minigame() ? 'the Pantheon' : `${CA.Pantheon.swapsFor(id)} worship swap${CA.Pantheon.swapsFor(id) === 1 ? '' : 's'}`),
    },
    dragon: {
      label: 'Dragon auras',
      icon: 'dragon',
      list: () => (CA.Dragon ? CA.Dragon.list() : []),
      isIn: (id) => CA.Dragon.isActive(id),
      // in once what fits is in, but done for the stage only when every aura is: a dragon still
      // training after an ascension gets the profile's second aura once its second slot opens
      done: (id) => CA.Dragon.isComplete(id),
      use: (id) => CA.Dragon.apply(id),
      waits: (id) => CA.Dragon.waitsFor(id),
    },
    grimoire: {
      label: 'Grimoire',
      icon: 'wizard',
      list: () => (CA.CastTiers ? CA.CastTiers.list() : []),
      isIn: (id) => CA.CastTiers.isActive(id),
      use: (id) => CA.CastTiers.use(id),
    },
    garden: {
      label: 'Garden',
      icon: 'leaf',
      list: () => (CA.GardenLayers ? CA.GardenLayers.list('profile') : []),
      // a garden that isn't ready for it (no garden yet, or seeds it plants still locked): meanwhile the
      // Mutation hunt breeds the next seed on the way to them (Whiskerbloom × Whiskerbloom for Nursetulip…),
      // or the weed farm when only weeds bring the next one (Brown mold); the profile goes in once it's ready
      isIn: (id) => CA.GardenLayers.picked('profile') === id && !CA.GardenLayers.profileChanged() && gardenReady(id),
      use: (id) => {
        if (gardenReady(id)) return (CA.GardenLayers.loadProfile(id), 1);
        const hunt = CA.GardenLayers.seedHunt(id);
        if (hunt) CA.GardenLayers.loadWithSeeds(SEED_HUNT, hunt.seeds);
        else if (id !== WEED_FARM && CA.GardenLayers.picked('profile') !== WEED_FARM) CA.GardenLayers.loadProfile(WEED_FARM);
        return 0;
      },
      waits: (id) => {
        const missing = CA.GardenLayers.missingSeeds(id);
        if (!missing) return 'the garden (the weed farm meanwhile)';
        const hunt = CA.GardenLayers.seedHunt(id);
        const N = CA.GardenLayers.NAMES;
        const meanwhile = !hunt ? 'the weed farm meanwhile' : `breeding ${N[hunt.grows] || hunt.grows}${hunt.grows !== hunt.for ? ` on the way to ${N[hunt.for] || hunt.for}` : ''} meanwhile`;
        return `${missing.join(', ')} unlocked (${meanwhile})`;
      },
    },
  };

  // Upgrade unlocker: the macros that unlock (and buy the cheap) upgrades, one switch for them all
  const UNLOCKER = { id: 'upgradeUnlocker', members: ['santa', 'research', 'autoDragon', 'petDragon', 'fortune', 'cheapUpgrades', 'goldenUpgrades'] };

  // Nunix late game: stage 1 sets everything up; the stages after it only change a few things
  const SEEDS = [
    {
      id: 'nunixLateGame',
      name: 'Nunix late game',
      desc: 'Clicks the big cookie from the start, not golden cookies (Scorn makes them all wrath cookies) beyond the one that unlocks Lucky day, Serendipity and Get lucky again, while it hunts every season’s drops in the Grandmapocalypse, the Auto buyer spending freely and the Upgrade unlocker on, the garden a weed farm (mature weeds and new seeds harvested); then Christmas again for the reindeer cookies with golden cookie combos already, the elders pledged: golden cookies clicked again, the buyer ranks by actual income and keeps the Lucky! and garden rounds banks, the golden Pantheon, the garden on tulip and clover combos (until their seeds are unlocked, the Mutation hunt breeding them) and Force the Hand of Fate on combos, the dragon still on Mind Over Matter & Dragonflight for the drops; then Dragonflight & Harvest, for good.',
      scope: 'ascension',
      v: 2,
      stages: [
        {
          name: 'Drops',
          macros: {
            autoBuyer: 'on',
            upgradeUnlocker: 'on', // Santa, research, the dragon trained and petted, fortunes, cheap upgrades, and
            // golden cookies popped until Lucky day, Serendipity and Get lucky are unlocked (one click after an ascension)
            seasonCompletion: 'on',
            bigCookie: 'on',
            reindeer: 'on',
            wrinklers: 'on',
            lumps: 'on',
            // Scorn (the Pantheon's wrinklers profile) makes every golden cookie a wrath cookie, so
            // they're left alone until the combos
            golden: 'off',
            wrath: 'off',
            elderPledge: 'off', // the Grandmapocalypse: its wrinklers drop Halloween's cookies
            // the garden isn't ready for the combos yet: the weed farm harvests mature weeds and the
            // new seeds that spring up (until stage 3 puts the tulips and clovers in)
            gardener: 'on',
            fthofOnClickFrenzy: 'off',
            stockTrader: 'off',
          },
          inputs: {
            // all the research, the Elder Pact too: it deepens the Grandmapocalypse (more wrinklers come
            // at its third stage) and unlocks the Elder Pledge Reindeer buys (SeasonCompletion ends on
            // Business day, and wrinklers are popped once they've eaten, as those macros do anyway)
            research: { stopBefore: 'none' },
          },
          profiles: { buyer: 'payback', pantheon: 'wrinklers', dragon: 'drops', garden: 'weedFarm' },
          until: 'season.complete(christmas, upgrades) and season.complete(easter) and season.complete(halloween) and season.complete(valentines)',
          // (not Santa or the Easter eggs: the "until" counts the seasons' drops already)
          watch: [
            // the research (all 9), and the one it's on
            { label: 'Research', value: '[researchOwned(), 9]', format: 'progress' },
            { label: 'Next research', value: 'researchNext()', format: 'auto' },
          ],
        },
        {
          name: 'Reindeer',
          // the drops are in: golden cookies from here on (the elders pledged, Scorn has no wrinklers left
          // to help) — all but the dragon, whose Mind Over Matter still helps the reindeer drop cookies
          macros: { elderPledge: 'on', golden: 'on', wrath: 'on', fthofOnClickFrenzy: 'on' },
          inputs: {},
          profiles: { buyer: 'combos', pantheon: 'golden', dragon: 'dropsFlight', grimoire: 'default', garden: 'tulipCombos' },
          until: 'season.complete(christmas)',
          // (not the reindeer cookies: the "until" counts Christmas's drops already)
          watch: [
            { label: 'Next reindeer in', value: 'reindeer.expected()', format: 'time' },
            { label: 'Combo on', value: 'grimoire.fthofCombo()', format: 'auto' },
            { label: 'Magic for FtHoF', value: 'grimoire.fill()', format: 'progress' },
            { label: 'Buying next', value: 'buyer.next()', format: 'auto' },
          ],
        },
        {
          name: 'Golden cookie combos',
          macros: {},
          inputs: {},
          profiles: { dragon: 'dragonFlightHarvest' },
          until: '',
          watch: [
            { label: 'Combo on', value: 'grimoire.fthofCombo()', format: 'auto' },
            { label: 'Magic for FtHoF', value: 'grimoire.fill()', format: 'progress' },
            { label: 'Buying next', value: 'buyer.next()', format: 'auto' },
            { label: 'Garden mature', value: 'garden.matureShare()', format: 'percent' },
          ],
        },
      ],
    },
  ];
  const copy = (x) => JSON.parse(JSON.stringify(x));
  let managers = copy(SEEDS);
  let active = 'nunixLateGame';
  // where the active manager is: its stage, the ascension it's for (Game.resets), and the profiles
  // of the stage still to put in
  let run = cleanRun(null);

  // ---- managers -----------------------------------------------------------------------------

  function cleanStage(s, i) {
    s = s && typeof s === 'object' ? s : {};
    const macros = {};
    Object.keys(s.macros || {}).forEach((id) => (s.macros[id] === 'on' || s.macros[id] === 'off') && id !== MACRO && (macros[id] = s.macros[id]));
    const profiles = {};
    KINDS.forEach((k) => s.profiles && s.profiles[k] && (profiles[k] = String(s.profiles[k])));
    // a macro's settings (its inputs) the stage sets on entering it: { macroId: { key: value } }
    const inputs = {};
    Object.keys(s.inputs && typeof s.inputs === 'object' ? s.inputs : {}).forEach((id) => {
      const v = s.inputs[id];
      if (id === MACRO || !v || typeof v !== 'object') return;
      const keep = {};
      Object.keys(v).forEach((k) => ['string', 'number', 'boolean'].includes(typeof v[k]) && (keep[k] = v[k]));
      if (Object.keys(keep).length) inputs[id] = keep;
    });
    return { name: String(s.name || `Stage ${i + 1}`).slice(0, 40), macros, inputs, profiles, until: typeof s.until === 'string' ? s.until.slice(0, 500) : '', watch: cleanWatch(s.watch) };
  }
  function cleanWatch(list) {
    return (Array.isArray(list) ? list : [])
      .filter((x) => x && typeof x === 'object')
      .slice(0, WATCH_MAX)
      .map((x) => ({ label: String(x.label || '').slice(0, 40), value: String(x.value || '').slice(0, 300), format: FORMATS.some((f) => f.v === x.format) ? x.format : 'auto' }));
  }
  /** What stages up to i (0 = the first) add up to: { macros, inputs, profiles } — i < 0: nothing. */
  function addUp(stages, i) {
    const out = { macros: {}, inputs: {}, profiles: {} };
    stages.slice(0, i + 1).forEach((s) => {
      Object.assign(out.macros, s.macros);
      Object.assign(out.profiles, s.profiles);
      Object.keys(s.inputs).forEach((id) => (out.inputs[id] = { ...(out.inputs[id] || {}), ...s.inputs[id] }));
    });
    return out;
  }
  /** Older stages (each its full list) as changes: what each sets that the ones before it don't already. */
  function toChanges(stages) {
    return stages.map((s, i) => {
      if (!i) return s;
      const before = addUp(stages, i - 1);
      const macros = {};
      Object.keys(s.macros).forEach((id) => before.macros[id] !== s.macros[id] && (macros[id] = s.macros[id]));
      const profiles = {};
      Object.keys(s.profiles).forEach((k) => before.profiles[k] !== s.profiles[k] && (profiles[k] = s.profiles[k]));
      const inputs = {};
      Object.keys(s.inputs).forEach((id) =>
        Object.keys(s.inputs[id]).forEach((k) => {
          if (!before.inputs[id] || before.inputs[id][k] !== s.inputs[id][k]) inputs[id] = { ...(inputs[id] || {}), [k]: s.inputs[id][k] };
        })
      );
      return { ...s, macros, inputs, profiles };
    });
  }
  function clean(m) {
    let stages = (Array.isArray(m.stages) ? m.stages : []).slice(0, 20).map(cleanStage);
    if (m.v !== 2) stages = toChanges(stages);
    return {
      v: 2,
      id: String(m.id),
      name: String(m.name || 'Manager').slice(0, 40),
      desc: String(m.desc || '').slice(0, 400),
      scope: SCOPES.some((s) => s.v === m.scope) ? m.scope : 'ascension',
      stages: stages.length ? stages : [cleanStage({}, 0)],
      ...(typeof m.code === 'string' ? { code: m.code.slice(0, 50000) } : {}),
    };
  }

  const list = () => managers.slice();
  /** A manager by id, or by name (any case). */
  function find(x) {
    if (x == null || x === '') return null;
    const k = String(x).toLowerCase();
    return managers.find((m) => m.id === String(x)) || managers.find((m) => m.name.toLowerCase() === k) || null;
  }
  const current = () => find(active);
  const changed = () => CA.Events.emit('managers');

  /** Makes a manager the active one (from its first stage): 1 when it changed, 0 when it already was. */
  function use(x) {
    const m = find(x);
    if (!m || m.id === active) return 0;
    active = m.id;
    run = cleanRun(null);
    on();
    changed();
    return 1;
  }
  /** The Manager macro on (picking a manager, or setting one up again, is to have it run). */
  const on = () => CA.Macros && CA.Macros.get(MACRO) && !CA.Macros.isOn(MACRO) && CA.Macros.set(MACRO, true);
  /**
   * The active manager set up again on its next pass, as it is: its stage's settings, switches and profiles (the
   * stages before it too), whatever was flipped by hand since — and the Manager macro on.
   */
  function setUp() {
    if (!current()) return 0;
    if (run.id === active) run.sig = '';
    on();
    changed();
    return 1;
  }
  const newId = () => {
    let i = managers.length + 1;
    while (managers.some((m) => m.id === `m${i}`)) i++;
    return `m${i}`;
  };
  /** A new manager — a copy of another, or one empty stage. Returns it. */
  function add(name, from) {
    const src = find(from);
    const m = clean({ ...(src ? copy(src) : { stages: [{ name: 'Stage 1' }] }), id: newId(), name: name || (src ? `${src.name} (copy)` : `Manager ${managers.length + 1}`) });
    managers.push(m);
    changed();
    return m;
  }
  function update(id, patch) {
    const m = managers.find((x) => x.id === id);
    if (!m) return null;
    if (patch.name != null && String(patch.name).trim()) m.name = String(patch.name).trim().slice(0, 40);
    if (patch.desc != null) m.desc = String(patch.desc).slice(0, 400);
    if (patch.scope && SCOPES.some((s) => s.v === patch.scope)) m.scope = patch.scope;
    changed();
    return m;
  }
  /** A built-in manager (one that comes with cookieMgr): always there, can't be deleted, can be reverted. */
  const builtinOf = (x) => {
    const m = typeof x === 'object' ? x : find(x);
    return (m && SEEDS.find((s) => s.id === m.id)) || null;
  };
  const isBuiltin = (x) => !!builtinOf(x);
  /** A built-in changed from how it comes (its name, stages or code). */
  function isEdited(x) {
    const m = typeof x === 'object' ? x : find(x);
    const seed = builtinOf(m);
    return !!seed && JSON.stringify(clean(m)) !== JSON.stringify(clean(seed));
  }
  /** A built-in back as it comes (where it is in the list, and active or not, kept). */
  function revert(id, { quiet = false } = {}) {
    const i = managers.findIndex((x) => x.id === id);
    const seed = builtinOf(id);
    if (i < 0 || !seed) return false;
    managers[i] = copy(seed);
    // the one at work: set up again (quiet: the Manager macro left as it is)
    if (id === active && !quiet) setUp();
    else if (id === active && run.id === active) run.sig = '';
    changed();
    return true;
  }
  /** Built-ins missing from a list (an older save that deleted one) go back at the top. */
  const withBuiltins = (list) => [...SEEDS.filter((s) => !list.some((m) => m.id === s.id)).map(copy), ...list];

  function remove(id) {
    const i = managers.findIndex((x) => x.id === id);
    if (i < 0 || isBuiltin(id)) return false;
    managers.splice(i, 1);
    if (active === id) active = managers.length ? managers[0].id : '';
    changed();
    return true;
  }
  /** Every built-in back as it comes (yours are kept). */
  function resetSeeds() {
    managers = withBuiltins(managers);
    SEEDS.forEach((s) => revert(s.id, { quiet: true }));
    changed();
  }

  // ---- stages ---------------------------------------------------------------------------------

  const stageOf = (id, i) => {
    const m = managers.find((x) => x.id === id);
    return m && m.stages[i] ? m.stages[i] : null;
  };
  function addStage(id, after) {
    const m = managers.find((x) => x.id === id);
    if (!m || m.stages.length >= 20) return null;
    const at = after == null ? m.stages.length : Math.min(m.stages.length, Number(after) + 1);
    // it changes nothing yet: what the stage before it runs with carries over
    const s = cleanStage({ name: `Stage ${m.stages.length + 1}` }, at);
    m.stages.splice(at, 0, s);
    if (run.id === id && at <= run.stage) run.stage++;
    changed();
    return s;
  }
  function updateStage(id, i, patch) {
    const s = stageOf(id, i);
    if (!s) return null;
    if (patch.name != null && String(patch.name).trim()) s.name = String(patch.name).trim().slice(0, 40);
    if (patch.until != null) s.until = String(patch.until).slice(0, 500);
    changed();
    return s;
  }
  /** What a manager's stage i inherits from the ones before it. */
  const before = (id, i) => addUp(managers.find((x) => x.id === id).stages, i - 1);
  /** A macro in a stage: 'on', 'off', or '' (no change: as the stage before it has it). */
  function setStageMacro(id, i, macro, to) {
    const s = stageOf(id, i);
    if (!s || macro === MACRO) return;
    if ((to === 'on' || to === 'off') && before(id, i).macros[macro] !== to) s.macros[macro] = to;
    else delete s.macros[macro];
    changed();
  }
  /** A macro's setting in a stage (undefined / '' : no change). */
  function setStageInput(id, i, macro, key, value) {
    const s = stageOf(id, i);
    if (!s || macro === MACRO) return;
    const cur = { ...(s.inputs[macro] || {}) };
    // (one the stage before already sets is kept too: you added it, so it shows)
    if (value === undefined || value === '') delete cur[key];
    else cur[key] = value;
    if (Object.keys(cur).length) s.inputs[macro] = cur;
    else delete s.inputs[macro];
    changed();
  }
  /** A profile in a stage ('' : left as it is). */
  function setStageProfile(id, i, kind, profile) {
    const s = stageOf(id, i);
    if (!s || !P[kind]) return;
    if (profile && before(id, i).profiles[kind] !== String(profile)) s.profiles[kind] = String(profile);
    else delete s.profiles[kind];
    changed();
  }
  /** What a stage's widget shows: replaces its watch list ([{ label, value, format }]). */
  function setStageWatch(id, i, list) {
    const s = stageOf(id, i);
    if (!s) return null;
    s.watch = cleanWatch(list);
    changed();
    return s.watch;
  }
  function removeStage(id, i) {
    const m = managers.find((x) => x.id === id);
    if (!m || m.stages.length <= 1 || !m.stages[i]) return false;
    // what it changed still holds for the stages after it: the next one takes it over
    const [gone] = m.stages.splice(i, 1);
    const next = m.stages[i];
    if (next) {
      next.macros = { ...gone.macros, ...next.macros };
      next.profiles = { ...gone.profiles, ...next.profiles };
      Object.keys(gone.inputs).forEach((x) => (next.inputs[x] = { ...gone.inputs[x], ...(next.inputs[x] || {}) }));
    }
    if (run.id === id && run.stage >= m.stages.length) run.stage = m.stages.length - 1;
    changed();
    return true;
  }
  function moveStage(id, i, by) {
    const m = managers.find((x) => x.id === id);
    const j = i + by;
    if (!m || !m.stages[i] || !m.stages[j]) return false;
    [m.stages[i], m.stages[j]] = [m.stages[j], m.stages[i]];
    changed();
    return true;
  }

  /** What a manager's stage i (0 = the first) runs with — its changes and those before it: { macros, inputs, profiles }. */
  const effective = (m, i) => addUp(m.stages, i);

  // ---- "until" ----------------------------------------------------------------------------------

  const compiled = new Map();
  function compileUntil(code) {
    if (!compiled.has(code)) {
      if (compiled.size > 100) compiled.clear();
      compiled.set(code, CA.Script.compile(`return ${code}`, { mode: 'stat' }));
    }
    return compiled.get(code);
  }
  /** What's wrong with an "until" condition ("": nothing). */
  function untilProblem(code) {
    if (!code || !code.trim()) return '';
    const c = compileUntil(code);
    return c.errors.length ? c.errors[0].message : '';
  }
  /** Whether an "until" holds now (none, or one with a problem: never). */
  function untilHolds(code) {
    if (!code || !code.trim()) return false;
    const c = compileUntil(code);
    if (c.errors.length) return false;
    const out = CA.Script.runStat(c.flow, {});
    return !out.error && !!out.value && !(typeof out.value === 'number' && !Number.isFinite(out.value));
  }

  /**
   * An "until", taken apart for the Manager widget: the conditions joined by its top `and` (or `or`),
   * each with whether it holds now — { join: 'and' | 'or', parts: [{ ok, text, have, of, missing }] }; have /
   * of: a season's drops counted ("Christmas complete (12/21)"), missing: the names of those still to get.
   * Null: no until, or one with a problem.
   */
  function untilParts(code) {
    if (!code || !code.trim()) return null;
    const c = compileUntil(code);
    const r0 = !c.errors.length && c.flow[0];
    const top = r0 && (r0.cond || (r0.e && { t: 'val', e: r0.e }));
    if (!top) return null;
    const join = top.t === 'or' ? 'or' : 'and';
    const flat = (e) => (e.t === join ? flat(e.a).concat(flat(e.b)) : [e]);
    const parts = flat(top).map((e) => {
      let r;
      try {
        r = CA.Script.evaluate(e, {});
      } catch (err) {
        r = { ok: false, text: '?' };
      }
      let text = String(r.text || '').replace(/ [✓✗]$/, '');
      // not veil(): "not veil() (now yes)" rather than "not (veil() = yes ✓)"
      if (e.t === 'not' && e.a && e.a.t === 'val') {
        const v = CA.Script.value(e.a.e, {});
        text = `not ${CA.Script.exprText(e.a.e)} (now ${typeof v === 'boolean' ? (v ? 'yes' : 'no') : v})`;
      }
      const m = /\((\d+)\/(\d+)\)/.exec(text);
      // a season's drops: also which ones are still to get (the widget names them when few are left)
      let missing;
      if (e.t === 'cond' && e.id === 'season.complete') {
        const p = CA.Script.resolve(e.params, {}) || {};
        missing = CA.Seasons.missing(p.season, p.part || 'all');
      }
      return { ok: !!r.ok, text, ...(m ? { have: Number(m[1]), of: Number(m[2]) } : {}), ...(missing ? { missing } : {}) };
    });
    return { join, parts };
  }

  /** A stage's watch list, worked out now: [{ label, value, format, error }] (value as the code gave it). */
  const compiledWatch = new Map();
  function watchOf(stage) {
    return ((stage && stage.watch) || []).map((x) => {
      if (!x.value.trim()) return { ...x, value: undefined, error: 'no value' };
      if (!compiledWatch.has(x.value)) {
        if (compiledWatch.size > 100) compiledWatch.clear();
        compiledWatch.set(x.value, CA.Script.compile(`return ${x.value}`, { mode: 'stat' }));
      }
      const c = compiledWatch.get(x.value);
      if (c.errors.length) return { ...x, value: undefined, error: c.errors[0].message };
      const out = CA.Script.runStat(c.flow, {});
      return { ...x, value: out.value, error: out.error || '' };
    });
  }

  // ---- the code ---------------------------------------------------------------------------------

  // a name or value as the macro language reads it: plain when it's a simple word, else in quotes
  const word = (v) => (typeof v === 'boolean' || typeof v === 'number' ? String(v) : /^[A-Za-z_]\w*$/.test(String(v)) && !['true', 'false'].includes(String(v)) ? String(v) : JSON.stringify(String(v)));

  /** A manager's stages written out as code (what runs, unless you wrote its code yourself). */
  function codeOf(m) {
    const out = [
      `# ${m.name}: its stages as code (the stage editor writes this; edit it to make it yours).`,
      '# A block per stage, for it and every stage after it: what it changes holds until a later stage changes',
      '# it back. On a stage\'s first pass (manager.arriving(N)) it sets settings and switches macros, once;',
      '# manager.profile() puts a profile in (the last block\'s wins) once per stage; manager.next() moves on.',
    ];
    m.stages.forEach((st, i) => {
      out.push('', `# ---- stage ${i + 1}: ${st.name}${i ? ' (what it changes)' : ''}`, `if manager.stage() >= ${i + 1}:`);
      const body = [];
      const entering = [];
      Object.keys(st.inputs).forEach((id) => {
        if (!CA.Macros.get(id)) return;
        Object.keys(st.inputs[id]).forEach((k) => entering.push(`macro.setting(${word(id)}, ${word(k)}, ${word(st.inputs[id][k])})`));
      });
      // switch on a, b, c: one line for each way (wrapped when long)
      ['on', 'off'].forEach((to) => {
        let line = '';
        stageMacros(st)
          .filter((id) => st.macros[id] === to)
          .forEach((id) => {
            if (line && line.length + word(id).length > 110) entering.push(line), (line = '');
            line = line ? `${line}, ${word(id)}` : `switch ${to} ${word(id)}`;
          });
        if (line) entering.push(line);
      });
      if (entering.length) body.push(`if manager.arriving(${i + 1}):`, ...entering.map((l) => `  ${l}`));
      KINDS.forEach((k) => st.profiles[k] && body.push(`manager.profile(${k}, ${word(st.profiles[k])})`));
      if (i < m.stages.length - 1 && st.until.trim()) body.push(`if manager.stage() == ${i + 1}:`, `  if ${st.until.trim()}:`, '    manager.next()');
      if (!body.length) body.push(`log ${JSON.stringify(st.name)}`);
      body.forEach((l) => out.push(`  ${l}`));
    });
    return `${out.join('\n')}\n`;
  }
  /** The code a manager runs: yours (written by hand), else its stages'. */
  const sourceOf = (m) => (m && typeof m.code === 'string' ? m.code : m ? codeOf(m) : '');
  /** A manager's code, compiled: { flow, errors }. */
  const compiledCode = new Map();
  function compiledOf(m) {
    const src = sourceOf(m);
    if (!compiledCode.has(src)) {
      if (compiledCode.size > 30) compiledCode.clear();
      compiledCode.set(src, CA.Script.compile(src));
    }
    return compiledCode.get(src);
  }
  /** Gives a manager code of yours (a problem: not saved, the message returned), or null back to its stages. */
  function setCode(id, code) {
    const m = managers.find((x) => x.id === id);
    if (!m) return 'no such manager';
    if (code == null) delete m.code;
    else {
      const { errors } = CA.Script.compile(String(code));
      if (errors.length) return `line ${errors[0].line}: ${errors[0].message}`;
      m.code = String(code).slice(0, 50000);
    }
    changed();
    return '';
  }

  // ---- running ----------------------------------------------------------------------------------

  const resets = () => Game.resets || 0;
  /** The macros a stage switches, that exist (one you deleted is skipped). */
  const stageMacros = (s) => Object.keys(s.macros).filter((id) => CA.Macros.get(id) && CA.Macros.get(id).mode !== 'once');
  // jumped: reached by manager.goTo (so the stages before it set up again), not by moving on
  const fresh = (id, stage, jumped) => ({ id, stage, resets: resets(), since: Date.now(), entering: true, entered: false, jumped: !!jumped, put: {}, waiting: {}, want: {}, sig: '' });
  let lastPass = null; // the last pass of the manager's code: { t, lines, trace, at, error, done }

  /** Goes into stage i (0 = the first) of the active manager: its next pass is that stage's first. */
  function enter(i, jumped) {
    const m = current();
    if (!m) return 0;
    const at = Math.max(0, Math.min(19, Math.floor(Number(i) || 0)));
    run = fresh(m.id, at, jumped && at > 0);
    const st = m.stages[at];
    CA.EventLog.add({ type: 'manager', title: `${m.name}: ${st ? st.name : `stage ${at + 1}`}`, text: `stage ${at + 1} of ${m.stages.length}`, data: { manager: m.id, stage: at + 1 } });
    changed();
    return 1;
  }
  /**
   * What a manager does, as one short string: its stages' switches, settings, profiles and untils (or its code) — not names or
   * watches — and the members of the groups they switch (a macro added to the Upgrade unlocker gets switched on too).
   */
  function sigOf(m) {
    const groups = [...new Set([].concat(...m.stages.map((st) => Object.keys(st.macros || {}))))]
      .map((id) => CA.Macros.get(id))
      .filter((x) => x && x.mode === 'group')
      .map((x) => [x.id, x.members]);
    const str = typeof m.code === 'string' ? m.code : JSON.stringify(m.stages.map((st) => [st.macros, st.inputs, st.profiles, st.until]));
    const all = groups.length ? `${str}|${JSON.stringify(groups)}` : str;
    let h = 0;
    for (let k = 0; k < all.length; k++) h = (Math.imul(h, 31) + all.charCodeAt(k)) | 0;
    return `${all.length}:${(h >>> 0).toString(36)}`;
  }
  /**
   * Before a pass: the manager at work changed since its stage set up (an edit, Revert to default, an update to a
   * built-in, a save from before it): its stage sets up again, as it is now — the stages before it too, as a jump
   * does (settings, switches and profiles; a macro flipped by hand is flipped back) — and its "until" moves it on
   * from there. A stage it no longer has: its last.
   */
  function sync() {
    const m = current();
    const sig = sigOf(m);
    if (run.sig === sig) return;
    run.sig = sig;
    if (run.entering) return; // setting up anyway
    run.stage = Math.min(run.stage, m.stages.length - 1);
    run.entering = true;
    run.jumped = run.stage > 0;
    run.put = {};
    run.waiting = {};
  }
  /** Before a pass: a new manager or a new ascension starts at stage 1. False: no manager. */
  function ready() {
    const m = current();
    if (!m) return false;
    if (run.id !== m.id || (m.scope === 'ascension' && run.resets !== resets())) enter(0);
    sync();
    return true;
  }
  /** After a pass: its first pass is over (unless it just moved on, so the next is the new stage's first). */
  function afterPass(F) {
    putWanted();
    if (run.entered) run.entered = false;
    else run.entering = false;
    lastPass = { t: Date.now(), lines: (F.trace || []).map((x) => x.line).filter(Boolean), trace: F.trace || [], at: F.at || [], error: F.error || '', done: F.done || 0 };
  }

  /** A profile this pass's code asks for (the last one asked, by kind, is put in after the pass). */
  function wantProfile(k, id) {
    if (!P[k]) return 0;
    run.want = run.want || {};
    run.want[k] = String(id);
    return 0;
  }
  /** After a pass: puts the profiles it asked for in (once per stage: once one's in, it's left alone). */
  function putWanted() {
    const want = run.want || {};
    run.want = {};
    Object.keys(want).forEach((k) => {
      const id = want[k];
      const kind = P[k];
      if (run.put[k] === id) return;
      const p = kind.list().find((x) => x.id === id || String(x.name).toLowerCase() === id.toLowerCase());
      if (!p) return;
      try {
        if (!kind.isIn(p.id)) kind.use(p.id);
        if ((kind.done || kind.isIn)(p.id)) {
          run.put[k] = id;
          delete run.waiting[k];
        } else run.waiting[k] = p.id;
      } catch (e) {
        run.waiting[k] = p.id; // a minigame that isn't there yet: next pass
      }
    });
  }

  /** One pass of the active manager's code, by hand (the Manager macro runs it each second). Returns what it did. */
  function step() {
    if (!ready()) return 0;
    const { flow, errors } = compiledOf(current());
    if (errors.length) return 0;
    const F = CA.Macros.runPass(flow);
    afterPass(F || {});
    return (F && F.done) || 0;
  }

  /** Goes to stage n (1 = the first) of the active manager. */
  const goTo = (n) => (current() ? enter(Math.floor(Number(n) || 1) - 1, true) : 0);

  /** Where the active manager is: { manager, stage, index, of, since, started, pending: [{ kind, label, id, name, waits }] } or null. */
  function where() {
    const m = current();
    if (!m) return null;
    const on = run.id === m.id && (m.scope !== 'ascension' || run.resets === resets());
    const index = on ? run.stage : 0;
    const pending = on
      ? Object.keys(run.waiting).map((k) => {
          const id = run.waiting[k];
          const p = P[k].list().find((x) => x.id === id);
          let waits = '';
          try {
            waits = P[k].waits ? P[k].waits(id) : '';
          } catch (e) {
            waits = '';
          }
          return { kind: k, label: P[k].label, id, name: p ? p.name : id, waits };
        })
      : [];
    const stage = m.stages[index] || { name: `Stage ${index + 1}`, until: '', macros: {}, inputs: {}, profiles: {} };
    return { manager: m, stage, index, of: Math.max(m.stages.length, index + 1), started: !!on, since: on ? run.since : 0, pending, coded: typeof m.code === 'string' };
  }

  function readiness() {
    const m = current();
    if (!m) return { ok: false, text: 'no manager picked (the Managers page)' };
    const c = compiledOf(m);
    if (c.errors.length) return { ok: false, text: `${m.name}: line ${c.errors[0].line}: ${c.errors[0].message}` };
    const w = where();
    return { ok: true, text: `${m.name} · ${w.started ? `stage ${w.index + 1} of ${w.of}: ${w.stage.name}` : 'starts at stage 1'}` };
  }

  // ---- save -------------------------------------------------------------------------------------

  function cleanRun(r) {
    r = r && typeof r === 'object' ? r : {};
    const obj = (x) => (x && typeof x === 'object' ? { ...x } : {});
    return { id: String(r.id || ''), stage: Math.max(0, Number(r.stage) || 0), resets: Number.isFinite(Number(r.resets)) ? Number(r.resets) : -1, since: Number(r.since) || 0, entering: !!r.entering, entered: false, jumped: !!r.jumped, put: obj(r.put), waiting: obj(r.waiting), want: {}, sig: typeof r.sig === 'string' ? r.sig : '' };
  }
  // the seeds' watches that repeated what the stage's "until" already counts (the Manager widget shows both):
  // taken out of saves that still have them, as seeded
  const RETIRED_WATCH = [
    { label: 'Santa', value: '[santaLevel(), 14]' },
    { label: 'Easter eggs', value: '[owned(easter), total(easter)]' },
    { label: 'Reindeer cookies', value: '[owned(christmas, cookies), total(christmas, cookies)]' },
  ];
  const retired = (x) => x && RETIRED_WATCH.some((r) => r.label === x.label && r.value === x.value);
  /**
   * A seeded manager saved before the Manager widget (its stages without a watch list): the seed's, stage by
   * stage name; one saved with the watches since retired: without them.
   */
  function withSeedWatch(m) {
    const seed = SEEDS.find((x) => x.id === m.id);
    if (!seed || !Array.isArray(m.stages)) return m;
    const watchOf = (st) => (!Array.isArray(st.watch) ? (seed.stages.find((x) => x.name === st.name) || {}).watch || [] : st.watch.filter((x) => !retired(x)));
    return { ...m, stages: m.stages.map((st) => (st && typeof st === 'object' ? withAllResearch(m, { ...st, watch: watchOf(st) }) : st)) };
  }
  /**
   * Nunix late game saved when its Drops stage stopped the research before the Elder Pact (which then held
   * for good, so Reindeer's Elder Pledge never came up for sale): all the research, as seeded now.
   */
  function withAllResearch(m, st) {
    if (m.id !== 'nunixLateGame' || st.name !== 'Drops') return st;
    const r = st.inputs && st.inputs.research;
    const out = r && r.stopBefore === 'Elder Pact' ? { ...st, inputs: { ...st.inputs, research: { ...r, stopBefore: 'none' } } } : st;
    return { ...out, watch: out.watch.map((x) => (x.label === 'Research' && x.value === '[researchOwned(), 8]' ? { ...x, value: '[researchOwned(), 9]' } : x)) };
  }
  /**
   * Nunix late game saved when golden cookies waited for its Golden cookie combos stage: they start with
   * Reindeer, as seeded now (all but the dragon's Harvest, which still waits).
   */
  const GOLDEN_MACROS = ['golden', 'wrath', 'fthofOnClickFrenzy'];
  const GOLDEN_PROFILES = ['buyer', 'pantheon', 'grimoire', 'garden'];
  function withGoldenReindeer(m) {
    if (m.id !== 'nunixLateGame' || !Array.isArray(m.stages)) return m;
    const reindeer = m.stages.find((st) => st && st.name === 'Reindeer');
    const combos = m.stages.find((st) => st && st.name === 'Golden cookie combos');
    if (!reindeer || !combos || !reindeer.macros || !combos.macros || reindeer.macros.golden || combos.macros.golden !== 'on') return m;
    const r = { ...reindeer, macros: { ...reindeer.macros }, profiles: { ...reindeer.profiles } };
    const c = { ...combos, macros: { ...combos.macros }, profiles: { ...combos.profiles } };
    GOLDEN_MACROS.forEach((k) => c.macros[k] && !r.macros[k] && ((r.macros[k] = c.macros[k]), delete c.macros[k]));
    GOLDEN_PROFILES.forEach((k) => c.profiles[k] && !r.profiles[k] && ((r.profiles[k] = c.profiles[k]), delete c.profiles[k]));
    const seed = SEEDS[0].stages.find((st) => st.name === 'Reindeer');
    if (Array.isArray(r.watch) && r.watch.length === 1 && r.watch[0].value === seed.watch[0].value) r.watch = copy(seed.watch);
    return { ...m, stages: m.stages.map((st) => (st === reindeer ? r : st === combos ? c : st)) };
  }
  /**
   * Nunix late game saved when the garden waited, off, for its Golden cookie combos stage: the weed farm
   * from the first stage, as seeded now (the combos stage then only changes the profile).
   */
  function withWeedFarm(m) {
    if (m.id !== 'nunixLateGame' || !Array.isArray(m.stages)) return m;
    const drops = m.stages.find((st) => st && st.name === 'Drops');
    if (!drops || !drops.macros || drops.macros.gardener !== 'off' || (drops.profiles && drops.profiles.garden)) return m;
    return {
      ...m,
      stages: m.stages.map((st) => {
        if (st === drops) return { ...st, macros: { ...st.macros, gardener: 'on' }, profiles: { ...st.profiles, garden: 'weedFarm' } };
        if (st && st.name === 'Golden cookie combos' && st.macros && st.macros.gardener === 'on') {
          const macros = { ...st.macros };
          delete macros.gardener;
          return { ...st, macros };
        }
        return st;
      }),
    };
  }
  function load(data) {
    if (data && Array.isArray(data.managers)) {
      managers = withBuiltins(data.managers.filter((m) => m && m.id).map((m) => clean(withGoldenReindeer(withWeedFarm(withSeedWatch(m))))));
      active = typeof data.active === 'string' && (data.active === '' || managers.some((m) => m.id === data.active)) ? data.active : managers.length ? managers[0].id : '';
      run = cleanRun(data.run);
    } else {
      managers = copy(SEEDS);
      active = 'nunixLateGame';
      run = cleanRun(null);
    }
    changed();
  }
  const serialize = () => ({ managers, active, run });

  // ---- building blocks ----------------------------------------------------------------------------

  const managerOptions = () => managers.map((m) => ({ v: m.id, label: m.name }));
  const kindOptions = () => KINDS.map((k) => ({ v: k, label: P[k].label }));

  function init() {
    CA.Settings.registerSection('managers', { serialize, load, event: 'managers' });
    CA.EventLog.defineType('manager', { name: 'Manager', icon: 'ascend', color: '#ffb74d' });
    // a new ascension: the stages start over (the next pass enters the first)
    CA.Events.on('ascend', () => {
      const m = current();
      if (m && m.scope === 'ascension') run = cleanRun(null);
    });

    const V = (id, desc, get, more) => CA.Script.defineValue({ id, desc, get, group: 'Managers', ...(more || {}) });
    V('manager.active', 'the active manager’s id ("": none)', () => active);
    V('manager.stage', 'the stage the active manager is on (1 = the first; 0: no manager)', () => {
      const w = where();
      return w ? w.index + 1 : 0;
    });
    V('manager.stageName', 'the name of the stage the active manager is on ("": no manager)', () => {
      const w = where();
      return w ? w.stage.name : '';
    });
    V('manager.entering', 'whether this is the first pass of the stage the manager is on (when it switches its macros)', () => !!run.entering, { bool: true });
    V('manager.arriving', 'whether this pass is the first of that stage (1 = the first) — or of a later one, jumped to, so the stages before it set up too', (n) => {
      const at = Math.floor(Number(n)) - 1;
      return !!run.entering && (at === run.stage || (run.jumped && at >= 0 && at < run.stage));
    }, { bool: true, params: ['stage'] });
    V('manager.stages', 'how many stages the active manager has', () => (current() ? current().stages.length : 0));
    V('manager.list', 'a list: every manager’s id', () => managers.map((m) => m.id), { list: true });

    const A = CA.Actions.register;
    A({
      id: 'manager.use',
      name: 'Use a manager',
      icon: 'ascend',
      group: 'Managers',
      unit: 'switched',
      params: [{ key: 'manager', label: 'Manager', type: 'select', default: 'nunixLateGame', options: managerOptions, word: 'manager' }],
      describe: (p) => `Use the manager ${(find(p.manager) || { name: p.manager }).name}`,
      run: (p) => use(p.manager),
    });
    A({
      id: 'manager.goTo',
      name: 'Go to a stage of the manager',
      icon: 'ascend',
      group: 'Managers',
      unit: 'stages',
      params: [{ key: 'stage', label: 'Stage (1 = the first)', type: 'number', default: 1, min: 1 }],
      describe: (p) => `Go to stage ${p.stage} of the manager`,
      run: (p) => goTo(p.stage),
    });
    A({
      id: 'manager.next',
      name: 'On to the manager’s next stage',
      icon: 'ascend',
      group: 'Managers',
      unit: 'stages',
      run: () => {
        if (!current()) return 0;
        enter(run.stage + 1);
        run.entered = true; // this pass is the old stage's: the next is the new one's first
        return 1;
      },
    });
    A({
      id: 'manager.profile',
      name: 'Put a profile in, once this stage',
      icon: 'ascend',
      group: 'Managers',
      unit: 'switched',
      params: [
        { key: 'kind', label: 'Of', type: 'select', default: 'buyer', options: kindOptions },
        { key: 'profile', label: 'Profile (id or name)', type: 'text', default: '', word: (v, a) => ({ kind: `profile.${a.kind || 'buyer'}`, id: v }) },
      ],
      describe: (p) => `Put the ${(P[p.kind] || { label: p.kind }).label} profile ${p.profile} in`,
      run: (p) => wantProfile(p.kind, p.profile),
    });
    A({
      id: 'macro.setting',
      name: 'Change a macro’s setting',
      icon: 'bolt',
      group: 'Macros',
      unit: 'changed',
      params: [
        { key: 'macro', label: 'Macro', type: 'select', default: '', options: () => CA.Macros.list().filter((x) => (x.inputs || []).length).map((x) => ({ v: x.id, label: x.name })) },
        { key: 'key', label: 'Setting', type: 'text', default: '', word: (v, a) => ({ kind: 'setting', id: `${a.macro || ''}.${v}` }) },
        { key: 'value', label: 'To', type: 'text', default: '' },
      ],
      describe: (p) => `Set ${(CA.Macros.get(p.macro) || { name: p.macro }).name}’s ${p.key} to ${p.value}`,
      run: (p) => {
        const x = CA.Macros.get(p.macro);
        if (!x || !(x.inputs || []).some((i) => i.key === p.key) || CA.Macros.inputsOf(x)[p.key] === p.value) return 0;
        CA.Macros.setInput(x.id, p.key, p.value);
        return 1;
      },
    });

    CA.Macros.addBuiltin({
      id: UNLOCKER.id,
      name: 'Upgrade unlocker',
      desc: 'One switch for the macros that unlock upgrades and buy the cheap ones: Santa, Research, Auto dragon, Pet the dragon, Fortunes, Cheap upgrades and Golden cookie upgrades (the Auto buyer is its own).',
      icon: { ico: 'sparkle' },
      mode: 'group',
      members: UNLOCKER.members,
      section: 'upkeep',
    });
    CA.Macros.addBuiltin({
      id: MACRO,
      name: 'Manager',
      desc: 'Plays the ascension in stages, as the active manager on the Managers page says: its code (written from its stages, or by you) switches macros and their settings, puts in Auto buyer, Pantheon, dragon, Grimoire and garden profiles, and moves on stage by stage.',
      icon: { ico: 'ascend' },
      mode: 'flow',
      pass: true,
      every: 1000,
      sourceFrom: () => sourceOf(current()),
      ready,
      afterPass,
      readiness: () => readiness(),
      editAt: 'managers',
      section: 'managers',
    });
  }

  // the code editors' hover cards: a manager's id (manager.use(nunixLateGame)), a macro's setting
  // (macro.setting(research, stopBefore, none)), and a garden profile (manager.profile(garden, tulipCombos))
  CA.Words.defineKind('manager', {
    name: 'Manager',
    info: (id) => {
      const m = find(id);
      if (!m) return null;
      return {
        title: m.name,
        sig: m.id,
        desc: m.desc || 'Plays the ascension in stages, switching macros and profiles.',
        rows: m.stages
          .map((st, i) => [`stage ${i + 1}`, `${st.name}${i < m.stages.length - 1 && st.until ? ` · until ${st.until}` : ''}`])
          .concat([
            ['code', typeof m.code === 'string' ? 'yours' : 'written from its stages'],
            ['in use', m.id === active ? `yes, on stage ${run.id === m.id ? run.stage + 1 : 1}` : 'no'],
          ]),
        note: 'Managers page.',
      };
    },
  });
  CA.Words.defineKind('setting', {
    name: 'Macro setting',
    info: (id) => {
      const [mid, key] = [id.slice(0, id.indexOf('.')), id.slice(id.indexOf('.') + 1)];
      const x = CA.Macros.get(mid);
      const inp = x && (x.inputs || []).find((i) => i.key === key);
      if (!inp) return null;
      const opts = typeof inp.options === 'function' ? inp.options() : inp.options;
      return {
        title: inp.label || key,
        sig: key,
        desc: `${x.name}’s setting${inp.desc ? `: ${inp.desc}` : ''}.`,
        rows: [['now', String(CA.Macros.inputsOf(x)[key])]].concat(Array.isArray(opts) && opts.length ? [['one of', opts.map((o) => (o && typeof o === 'object' ? o.v : o)).join(', ')]] : []),
        note: 'Its card on the Macros page.',
      };
    },
  });
  if (!CA.Words.kinds().includes('profile.garden'))
    CA.Words.defineKind('profile.garden', {
      name: 'Garden profile',
      info: (id) => {
        const p = CA.GardenLayers && CA.GardenLayers.list('profile').find((x) => x.id === id || x.name.toLowerCase() === String(id).toLowerCase());
        if (!p) return null;
        return {
          title: p.name,
          sig: p.id,
          desc: p.desc || 'A garden profile: its layout, gardener and rules, loaded together.',
          rows: [['in use', CA.GardenLayers.picked('profile') === p.id ? 'yes' : 'no']],
          note: 'Garden page, Profiles.',
        };
      },
    });

  return { init, list, find, current, use, setUp, add, update, remove, resetSeeds, revert, isBuiltin, isEdited, addStage, updateStage, setStageMacro, setStageInput, setStageProfile, setStageWatch, removeStage, moveStage, untilProblem, untilHolds, untilParts, watchOf, codeOf, sourceOf, setCode, step, enter, goTo, where, readiness, lastPass: () => lastPass, P, KINDS, SCOPES, SEEDS, MACRO, UNLOCKER, FORMATS, effective };
})();
