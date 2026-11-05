// Krumblor, the cookie dragon: training it, its auras, and aura profiles.
//
//   Training     the egg is chipped and hatched with cookies (1M, 2M, 4M, 8M, 16M); each level after
//                trains one aura for 100 of a building (Cursors first, then down the store); then a
//                dragon cookie for 50 of every building, and the second aura slot for 200 of every
//                building (dragon level 27). train(buildings) does the next one when you can afford it
//                — buildings says which levels it may sacrifice buildings for: all, one (only the
//                100-of-one-building levels) or none (cookies only). It buys "A crumbly egg" first
//                when the store has it.
//   Auras        aura n is trained at dragon level n + 4; slot 1 opens at level 5, slot 2 at 27.
//                Switching a slot to another aura costs one of your highest buildings (free when you
//                own none), as the game's Confirm does (main.js SelectDragonAura).
//   Profiles     named pairs of auras — yours, saved with the game. Using one puts its auras in:
//                with one slot, its first aura you've trained; with two, both (in either slot — a
//                pair already in, swapped, costs nothing). Auras not trained yet are skipped.
//                Three come seeded, with stable ids a macro can count on even after a rename:
//                  drops        Mind Over Matter + Dragon Guts (random drops, wrinklers)
//                  dropsFlight  Mind Over Matter + Dragonflight
//                  dragonFlightHarvest  Dragonflight + Reaper of Fields
//
//   For algorithmic code:
//     dragon.level()                 the dragon's level (0–27)
//     dragon.aura(slot)              the aura in slot 1 or 2 ("" none)
//     dragon.canTrain(buildings)     whether train(buildings) would train now
//     dragon.train(buildings)        trains the next level (an action)
//     dragon.setAura(aura, slot)     puts an aura in slot 1 or 2 (an action)
//     dragon.profile(profile)        uses a profile — its id or name (an action; 0 when nothing changed)
//     dragon.profileActive(profile)  whether a profile is in (using it would change nothing)
//     dragon.activeProfile()         the id of the first profile that's in ("": none)
//     dragon.profiles()              a list: the profiles' ids

CA.Dragon = (() => {
  const LAST = 27; // fully trained
  const SEEDS = [
    { id: 'drops', name: 'Drops', auras: ['Mind Over Matter', 'Dragon Guts'] },
    { id: 'dropsFlight', name: 'Drops & flight', auras: ['Mind Over Matter', 'Dragonflight'] },
    { id: 'dragonFlightHarvest', name: 'Dragonflight & Harvest', auras: ['Dragonflight', 'Reaper of Fields'] },
  ];
  let profiles = SEEDS.map((p) => ({ ...p, auras: p.auras.slice() }));

  const strip = (html) => String(html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const has = (n) => typeof Game.Has === 'function' && Game.Has(n);
  const ready = () => !!(Game.dragonLevels && Game.dragonAuras);
  const level = () => Game.dragonLevel || 0;
  const hasEgg = () => has('A crumbly egg');
  /** How many aura slots the dragon has now (0–2). */
  const slots = () => (level() >= LAST ? 2 : level() >= 5 ? 1 : 0);

  // ---- auras ------------------------------------------------------------------------------------

  /** Every aura: [{ id, name, desc, pic, trained }] (not "No aura"). */
  function auras() {
    if (!ready()) return [];
    return Object.keys(Game.dragonAuras)
      .map(Number)
      .filter((i) => i > 0)
      .map((i) => {
        const a = Game.dragonAuras[i];
        return { id: i, name: a.name, dname: a.dname || a.name, desc: a.desc || '', pic: a.pic, trained: level() >= i + 4 };
      });
  }
  /** An aura's id from its name (any case) or number; null when there's no such aura. */
  function auraId(x) {
    if (!ready() || x == null || x === '') return null;
    if (Number.isInteger(Number(x)) && Game.dragonAuras[Number(x)]) return Number(x);
    const k = String(x).toLowerCase();
    const id = Object.keys(Game.dragonAuras).find((i) => String(Game.dragonAuras[i].name).toLowerCase() === k);
    return id == null ? null : Number(id);
  }
  const trained = (id) => id > 0 && level() >= id + 4;
  const current = () => [Game.dragonAura || 0, Game.dragonAura2 || 0];
  const auraName = (id) => (id > 0 && Game.dragonAuras && Game.dragonAuras[id] ? Game.dragonAuras[id].name : '');

  /** The building a switch costs: the last one down the store you own any of (null: switching is free). */
  function switchCost() {
    let b = null;
    Object.values(Game.Objects || {}).forEach((o) => o.amount > 0 && (b = o));
    return b;
  }
  /** Redraws the dragon's menu if it's open (as the game does after a change). */
  function refreshMenu() {
    if (Game.specialTab && typeof Game.ToggleSpecialMenu === 'function') Game.ToggleSpecialMenu(1);
  }

  /** Puts aura `x` in slot 1 or 2, paying like the game's Confirm: 1 when it switched. */
  function setAura(x, slot) {
    const id = auraId(x);
    const s = Number(slot) === 2 ? 1 : 0;
    if (id == null || !(id === 0 || trained(id)) || s + 1 > slots()) return 0;
    const cur = current();
    if (cur[s] === id || (id > 0 && cur[1 - s] === id)) return 0; // there already / in the other slot
    const b = switchCost();
    if (b && typeof b.sacrifice === 'function') b.sacrifice(1);
    Game[s ? 'dragonAura2' : 'dragonAura'] = id;
    Game.recalculateGains = 1;
    refreshMenu();
    return 1;
  }

  // ---- training -----------------------------------------------------------------------------

  /** What the next level costs: { kind: 'cookies'|'building'|'every'|'egg', n, building?, text } — null when fully trained / no egg. */
  function nextCost() {
    if (!ready()) return null;
    if (!hasEgg()) {
      const egg = Game.Upgrades && Game.Upgrades['A crumbly egg'];
      return egg && egg.unlocked && !egg.bought ? { kind: 'egg', n: egg.getPrice ? egg.getPrice() : egg.basePrice || 0, text: 'buy A crumbly egg' } : null;
    }
    const L = level();
    if (L >= LAST) return null;
    const lv = Game.dragonLevels[L];
    const text = lv && typeof lv.costStr === 'function' ? strip(lv.costStr()) : '';
    if (L < 5) return { kind: 'cookies', n: 1e6 * Math.pow(2, L), text };
    if (L < 25) return { kind: 'building', n: 100, building: Game.ObjectsById && Game.ObjectsById[L - 5], text };
    return { kind: 'every', n: L === 25 ? 50 : 200, text };
  }
  /** What the next level does: "Train Dragonflight", "Bake dragon cookie"… ("" fully trained). */
  function nextAction() {
    if (!ready() || !hasEgg() || level() >= LAST) return !hasEgg() && nextCost() ? 'Buy the egg' : '';
    const L = level();
    if (L < 3) return 'Chip the egg';
    if (L === 3) return 'Hatch the egg';
    if (L < 25) return `Train ${auraName(L - 3)}`;
    return L === 25 ? 'Bake a dragon cookie' : 'Train the second aura slot';
  }
  const allowed = (kind, buildings) => kind === 'cookies' || kind === 'egg' || (kind === 'building' ? buildings !== 'none' : buildings === 'all' || buildings == null || buildings === '');

  function canTrain(buildings) {
    const c = nextCost();
    if (!c || !allowed(c.kind, buildings)) return false;
    if (c.kind === 'egg') return Game.cookies >= c.n;
    const lv = Game.dragonLevels[level()];
    return !!(lv && typeof lv.cost === 'function' && lv.cost());
  }

  /** Trains the next level if allowed and affordable: 1 when it did. Quietly — no sound, the menu stays as it is. */
  function train(buildings) {
    if (!canTrain(buildings)) return 0;
    if (nextCost().kind === 'egg') {
      Game.Upgrades['A crumbly egg'].buy(1);
      return hasEgg() ? 1 : 0;
    }
    Game.dragonLevels[level()].buy();
    Game.dragonLevel = (level() + 1) % Game.dragonLevels.length;
    if (level() >= Game.dragonLevels.length - 1 && typeof Game.Win === 'function') Game.Win('Here be dragon');
    Game.recalculateGains = 1;
    Game.upgradesToRebuild = 1;
    refreshMenu();
    return 1;
  }

  // ---- profiles -----------------------------------------------------------------------------

  const list = () => profiles.slice();
  /** A profile by id, or by name (any case). */
  function find(x) {
    if (x == null || x === '') return null;
    const k = String(x).toLowerCase();
    return profiles.find((p) => p.id === String(x)) || profiles.find((p) => p.name.toLowerCase() === k) || null;
  }

  /** The auras a profile would put in now, by slot: [id, id] (0: leave the slot as it is). */
  function wanted(p) {
    const n = slots();
    const ids = (p.auras || []).map(auraId).filter((id) => id > 0 && trained(id));
    const uniq = ids.filter((id, i) => ids.indexOf(id) === i).slice(0, n);
    if (n < 2) return [uniq[0] || 0, 0];
    // two slots: keep what's already in, fill the rest
    const cur = current();
    const out = cur.map((id) => (uniq.includes(id) ? id : 0));
    uniq.filter((id) => !out.includes(id)).forEach((id) => (out[out[0] ? 1 : 0] = id));
    return out;
  }
  /** Switches a profile needs now (0: it's in), and the profile's auras the dragon hasn't trained yet. */
  function status(x) {
    const p = typeof x === 'object' && x ? x : find(x);
    if (!p || !ready()) return null;
    const w = wanted(p);
    const cur = current();
    const switches = w.filter((id, s) => id > 0 && cur[s] !== id).length;
    const untrained = (p.auras || []).filter((a) => {
      const id = auraId(a);
      return id > 0 && !trained(id);
    });
    return { switches, untrained, slots: slots(), wanted: w };
  }
  const isActive = (x) => {
    const s = status(x);
    return !!s && s.slots > 0 && s.switches === 0 && s.wanted.some((id) => id > 0);
  };
  const activeProfile = () => (profiles.find((p) => isActive(p)) || { id: '' }).id;
  /** Whether all of a profile's auras are in (isActive is true as soon as what fits now is in: with one
   *  slot, its first aura). A manager keeps a profile coming until it's complete, so the second aura
   *  goes in once the dragon has its second slot. */
  function isComplete(x) {
    const p = typeof x === 'object' && x ? x : find(x);
    if (!p || !ready()) return false;
    const ids = (p.auras || []).map(auraId).filter((id) => id > 0);
    const cur = current();
    return ids.length > 0 && ids.every((id) => cur.includes(id));
  }
  /** What a profile that isn't complete waits for: "the second aura slot (dragon level 27)", "Dragon Guts trained"… */
  function waitsFor(x) {
    const s = status(x);
    if (!s) return '';
    if (!s.slots) return 'an aura slot (dragon level 5)';
    if (s.untrained.length) return `${s.untrained.join(', ')} trained`;
    const n = new Set((find(x) || { auras: [] }).auras.map(auraId).filter((id) => id > 0)).size;
    return n > s.slots ? 'the second aura slot (dragon level 27)' : 'auras';
  }

  /** Uses a profile: the number of slots it switched (0: already in, unknown, or no slot yet). */
  function apply(x) {
    const p = find(x);
    if (!p || !ready()) return 0;
    const w = wanted(p);
    let n = 0;
    w.forEach((id, s) => id > 0 && current()[s] !== id && (n += setAura(id, s + 1)));
    return n;
  }

  // edits, for the Dragon page
  const changed = () => CA.Events.emit('dragon');
  const newId = () => {
    let i = profiles.length + 1;
    while (profiles.some((p) => p.id === `p${i}`)) i++;
    return `p${i}`;
  };
  /** A new profile: the auras in now (or none); returns it. */
  function add(name, fromCurrent) {
    const auras = fromCurrent ? current().filter((id) => id > 0).map(auraName) : [];
    const p = { id: newId(), name: String(name || `Profile ${profiles.length + 1}`).slice(0, 40), auras: auras.concat(['', '']).slice(0, 2) };
    profiles.push(p);
    changed();
    return p;
  }
  function update(id, patch) {
    const p = profiles.find((x) => x.id === id);
    if (!p) return null;
    if (patch.name != null && String(patch.name).trim()) p.name = String(patch.name).trim().slice(0, 40);
    if (Array.isArray(patch.auras)) p.auras = patch.auras.slice(0, 2).map((a) => (a ? auraName(auraId(a)) || '' : ''));
    changed();
    return p;
  }
  function remove(id) {
    const i = profiles.findIndex((x) => x.id === id);
    if (i < 0) return false;
    profiles.splice(i, 1);
    changed();
    return true;
  }

  function load(data) {
    if (!data || !Array.isArray(data.profiles)) return;
    profiles = data.profiles
      .filter((p) => p && p.id && p.name)
      .map((p) => ({ id: String(p.id), name: String(p.name).slice(0, 40), auras: (Array.isArray(p.auras) ? p.auras : []).slice(0, 2).map((a) => String(a || '')) }));
    changed();
  }

  // ---- blocks, actions and the Auto dragon macro -----------------------------------------------

  const BUILDINGS = [
    { v: 'all', label: 'all — every level' },
    { v: 'one', label: 'one — the 100-of-a-building levels, not 50 / 200 of every building' },
    { v: 'none', label: 'none — cookies only (the egg)' },
  ];
  const auraOptions = () => auras().map((a) => ({ v: a.name, label: a.dname }));
  const profileOptions = () => profiles.map((p) => ({ v: p.id, label: p.name }));

  function readiness(buildings) {
    if (!ready() || (!hasEgg() && !nextCost())) return { ok: false, text: 'no dragon yet (needs A crumbly egg)' };
    const c = nextCost();
    if (!c) return { ok: false, text: 'fully trained' };
    if (!allowed(c.kind, buildings)) return { ok: false, text: `next: ${nextAction()} — ${c.text} (not allowed)` };
    return { ok: canTrain(buildings), text: `next: ${nextAction()} — ${c.text}` };
  }

  function init() {
    CA.Settings.registerSection('dragon', { serialize: () => ({ profiles }), load, event: 'dragon' });
    const V = (id, desc, get, more) => CA.Script.defineValue({ id, desc, get, ...(more || {}) });
    V('dragon.level', 'the dragon’s level (0–27; auras from 5, the second slot at 27)', () => level());
    V('dragon.aura', 'the aura in slot 1 or 2 ("" none)', (s) => auraName(current()[Number(s) === 2 ? 1 : 0]), { params: ['slot'] });
    V('dragon.canTrain', 'whether the dragon can train its next level now — buildings: all, one or none (which levels may sacrifice buildings)', (b) => canTrain(b || 'all'), { params: ['buildings'], bool: true });
    V('dragon.profileActive', 'whether an aura profile (its id or name) is in — using it would change nothing', (x) => isActive(x), { params: ['profile'], bool: true });
    V('dragon.activeProfile', 'the id of the first aura profile that’s in ("": none)', () => activeProfile());
    V('dragon.profiles', 'a list: the aura profiles’ ids', () => profiles.map((p) => p.id), { list: true });

    const A = CA.Actions.register;
    A({
      id: 'dragon.train',
      name: 'Train the dragon',
      icon: 'dragon',
      group: 'Dragon',
      unit: 'trained',
      params: [{ key: 'buildings', label: 'Sacrificing buildings', type: 'select', default: 'all', options: () => BUILDINGS }],
      available: ready,
      describe: (p) => (p.buildings === 'none' ? 'Train the dragon (cookies only)' : p.buildings === 'one' ? 'Train the dragon (not the every-building levels)' : 'Train the dragon'),
      ready: (p) => readiness(p.buildings),
      run: (p) => train(p.buildings),
    });
    A({
      id: 'dragon.setAura',
      name: 'Set a dragon aura',
      icon: 'dragon',
      group: 'Dragon',
      unit: 'switched',
      params: [
        { key: 'aura', label: 'Aura', type: 'select', default: 'Dragonflight', options: auraOptions },
        { key: 'slot', label: 'Slot', type: 'select', default: '1', options: () => [{ v: '1', label: 'slot 1' }, { v: '2', label: 'slot 2 (dragon level 27)' }] },
      ],
      available: () => slots() > 0,
      describe: (p) => `Set the dragon’s aura ${p.slot === '2' || p.slot === 2 ? '2' : '1'} to ${p.aura}`,
      run: (p) => setAura(p.aura, p.slot),
    });
    A({
      id: 'dragon.profile',
      name: 'Use a dragon aura profile',
      icon: 'dragon',
      group: 'Dragon',
      unit: 'switched',
      params: [{ key: 'profile', label: 'Profile', type: 'select', default: 'dragonFlightHarvest', options: profileOptions }],
      available: () => slots() > 0,
      describe: (p) => `Use the dragon aura profile ${(find(p.profile) || { name: p.profile }).name}`,
      ready: (p) => {
        const s = status(p.profile);
        if (!s) return { ok: false, text: 'no such profile' };
        if (!s.slots) return { ok: false, text: 'the dragon has no aura slot yet (level 5)' };
        return { ok: s.switches > 0, text: s.switches ? `${s.switches} switch${s.switches === 1 ? '' : 'es'}` : 'in use' };
      },
      run: (p) => apply(p.profile),
    });

    CA.Macros.addBuiltin({
      id: 'autoDragon',
      name: 'Auto dragon',
      desc: 'Trains the dragon whenever you can afford its next level: buys A crumbly egg, chips and hatches the egg, then trains each aura (100 of a building each), bakes the dragon cookie and trains the second aura slot (50 and 200 of every building). Pick which levels may sacrifice buildings.',
      icon: { sprite: [21, 12] },
      mode: 'flow',
      every: 2000,
      defaultSource:
        '# Train the dragon whenever you can: the egg costs cookies, each aura 100 of a building, the last two\n# levels 50 and 200 of every building. buildings: which levels may sacrifice buildings — all, one (only\n# the 100-of-a-building ones) or none (cookies only).\nforever:\n  if dragon.canTrain(buildings):\n    dragon.train(buildings)\n',
      inputs: [{ key: 'buildings', label: 'Sacrificing buildings', type: 'select', default: 'all', options: () => BUILDINGS }],
      readiness: (ins) => readiness(ins.buildings),
      holdRepeat: true,
      section: 'upkeep',
    });
  }

  // a profile's id in code (dragon.profile(drops)…), and an aura's name: the code editors' hover cards
  CA.Words.defineKind('profile.dragon', {
    name: 'Dragon aura profile',
    info: (id) => {
      const p = find(id);
      if (!p) return null;
      const s = status(p);
      return {
        title: p.name,
        sig: p.id,
        desc: `Puts the dragon's auras ${p.auras.join(' and ')} in.`,
        rows: [['in now', isActive(p) ? 'yes' : 'no'], s && s.untrained.length ? ['not trained yet', s.untrained.join(', ')] : null].filter(Boolean),
        note: 'Dragon page.',
      };
    },
  });
  CA.Words.defineKind('aura', {
    name: 'Dragon aura',
    info: (id) => {
      const a = auras().find((x) => x.id === auraId(id));
      return a ? { title: a.dname, desc: strip(a.desc), rows: [['trained', a.trained ? 'yes' : 'no']] } : null;
    },
  });

  return { init, auras, auraId, slots, level, nextCost, nextAction, canTrain, train, setAura, switchCost, list, find, status, isActive, isComplete, waitsFor, activeProfile, apply, add, update, remove, SEEDS, LAST };
})();
