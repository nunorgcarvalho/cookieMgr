// cookieMgr's save: options, hotkey bindings, and the sections features register (your macros,
// widgets, garden profiles… — registerSection). Saved inside the regular Cookie Clicker save
// through the mod API (see main.js), so it follows exports/imports and cloud saves like any other
// game data, and mirrored to localStorage so a quick refresh never loses a change.
//
//   CA.Settings.registerSection('garden', { serialize: () => data, load(data, whole), event: 'garden' })
//
// Loading is careful: nothing is mirrored while a save is being read, each section loads on its
// own (one that fails keeps a copy of what it couldn't read and the rest load as usual), and
// options defined later (by a page that defines them lazily) still get their saved values.

CA.Settings = (() => {
  const SAVE_VERSION = 2;

  const optionDefs = []; // { key, name, desc, group, default }
  const options = {};
  let hotkeyOverrides = {}; // actionId -> combo ('' = explicitly unbound)
  let savedOptions = {}; // the options of the save last loaded, for options defined after it

  // ---- options ---------------------------------------------------------------

  function defineOption(def) {
    optionDefs.push(def);
    if (!(def.key in options)) options[def.key] = typeof savedOptions[def.key] === typeof def.default ? savedOptions[def.key] : def.default;
    return def;
  }

  function optionsIn(group) {
    return optionDefs.filter((d) => d.group === group);
  }
  /** Every option defined so far (for the Settings page and the tests). */
  const definitions = () => optionDefs.slice();

  function get(key) {
    return options[key];
  }

  function set(key, value) {
    if (options[key] === value) return;
    options[key] = value;
    CA.Events.emit('settings', key);
  }

  // ---- hotkeys ---------------------------------------------------------------

  // Hotkeys bind to bindables (CA.Hotkeys.register): macros and a few panel commands.
  // Up to v1.6 the autoclickers were bound as 'clicker.<id>'; they're macros now.
  const LEGACY_HOTKEY_IDS = { 'clicker.stockTrader': 'macro.stockTrader' };
  const migrateHotkeyId = (id) => LEGACY_HOTKEY_IDS[id] || (id.startsWith('clicker.') ? `macro.${id.slice(8)}` : id);

  function getHotkey(id) {
    if (id in hotkeyOverrides) return hotkeyOverrides[id];
    const b = CA.Hotkeys.get(id);
    return b ? b.defaultKey : '';
  }

  /** Every bindable a combo triggers (a key may be shared by several macros). */
  function targetsForCombo(combo) {
    if (!combo) return [];
    return CA.Hotkeys.all()
      .filter((b) => getHotkey(b.id) === combo)
      .map((b) => b.id);
  }

  /**
   * Binds `combo` to bindable `id`. Keys can be shared, so nothing else is unbound.
   * @returns {string[]} ids of the other bindables that the same key also triggers
   */
  function setHotkey(id, combo) {
    storeOverride(id, combo);
    CA.Events.emit('hotkeys', id);
    return combo ? targetsForCombo(combo).filter((x) => x !== id) : [];
  }

  function storeOverride(id, combo) {
    const b = CA.Hotkeys.get(id);
    if (b && b.defaultKey === combo) delete hotkeyOverrides[id];
    else hotkeyOverrides[id] = combo;
  }

  /** Back to the key it comes with. */
  function resetHotkey(id) {
    delete hotkeyOverrides[id];
    CA.Events.emit('hotkeys', id);
  }
  const isDefaultHotkey = (id) => !(id in hotkeyOverrides);

  function resetHotkeys() {
    hotkeyOverrides = {};
    CA.Events.emit('hotkeys', null);
  }

  // ---- save / load -------------------------------------------------------------

  const sections = []; // { key, serialize, load, event }
  let loading = false;
  let loadedOnce = false;

  /** A part of the save that a feature owns: serialize() → JSON-able data, load(data, whole). */
  function registerSection(key, s) {
    if (sections.some((x) => x.key === key)) throw new Error(`Save section "${key}" already registered`);
    sections.push({ key, ...s });
    if (s.event && persisting) CA.Events.on(s.event, persistToLocal);
  }

  function serialize() {
    // options not defined (yet) this session keep their saved values
    const data = { v: SAVE_VERSION, savedAt: Date.now(), options: { ...savedOptions, ...options }, hotkeys: { ...hotkeyOverrides } };
    sections.forEach((s) => {
      try {
        const v = s.serialize();
        if (v !== undefined) data[s.key] = v;
      } catch (e) {
        CA.Util.log(`Could not save “${s.key}”.`, e);
      }
    });
    return JSON.stringify(data);
  }

  const parse = (str) => {
    if (!str || typeof str !== 'string') return null;
    try {
      const d = JSON.parse(str);
      return d && typeof d === 'object' && !Array.isArray(d) ? d : null;
    } catch (e) {
      CA.Util.log('Could not read saved settings, using defaults.', e);
      return null;
    }
  };

  // Up to v3.16 the Numbers option started on the abbreviated short scale (ODe), which every save
  // kept; v3.17 starts on Cookie Monster's default, the short scale (Octodec), saves before it too.
  // The Actual, 15 min / 1 h / 3 h payback modes are gone: one Actual income window for all. A save
  // in one of them (or with an Auto buyer profile ranking by one) keeps that window, in the one mode.
  const RETIRED_ACTUAL = { actualIncome15m: '15', actualIncome1h: '60', actualIncome3h: '180' };
  function migrateOptions(saved, v, data) {
    const out = { ...saved };
    if (!(v >= 2) && out.numberFormat === 'abbr') out.numberFormat = 'short';
    // American spelling: the store's payback colors option was saved as storeColours
    if ('storeColours' in out) {
      if (!('storeColors' in out)) out.storeColors = out.storeColours;
      delete out.storeColours;
    }
    const profiles = data && data.buyer && Array.isArray(data.buyer.profiles) ? data.buyer.profiles : [];
    const retired = [out.ppMode].concat(profiles.map((p) => p && p.mode)).find((m) => RETIRED_ACTUAL[m]);
    if (retired) out.ppActualWindow = RETIRED_ACTUAL[retired];
    if (RETIRED_ACTUAL[out.ppMode]) out.ppMode = 'actualIncome';
    return out;
  }

  /** Options and hotkeys from parsed save data. */
  function applyBasics(data) {
    if (data.options && typeof data.options === 'object' && !Array.isArray(data.options)) {
      savedOptions = migrateOptions(data.options, data.v, data);
      optionDefs.forEach((d) => {
        if (typeof savedOptions[d.key] === typeof d.default) options[d.key] = savedOptions[d.key];
      });
    }
    if (data.hotkeys && typeof data.hotkeys === 'object') {
      hotkeyOverrides = {};
      Object.keys(data.hotkeys).forEach((id) => {
        if (typeof data.hotkeys[id] === 'string') hotkeyOverrides[migrateHotkeyId(id)] = data.hotkeys[id];
      });
    }
  }

  /** Data a section couldn't read: kept in localStorage (never thrown away), and you're told. */
  const UNREADABLE_KEY = 'CookieMgr.unreadable';
  function keepUnreadable(key, value, err) {
    CA.Util.log(`Could not load your saved “${key}”.`, err);
    try {
      const all = JSON.parse(localStorage.getItem(UNREADABLE_KEY) || '{}');
      all[key] = { at: Date.now(), version: CA.VERSION, error: String((err && err.message) || err), data: value };
      localStorage.setItem(UNREADABLE_KEY, JSON.stringify(all));
    } catch (e) {
      /* storage blocked: the log line is all we can do */
    }
    CA.Util.notify('cookieMgr', `Part of your saved settings (“${CA.Util.escapeHtml(key)}”) couldn’t be read, so it starts fresh. A copy is kept in this browser (localStorage “${UNREADABLE_KEY}”).`, CA.ICON, 8);
  }

  /**
   * Loads cookieMgr's part of a game save (`str`, may be empty). On the first load of a session the
   * local mirror is used instead when it's the same bakery's and not older — the game only saves
   * once a minute; a later load (an import, another save) always takes the game's.
   * @returns {object|null} the data that was loaded
   */
  function load(str) {
    const game = parse(str);
    const local = loadedOnce ? null : localMirror();
    loadedOnce = true;
    let data = game;
    if (local && local.data && (!local.saveId || local.saveId === CA.Store.saveId()) && (!game || !game.savedAt || (local.data.savedAt || local.savedAt || 0) >= game.savedAt)) data = local.data;
    if (!data) return null;
    loading = true;
    try {
      applyBasics(data);
      sections.forEach((s) => {
        try {
          s.load(data[s.key], data);
        } catch (e) {
          keepUnreadable(s.key, data[s.key], e);
        }
      });
    } finally {
      loading = false;
    }
    CA.Events.emit('settings', null);
    CA.Events.emit('hotkeys', null);
    persistToLocal();
    return data;
  }

  // ---- local mirror (survives a quick refresh) ----------------------------------
  // Cookie Clicker only autosaves once every 60 real seconds (see Game.T%(fps*60) in its own
  // source) and does not force a save on tab close/refresh — so toggling a setting and
  // reloading soon after can lose it, through no fault of this mod (any mod's save data has
  // the same gap). We mirror our own serialized state to localStorage on every change (plus a
  // periodic safety net and on page hide), and prefer it over whatever came from the game's own
  // save on load, since ours is never more than moments out of date.

  const STORE_KEY = 'CookieMgr.settings.v1';
  const PERSIST_MS = 30000;
  let persisting = false;

  function persistToLocal() {
    if (loading || !loadedOnce) return; // never mirror a half-loaded (or not yet loaded) state
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ v: 1, savedAt: Date.now(), saveId: CA.Store.saveId(), payload: serialize() }));
    } catch (e) {
      /* storage full/blocked (private mode, quota, ...) — this is a convenience mirror, never fatal */
    }
  }

  /** The mirror: { data (parsed), savedAt, saveId } or null. */
  function localMirror() {
    let wrap;
    try {
      wrap = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    } catch (e) {
      return null;
    }
    if (!wrap || typeof wrap.payload !== 'string') return null;
    return { data: parse(wrap.payload), savedAt: wrap.savedAt || 0, saveId: wrap.saveId || null };
  }

  function startAutoPersist() {
    persisting = true;
    CA.Events.on('settings', persistToLocal);
    CA.Events.on('hotkeys', persistToLocal);
    sections.forEach((s) => s.event && CA.Events.on(s.event, persistToLocal));
    setInterval(persistToLocal, PERSIST_MS);
    addEventListener('pagehide', persistToLocal);
    addEventListener('beforeunload', persistToLocal);
  }

  return {
    defineOption,
    optionsIn,
    definitions,
    get,
    set,
    getHotkey,
    setHotkey,
    targetsForCombo,
    resetHotkey,
    isDefaultHotkey,
    resetHotkeys,
    registerSection,
    serialize,
    load,
    startAutoPersist,
  };
})();
