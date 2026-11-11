// **Macros**: automations built by chaining actions (core/actions.js). hotkey → macro(s) → action(s).
//
// A macro has a trigger mode:
//   repeat   while it's on, runs its steps every `every` ms              (the autoclickers)
//   when     while it's on, checks a condition (core/conditions.js) every `every` ms and runs its
//            steps when it becomes true ("rise") or on every check while it holds ("while")
//   once     no on/off — a button or hotkey runs its steps one time       (Sell all stocks)
//   group    a switch for several other macros: on turns them all on, off turns them all off.
//            It has no steps or timer of its own; it counts as on while all its members are on,
//            so it stays right however its members get switched.
//
// Built-in macros (the original autoclickers, the stock autobuyer, Sell all…) can't be removed or
// edited, only duplicated. Your own macros are saved in the game save with the rest of the
// settings. Every macro is also a hotkey bindable ('macro.<id>'): repeat/when macros toggle,
// once macros run.

CA.Macros = (() => {
  const MIN_EVERY = 20;
  const MAX_DEPTH = 4; // macros running macros running macros…

  const sprite = (x, y, img) => ({ sprite: [x, y], img });

  const BUILTINS = [
    {
      id: 'bigCookie',
      name: 'Big cookie',
      desc: 'Clicks the big cookie 20 times a second.',
      icon: sprite(11, 0, 'img/perfectCookie.png'),
      mode: 'repeat',
      every: 50,
      steps: [{ action: 'click.bigCookie', params: { anim: 'default' } }],
      options: [{ step: 0, key: 'anim' }],
      defaultKey: 'KeyC',
      inAll: true,
      section: 'autoclickers',
    },
    {
      id: 'golden',
      name: 'Golden cookies',
      desc: 'Pops golden cookies the moment they appear.',
      icon: sprite(10, 14, 'img/goldCookie.png'),
      mode: 'flow',
      every: 100,
      defaultSource: "# Pop every golden cookie (not wrath cookies: that’s its own macro) on screen.\nforever:\n  for s in shimmers():\n    if shimmer.type(s) == \"golden\" and not shimmer.isWrath(s):\n      shimmer.pop(s)\n",
      defaultKey: 'KeyG',
      inAll: true,
      section: 'autoclickers',
    },
    {
      id: 'wrath',
      name: 'Wrath cookies',
      desc: 'Pops red wrath cookies too (they can be good or bad).',
      icon: sprite(15, 5, 'img/wrathCookie.png'),
      mode: 'flow',
      every: 100,
      defaultSource: "# Pop every wrath cookie on screen.\nforever:\n  for s in shimmers():\n    if shimmer.type(s) == \"golden\" and shimmer.isWrath(s):\n      shimmer.pop(s)\n",
      defaultKey: 'KeyW',
      inAll: true,
      section: 'autoclickers',
    },
    {
      // golden cookies clicked (all time) unlock Lucky day (7), Serendipity (27) and Get lucky (77) — main.js's
      // popFunc, wrath cookies too — so after an ascension one click puts all three back in the store
      id: 'goldenUpgrades',
      name: 'Golden cookie upgrades',
      desc: 'Pops golden cookies, wrath ones too, until Lucky day, Serendipity and Get lucky are unlocked (7, 27 and 77 clicked, all time: after an ascension, one click).',
      icon: sprite(27, 6),
      mode: 'flow',
      every: 100,
      defaultSource: "# Pop golden cookies (wrath ones too) until the golden cookie upgrades are unlocked: Lucky day,\n# Serendipity and Get lucky come with 7, 27 and 77 clicked, all time (after an ascension: one click).\nforever:\n  if not (upgrade.owned(\"Lucky day\") and upgrade.owned(\"Serendipity\") and upgrade.owned(\"Get lucky\")):\n    for s in shimmers():\n      if shimmer.type(s) == \"golden\":\n        shimmer.pop(s)\n",
      defaultKey: '',
      section: 'autoclickers',
    },
    {
      id: 'reindeer',
      name: 'Reindeer',
      desc: 'Pops reindeer during the Christmas season.',
      icon: sprite(12, 9, 'img/frostedReindeer.png'),
      mode: 'flow',
      every: 100,
      defaultSource: "# Pop every reindeer on screen.\nforever:\n  for s in shimmers():\n    if shimmer.type(s) == \"reindeer\":\n      shimmer.pop(s)\n",
      defaultKey: 'KeyR',
      inAll: true,
      section: 'autoclickers',
    },
    {
      id: 'fortune',
      name: 'Fortune news',
      desc: 'Clicks fortunes as they scroll through the news ticker.',
      icon: sprite(29, 8),
      mode: 'repeat',
      every: 100,
      steps: [{ action: 'click.fortune' }],
      defaultKey: 'KeyF',
      inAll: true,
      section: 'autoclickers',
    },
    {
      id: 'wrinklers',
      name: 'Wrinklers',
      desc: 'Pops wrinklers once they’ve eaten something (so they can drop Halloween cookies and such) — or the moment they latch on. Shift-click its button to switch.',
      icon: sprite(19, 8),
      mode: 'flow',
      every: 100,
      defaultSource: "# Pop the wrinklers — once they've eaten something (so they can drop Halloween cookies and such),\n# or at once when fed is off; shiny ones too unless shiny says to leave them alone.\n# (Its choices are on its card; shift-click its button flips fed.)\nforever:\n  for w in wrinklers():\n    if (wrinkler.isFed(w) or not fed) and (shiny == \"pop\" or not wrinkler.isShiny(w)):\n      wrinkler.pop(w)\n",
      inputs: [
        { key: 'shiny', label: 'Shiny wrinklers', type: 'select', default: 'pop', options: [{ v: 'pop', label: 'Pop them too' }, { v: 'keep', label: 'Leave them alone' }] },
        { key: 'fed', label: 'Wait until it has eaten (so it can drop something)', type: 'bool', default: true },
      ],
      shift: { input: 'fed', on: 'pops them once they’ve eaten (drops count)', off: 'pops them at once' },
      defaultKey: 'KeyK',
      inAll: true,
      section: 'autoclickers',
    },
    {
      id: 'stockTrader',
      name: 'Stock market autobuyer',
      desc: 'Once a second: hires the stockbrokers it can afford (each makes buying cheaper), then buys and sells as its trader profile says (Stock market page): Trends and prices, Ride the trends, or one of yours.',
      icon: sprite(9, 33),
      mode: 'flow',
      every: 1000,
      defaultSource: () => CA.StockTrader.SOURCE,
      // its code is the trader profile in use (features/stockTrader.js), edited on the Stock market page
      sourceFrom: () => CA.StockTrader.sourceOf(),
      editAt: 'stocks',
      inputs: [
        { key: 'buy', label: 'Buy rising stocks', type: 'bool', default: true },
        { key: 'brokers', label: 'Hire stockbrokers when affordable', type: 'bool', default: true },
      ],
      shift: { input: 'buy', on: 'buys and sells', off: 'only sells what you hold' },
      defaultKey: '',
      section: 'stocks',
    },
    {
      id: 'sellAll',
      name: 'Sell all stocks',
      desc: 'Turns the autobuyer off (so it doesn’t buy it all straight back), then sells every stock you hold.',
      icon: { ico: 'dollar' },
      mode: 'once',
      steps: [{ action: 'macro.set', params: { macro: 'stockTrader', to: 'off' } }, { action: 'stocks.sellAll' }],
      noOptions: true,
      defaultKey: '',
      section: 'stocks',
    },
    {
      id: 'elderPledge',
      name: 'Elder Pledge',
      desc: 'Keeps the elders pledged: buys the Elder Pledge whenever the Grandmapocalypse is on and it’s for sale (it lasts a while, then wears off).',
      icon: sprite(9, 9),
      mode: 'repeat',
      every: 2000,
      steps: [{ action: 'grandma.exit', params: { how: 'pledge' } }],
      defaultKey: '',
      section: 'upkeep',
    },
    {
      id: 'lumps',
      name: 'Sugar lump harvester',
      desc: 'Harvests your sugar lump when it’s ripe (always pays) — or as soon as it’s mature, a little earlier but with the game’s 50% chance of getting nothing.',
      icon: sprite(29, 14),
      mode: 'flow',
      every: 1000,
      defaultSource: "# Harvest the sugar lump when it's ripe (always pays) — or as soon as it's mature when \"when\"\n# says so (a little earlier, but with the game's 50% chance of getting nothing).\nforever:\n  if lump.isRipe() or (when == \"mature\" and lump.isMature()):\n    lump.pick()\n",
      inputs: [{ key: 'when', label: 'Harvest when', type: 'select', default: 'ripe', options: [{ v: 'ripe', label: 'ripe (always pays)' }, { v: 'mature', label: 'mature (50% chance)' }] }],
      defaultKey: '',
      section: 'upkeep',
    },
  ];

  const macros = []; // builtins first, then yours, in order
  const byId = {};
  // built-ins that were replaced by another (v3.43: Best building, Best upgrade → Auto buyer): their
  // old ids — on left-panel buttons, in groups, in code, in the running list — mean the new one
  const renamed = {};
  const rid = (id) => (byId[id] || !renamed[id] ? id : renamed[id]);
  /** Makes an old built-in's id stand for another macro (the old one must not be defined). */
  const rename = (from, to) => (renamed[from] = to);
  const running = {}; // id -> { timer, since }
  const status = {}; // id -> { runs, lastRun, steps: [{ total, runs, last, lastAt, error }] }
  let prefs = {}; // id -> { fav }
  let depth = 0;
  // how busy each macro has been: an exponentially decaying count of the things it did
  // (time constant ACTIVITY_S), so rate() ≈ things per second over the last few minutes
  const ACTIVITY_S = 300;
  const activity = {}; // id -> { h, t }
  // what each macro did last (for the Manager widget): its last RECENT_MAX actions that did something
  const RECENT_MAX = 8;
  const recentDone = {}; // id -> [{ t, action, params, k }], newest first

  // ---- definitions --------------------------------------------------------------------

  function clean(def) {
    const mode = ['repeat', 'when', 'once', 'group', 'flow'].includes(def.mode) ? def.mode : 'repeat';
    const m = {
      id: String(def.id),
      name: String(def.name || 'Macro').slice(0, 60),
      desc: String(def.desc || '').slice(0, 300),
      icon: def.icon && typeof def.icon === 'object' ? def.icon : { ico: 'bolt' },
      mode,
      every: Math.max(MIN_EVERY, Math.round(Number(def.every) || (mode === 'when' ? 250 : 1000))),
      steps: (Array.isArray(def.steps) ? def.steps : [])
        .filter((s) => s && typeof s.action === 'string')
        .map((s) => ({ action: s.action, params: s.params && typeof s.params === 'object' ? { ...s.params } : {} })),
      builtin: !!def.builtin,
    };
    if (mode === 'group') {
      m.steps = [];
      m.members = (Array.isArray(def.members) ? def.members : []).map(String).filter((id) => id !== m.id);
    }
    if (mode === 'flow') {
      m.steps = [];
      // an algorithmic macro: its code (features/script.js compiles it when it starts) — v2.22
      // saved blocks instead, written out as code here
      if (typeof def.source === 'string') m.source = def.source.slice(0, 50000);
      else if (Array.isArray(def.flow) && def.flow.length) m.source = CA.Script.decompile(cleanFlow(def.flow));
      if (def.builtin && (typeof def.defaultSource === 'string' || typeof def.defaultSource === 'function')) m.defaultSource = typeof def.defaultSource === 'function' ? def.defaultSource() : def.defaultSource;
      // a built-in's inputs: its settings (on its card), variables in its code
      if (def.builtin && Array.isArray(def.inputs)) m.inputs = def.inputs.map((i) => ({ ...i }));
      // from the top on every pass (a wait only ends that pass) — rules, like a garden profile's
      if (def.pass) m.pass = true;
      // a built-in whose code comes from elsewhere (the active gardener's code), that only
      // runs when it can (ready), reports each pass (afterPass), and is edited on its own page (editAt)
      if (def.builtin) ['sourceFrom', 'ready', 'afterPass', 'readiness', 'hint'].forEach((k) => typeof def[k] === 'function' && (m[k] = def[k]));
      if (def.builtin && def.editAt) m.editAt = def.editAt;
    }
    if (mode === 'when') {
      // { all: [{ cond, params, not }, …], edge } — v2.0 saved a single condition at the top level
      const w = def.when || {};
      const list = (Array.isArray(w.all) ? w.all : [w]).filter((c) => c && c.cond);
      m.when = {
        all: (list.length ? list : [{ cond: 'buff' }]).map((c) => ({
          cond: String(c.cond),
          params: c.params && typeof c.params === 'object' ? { ...c.params } : {},
          not: !!c.not,
        })),
        edge: w.edge === 'while' ? 'while' : 'rise',
      };
    }
    ['defaultKey', 'section', 'spell', 'holdRepeat'].forEach((k) => def[k] !== undefined && (m[k] = def[k]));
    // built-ins can let you choose some of their steps' params right on their row (saved in prefs);
    // by default every param of their actions — worked out after every feature has registered its
    // actions (ready()), since a built-in can use an action registered after it
    if (m.builtin) {
      const auto = def.spell || def.noOptions ? [] : [].concat(...m.steps.map((st, i) => ((CA.Actions.get(st.action) || {}).params || []).map((p) => ({ step: i, key: p.key }))));
      m.options = (Array.isArray(def.options) ? def.options : auto).filter((o) => m.steps[o.step]);
      // a setting that shift-clicking its left-panel button flips: { step, key, on, off } (labels)
      if (def.shift) m.shift = def.shift;
    }
    return m;
  }

  function add(def) {
    const m = clean(def);
    if (byId[m.id]) {
      macros[macros.indexOf(byId[m.id])] = m;
    } else macros.push(m);
    byId[m.id] = m;
    status[m.id] = status[m.id] || freshStatus(m);
    if (status[m.id].steps.length !== m.steps.length) status[m.id] = freshStatus(m);
    CA.Hotkeys.register({
      id: `macro.${m.id}`,
      name: m.name,
      group: 'macros',
      defaultKey: m.defaultKey || '',
      run: () => trigger(m.id),
    });
    return m;
  }

  const freshStatus = (m) => ({ runs: 0, lastRun: 0, steps: m.steps.map(() => ({ total: 0, runs: 0, last: 0, lastAt: 0, error: '' })) });

  const newId = () => `m${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

  /** For features that bring their own built-in macros (e.g. features/grimoire.js). Call during init. */
  // Built-ins can be edited like your own macros: your version is kept in prefs[id].custom and
  // laid over the original (baseDefs) — "Revert to default" just drops it.
  const baseDefs = {};
  const CUSTOM_FIELDS = ['name', 'desc', 'icon', 'mode', 'every', 'steps', 'when', 'members', 'source'];
  function applyBuiltin(id) {
    const base = baseDefs[id];
    if (!base) return null;
    const c = prefs[id] && prefs[id].custom;
    const wasOn = !!running[id];
    if (wasOn) stop(id);
    const m = add({ ...base, ...(c || {}), builtin: true });
    m.customized = !!c;
    if (wasOn && m.mode !== 'once' && m.mode !== 'group') start(id);
    return m;
  }
  const addBuiltin = (def) => {
    baseDefs[def.id] = def;
    return applyBuiltin(def.id);
  };
  /** Saves your version of a built-in (its steps, kind, code… as the editor has them). */
  function customize(id, def) {
    if (!baseDefs[id]) return null;
    const custom = {};
    CUSTOM_FIELDS.forEach((k) => def[k] !== undefined && (custom[k] = JSON.parse(JSON.stringify(def[k]))));
    // the editor's version already holds the row choices, interval and code: drop the separate ones
    const fav = prefs[id] && prefs[id].fav;
    const inputs = prefs[id] && prefs[id].inputs;
    prefs[id] = { custom, ...(fav ? { fav } : {}), ...(inputs ? { inputs } : {}) };
    const m = applyBuiltin(id);
    changed(id);
    return m;
  }
  /** Back to the built-in as it comes (keeping only whether it's a favorite). */
  function revert(id) {
    if (!baseDefs[id]) return null;
    const fav = prefs[id] && prefs[id].fav;
    prefs[id] = fav ? { fav } : {};
    const m = applyBuiltin(id);
    changed(id);
    return m;
  }
  /** Whether a built-in has been changed from how it comes (edited, or its settings changed). */
  const isCustomized = (id) => !!(baseDefs[id] && prefs[id] && Object.keys(prefs[id]).some((k) => k !== 'fav'));

  /** Creates or updates one of your macros; returns it. Built-ins can't be changed. */
  function save(def) {
    if (def.id && byId[def.id] && byId[def.id].builtin) return customize(def.id, def);
    const wasOn = def.id && isOn(def.id);
    if (wasOn) stop(def.id);
    const m = add({ ...def, id: def.id || newId(), builtin: false });
    if (wasOn && m.mode !== 'once') start(m.id);
    changed(m.id);
    return m;
  }

  function remove(id) {
    const m = byId[id];
    if (!m || m.builtin) return false;
    stop(id);
    macros.splice(macros.indexOf(m), 1);
    delete byId[id];
    delete status[id];
    delete prefs[id];
    delete flowRuns[id];
    delete activity[id];
    delete recentDone[id];
    delete problems[id];
    CA.Hotkeys.unregister(`macro.${id}`);
    changed(id);
    return true;
  }

  function duplicate(id) {
    const m = byId[id];
    if (!m) return null;
    // the copy gets the steps (and a flow's blocks) as they are now, settings applied
    const ins = inputsOf(m);
    const lead = Object.keys(ins).map((k) => `${k} = ${CA.Script.litText(ins[k])}\n`).join('');
    const copy = JSON.parse(JSON.stringify({ ...m, steps: stepsOf(m), every: everyOf(m), source: m.mode === 'flow' ? lead + sourceOf(m) : undefined }));
    delete copy.defaultSource;
    delete copy.inputs;
    delete copy.options;
    delete copy.shift;
    delete copy.defaultKey;
    delete copy.section;
    return save({ ...copy, id: null, builtin: false, name: `${m.name} (copy)`.slice(0, 60) });
  }

  // ---- running ----------------------------------------------------------------------------

  const ascending = () => CA.Ascension.inProgress();

  // ---- every macro is code ----------------------------------------------------------------------
  //
  // Whatever its kind, a macro runs as algorithmic code (the flow engine below). An Algorithmic
  // macro is its code; the other kinds are shortcuts for the common shapes, built from their settings:
  //   Repeat           forever: <steps>                       (every pass)
  //   When… (rise)     forever: wait until <c> · <steps> · wait until not <c>   (once each time it happens)
  //   When… (while)    forever: if <c>: <steps>               (every pass while it holds)
  //   Once             <steps>                                (one pass, when you run it)
  // Their "do" blocks carry their step's number, so each step still counts what it did (the cards).
  // A Group isn't code: it switches its members.

  /** A "When…" macro's conditions as code's condition tree: c1 and not c2 and … */
  function condTree(when) {
    const one = (c) => {
      const x = { t: 'cond', id: c.cond, params: { ...(c.params || {}) } };
      return c.not ? { t: 'not', a: x } : x;
    };
    return ((when && when.all) || []).map(one).reduce((a, b) => (a ? { t: 'and', a, b } : b), null) || { t: 'cmp', op: '<', l: { v: 'lit', x: 1 }, r: { v: 'lit', x: 0 } };
  }
  /** The code a Repeat / When… / Once macro amounts to, from its { mode, steps, when }. */
  function programFrom(def) {
    const steps = (def.steps || []).map((s, i) => ({ type: 'do', action: s.action, params: { ...(s.params || {}) }, step: i }));
    if (def.mode === 'repeat') return [{ type: 'forever', body: steps }];
    if (def.mode === 'when') {
      const cond = condTree(def.when);
      if (def.when && def.when.edge === 'while') return [{ type: 'forever', body: [{ type: 'if', cond, then: steps, else: [] }] }];
      return [{ type: 'forever', body: [{ type: 'wait', cond }, ...steps, { type: 'wait', cond: { t: 'not', a: cond } }] }];
    }
    return steps; // once (a group has none)
  }
  /** What a macro runs: an algorithm's compiled code, or what its settings amount to (its choices applied). */
  const programOf = (m) => (m.mode === 'flow' ? compiledOf(m).flow : m.mode === 'group' ? [] : programFrom({ mode: m.mode, steps: stepsOf(m), when: m.when }));
  /** Any macro as code — an algorithm's own, or what a Repeat / When… / Once macro's settings write out. */
  const codeOf = (m) => (m.mode === 'flow' ? sourceOf(m) : m.mode === 'group' ? '' : CA.Script.decompile(programOf(m)));
  /** The same for a macro being edited ({ mode, steps, when }). */
  const codeFor = (def) => (def.mode === 'group' ? '' : CA.Script.decompile(programFrom(def)));

  // ---- flows --------------------------------------------------------------------------------
  //
  // A flow is a list of blocks run in order; each block finishes now or waits for a later pass:
  //   { type: 'do', action, params }               runs the action once
  //   { type: 'wait', cond }                       waits until the condition holds
  //   { type: 'until', cond, body: [...] }         runs body (again each pass) until cond holds
  //   { type: 'if', cond, then: [...], else: [...] }   picks a branch when it gets there
  //   { type: 'parallel', branches: [[...], ...] } runs the branches side by side; done when all are
  //   { type: 'forever', body: [...] }             runs body again and again
  // (cond is { all: [{ cond, params, not }] }, like a "When…" macro's.) Every pass (the macro's
  // interval) advances each running branch as far as it can without waiting, but never repeats
  // a body twice in one pass, so nothing can spin. A flow that reaches its end switches itself off.

  const FLOW_TYPES = ['do', 'wait', 'until', 'if', 'parallel', 'forever', 'sleep', 'times', 'stop', 'log'];
  const MAX_FLOW_DEPTH = 12;
  function cleanCond(c) {
    const list = (c && Array.isArray(c.all) ? c.all : []).filter((x) => x && x.cond).map((x) => ({ cond: String(x.cond), params: x.params && typeof x.params === 'object' ? { ...x.params } : {}, not: !!x.not }));
    return { all: list.length ? list : [{ cond: 'buff', params: {}, not: false }] };
  }
  function cleanFlow(list, d = 0) {
    if (!Array.isArray(list) || d > MAX_FLOW_DEPTH) return [];
    return list
      .filter((n) => n && FLOW_TYPES.includes(n.type))
      .map((n) => {
        if (n.type === 'do') return { type: 'do', action: String(n.action || 'pop.golden'), params: n.params && typeof n.params === 'object' ? { ...n.params } : {} };
        if (n.type === 'wait') return { type: 'wait', cond: cleanCond(n.cond) };
        if (n.type === 'until') return { type: 'until', cond: cleanCond(n.cond), body: cleanFlow(n.body, d + 1) };
        if (n.type === 'if') return { type: 'if', cond: cleanCond(n.cond), then: cleanFlow(n.then, d + 1), else: cleanFlow(n.else, d + 1) };
        if (n.type === 'parallel') return { type: 'parallel', branches: (Array.isArray(n.branches) ? n.branches : [[], []]).slice(0, 8).map((b) => cleanFlow(b, d + 1)) };
        if (n.type === 'sleep') return { type: 'sleep', secs: Math.max(0, Number(n.secs) || 0) };
        if (n.type === 'times') return { type: 'times', n: Math.max(0, Math.floor(Number(n.n) || 0)), body: cleanFlow(n.body, d + 1) };
        if (n.type === 'stop') return { type: 'stop' };
        if (n.type === 'log') return { type: 'log', text: String(n.text || '') };
        return { type: 'forever', body: cleanFlow(n.body, d + 1) };
      });
  }

  /** An algorithmic macro's code: yours, or a built-in's (as you edited it, else its default). */
  const sourceOf = (m) => (m.sourceFrom ? String(m.sourceFrom() || '') : typeof m.source === 'string' ? m.source : (m.builtin && m.defaultSource) || '');
  /** Its code compiled: { flow, errors } (lines kept, for its status). */
  const compileCache = new Map(); // vars | source → { flow, errors }
  function compiledOf(m) {
    const vars = (m.inputs || []).map((i) => i.key);
    const src = sourceOf(m);
    const key = `${vars.join(',')}|${src}`;
    if (!compileCache.has(key)) {
      if (compileCache.size > 60) compileCache.clear();
      compileCache.set(key, CA.Script.compile(src, { vars }));
    }
    return compileCache.get(key);
  }
  /** An algorithmic built-in's inputs (its settings — variables in its code), with your choices. */
  function inputsOf(m) {
    const mine = (m && prefs[m.id] && prefs[m.id].inputs) || {};
    const out = {};
    // an input with get/set is a setting kept elsewhere (the Auto-gardener's layout and gardener)
    ((m && m.inputs) || []).forEach((i) => (out[i.key] = typeof i.get === 'function' ? i.get() : mine[i.key] !== undefined ? mine[i.key] : i.default));
    return out;
  }
  /** Sets one of its inputs — a running one sees it on its next pass. */
  function setInput(id, key, value) {
    const m = byId[id];
    const inp = m && (m.inputs || []).find((i) => i.key === key);
    if (!inp) return;
    if (typeof inp.set === 'function') {
      inp.set(value);
      if (running[id] && flowRuns[id]) flowRuns[id].vars[key] = value;
      changed(id);
      return;
    }
    const p = { ...(prefs[id] || {}) };
    p.inputs = { ...(p.inputs || {}), [key]: value };
    prefs[id] = p;
    if (running[id] && flowRuns[id]) flowRuns[id].vars[key] = value;
    changed(id);
  }
  /** The blocks a flow runs. */
  const flowOf = (m) => compiledOf(m).flow;
  /** Why a macro couldn't start or stopped by itself (code with a problem), else ''. */
  const problems = {};
  const problemOf = (id) => problems[id] || '';

  const flowRuns = {}; // id -> { prog, S (per-block state by path), at: [what it waits on], done, error }

  /** { ok, text } for a block's condition — the text says what it saw. */
  const check = (F, c) => CA.Script.evaluate(c, F.vars);
  const at = (F, n, text) => F.at.push(n.line ? `line ${n.line}: ${text}` : text);
  const EACH_MAX = 10000; // items a live list's loop goes through
  const logText = (v) => (v === undefined ? '(not set)' : Array.isArray(v) ? `[${v.join(', ')}]` : typeof v === 'number' ? CA.Format.beautify(v, Number.isInteger(v) ? 0 : 2) : String(v));

  /** A line in the flow's trace (the decisions it took), newest last, the last TRACE_MAX kept. */
  const TRACE_MAX = 40;
  function trace(F, n, text) {
    const last = F.trace[F.trace.length - 1];
    const entry = n.line ? `line ${n.line}: ${text}` : text;
    if (last && last.text === entry) return;
    F.trace.push({ t: Date.now(), text: entry, line: n.line || 0 });
    if (F.trace.length > TRACE_MAX) F.trace.shift();
  }
  function resetUnder(S, path) {
    Object.keys(S).forEach((k) => (k === path || k.startsWith(`${path}.`)) && delete S[k]);
  }
  function execSeq(F, nodes, path) {
    const st = F.S[path] || (F.S[path] = { i: 0 });
    while (st.i < nodes.length) {
      if (!execNode(F, nodes[st.i], `${path}.${st.i}`) || F.stopped) return false;
      st.i++;
    }
    return true;
  }
  function execNode(F, n, path) {
    switch (n.type) {
      case 'do': {
        const s = n.step != null && F.steps ? F.steps[n.step] : null; // a shortcut macro's step: its counts
        try {
          const k = CA.Actions.run(n.action, CA.Script.resolve(n.params, F.vars)) || 0;
          F.done += k;
          F.error = '';
          if (F.pass && k) trace(F, n, `${n.action}: ${k}`);
          if (k) (F.did || (F.did = [])).push({ action: n.action, params: CA.Script.resolve(n.params, F.vars), k });
          if (s) {
            s.runs++;
            s.last = k;
            if (k > 0) {
              s.total += k;
              s.lastAt = Date.now();
            }
            s.error = '';
          }
        } catch (e) {
          F.error = String((e && e.message) || e);
          if (s) s.error = F.error;
        }
        return true;
      }
      case 'wait': {
        const r = check(F, n.cond);
        if (r.ok) {
          trace(F, n, `waited until ${r.text}`);
          return true;
        }
        at(F, n, `waiting until ${r.text}`);
        return false;
      }
      case 'sleep': {
        const st = F.S[path] || (F.S[path] = { until: Date.now() + n.secs * 1000 });
        if (Date.now() >= st.until) return true;
        at(F, n, `waiting ${Math.ceil((st.until - Date.now()) / 1000)}s`);
        return false;
      }
      case 'until': {
        const r = check(F, n.cond);
        if (r.ok) {
          trace(F, n, `done: ${r.text}`);
          return true;
        }
        at(F, n, `until ${r.text}`);
        if (execSeq(F, n.body, `${path}.b`)) resetUnder(F.S, `${path}.b`);
        return false;
      }
      case 'times': {
        const st = F.S[path] || (F.S[path] = { k: 0 });
        if (st.k >= n.n) return true;
        at(F, n, `round ${st.k + 1} of ${n.n}`);
        if (execSeq(F, n.body, `${path}.b`)) {
          resetUnder(F.S, `${path}.b`);
          st.k++;
        }
        return st.k >= n.n;
      }
      case 'if': {
        let st = F.S[path];
        if (!st) {
          const r = check(F, n.cond);
          st = F.S[path] = { branch: r.ok ? 'then' : 'else' };
          trace(F, n, `if ${r.text} → ${r.ok ? 'yes' : n.else && n.else.length ? 'no: else' : 'no: skipped'}`);
        }
        return execSeq(F, n[st.branch] || [], `${path}.${st.branch}`);
      }
      case 'stop':
        trace(F, n, 'stop');
        F.stopped = true;
        return false;
      case 'log':
        trace(F, n, n.e ? logText(CA.Script.value(n.e, F.vars)) : n.text);
        return true;
      case 'set':
        F.vars[n.name] = n.cond ? check(F, n.cond).ok : CA.Script.value(n.e, F.vars);
        return true;
      case 'each': {
        // a live list: the items it has when the loop starts; as many as finish this pass
        let st = F.S[path];
        if (!st) {
          const list = CA.Script.value(n.list, F.vars);
          st = F.S[path] = { items: Array.isArray(list) ? list.slice(0, EACH_MAX) : [], k: 0 };
        }
        while (st.k < st.items.length) {
          F.vars[n.name] = st.items[st.k];
          if (!execSeq(F, n.body, `${path}.b`) || F.stopped) {
            at(F, n, `${n.name} = ${logText(st.items[st.k])} (${st.k + 1} of ${st.items.length})`);
            return false;
          }
          resetUnder(F.S, `${path}.b`);
          st.k++;
        }
        return true;
      }
      case 'parallel': {
        let all = true;
        n.branches.forEach((b, i) => {
          if (F.stopped) return;
          if (!execSeq(F, b, `${path}.p${i}`)) all = false;
        });
        return all;
      }
      case 'forever':
      default:
        if (execSeq(F, n.body || [], `${path}.b`)) resetUnder(F.S, `${path}.b`);
        at(F, n, 'repeating');
        return false;
    }
  }
  /** A pass-by-pass macro's tick: its code from the top, fresh (its last pass stays for its status). */
  function runFresh(m) {
    if (ascending() || depth >= MAX_DEPTH || (m.ready && !m.ready())) return;
    const { flow, errors } = compiledOf(m);
    if (errors.length) {
      problems[m.id] = `line ${errors[0].line}: ${errors[0].message}`;
      set(m.id, false, { silent: true });
      CA.Util.notify(m.name, `Stopped — ${CA.Util.escapeHtml(problems[m.id])}`, CA.ICON, 5);
      return;
    }
    const F = runPass(flow, status[m.id].steps, inputsOf(m));
    F.t = Date.now();
    flowRuns[m.id] = F;
    status[m.id].runs++;
    status[m.id].lastRun = F.t;
    if (F.done > 0) bump(m.id, F.done);
    remember(m.id, F);
    if (m.afterPass) m.afterPass(F);
  }

  function runFlow(m) {
    if (m.pass) return runFresh(m);
    passNo++;
    const F = flowRuns[m.id];
    if (!F || ascending() || depth >= MAX_DEPTH) return;
    F.at = [];
    const before = F.done;
    depth++;
    let finished = false;
    let failed = false;
    try {
      finished = execSeq(F, F.prog, 'r') || F.stopped;
    } catch (e) {
      failed = true;
      F.error = String((e && e.message) || e);
      console.error(`[cookieMgr] macro "${m.name}" stopped`, e);
    } finally {
      depth--;
    }
    status[m.id].runs++;
    status[m.id].lastRun = Date.now();
    if (F.done > before) bump(m.id, F.done - before);
    remember(m.id, F);
    if (failed) {
      problems[m.id] = F.error;
      set(m.id, false, { silent: true });
      CA.Util.notify(m.name, `Stopped — ${CA.Util.escapeHtml(F.error)}`, CA.ICON, 5);
      return;
    }
    if (finished) {
      set(m.id, false, { silent: true });
      if (CA.Settings.get('notifications')) CA.Util.notify(m.name, 'Finished — it got to the end of its flow.', CA.ICON, 3);
    }
  }
  /**
   * Runs compiled code once, from the top, as one pass (rules that are checked every second, like
   * a garden profile's). Returns { done, at, trace, error } — what it did and where it stopped.
   */
  // passes, numbered: a feature can keep something for the length of one pass (passKey(); null outside one)
  let passNo = 0;
  const passKey = () => (depth > 0 ? passNo : null);
  function runPass(prog, steps, vars) {
    passNo++;
    const F = { prog, S: {}, at: [], trace: [], done: 0, error: '', stopped: false, pass: true, steps, vars: { ...(vars || {}) } };
    if (depth >= MAX_DEPTH) return F;
    depth++;
    try {
      execSeq(F, prog, 'r');
    } finally {
      depth--;
    }
    return F;
  }

  /** Where a running flow is: { at: ['until Christmas is complete', …], done, error }. */
  const flowStatus = (id) =>
    flowRuns[id]
      ? {
          at: flowRuns[id].at.slice(),
          // the lines it's on right now (for the editor's gutter)
          lines: flowRuns[id].pass ? flowRuns[id].trace.map((x) => x.line).filter(Boolean) : flowRuns[id].at.map((a) => Number((a.match(/^line (\d+):/) || [])[1])).filter(Boolean),
          t: flowRuns[id].t || 0,
          trace: flowRuns[id].trace.slice(),
          done: flowRuns[id].done,
          error: flowRuns[id].error,
        }
      : null;

  function tick(m) {
    if (running[m.id]) runFlow(m);
  }

  /** Starts a macro's timer; false when it can't run (code with a problem: problemOf(id) says why). */
  function start(id) {
    const m = byId[id];
    if (!m || m.mode === 'once' || running[id]) return false;
    let prog;
    if (m.mode === 'flow') {
      const { flow, errors } = compiledOf(m);
      if (errors.length) {
        problems[id] = `line ${errors[0].line}: ${errors[0].message}`;
        return false;
      }
      prog = flow;
    } else prog = programOf(m);
    flowRuns[id] = { prog, S: {}, at: [], trace: [], done: 0, error: '', stopped: false, steps: status[id].steps, vars: inputsOf(m) };
    delete problems[id];
    running[id] = { since: Date.now(), timer: setInterval(() => tick(m), everyOf(m)) };
    return true;
  }

  function stop(id) {
    const r = running[id];
    if (!r) return;
    clearInterval(r.timer);
    delete running[id];
  }

  function announce(m, on) {
    if (!CA.Settings.get('notifications')) return;
    const icon = m.icon && m.icon.sprite ? m.icon.sprite : CA.ICON;
    CA.Util.notify(m.name, on ? '<b style="color:#8f8">ON</b>' : '<b style="color:#f88">OFF</b>', icon, 2);
  }

  function changed(id) {
    CA.Events.emit('macros', id);
  }

  /** A group's members that exist and can be switched (no once macros, no other groups). */
  const membersOf = (m) => (m && m.mode === 'group' ? [...new Set(m.members.map(rid))].map((id) => byId[id]).filter((x) => x && x.mode !== 'once' && x.mode !== 'group') : []);

  /** Turns a repeat/when macro — or every member of a group — on or off. */
  function set(id, on, { silent = false } = {}) {
    id = rid(id);
    const m = byId[id];
    if (!m || m.mode === 'once') return;
    on = !!on;
    if (m.mode === 'group') {
      const members = membersOf(m);
      if (!members.length || (isOn(id) === on && members.every((x) => isOn(x.id) === on))) return;
      members.forEach((x) => set(x.id, on, { silent: true }));
      if (!silent) announce(m, on);
      changed(id);
      return;
    }
    if (isOn(id) === on) return;
    if (on && !start(id)) {
      CA.Util.notify(m.name, `Can’t start — ${CA.Util.escapeHtml(problems[id] || 'its code has a problem')}. Edit it to fix that.`, CA.ICON, 5);
      changed(id);
      return;
    }
    if (!on) stop(id);
    if (!silent) announce(m, on);
    changed(id);
  }

  const toggle = (id) => set(id, !isOn(id));

  /** Runs a macro's steps one time right now (any mode). Returns how many things it did. */
  function runOnce(id) {
    id = rid(id);
    const m = byId[id];
    if (!m || m.mode === 'group' || ascending()) return 0;
    // its steps once (an algorithm: one pass of its code)
    const prog = m.mode === 'flow' ? compiledOf(m).flow : programFrom({ mode: 'once', steps: stepsOf(m) });
    const F = runPass(prog, status[id].steps, inputsOf(m));
    status[id].runs++;
    status[id].lastRun = Date.now();
    if (F.done > 0) bump(id, F.done);
    changed(id);
    return F.done;
  }

  /** What a hotkey or shortcut button does: once macros run, the others switch on/off. */
  function trigger(id) {
    id = rid(id);
    const m = byId[id];
    if (!m) return;
    if (m.mode === 'once') runOnce(id);
    else toggle(id);
  }

  // ---- queries --------------------------------------------------------------------------------

  function isOn(id) {
    id = rid(id);
    const m = byId[id];
    if (m && m.mode === 'group') {
      const members = membersOf(m);
      return members.length > 0 && members.every((x) => !!running[x.id]);
    }
    return !!running[id];
  }
  const list = () => macros.slice();
  const get = (id) => byId[rid(id)] || null;
  const activeCount = () => Object.keys(running).length;
  const runningIds = () => Object.keys(running);
  const statusOf = (id) => status[id] || null;
  const since = (id) => (running[id] ? running[id].since : 0);
  /** Keeps the actions a run did (F.did) as the macro's latest, and empties F.did for its next run. */
  function remember(id, F) {
    if (!F.did || !F.did.length) return;
    const t = Date.now();
    recentDone[id] = F.did
      .slice()
      .reverse()
      .map((x) => ({ t, ...x }))
      .concat(recentDone[id] || [])
      .slice(0, RECENT_MAX);
    F.did = [];
  }
  /** The last things a macro did, newest first: [{ t, action, params, k }] (a group: its members' together). */
  function recent(id) {
    const m = byId[rid(id)];
    if (m && m.mode === 'group') return [].concat(...membersOf(m).map((x) => recent(x.id))).sort((a, b) => b.t - a.t).slice(0, RECENT_MAX);
    return (recentDone[rid(id)] || []).slice();
  }
  function bump(id, n) {
    const now = Date.now();
    const a = activity[id] || { h: 0, t: now };
    a.h = a.h * Math.exp(-(now - a.t) / 1000 / ACTIVITY_S) + n;
    a.t = now;
    activity[id] = a;
  }
  /** Things done per second lately (a group: its members together). */
  function rate(id) {
    const m = byId[id];
    if (m && m.mode === 'group') return membersOf(m).reduce((s, x) => s + rate(x.id), 0);
    const a = activity[id];
    return a ? (a.h * Math.exp(-(Date.now() - a.t) / 1000 / ACTIVITY_S)) / ACTIVITY_S : 0;
  }
  /** rate() in six bands (0 idle … 5 many per second), for the activity ring on macro buttons. */
  function activityLevel(id) {
    const r = rate(id);
    return r < 0.0005 ? 0 : r < 0.01 ? 1 : r < 0.1 ? 2 : r < 1 ? 3 : r < 10 ? 4 : 5;
  }

  /** A macro's steps with the choices you made on a built-in's row applied. */
  function stepsOf(m) {
    const chosen = (prefs[m.id] && prefs[m.id].params) || {};
    if (!m.options || !m.options.length) return m.steps;
    return m.steps.map((s, i) => {
      const own = {};
      m.options.forEach((o) => o.step === i && chosen[`${i}.${o.key}`] !== undefined && (own[o.key] = chosen[`${i}.${o.key}`]));
      return Object.keys(own).length ? { ...s, params: { ...s.params, ...own } } : s;
    });
  }
  /** How often a macro runs (ms): a built-in's interval can be changed in its settings. */
  const everyOf = (m) => (m.builtin && prefs[m.id] && prefs[m.id].every >= MIN_EVERY ? prefs[m.id].every : m.every);
  /** Sets a built-in's interval (restarting it if it's running). */
  function setEvery(id, ms) {
    const m = byId[id];
    if (!m || !m.builtin || m.mode === 'once' || m.mode === 'group') return;
    prefs[id] = { ...(prefs[id] || {}), every: Math.max(MIN_EVERY, Math.round(ms)) };
    if (running[id]) {
      stop(id);
      start(id);
    }
    changed(id);
  }
  /** Flips a built-in's shift-click setting; returns the new value (or null if it has none). */
  function shiftToggle(id) {
    const m = byId[id];
    if (!m || !m.shift) return null;
    const now = shiftValue(id);
    if (m.shift.input) setInput(id, m.shift.input, !now);
    else setParam(id, m.shift.step, m.shift.key, !now);
    return !now;
  }
  /** The current value of a built-in's shift-click setting. */
  function shiftValue(id) {
    const m = byId[id];
    if (!m || !m.shift) return null;
    if (m.shift.input) return !!inputsOf(m)[m.shift.input];
    const step = stepsOf(m)[m.shift.step];
    return !!CA.Actions.paramsFor(step.action, step.params)[m.shift.key];
  }

  /** Sets one of a built-in's row choices (one of its `options`). */
  function setParam(id, step, key, value) {
    const m = byId[id];
    if (!m || !(m.options || []).some((o) => o.step === step && o.key === key)) return;
    const p = { ...(prefs[id] || {}) };
    p.params = { ...(p.params || {}), [`${step}.${key}`]: value };
    prefs[id] = p;
    if (running[id] && flowRuns[id] && m.mode !== 'flow') flowRuns[id].prog = programOf(m);
    changed(id);
  }
  const isFav = (id) => !!(prefs[id] && prefs[id].fav);
  function setFav(id, on) {
    if (!byId[id]) return;
    prefs[id] = { ...(prefs[id] || {}), fav: !!on };
    changed(id);
  }

  /** Human summary of when a macro runs: "every 0.1s", "when Click frenzy is active", "on demand". */
  function triggerText(m) {
    const secs = (ms) => (ms < 1000 ? `${ms / 1000}s` : `${Math.round(ms / 100) / 10}s`);
    if (m.mode === 'once') return 'on demand';
    if (m.mode === 'group') return `group of ${membersOf(m).length}`;
    if (m.mode === 'repeat') return `every ${secs(everyOf(m))}`;
    if (m.mode === 'flow') return `flow · every ${secs(everyOf(m))}`;
    return `${m.when.edge === 'while' ? 'while' : 'when'} ${CA.Conditions.describe(m.when)}`;
  }

  // ---- save / load ---------------------------------------------------------------------------

  function serialize() {
    return {
      custom: macros.filter((m) => !m.builtin).map(({ builtin, ...rest }) => rest),
      prefs: { ...prefs },
    };
  }

  /** Loads your macros and preferences from a save (replacing the ones defined now). */
  function load(data) {
    if (!data || typeof data !== 'object') return;
    macros.filter((m) => !m.builtin).forEach((m) => remove(m.id));
    (Array.isArray(data.custom) ? data.custom : []).forEach((d) => {
      if (d && d.id && !(byId[d.id] && byId[d.id].builtin)) add({ ...d, builtin: false });
    });
    prefs = data.prefs && typeof data.prefs === 'object' ? { ...data.prefs } : {};
    // before v2.28: a built-in's edited code in prefs.source, and v2.22's flow settings in prefs.flow
    Object.keys(prefs).forEach((id) => {
      const p = prefs[id];
      if (!p || typeof p !== 'object') return delete prefs[id];
      if (typeof p.source === 'string') p.custom = { ...(p.custom || {}), source: p.source };
      delete p.source;
      delete p.flow;
      if (p.custom && typeof p.custom === 'object') delete p.custom.flow;
      const base = baseDefs[id];
      if (base && Array.isArray(base.inputs) && p.params && typeof p.params === 'object') {
        Object.keys(p.params).forEach((k) => {
          const key = k.split('.')[1];
          if (base.inputs.some((i) => i.key === key) && !(p.inputs && key in p.inputs)) p.inputs = { ...(p.inputs || {}), [key]: p.params[k] };
        });
      }
    });
    // your versions of the built-ins (and back to the originals where you had none)
    Object.keys(baseDefs).forEach((id) => {
      if ((prefs[id] && prefs[id].custom) || (byId[id] && byId[id].customized)) applyBuiltin(id);
    });
    changed(null);
  }

  /** Turns on the macros that were running when the game was saved (rememberStates). */
  function restore(ids) {
    (ids || []).forEach((id) => set(id, true, { silent: true }));
  }

  /** Once every feature has started: built-ins' row choices can use any action now. */
  function ready() {
    Object.keys(baseDefs).forEach((id) => {
      const m = byId[id];
      if (m && !(baseDefs[id].options || baseDefs[id].spell || baseDefs[id].noOptions)) applyBuiltin(id);
    });
  }

  function init() {
    BUILTINS.forEach((d) => addBuiltin(d));
    CA.Settings.registerSection('macros', { serialize, load, event: 'macros' });
    // which were running (when "Remember on/off states" is on) — v1.x saved { clickers: { id: true }, stockTrader }
    CA.Settings.registerSection('running', {
      serialize: () => (CA.Settings.get('rememberStates') ? runningIds() : undefined),
      load(ids, whole) {
        if (!CA.Settings.get('rememberStates')) return;
        if (Array.isArray(ids)) return restore(ids);
        const legacy = Object.keys((whole && whole.clickers) || {}).filter((id) => whole.clickers[id] === true);
        if (whole && whole.stockTrader === true) legacy.push('stockTrader');
        restore(legacy);
      },
    });

    CA.Settings.defineOption({
      key: 'disableOnAscend',
      icon: 'ascend',
      group: 'macros',
      name: 'Turn off when ascending',
      desc: 'Switches every running macro off as soon as you ascend.',
      default: true,
    });
    CA.Settings.defineOption({
      key: 'rememberStates',
      icon: 'save',
      group: 'macros',
      name: 'Remember on/off states',
      desc: 'Restores which macros were running when you reload the game.',
      default: false,
    });
    CA.Settings.defineOption({
      key: 'notifications',
      icon: 'bell',
      group: 'macros',
      name: 'Macro on/off notifications',
      desc: 'Shows a small ON/OFF popup whenever a macro is switched.',
      default: true,
    });

    CA.Events.on('ascend', () => {
      if (!CA.Settings.get('disableOnAscend')) return;
      const stopping = runningIds();
      if (!stopping.length) return;
      stopping.forEach((id) => set(id, false, { silent: true }));
      CA.Util.notify('cookieMgr', 'Your macros were turned off for your ascension.', [20, 7], 4);
    });
  }

  // what a macro id means in code (switch on bigCookie, macro.set(golden)…): the code editors' hover cards
  CA.Words.defineKind('macro', {
    name: 'Macro',
    info: (id) => {
      const m = get(id) || macros.find((x) => x.name.toLowerCase() === String(id).toLowerCase());
      if (!m) return null;
      return {
        title: m.name,
        sig: m.id,
        desc: m.desc || '',
        rows: [
          ['runs', triggerText(m)],
          m.mode === 'once' ? null : ['now', isOn(m.id) ? 'on' : 'off'],
          m.mode === 'group' ? ['switches', membersOf(m).map((x) => x.id).join(', ')] : null,
        ].filter(Boolean),
        note: m.builtin ? 'A built-in macro (Macros page).' : 'One of your macros (Macros page).',
      };
    },
  });

  return {
    init,
    ready,
    list,
    get,
    addBuiltin,
    rename,
    save,
    remove,
    duplicate,
    set,
    toggle,
    trigger,
    runOnce,
    isOn,
    since,
    activeCount,
    runningIds,
    status: statusOf,
    membersOf,
    isFav,
    setFav,
    customize,
    revert,
    isCustomized,
    stepsOf,
    setParam,
    everyOf,
    setEvery,
    shiftToggle,
    shiftValue,
    flowOf,
    compiledOf,
    passKey,
    inputsOf,
    setInput,
    programOf,
    codeOf,
    codeFor,
    problemOf,
    sourceOf,
    flowStatus,
    runPass,
    rate,
    recent,
    activityLevel,
    triggerText,
    serialize,
    load,
    restore,
    MIN_EVERY,
  };
})();
