// Statistics: named bits of algorithmic code (features/script.js) that work out one thing to show —
// the lines under the store's tooltips (ui/storeInsight.js) are statistics, and so are yours.
//
//   a statistic   { id, key, label, desc, scope, format, color, source, group, warn }
//                 scope: 'building' | 'upgrade' | 'item' (either) | 'game' — what it's about; in a
//                 statistic about an item, `item` is the name of the building / upgrade, and the
//                 item.* words read it (its price, what it adds, its payback period…)
//                 source: code compiled as a statistic — it reads, never acts, and ends with
//                 `return <value>` (no return, or "": nothing to show). It may set `label` (the line's
//                 label instead of its own), `note` (small print after the value) and `color` (a
//                 payback color for the value — or a list of them, one per item of a list)
//                 format: how the value reads — auto, number, time, chance, payback, text, upgrade
//                 (an upgrade's name: its icon and name, its info card on hover — ui/upgradeTip.js)
//                 color: 'payback' — the value in the item's payback color; or one color (red…)
//                 group: the catalog's shelf (GROUPS: Payback, Production, Achievements, Upgrades, Bank)
//                 warn: a warning, not a line — when it has something to show about an item, the
//                 item gets a "!" in the store in its color (red when it has none) and a tag in the
//                 tooltip's ⚠ line (ui/storeInsight.js: which warnings, in what order)
//   built-ins     the lines cookieMgr shows, written in the language like any other (BUILTINS)
//   yours         saved in the "stats" part of the save: { v, mine: [statistic…], builtin: { id:
//                 { label, source, format, color } } (your changes to a built-in), favs: [id…] }
//
// Every statistic is a value word too — stat.<key>(item) (or stat.<key>() for one about the game) —
// so macros and other statistics can use it. Formatting words (fmt.number(x), fmt.time(s)…) build
// text; finite(x) and known(x) are yes / no.
//
// bestOf(scope) is the best item to show one about (the Tooltips page's cards, a Statistic widget
// set to "the best"); about(c, fn) runs fn with the item words about c. toText / fromText: one as
// text to share (a few "# field: value" lines, then the code).
//
// Nothing here reads the seed: statistics see what the value words see.

CA.Stats = (() => {
  const F = () => CA.Format;
  const esc = (s) => CA.Util.escapeHtml(s);
  const COLORS = ['blue', 'green', 'yellow', 'orange', 'red', 'purple', 'gray'];
  const SCOPES = ['building', 'upgrade', 'item', 'game'];
  const FORMATS = [
    { id: 'auto', name: 'as it reads', desc: 'a time for seconds, a chance for 0–1, else a number' },
    { id: 'number', name: 'number' },
    { id: 'time', name: 'time (seconds)' },
    { id: 'chance', name: 'chance (0–1)' },
    { id: 'payback', name: 'payback period', desc: 'seconds, in time units (45s, 3h 12m) or plain seconds as the Payback page sets, ∞ when it never pays back' },
    { id: 'text', name: 'text', desc: 'as written (numbers as numbers)' },
    { id: 'upgrade', name: 'an upgrade', desc: 'an upgrade’s name: its icon and name, its info on hover' },
  ];
  const MAX_DEPTH = 8;
  /** The catalog's groups (a statistic of yours keeps the group of the one it was duplicated from). */
  const GROUPS = ['Payback', 'Payback modes', 'Production', 'Achievements', 'Upgrades', 'Bank'];

  // ---- the built-ins: Cookie Monster's lines -----------------------------------------------------

  const BUILTINS = [
    {
      id: 'bonus',
      group: 'Production',
      name: 'Bonus income',
      label: 'Bonus income',
      desc: 'the raw CpS it adds (no golden cookie effects), and its share of your raw CpS',
      scope: 'item',
      format: 'text',
      source: `# the raw CpS it adds, and what share of your raw CpS that is
gain = item.rawGain()
if item.kind() == "upgrade" and gain == 0:
  return
sign = ""
if item.kind() == "building":
  label = "Bonus income (×" + item.bulk() + ")"
  sign = "+"
elif gain > 0:
  sign = "+"
share = ""
if rawCps() > 0:
  share = " (" + fmt.pct(gain / rawCps(), 2) + ")"
return sign + fmt.number(gain) + "/s" + share`,
    },
    {
      id: 'click',
      group: 'Production',
      name: 'Income per click',
      label: 'Income',
      desc: 'what a clicking upgrade adds to a click, and (in parentheses) the income it adds at your clicking',
      scope: 'upgrade',
      format: 'text',
      source: `# how much more a click makes, then the income that is at your clicking
m = item.clickGain()
if m > 0:
  more = "+" + fmt.number(m) + " per click"
  if payback.perClick() > 0:
    r = m / payback.perClick()
    more = "+" + fmt.pct(r, 1) + " per click"
    if r >= 10:
      more = "+" + fmt.number(r * 100) + "% per click"
  return more + " (+" + fmt.number(m * clickRate()) + "/s)"`,
    },
    {
      id: 'actualGain',
      group: 'Production',
      name: 'Income, actual income',
      label: 'Income, actual income',
      desc: 'what it adds to what you’ve really been taking in: its bonus income (and a clicking upgrade’s clicks) scaled by your actual income over the Payback page’s Actual income window (once a minute of play is recorded)',
      scope: 'item',
      format: 'text',
      source: `g = item.gainIn("actual")
if known(g) and g > 0:
  return "+" + fmt.number(g) + "/s"`,
    },
    { id: 'payback', group: 'Payback', name: 'Payback period', label: 'Payback period', desc: 'in the payback mode in use, in its payback color', scope: 'item', format: 'payback', color: 'payback', source: 'return item.payback()' },
    {
      id: 'actual',
      group: 'Payback',
      name: 'Payback period, actual income',
      label: 'Payback period, actual income',
      desc: 'the payback period by what you’ve really been taking in over the Payback page’s Actual income window (once a minute of play is recorded)',
      scope: 'item',
      format: 'payback',
      source: `a = item.paybackIn("actual")
if known(a):
  return a`,
    },
    // ---- the payback modes (features/payback.js): what payback periods count in. A mode's code sets
    // `income` (cookies a second) and returns what the item adds to it.
    {
      id: 'rawCps',
      group: 'Payback modes',
      mode: true,
      name: 'Raw CpS',
      label: 'Raw CpS',
      desc: 'Payback periods count in your raw CpS — what you make with no golden cookie effects, golden switch or Dragon’s Fortune: steady, whatever is running now. A purchase’s gain is what it adds to that.',
      scope: 'item',
      format: 'number',
      source: `# a payback mode: income is what payback periods count in, the return what the item adds to it
# the game's raw CpS: no golden cookie effects, golden switch or Dragon's Fortune
income = rawCps()
gain = item.rawGain()
# an upgrade that makes clicks stronger: its clicks at your click rate, without the buffs
if item.kind() == "upgrade" and item.clickGain() > 0 and cps() > 0:
  gain = gain + item.clickGain() * clickRate() * rawCps() / cps()
return gain`,
    },
    {
      id: 'cps',
      group: 'Payback modes',
      mode: true,
      name: 'CpS',
      label: 'CpS',
      desc: 'Payback periods count in the CpS the game shows now, buffs included (a Frenzy shrinks every payback period alike) — Cookie Monster’s way. An upgrade that makes clicks stronger counts its clicks at your click rate.',
      scope: 'item',
      format: 'number',
      source: `# a payback mode: income is what payback periods count in, the return what the item adds to it
# the CpS the game shows now, buffs included (Cookie Monster's)
income = cps()
gain = item.gain()
# an upgrade that makes clicks stronger: its clicks at your click rate (the last 10 seconds)
if item.kind() == "upgrade" and item.clickGain() > 0:
  gain = gain + item.clickGain() * clickRate()
return gain`,
    },
    {
      id: 'cpsClicking',
      group: 'Payback modes',
      mode: true,
      name: 'CpS + clicking',
      label: 'CpS + clicking',
      desc: 'Payback periods count in your CpS plus your clicking: your clicks a second (averaged over the last minute, or what the option says) × what a click is worth. A purchase’s gain is the CpS it adds plus what it adds to your clicks.',
      scope: 'item',
      format: 'number',
      source: `# a payback mode: income is what payback periods count in, the return what the item adds to it
# your CpS plus your clicking: clicks a second (over the option's window) × what a click is worth
rate = payback.clickRate()
income = cps() + rate * payback.perClick()
return item.gain() + item.clickGain() * rate`,
    },
    {
      id: 'actualIncome',
      group: 'Payback modes',
      mode: true,
      name: 'Actual income',
      label: 'Actual income',
      desc: 'Payback periods count in what you’ve actually been taking in — everything baked: production, clicking, golden cookies, wrinklers — averaged over the Payback page’s Actual income window (30 minutes at first; 15 min, 30 min, 1 h, 3 h or any time up to a day), projected forward. A purchase’s gain scales the same way: what it adds to your raw CpS × your actual income ÷ your raw CpS. Needs a minute of play recorded (until then CpS); with less than the window recorded, it averages what there is.',
      scope: 'item',
      format: 'number',
      source: `# a payback mode: income is what payback periods count in, the return what the item adds to it
# what you actually took in (everything baked) over the Actual income window, projected forward
a = payback.actualIncome()
if not known(a) or rawCps() <= 0:
  return
income = a
# what it adds scales the same way: its raw gain × actual ÷ raw CpS
gain = item.rawGain()
if item.kind() == "upgrade" and item.clickGain() > 0 and cps() > 0:
  gain = gain + item.clickGain() * clickRate() * rawCps() / cps()
return gain * a / rawCps()`,
    },
    {
      id: 'paybackRaw',
      group: 'Payback',
      name: 'Payback, raw CpS',
      label: 'Payback period',
      desc: 'the payback period by your raw CpS (no golden cookie effects) — in its payback color while the payback mode is Raw CpS',
      scope: 'item',
      format: 'payback',
      source: `p = item.paybackIn("raw")
if payback.mode() == "rawCps":
  color = item.color()
return p`,
    },
    { id: 'paybackCps', group: 'Payback', name: 'Payback, CpS', label: 'Payback, CpS', desc: 'the payback period by the CpS the game shows (Cookie Monster’s)', scope: 'item', format: 'payback', source: 'return item.paybackIn("cps")' },
    { id: 'paybackClicking', group: 'Payback', name: 'Payback, CpS + clicking', label: 'Payback, CpS + clicking', desc: 'the payback period by your CpS plus your clicking', scope: 'item', format: 'payback', source: 'return item.paybackIn("clicking")' },
    {
      id: 'paybackModes',
      group: 'Payback',
      name: 'Payback in every mode',
      label: 'Payback raw / CpS / click / actual',
      desc: 'the payback period in each payback mode: raw CpS, CpS, CpS + clicking, actual income',
      scope: 'item',
      format: 'payback',
      source: `return [item.paybackIn("raw"), item.paybackIn("cps"), item.paybackIn("clicking"), item.paybackIn("actual")]`,
    },
    {
      id: 'paybackParts',
      group: 'Payback',
      name: 'Payback, its parts',
      label: 'Afford + earn back',
      desc: 'the payback period’s two parts: the time to afford it, plus the time to earn its price back',
      scope: 'item',
      format: 'text',
      source: `# payback period = time to afford + price ÷ gain, at your income in the payback mode in use
a = item.timeToAfford()
e = item.earnBack()
if not finite(e):
  return "never pays back"
w = "now"
if a > 0:
  w = fmt.time(a)
if not finite(a):
  w = "never"
return w + " + " + fmt.time(e)`,
    },
    {
      id: 'income',
      group: 'Payback',
      name: 'Payback income',
      label: 'Income',
      desc: 'what payback periods count in now: your income in the payback mode in use',
      scope: 'game',
      format: 'text',
      source: `label = "Income (" + payback.mode() + ")"
return fmt.number(payback.income()) + "/s"`,
    },
    {
      id: 'bulks',
      group: 'Payback',
      name: 'Payback ×1 / ×10 / ×100',
      label: 'Payback ×1 / 10 / 100',
      desc: 'the payback period of one, ten and a hundred more, each in its color',
      scope: 'building',
      format: 'payback',
      source: `color = [item.colorOf(1), item.colorOf(10), item.colorOf(100)]
return [item.paybackOf(1), item.paybackOf(10), item.paybackOf(100)]`,
    },
    {
      id: 'price',
      group: 'Bank',
      name: 'Price',
      label: 'Price',
      desc: 'what it costs (what a click buys) — green when you can afford it, red when not',
      scope: 'item',
      format: 'number',
      source: `color = "red"
if timeTo(item.price()) <= 0:
  color = "green"
return item.price()`,
    },
    {
      id: 'afford',
      group: 'Bank',
      name: 'Affordable',
      label: 'Affordable',
      desc: 'when you can afford it at your CpS — green when you can now, red when not',
      scope: 'item',
      format: 'text',
      source: `s = timeTo(item.price())
if s <= 0:
  color = "green"
  return "now"
color = "red"
if finite(s):
  return fmt.time(s)
return "not at this CpS"`,
    },
    { id: 'share', group: 'Production', name: 'Share of production', label: 'Share of production', desc: 'what share of your CpS the building makes', scope: 'building', format: 'text', source: 'return fmt.pct(item.share(), 2)' },
    {
      id: 'next',
      group: 'Achievements',
      name: 'Next achievement',
      label: 'Next achievement',
      desc: 'how many more win the next achievement, and for how much — in the payback color of buying that many',
      scope: 'building',
      format: 'text',
      source: `n = building.toNextAchievement(item)
if n > 100:
  return "none within 100"
# buying that many, the achievement's milk counted: is its payback period good enough?
color = item.colorOf(n)
return n + " more (" + fmt.number(building.priceOf(item, n)) + ")"`,
    },
    {
      id: 'nextUpgrade',
      group: 'Upgrades',
      name: 'Next upgrade',
      label: 'Next upgrade',
      desc: 'the next upgrade buying more of the building unlocks, how many more that takes, and for how much',
      scope: 'building',
      format: 'upgrade',
      source: `u = building.nextUpgrade(item)
if u == "":
  return
n = building.toNextUpgrade(item)
note = n + " more (" + fmt.number(building.priceOf(item, n)) + ")"
return u`,
    },
    { id: 'wins', group: 'Achievements', name: 'Wins', label: 'Wins', desc: 'the achievements buying it wins, in its payback color', scope: 'item', format: 'text', color: 'payback', source: 'return item.wins()' },
    // the bank warnings: buying it would take your bank below what a golden cookie (or a spell) needs
    // to pay its most — only when you have that bank now; keep: how many times that bank to keep
    ...[
      ['warnLucky', 'Lucky! bank', 'a Lucky!', 'bank.lucky', 'red'],
      ['warnConjure', 'Conjure bank', 'Conjure Baked Goods', 'bank.conjure', 'orange'],
      ['warnFrenzy', 'Frenzy Lucky! bank', 'a Lucky! in a Frenzy', 'bank.luckyFrenzy', 'yellow'],
    ].map(([id, label, what, word, color]) => ({
      id,
      group: 'Bank',
      name: label,
      label,
      desc: `warns when buying it would take your bank below what ${what} needs to pay its most, and by how much`,
      scope: 'item',
      format: 'text',
      color,
      warn: true,
      source: `# a warning when buying it takes your bank below what ${what} needs
keep = 1   # times that bank
need = ${word}() * keep
after = cookies() - item.price()
if cookies() >= need and after < need:
  return "−" + fmt.number(need - after)`,
    })),
  ].map((b) => ({ ...b, key: b.id, builtin: true, color: b.color || 'none' }));
  const BUILTIN = Object.fromEntries(BUILTINS.map((b) => [b.id, b]));

  // ---- yours ---------------------------------------------------------------------------------

  let mine = [];
  let overrides = {}; // your changes to built-ins
  let favs = [];

  const OVERRIDABLE = ['label', 'source', 'format', 'color'];
  /** A built-in as you have it (your changes on top). */
  function builtinAsIs(b) {
    const o = overrides[b.id];
    if (!o) return b;
    const out = { ...b, customized: true };
    OVERRIDABLE.forEach((k) => typeof o[k] === 'string' && (out[k] = o[k]));
    return out;
  }

  /** Every statistic: the built-ins (as you have them), then yours. */
  const all = () => BUILTINS.map(builtinAsIs).concat(mine);
  const get = (id) => (BUILTIN[id] ? builtinAsIs(BUILTIN[id]) : mine.find((s) => s.id === id) || null);
  const byKey = (key) => all().find((s) => s.key === key) || null;

  const KEY = /^[A-Za-z_]\w*$/;
  /** A label as a code name: "Price in CpS" → priceInCps. */
  const camel = (label) =>
    String(label)
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean)
      .map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase()))
      .join('')
      .replace(/^[0-9]+/, '') || 'statistic';
  function clean(def, old) {
    const s = { ...(old || {}), ...def };
    s.label = String(s.label || s.key || 'Statistic').slice(0, 80);
    s.key = KEY.test(String(s.key || '')) ? String(s.key) : camel(s.label);
    s.desc = String(s.desc || '');
    s.scope = SCOPES.includes(s.scope) ? s.scope : 'item';
    s.format = FORMATS.some((f) => f.id === s.format) ? s.format : 'auto';
    if (s.color === undefined && s.colour !== undefined) s.color = s.colour; // the old British field name (saves, shared text)
    delete s.colour;
    s.color = s.color === 'payback' || COLORS.includes(s.color) ? s.color : 'none';
    s.source = String(s.source || '');
    s.group = GROUPS.includes(s.group) ? s.group : '';
    s.warn = (s.warn === true || s.warn === 'yes' || s.warn === 'true') && s.scope !== 'game';
    // a payback mode (features/payback.js): about an item, never a warning too
    s.mode = (s.mode === true || s.mode === 'yes' || s.mode === 'true') && !s.warn;
    if (s.mode && s.scope === 'game') s.scope = 'item';
    return s;
  }
  /** A key no other statistic has: paybackVsBest, paybackVsBest2… */
  function freeKey(key, id) {
    let k = key;
    for (let i = 2; all().some((s) => s.key === k && s.id !== id); i++) k = `${key}${i}`;
    return k;
  }

  const changed = () => {
    cache.clear();
    CA.Events.emit('stats');
  };

  /** Adds one of yours: the statistic, with its id. */
  function add(def) {
    const s = clean(def);
    s.id = `st_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    s.key = freeKey(s.key, s.id);
    mine.push(s);
    defineWord(s);
    changed();
    return s;
  }
  /** Changes one of yours (or a built-in: your version of it, kept beside the original). */
  function update(id, patch) {
    if (BUILTIN[id]) {
      const o = { ...(overrides[id] || {}) };
      OVERRIDABLE.forEach((k) => patch[k] !== undefined && (o[k] = String(patch[k])));
      overrides[id] = o;
      changed();
      return get(id);
    }
    const i = mine.findIndex((s) => s.id === id);
    if (i < 0) return null;
    const old = mine[i];
    const s = clean(patch, old);
    s.id = id;
    s.key = freeKey(s.key, id);
    CA.Script.removeValue(`stat.${old.key}`);
    mine[i] = s;
    defineWord(s);
    changed();
    return s;
  }
  /** Deletes one of yours; a built-in goes back to how it came. */
  function remove(id) {
    if (BUILTIN[id]) {
      delete overrides[id];
      return changed();
    }
    const s = mine.find((x) => x.id === id);
    if (!s) return;
    mine = mine.filter((x) => x !== s);
    favs = favs.filter((x) => x !== id);
    CA.Script.removeValue(`stat.${s.key}`);
    changed();
  }

  /** A copy of any statistic, yours to change: "Payback period (copy)". */
  function duplicate(id) {
    const s = get(id);
    if (!s) return null;
    const { label, desc, scope, format, color, source, group, warn, mode } = s;
    return add({ label: `${label} (copy)`, desc, scope, format, color, source, group, warn, mode });
  }

  // ---- running one ------------------------------------------------------------------------------
  //
  // A context: what a statistic is about — { kind: 'building' | 'upgrade', name, r, t }: r its row of
  // the payback table t (CA.Payback.table(): price, bonus, pp, color, won…).

  let cur = null;
  let depth = 0;
  const cache = new Map(); // scope|source → compiled

  function compiled(s) {
    const item = s.scope !== 'game';
    const k = `${s.scope}|${s.source}`;
    if (cache.size > 300) cache.clear(); // the editor compiles every keystroke
    if (!cache.has(k)) cache.set(k, CA.Script.compile(s.source, { mode: 'stat', item, vars: item ? ['item'] : [] }));
    return cache.get(k);
  }
  const fits = (s, kind) => s.scope === 'game' || s.scope === 'item' || s.scope === kind;

  /**
   * Works a statistic out, about `c` (opts.trace: what each line did, too — CA.Script.runStat) (a context, or null): { returned, value, vars, error }. A
   * statistic about an item of the other kind (a building's, for an upgrade) returns nothing.
   */
  function run(s, c, opts = {}) {
    if (!s) return { returned: false, error: 'no such statistic' };
    if (s.scope !== 'game' && !(c && fits(s, c.kind))) return { returned: false };
    const comp = compiled(s);
    if (comp.errors.length) return { returned: false, error: `line ${comp.errors[0].line}: ${comp.errors[0].message}` };
    if (depth >= MAX_DEPTH) return { returned: false, error: 'statistics call each other too deeply' };
    const prev = cur;
    cur = c;
    depth++;
    try {
      return CA.Script.runStat(comp.flow, s.scope === 'game' ? {} : { item: c.name }, opts);
    } finally {
      cur = prev;
      depth--;
    }
  }

  /** The context for an item by name (from a macro, or another statistic): one more of a building, or a store upgrade. */
  function contextOf(name, scope) {
    if (cur && cur.name === name) return cur;
    const t = CA.Payback.table();
    if (scope !== 'upgrade' && Game.Objects && Game.Objects[name]) {
      const r = t.buildings[1] && t.buildings[1][name];
      return r ? { kind: 'building', name, r, t } : null;
    }
    const r = t.upgrades[name];
    return r ? { kind: 'upgrade', name, r, t } : null;
  }
  /**
   * The best item a statistic of this scope could be about, as a context: the building or the store
   * upgrade with the lowest payback period (an item's: the lower of the two) — or null.
   */
  function bestOf(scope) {
    const t = CA.Payback.table();
    const low = (rows, kind) =>
      Object.keys(rows || {}).reduce((m, name) => {
        const r = rows[name];
        return r && Number.isFinite(r.pp) && (!m || r.pp < m.r.pp) ? { kind, name, r, t } : m;
      }, null);
    const b = scope === 'upgrade' ? null : low(t.buildings[1], 'building');
    const u = scope === 'building' ? null : low(t.upgrades, 'upgrade');
    return b && u ? (u.r.pp < b.r.pp ? u : b) : b || u;
  }
  /**
   * What a statistic of this scope shows about, by a pick: 'best' (bestOf), 'b:<building>' or
   * 'u:<upgrade>' (one that doesn't fit the scope: the best) — null for one about the game.
   */
  function pick(scope, item) {
    if (scope === 'game') return null;
    const it = String(item || 'best');
    if (it.startsWith('b:') && scope !== 'upgrade') return contextOf(it.slice(2), 'building');
    if (it.startsWith('u:') && scope !== 'building') return contextOf(it.slice(2), 'upgrade');
    return bestOf(scope);
  }
  /** fn() with the item words about `c` (the Values list's live values). */
  function about(c, fn) {
    const prev = cur;
    cur = c;
    try {
      return fn();
    } finally {
      cur = prev;
    }
  }

  /** A statistic's value, as a value word gives it (NaN: nothing to show). */
  function valueOf(s, name) {
    const r = run(s, s.scope === 'game' ? cur : contextOf(String(name), s.scope));
    return r.returned && r.value !== undefined ? r.value : NaN;
  }

  // ---- how it reads ------------------------------------------------------------------------------

  /** One value as HTML, in a format; `desc` (a value word's) tells `auto` seconds and chances apart. */
  function format(x, fmt, desc) {
    if (typeof x === 'boolean') return x ? 'yes' : 'no';
    if (typeof x === 'string' && fmt === 'upgrade') return x ? CA.UpgradeInfo.ref(x) : '—';
    if (typeof x === 'string') return esc(x) || '—';
    if (typeof x !== 'number' || Number.isNaN(x)) return '—';
    let f = fmt || 'auto';
    if (f === 'auto') f = /\bseconds\b/.test(desc || '') ? 'time' : /0–1|0-1/.test(desc || '') ? 'chance' : 'number';
    if (f === 'payback') return F().payback(x);
    if (f === 'time') return !Number.isFinite(x) ? 'never' : x <= 0 ? 'now' : F().span(x);
    if (f === 'chance') return `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;
    return Number.isFinite(x) ? F().beautify(x) : '∞';
  }
  const colorClass = (c) => (COLORS.includes(c) ? `ca-pp-${c}` : '');

  /**
   * A statistic as a tooltip line about `c`: [label html, value html, class] — or null when it has
   * nothing to show (no return, "", an empty list; or it fails: error, in opts.errors).
   */
  function line(s, c) {
    const r = run(s, c);
    if (r.error || !r.returned) return null;
    const v = r.value;
    if (v === undefined || v === null || (v === '' && !s.showEmpty) || (Array.isArray(v) && !v.length)) return null;
    const vars = r.vars || {};
    const label = typeof vars.label === 'string' || typeof vars.label === 'number' ? String(vars.label) : s.label;
    let color = vars.color !== undefined ? vars.color : vars.colour !== undefined ? vars.colour : s.color === 'payback' ? (c && c.r ? c.r.color : '') : s.color;
    let html;
    let cls = '';
    if (Array.isArray(v)) {
      const cs = Array.isArray(color) ? color : v.map(() => color);
      html = v
        .map((x, i) => {
          const one = format(x, s.format, s.wordDesc);
          return typeof x === 'number' && !Number.isNaN(x) && colorClass(cs[i]) ? `<span class="${colorClass(cs[i])}">${one}</span>` : one;
        })
        .join(' · ');
    } else {
      html = format(v, s.format, s.wordDesc);
      if (Array.isArray(color)) color = color[0];
      cls = colorClass(color);
    }
    if (vars.note !== undefined && vars.note !== '') html += ` <small>${esc(String(vars.note))}</small>`;
    return [esc(label), html, cls];
  }

  /**
   * A warning statistic about `c`, when it has something to show: { id, label, html, color } — the
   * color it set, or its own (red when none); null when it doesn't warn (or fails).
   */
  function warning(s, c) {
    const row = line(s, c);
    if (!row) return null;
    const color = (row[2].match(/^ca-pp-(\w+)$/) || [])[1] || 'red';
    return { id: s.id, label: row[0], html: row[1], color };
  }

  // ---- a value word as a statistic (a tooltip line that's one word: { word, fmt, label }) -----------

  const wordCache = new Map();
  /** The statistic a word line amounts to: return word(item) — or null (no such word; one that takes something else). */
  function fromWord(entry) {
    const k = `${entry.word}|${entry.fmt || ''}|${entry.label || ''}`;
    if (wordCache.has(k)) return wordCache.get(k);
    const v = CA.Script.VALUES.find((x) => x.id === entry.word);
    const ps = (v && v.params) || [];
    let s = null;
    if (v && !v.context && (ps.length === 0 || (ps.length === 1 && (ps[0] === 'building' || ps[0] === 'upgrade')))) {
      s = clean({ key: 'word', label: entry.label || entry.word, scope: ps.length ? ps[0] : 'game', format: entry.fmt || 'auto', source: `return ${entry.word}(${ps.length ? 'item' : ''})` });
      s.id = `word:${entry.word}`;
      s.word = entry.word;
      s.wordDesc = v.desc;
      s.showEmpty = true;
    }
    wordCache.set(k, s);
    return s;
  }

  // ---- as text: to share one (copy, paste) -----------------------------------------------------

  const TEXT_HEAD = '# cookieMgr statistic';
  const TEXT_KEYS = ['label', 'key', 'desc', 'scope', 'format', 'color', 'group', 'warn', 'mode'];
  /** A statistic as text: a few "# field: value" lines, then its code. */
  function toText(s) {
    const val = (k) => (k === 'warn' || k === 'mode' ? (s[k] ? 'yes' : '') : s[k]);
    return [TEXT_HEAD, ...TEXT_KEYS.filter((k) => val(k) !== undefined && val(k) !== '').map((k) => `# ${k}: ${String(val(k)).replace(/\n/g, ' ')}`), s.source].join('\n');
  }
  /** Text (toText's, or just code) as a statistic to add: { label, key, …, source } — null when there's nothing in it. */
  function fromText(text) {
    const lines = String(text || '').replace(/\r/g, '').split('\n');
    const def = {};
    let i = 0;
    if (lines[0] && lines[0].trim().toLowerCase() === TEXT_HEAD.toLowerCase()) { // up to v3.47.0 the head had a capital C
      for (i = 1; i < lines.length; i++) {
        const m = lines[i].match(/^#\s*(\w+):\s?(.*)$/);
        const k = m && m[1] === 'colour' ? 'color' : m && m[1]; // shared under the old spelling
        if (!m || !TEXT_KEYS.includes(k)) break;
        def[k] = m[2].trim();
      }
    }
    def.source = lines.slice(i).join('\n').replace(/\s+$/, '');
    if (!def.source.trim() && !def.label) return null;
    return clean(def);
  }

  // ---- words ---------------------------------------------------------------------------------

  function defineWord(s) {
    CA.Script.defineValue({
      id: `stat.${s.key}`,
      desc: `the statistic “${s.label}”${s.desc ? ` — ${s.desc}` : ''}`,
      params: s.scope === 'game' ? [] : ['item'],
      group: 'Statistics',
      origin: s.builtin ? 'stat' : 'mine',
      get: (name) => valueOf(get(s.id) || s, name),
    });
  }

  function defineItemWords() {
    const V = (id, desc, get, more) => CA.Script.defineValue({ id, desc, get, context: true, group: 'This item', ...(more || {}) });
    const r = () => (cur && cur.r) || null;
    const isB = () => !!cur && cur.kind === 'building';
    V('item.kind', 'what the item is: building or upgrade', () => (cur ? cur.kind : ''));
    V('item.price', 'what it costs (for a building: what a click buys)', () => (r() ? r().price : NaN));
    V('item.gain', 'the CpS it adds (an upgrade’s clicks not counted)', () => (r() ? r().bonus : NaN));
    V('item.payback', 'its payback period (seconds; in the payback mode in use) — the number behind its payback color', () => (r() ? r().pp : NaN), {
      how: 'time to afford it, max(price − bank, 0) ÷ income, plus time to earn its price back, price ÷ gain — income and gain as the payback mode has them (payback.mode())',
    });
    // its payback period's parts, in a payback mode ("raw", "cps", "clicking", "actual"; none: the one in use)
    const worth = () => {
      if (!r()) return null;
      if (r().worth) return r().worth;
      return isB() ? CA.Payback.buildingWorth(cur.name, r().n || 1) : CA.Payback.upgradeWorth(cur.name);
    };
    const partsIn = (m) => (r() ? CA.Payback.parts(r().price, worth(), m) : null);
    const MODES = '"raw", "cps", "clicking", "actual" or a mode statistic’s code name — none: the mode in use';
    V('item.rawGain', 'the raw CpS it adds (no golden cookie effects; an upgrade’s clicks not counted)', () => {
      const w = worth();
      return w ? (Number.isFinite(w.raw) ? w.raw : w.bonus || 0) : NaN;
    });
    V('item.paybackIn', `its payback period in a payback mode: ${MODES} (seconds; NaN: not ready)`, (m) => (partsIn(m) || { pp: NaN }).pp, { params: ['mode'] });
    V('item.gainIn', `what it adds to your income in a payback mode: ${MODES} (cookies a second)`, (m) => (partsIn(m) || { gain: NaN }).gain, { params: ['mode'] });
    V('item.timeToAfford', `seconds until you can afford it at your income in a payback mode: ${MODES} (0: now) — a payback period's first part`, (m) => (partsIn(m) || { afford: NaN }).afford, { params: ['mode'] });
    V('item.earnBack', `seconds it takes to earn its price back, in a payback mode: ${MODES} — price ÷ gain, a payback period's second part`, (m) => (partsIn(m) || { earn: NaN }).earn, { params: ['mode'] });
    const colorWord = () => (r() ? r().color || '' : '');
    V('item.color', 'its payback color: blue, green, yellow, orange, red, purple or gray', colorWord);
    V('item.colour', 'the same as item.color()', colorWord, { hidden: true }); // the old spelling, still works
    V('item.bulk', 'how many a click buys (an upgrade: 1)', () => (isB() ? r().n || 1 : cur ? 1 : NaN));
    V('item.owned', 'how many you own (an upgrade: 1 or 0)', () => {
      if (!cur) return NaN;
      if (isB()) return (Game.Objects[cur.name] || {}).amount || 0;
      const u = Game.Upgrades && Game.Upgrades[cur.name];
      return u && u.bought ? 1 : 0;
    });
    V('item.wins', 'the achievements buying it wins, as text ("" when none)', () => (r() && r().won ? r().won.join(', ') : ''));
    V('item.share', 'what share of your CpS the building makes (0–1; an upgrade: 0)', () => {
      if (!isB()) return cur ? 0 : NaN;
      const b = Game.Objects[cur.name];
      return b && b.storedTotalCps && Game.cookiesPs ? (b.storedTotalCps * (Game.globalCpsMult || 1)) / Game.cookiesPs : 0;
    });
    V('item.clickGain', 'what it adds to each click (an upgrade that makes clicks stronger; a building, through the fingers upgrades)', () => {
      if (!cur) return NaN;
      const w = worth();
      return (w && Number.isFinite(w.mouse) ? w.mouse : r().mouse) || 0;
    });
    const bulkRow = (n) => {
      if (!isB()) return null;
      const k = Math.max(1, Math.floor(Number(n)) || 1);
      const row = cur.t.buildings[k] && cur.t.buildings[k][cur.name];
      if (row) return row;
      const b = Game.Objects[cur.name];
      if (!b) return null;
      const price = CA.Payback.sumPrice(b, k);
      const pp = CA.Payback.ppOf(price, CA.Payback.buildingWorth(cur.name, k));
      return { pp, color: cur.t.colorOf ? cur.t.colorOf(pp, price) : '' };
    };
    V('item.paybackOf', 'the payback period of n more of the building (seconds; an upgrade: NaN)', (n) => (bulkRow(n) || { pp: NaN }).pp, { params: ['n'] });
    const colorOfWord = (n) => (bulkRow(n) || { color: '' }).color;
    V('item.colorOf', 'the payback color of n more of the building', colorOfWord, { params: ['n'] });
    V('item.colourOf', 'the same as item.colorOf(n)', colorOfWord, { params: ['n'], hidden: true }); // the old spelling, still works
  }

  function defineFormatWords() {
    const V = (id, desc, params, get, more) => CA.Script.defineValue({ id, desc, params, get, group: 'Text', ...(more || {}) });
    const n = (x) => Number(x);
    V('fmt.number', 'a number as text, as the game writes it (1.23 M)', ['x'], (x) => F().beautify(n(x)));
    V('fmt.short', 'a number as short text (1.23M)', ['x'], (x) => F().short(n(x)));
    V('fmt.time', 'seconds as a time (3m 20s)', ['seconds'], (x) => F().span(n(x)));
    V('fmt.payback', 'seconds as a payback period, as the Payback page writes them (16m 40s, or 1K in seconds)', ['seconds'], (x) => F().payback(n(x)));
    V('fmt.pct', 'a share (0–1) as a percentage, with so many decimals: fmt.pct(0.0741, 2) is 7.41%', ['x', 'decimals'], (x, d) => `${(n(x) * 100).toFixed(Math.max(0, Math.min(10, Math.floor(n(d)) || 0)))}%`);
    V('fmt.fixed', 'a number with so many decimals', ['x', 'decimals'], (x, d) => n(x).toFixed(Math.max(0, Math.min(10, Math.floor(n(d)) || 0))));
    V('finite', 'whether a number is finite (not ∞, not NaN)', ['x'], (x) => typeof x === 'number' && Number.isFinite(x), { bool: true, group: 'Numbers' });
    V('known', 'whether a value is known: not NaN, not empty', ['x'], (x) => x !== undefined && x !== null && x !== '' && !(typeof x === 'number' && Number.isNaN(x)), { bool: true, group: 'Numbers' });
  }

  // ---- save / load ---------------------------------------------------------------------------

  function serialize() {
    if (!mine.length && !Object.keys(overrides).length && !favs.length) return undefined;
    return { v: 1, mine: mine.map((s) => ({ id: s.id, key: s.key, label: s.label, desc: s.desc, scope: s.scope, format: s.format, color: s.color, source: s.source, group: s.group || undefined, warn: s.warn || undefined, mode: s.mode || undefined })), builtin: overrides, favs };
  }
  function load(data) {
    mine.forEach((s) => CA.Script.removeValue(`stat.${s.key}`));
    mine = [];
    overrides = {};
    favs = [];
    if (data && typeof data === 'object') {
      (Array.isArray(data.mine) ? data.mine : []).forEach((d) => {
        if (!d || typeof d !== 'object' || typeof d.id !== 'string') return;
        const s = clean(d);
        s.id = d.id;
        s.key = freeKey(s.key, s.id);
        mine.push(s);
        defineWord(s);
      });
      if (data.builtin && typeof data.builtin === 'object')
        Object.keys(data.builtin).forEach((id) => {
          const o = data.builtin[id];
          if (!BUILTIN[id] || !o || typeof o !== 'object') return;
          overrides[id] = {};
          OVERRIDABLE.forEach((k) => typeof o[k] === 'string' && (overrides[id][k] = o[k]));
          if (typeof o.colour === 'string' && overrides[id].color === undefined) overrides[id].color = o.colour; // saved under the old spelling
        });
      if (Array.isArray(data.favs)) favs = data.favs.filter((x) => typeof x === 'string');
    }
    changed();
  }

  function init() {
    defineItemWords();
    defineFormatWords();
    BUILTINS.forEach(defineWord);
    CA.Settings.registerSection('stats', { serialize, load, event: 'stats' });
  }

  // ---- payback modes ---------------------------------------------------------------------------

  /** The payback mode statistics (built-in, then yours). */
  const modes = () => all().filter((s) => s.mode);
  /**
   * A payback mode's statistic run about `c` (an item context): { income — what it set as income,
   * gain — what it returned } (NaN: none, or it failed).
   */
  function runMode(s, c) {
    let r;
    try {
      r = run(s, c);
    } catch (e) {
      r = { returned: false };
    }
    const num = (x) => (typeof x === 'number' ? x : NaN);
    return { income: num(r && r.vars ? r.vars.income : NaN), gain: r && r.returned ? num(r.value) : NaN };
  }

  return { init, modes, runMode, all, get, byKey, add, update, remove, duplicate, toText, fromText, run, line, warning, format, fromWord, compiled, contextOf, bestOf, pick, about, keyOf: camel, favs: () => favs.slice(), BUILTINS, FORMATS, SCOPES, GROUPS, COLORS };
})();
