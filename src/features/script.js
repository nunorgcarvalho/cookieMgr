// The language of **algorithmic macros**: a little pseudo-code, indented like Python, compiled to
// the flow blocks features/macros.js runs.
//
//   # a comment
//   pop.golden()                      run an action — its options by position or by name:
//   season.keep(christmas)            season.keep(season=christmas)
//   switch on reindeer                switch another macro on / off (by id or "its name")
//   switch off a, b, c                several at once
//   wait until magic() >= 80          wait for something
//   wait 30 seconds                   (or minutes)
//   repeat until <condition>:         run the block on every pass until the condition holds
//   while <condition>:                …as long as it holds
//   repeat 5 times:                   the block 5 times (one per pass)
//   forever:                          the block again and again
//   if <condition>:  elif …:  else:
//   for season in [easter, halloween]:   the block once per item, with `season` standing for it
//   for good in stocks():             the block for each item of a live list (as far as it gets this pass)
//   target = cookies() * 0.1          a variable: a number, text, or a condition's yes / no
//   def sell(good):                   a named block, called like an action: sell(good)
//   parallel:                         branches side by side (each one a `branch [name]:` block)
//   stop                              end the macro here
//   log "text"                        write to its trace (or log <a value>)
//
// Conditions: condition calls (season.complete(christmas), buff(Frenzy)), comparisons of values
// (owned(christmas, upgrades) >= total(christmas, upgrades), cookies() > 0.1 * cps() * 60,
// season == easter), a variable on its own, joined with and / or / not and brackets. Values add up
// with + - * / %. Numbers can be written 1e12, 25K, 2.5M, 3B, 1T…
// Values: see VALUES below (and any recorded state: state(cookies)). Each comes from somewhere: the game,
// cookieMgr, a statistic, or it's a function (originOf, below); a value may say how it's worked out (how).
//
// Every block keeps the line it came from, so a running macro can show where it is.
//
// **Statistics** (features/stats.js) are written in the same language, compiled with { mode: 'stat' }:
// they only read the game (no actions, waits, switches, parallel, stop, forever, while or repeat until),
// may build lists ([a, b, c]) and end with `return <value>` (no return: nothing to show). runStat() runs
// one at once, start to finish, with a step limit. Words marked `context` (item.price()…) only exist
// in a statistic about an item.

CA.Script = (() => {
  const KEYWORDS = ['if', 'elif', 'else', 'for', 'in', 'repeat', 'until', 'while', 'times', 'forever', 'parallel', 'branch', 'wait', 'seconds', 'second', 'minutes', 'minute', 'stop', 'log', 'switch', 'on', 'off', 'and', 'or', 'not', 'def', 'return'];
  const SUFFIX = { k: 1e3, m: 1e6, b: 1e9, t: 1e12, qa: 1e15, qi: 1e18 };

  // ---- values: numbers a condition can compare -------------------------------------------------

  const has = (n) => CA.Util.has(n);
  const VALUES = [
    { id: 'cookies', desc: 'cookies in the bank', get: () => Game.cookies || 0 },
    { id: 'cps', desc: 'cookies per second (as the game shows it)', get: () => Game.cookiesPs || 0 },
    { id: 'rawCps', desc: 'cookies per second without effects', get: () => Game.cookiesPsRaw || Game.unbuffedCps || 0 },
    { id: 'magic', desc: 'Grimoire magic', get: () => (CA.Util.minigame('Wizard tower') || {}).magic || 0 },
    { id: 'lumps', desc: 'sugar lumps', get: () => Game.lumps || 0 },
    { id: 'santaLevel', desc: 'Santa’s level (14 = Final Claus)', get: () => Game.santaLevel || 0 },
    { id: 'veil', bool: true, desc: 'whether the Shimmering veil is up (clicking the big cookie, a golden cookie or a reindeer can break it)', get: () => typeof Game.Has === 'function' && !!Game.Has('Shimmering veil [off]') },
    { id: 'elderWrath', desc: 'the Grandmapocalypse’s stage (0 none … 3 angered)', get: () => Game.elderWrath || 0 },
    { id: 'researchOwned', desc: 'research upgrades owned (of 9)', get: () => (CA.AutoBuy ? CA.AutoBuy.RESEARCH.filter(has).length : 0) },
    { id: 'researchNext', desc: 'the next research upgrade, in the order the game gives them ("": all done)', get: () => (CA.AutoBuy ? CA.AutoBuy.RESEARCH.find((n) => !has(n)) || '' : '') },
    {
      id: 'owned',
      desc: 'how many of a season’s drops you own — part: all, upgrades or cookies',
      params: ['season', 'part'],
      get: (season, part) => CA.Seasons.dropsOf(season, part || 'all').filter(has).length,
    },
    {
      id: 'total',
      desc: 'how many drops a season has — part: all, upgrades or cookies',
      params: ['season', 'part'],
      get: (season, part) => CA.Seasons.dropsOf(season, part || 'all').length,
    },
    {
      id: 'building',
      desc: 'how many of a building you own',
      params: ['name'],
      get: (name) => ((Game.Objects && Game.Objects[name]) || {}).amount || 0,
    },
    {
      id: 'state',
      desc: 'a recorded state (CpS, cookies, prestige…), as on the Graphs page',
      params: ['id'],
      get: (id) => {
        const fr = CA.Recorder.frames();
        const last = fr[fr.length - 1];
        return last && Number.isFinite(last[id]) ? last[id] : NaN;
      },
    },
  ];
  VALUES.push(
    { id: 'count', desc: 'how many items a list has', params: ['list'], get: (list) => (Array.isArray(list) ? list.length : 0) },
    { id: 'buildings', desc: 'a list: every building’s name', list: true, get: () => Object.keys((Game && Game.Objects) || {}) }
  );
  const valueById = {};
  VALUES.forEach((v) => (valueById[v.id] = v));

  // ---- where a value comes from (the code editors color each by it) --------------------------------
  //   game       read straight from the game: what it has or shows (cookies, a stock's price, a tile's plant)
  //   cookieMgr  worked out by cookieMgr: payback periods, golden cookie odds, banks, its profiles…
  //   stat       a built-in statistic (stat.*)        mine  a statistic you wrote
  //   function   works on what it's given (fmt.number(x), count(list))
  // A value can say its own (origin: …); else it's the game's when listed here, cookieMgr's otherwise.
  const GAME_VALUES = new Set(
    (
      'cookies cps rawCps magic lumps santaLevel veil elderWrath researchOwned researchNext owned total building buildings ' +
      'shimmers shimmer.type shimmer.isWrath shimmer.life wrinklers wrinkler.isShiny wrinkler.isFed wrinkler.sucked ' +
      'lump.isRipe lump.isMature lump.ripeIn autosave.in buff.timeLeft upgrades upgrade.price upgrade.owned ' +
      'building.price building.priceOf missing.upgrades missing.achievements spell.cost spell.failChance fthof.backfireChance ' +
      'pantheon.gods pantheon.god pantheon.slotOf pantheon.isSlotted pantheon.swaps dragon.level dragon.aura dragon.canPet ' +
      'garden.tickIn garden.plants garden.mature garden.empty garden.isUnlocked garden.soilAvailable garden.tiles garden.plantAt ' +
      'garden.age garden.isMature garden.isNew garden.isEmpty garden.seeds garden.seedCost ' +
      'stocks stock.mode stock.price stock.resting stock.held stock.max stock.room stock.delta stock.cost stock.brokers stock.maxBrokers stock.brokerPrice'
    ).split(' ')
  );
  const FUNCTIONS = new Set(['count', 'finite', 'known']);
  const ORIGINS = {
    game: { name: 'Game', what: 'Game value', desc: 'read straight from the game' },
    cookieMgr: { name: 'cookieMgr', what: 'cookieMgr value', desc: 'worked out by cookieMgr' },
    stat: { name: 'Statistic', what: 'Statistic', desc: 'a built-in statistic: code you can read and change' },
    mine: { name: 'Your statistic', what: 'Your statistic', desc: 'a statistic you wrote' },
    function: { name: 'Function', what: 'Function', desc: 'works on what you give it' },
  };
  /** Where a value comes from: 'game', 'cookieMgr', 'stat', 'mine' or 'function' ('' when it isn't a value). */
  function originOf(id) {
    const v = valueById[id];
    if (!v) return '';
    if (v.origin) return v.origin;
    if (GAME_VALUES.has(id)) return 'game';
    if (FUNCTIONS.has(id) || /^fmt\./.test(id)) return 'function';
    return 'cookieMgr';
  }

  // ---- tokens ---------------------------------------------------------------------------------

  /** One line → tokens { t: 'id' | 'num' | 'str' | 'op' | 'p', v }. Throws { col, message }. */
  function tokenize(text) {
    const out = [];
    let i = 0;
    while (i < text.length) {
      const c = text[i];
      if (c === ' ' || c === '\t') {
        i++;
        continue;
      }
      if (c === '#') break;
      if (c === '"' || c === "'") {
        const end = text.indexOf(c, i + 1);
        if (end < 0) throw { col: i, message: 'a quote that isn’t closed' };
        out.push({ t: 'str', v: text.slice(i + 1, end), col: i });
        i = end + 1;
        continue;
      }
      const dur = text.slice(i).match(/^(\d+(?:\.\d+)?)(s|sec|secs|min|mins)(?![A-Za-z_])/i);
      if (dur) {
        out.push({ t: 'num', v: Number(dur[1]), base: Number(dur[1]), unit: /^s/i.test(dur[2]) ? 's' : 'min', col: i });
        i += dur[0].length;
        continue;
      }
      const num = text.slice(i).match(/^(\d+(?:\.\d+)?(?:e[+-]?\d+)?)(qa|qi|k|m|b|t)?(?![A-Za-z_])/i);
      if (num) {
        out.push({ t: 'num', v: Number(num[1]) * (num[2] ? SUFFIX[num[2].toLowerCase()] : 1), base: Number(num[1]), sfx: (num[2] || '').toLowerCase(), col: i });
        i += num[0].length;
        continue;
      }
      const id = text.slice(i).match(/^[A-Za-z_][\w.\-']*\w|^[A-Za-z_]/);
      if (id) {
        out.push({ t: 'id', v: id[0], col: i });
        i += id[0].length;
        continue;
      }
      const op = text.slice(i).match(/^(>=|<=|==|!=|>|<|=|\+|-|\*|\/|%)/);
      if (op) {
        out.push({ t: 'op', v: op[0], col: i });
        i += op[0].length;
        continue;
      }
      if ('()[],:'.includes(c)) {
        out.push({ t: 'p', v: c, col: i });
        i++;
        continue;
      }
      throw { col: i, message: `“${c}” isn’t something I understand here` };
    }
    return out;
  }

  // ---- lines → a tree by indentation --------------------------------------------------------------

  /** The line without its comment (a # outside quotes and everything after it). */
  function withoutComment(text) {
    let q = '';
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === q) q = '';
      } else if (c === '"' || c === "'") q = c;
      else if (c === '#') return text.slice(0, i);
    }
    return text;
  }

  function lineTree(source) {
    const lines = String(source || '').replace(/\r\n/g, '\n').split('\n');
    const root = { indent: -1, children: [] };
    const stack = [root];
    const errors = [];
    lines.forEach((raw, i) => {
      const text = raw.replace(/\t/g, '  ');
      const body = withoutComment(text);
      if (!body.trim()) return;
      const indent = text.length - text.trimStart().length;
      while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
      const parent = stack[stack.length - 1];
      let tokens = [];
      try {
        tokens = tokenize(body);
      } catch (e) {
        errors.push({ line: i + 1, message: e.message });
        return;
      }
      const node = { line: i + 1, indent, tokens, text: text.trim(), children: [] };
      parent.children.push(node);
      stack.push(node);
    });
    return { root, errors };
  }

  // ---- parsing statements and expressions -----------------------------------------------------------
  //
  // Expressions (values): numbers, "text", true / false, names (a variable — or a word standing for
  // itself: easter), value calls (cookies(), stock.price(good)), + - * / %, unary minus, brackets.
  // Conditions: comparisons of expressions, condition calls, a variable on its own (true / non-zero),
  // joined with and / or / not and brackets.
  //
  //   values      { v: 'lit', x } · { v: 'var', name } · { v: 'fn', id, args: [value…] }
  //               { v: 'bin', op, a, b } · { v: 'neg', a }
  //   conditions  { t: 'cmp', op, l, r } · { t: 'cond', id, params } · { t: 'val', e }
  //               { t: 'and' | 'or', a, b } · { t: 'not', a }
  //
  // An action's or condition's option can be an expression too — { $e: value }, worked out when the
  // line runs (resolve()): stock.buy(good), garden.harvest(tile).

  class Err extends Error {
    constructor(message) {
      super(message);
      this.script = true;
    }
  }

  // what the source being compiled names: its variables (anything assigned, a for over a live list,
  // a named block's options, a macro's inputs) and its named blocks (def)
  const freshCtx = (vars, opts = {}) => ({ vars: new Set(vars || []), defs: {}, depth: 0, mode: opts.mode || 'macro', item: !!opts.item });
  let ctx = freshCtx();
  const CMP = ['>=', '<=', '==', '!=', '>', '<'];

  /** A cursor over one line's tokens, with the loop variables in scope substituted. */
  function cursor(tokens, scope) {
    const toks = tokens.map((t) => (t.t === 'id' && scope && Object.prototype.hasOwnProperty.call(scope, t.v) ? { ...t, t: 'id', v: scope[t.v], sub: true } : t));
    let i = 0;
    return {
      peek: (k = 0) => toks[i + k],
      next: () => toks[i++],
      done: () => i >= toks.length,
      is: (t, v) => toks[i] && toks[i].t === t && (v === undefined || toks[i].v === v),
      take(t, v, what) {
        if (!this.is(t, v)) throw new Err(`expected ${what || v || t}${toks[i] ? `, found “${toks[i].v}”` : ' at the end of the line'}`);
        return toks[i++];
      },
      rest: () => toks.slice(i),
      mark: () => i,
      reset: (m) => {
        i = m;
      },
    };
  }
  const isVar = (t) => !!t && t.t === 'id' && !t.sub && ctx.vars.has(t.v);
  /** A name the language already uses (so it can't be a variable or a named block). */
  const taken = (name) => KEYWORDS.includes(name) || name === 'true' || name === 'false' || !!CA.Actions.get(name) || !!CA.Conditions.get(name) || !!valueById[name];

  /** "(a, b=c)" → { pos: [...], named: {...} } (the opening "(" already taken). */
  function args(c) {
    const pos = [];
    const named = {};
    if (c.is('p', ')')) {
      c.next();
      return { pos, named };
    }
    for (;;) {
      if (c.is('id') && c.peek(1) && c.peek(1).t === 'op' && c.peek(1).v === '=') {
        const k = c.next().v;
        c.next();
        named[k] = arg(c);
      } else pos.push(arg(c));
      if (c.is('p', ',')) {
        c.next();
        continue;
      }
      c.take('p', ')', '“)”');
      return { pos, named };
    }
  }
  /** One option: a plain literal (5, "hand of fate", easter, true) — or an expression, worked out when the line runs. */
  function arg(c) {
    const t = c.peek();
    const nx = c.peek(1);
    const alone = !!nx && nx.t === 'p' && (nx.v === ',' || nx.v === ')');
    if (t && alone && (t.t === 'num' || t.t === 'str' || (t.t === 'id' && !isVar(t)))) return literal(c);
    return { $e: sum(c) };
  }
  function literal(c) {
    const t = c.next();
    if (!t) throw new Err('expected a value');
    if (t.t === 'num' || t.t === 'str') return t.v;
    if (t.t === 'id') return t.v === 'true' ? true : t.v === 'false' ? false : t.v;
    throw new Err(`expected a value, found “${t.v}”`);
  }

  /** Positional + named arguments → an action's / condition's params object. */
  function bind(def, a, what) {
    const params = {};
    const list = def.params || [];
    a.pos.forEach((v, k) => {
      if (!list[k]) throw new Err(`${what} takes ${list.length || 'no'} option${list.length === 1 ? '' : 's'}`);
      params[list[k].key] = v;
    });
    Object.keys(a.named).forEach((k) => {
      const p = list.find((x) => x.key === k) || list.find((x) => x.alias && x.alias === k); // alias: an old spelling, still works
      if (!p) throw new Err(`${what} has no option “${k}” (it has: ${list.map((x) => x.key).join(', ') || 'none'})`);
      params[p.key] = a.named[k];
    });
    return params;
  }

  // values: sum > term > unary > primary
  function sum(c) {
    let a = term(c);
    while (c.is('op', '+') || c.is('op', '-')) {
      const op = c.next().v;
      a = { v: 'bin', op, a, b: term(c) };
    }
    return a;
  }
  function term(c) {
    let a = unary(c);
    while (c.is('op', '*') || c.is('op', '/') || c.is('op', '%')) {
      const op = c.next().v;
      a = { v: 'bin', op, a, b: unary(c) };
    }
    return a;
  }
  function unary(c) {
    if (c.is('op', '-')) {
      c.next();
      if (c.is('num')) return { v: 'lit', x: -c.next().v }; // -5 is a number
      return { v: 'neg', a: unary(c) };
    }
    return primary(c);
  }
  function primary(c) {
    if (c.is('p', '(')) {
      c.next();
      const e = sum(c);
      c.take('p', ')', '“)”');
      return e;
    }
    return operand(c);
  }
  /** A word that only means something in a statistic about an item (item.price()…): here? */
  function contextOk(def) {
    if (!def || !def.context) return;
    if (ctx.mode !== 'stat') throw new Err(`${def.id}() is for statistics — it reads the building or upgrade a tooltip is about`);
    if (!ctx.item) throw new Err(`${def.id}() needs an item, and this statistic is about the whole game`);
  }
  function operand(c) {
    const t = c.peek();
    if (!t) throw new Err('expected something to compare');
    if (t.t === 'num' || t.t === 'str') return { v: 'lit', x: c.next().v };
    // a list: [a, b, c]
    if (t.t === 'p' && t.v === '[') {
      c.next();
      const items = [];
      while (!c.is('p', ']')) {
        items.push(sum(c));
        if (c.is('p', ',')) c.next();
        else if (!c.is('p', ']')) throw new Err('items are separated by commas');
      }
      c.next();
      return { v: 'list', items };
    }
    if (t.t === 'id') {
      c.next();
      if (c.is('p', '(')) {
        c.next();
        const a = args(c);
        const def = valueById[t.v];
        if (!def) throw new Err(`“${t.v}” isn’t a value (values: ${VALUES.map((v) => v.id).join(', ')})`);
        contextOk(def);
        return { v: 'fn', id: t.v, args: a.pos.concat(Object.values(a.named)).map((x) => (x && x.$e ? x.$e : { v: 'lit', x })) };
      }
      if (isVar(t)) return { v: 'var', name: t.v };
      if (t.v === 'true' || t.v === 'false') return { v: 'lit', x: t.v === 'true' };
      if (valueById[t.v] && !t.sub) {
        contextOk(valueById[t.v]);
        return { v: 'fn', id: t.v, args: [] };
      }
      return { v: 'lit', x: t.v };
    }
    throw new Err(`expected something to compare, found “${t.v}”`);
  }

  // conditions: or > and > not > comparison / call / a value on its own
  function expr(c) {
    let a = andExpr(c);
    while (c.is('id', 'or')) {
      c.next();
      a = { t: 'or', a, b: andExpr(c) };
    }
    return a;
  }
  function andExpr(c) {
    let a = notExpr(c);
    while (c.is('id', 'and')) {
      c.next();
      a = { t: 'and', a, b: notExpr(c) };
    }
    return a;
  }
  function notExpr(c) {
    if (c.is('id', 'not')) {
      c.next();
      return { t: 'not', a: notExpr(c) };
    }
    return atom(c);
  }
  /** At an id: is it (with its call, if any) followed by a comparison? — then it's a value. */
  function comparedAfter(c) {
    let k = 1;
    if (c.peek(1) && c.peek(1).t === 'p' && c.peek(1).v === '(') {
      for (let depth = 0; c.peek(k); k++) {
        const t = c.peek(k);
        if (t.t === 'p' && t.v === '(') depth++;
        else if (t.t === 'p' && t.v === ')' && --depth === 0) break;
      }
      k++;
    }
    const nx = c.peek(k);
    return !!nx && nx.t === 'op' && nx.v !== '=';
  }
  function atom(c) {
    if (c.is('p', '(')) {
      // conditions in brackets — or a sum in brackets that's then compared: (a + b) > c
      const m = c.mark();
      try {
        c.next();
        const e = expr(c);
        c.take('p', ')', '“)”');
        const nx = c.peek();
        if (!nx || nx.t !== 'op' || nx.v === '=') return e;
      } catch (err) {
        if (!err.script) throw err;
      }
      c.reset(m);
    }
    const t = c.peek();
    // a condition call: an id that is a known condition (and isn't followed by a comparison)
    if (t && t.t === 'id' && !isVar(t) && CA.Conditions.get(t.v) && !(valueById[t.v] && comparedAfter(c))) {
      c.next();
      let a = { pos: [], named: {} };
      if (c.is('p', '(')) {
        c.next();
        a = args(c);
      }
      const def = CA.Conditions.get(t.v);
      return { t: 'cond', id: t.v, params: bind(def, a, t.v) };
    }
    const l = sum(c);
    const op = c.peek();
    if (op && op.t === 'op' && CMP.includes(op.v)) {
      c.next();
      return { t: 'cmp', op: op.v, l, r: sum(c) };
    }
    return { t: 'val', e: l }; // a value on its own: only a variable or true / false can be a condition (checkCond)
  }
  /** Throws when a condition is a value on its own that can't be one ("cookies()" — compare it). */
  function checkCond(e) {
    if (!e) return;
    if (e.t === 'and' || e.t === 'or') {
      checkCond(e.a);
      checkCond(e.b);
    } else if (e.t === 'not') checkCond(e.a);
    else if (e.t === 'val' && !(e.e.v === 'var' || (e.e.v === 'lit' && typeof e.e.x === 'boolean') || (e.e.v === 'fn' && valueById[e.e.id] && valueById[e.e.id].bool)))
      throw new Err(`“${exprText(e.e)}” isn’t a condition — compare it with >=, <=, >, <, == or !=`);
  }
  function condition(c) {
    const e = expr(c);
    checkCond(e);
    return e;
  }

  /** The blocks for a list of lines (siblings), with `scope` (loop variables). */
  function block(lines, scope, errors) {
    const out = [];
    for (let k = 0; k < lines.length; k++) {
      const ln = lines[k];
      try {
        const node = statement(ln, scope, errors, lines, k);
        if (node && node.skip) k += node.skip;
        if (node && node.node) out.push(...[].concat(node.node));
      } catch (e) {
        if (!e.script) throw e;
        errors.push({ line: ln.line, message: e.message });
      }
    }
    return out;
  }

  function needBlock(ln, what) {
    if (!ln.children.length) throw new Err(`${what} needs an indented block under it`);
  }
  const endColon = (c) => {
    c.take('p', ':', '“:”');
    if (!c.done()) throw new Err('nothing should come after the “:”');
  };

  function statement(ln, scope, errors, siblings, k) {
    const c = cursor(ln.tokens, scope);
    const t = c.peek();
    const line = ln.line;
    const sub = (s) => block(ln.children, s || scope, errors);
    if (t.t !== 'id') throw new Err(`a line should start with an action or a keyword, not “${t.v}”`);
    const kw = t.v;
    // name = …: a variable (a number, text, or a condition's yes / no)
    if (c.peek(1) && c.peek(1).t === 'op' && c.peek(1).v === '=') {
      if (taken(kw) || ctx.defs[kw]) throw new Err(`“${kw}” is already a word of the language — pick another name`);
      c.next();
      c.next();
      const e = expr(c);
      if (!c.done()) throw new Err('something extra at the end of the line');
      if (e.t === 'val') return { node: { type: 'set', name: kw, e: e.e, line } };
      checkCond(e);
      return { node: { type: 'set', name: kw, cond: e, line } };
    }
    if (kw === 'def') {
      if (ln.bad || (ctx.defs[ln.tokens[1] && ln.tokens[1].v] || {}).ln === ln) return null; // compiled where it's called
      throw new Err('a named block (def) goes at the top level, not inside another block');
    }
    // a named block: its lines, here, with its options set
    if (ctx.defs[kw]) {
      const d = ctx.defs[kw];
      c.next();
      let ar = { pos: [], named: {} };
      if (c.is('p', '(')) {
        c.next();
        ar = args(c);
      }
      if (!c.done()) throw new Err('something extra at the end of the line');
      if (Object.keys(ar.named).length) throw new Err(`${kw}(…) takes its options in order`);
      if (ar.pos.length !== d.params.length) throw new Err(`${kw} takes ${d.params.length || 'no'} option${d.params.length === 1 ? '' : 's'}${d.params.length ? `: ${d.params.join(', ')}` : ''}`);
      if (ctx.depth >= 8) throw new Err(`${kw} calls itself (or blocks call each other) too deeply`);
      ctx.depth++;
      try {
        const sets = d.params.map((p, i) => ({ type: 'set', name: p, e: ar.pos[i] && ar.pos[i].$e ? ar.pos[i].$e : { v: 'lit', x: ar.pos[i] }, line }));
        return { node: [...sets, ...block(d.ln.children, scope, errors)] };
      } finally {
        ctx.depth--;
      }
    }
    if (kw === 'if') {
      c.next();
      const cond = condition(c);
      endColon(c);
      needBlock(ln, 'if');
      // elif / else chain
      const node = { type: 'if', cond, then: sub(), else: [], line };
      let tail = node;
      let used = 0;
      for (let j = k + 1; j < siblings.length; j++) {
        const nx = siblings[j];
        const nc = cursor(nx.tokens, scope);
        if (nc.is('id', 'elif')) {
          nc.next();
          const cond2 = condition(nc);
          endColon(nc);
          needBlock(nx, 'elif');
          const n2 = { type: 'if', cond: cond2, then: block(nx.children, scope, errors), else: [], line: nx.line };
          tail.else = [n2];
          tail = n2;
          used++;
        } else if (nc.is('id', 'else')) {
          nc.next();
          endColon(nc);
          needBlock(nx, 'else');
          tail.else = block(nx.children, scope, errors);
          used++;
          break;
        } else break;
      }
      return { node, skip: used };
    }
    if (kw === 'elif' || kw === 'else') throw new Err(`“${kw}” without an “if” before it`);
    if (kw === 'repeat') {
      c.next();
      if (c.is('id', 'until')) {
        c.next();
        const cond = condition(c);
        endColon(c);
        needBlock(ln, 'repeat until');
        return { node: { type: 'until', cond, body: sub(), line } };
      }
      const n = c.take('num', undefined, 'a number of times, or “until”').v;
      c.take('id', 'times', '“times”');
      endColon(c);
      needBlock(ln, 'repeat');
      return { node: { type: 'times', n: Math.max(0, Math.floor(n)), body: sub(), line } };
    }
    if (kw === 'while') {
      c.next();
      const cond = condition(c);
      endColon(c);
      needBlock(ln, 'while');
      return { node: { type: 'until', cond: { t: 'not', a: cond }, body: sub(), line } };
    }
    if (kw === 'forever') {
      c.next();
      endColon(c);
      needBlock(ln, 'forever');
      return { node: { type: 'forever', body: sub(), line } };
    }
    if (kw === 'for') {
      c.next();
      const name = c.take('id', undefined, 'a name for each item').v;
      c.take('id', 'in', '“in”');
      // over a live list (stocks(), garden.tiles()…): the items it has when the loop starts
      if (!c.is('p', '[')) {
        const list = sum(c);
        endColon(c);
        needBlock(ln, 'for');
        return { node: { type: 'each', name, list, body: sub(), line } };
      }
      c.take('p', '[', '“[”');
      const items = [];
      while (!c.is('p', ']')) {
        items.push(literal(c));
        if (c.is('p', ',')) c.next();
        else if (!c.is('p', ']')) throw new Err('items are separated by commas');
      }
      c.next();
      endColon(c);
      needBlock(ln, 'for');
      // once per item, with `name` standing for it (unrolled: each keeps its own lines)
      const nodes = [];
      items.forEach((it) => nodes.push(...block(ln.children, { ...scope, [name]: String(it) }, errors)));
      return { node: nodes };
    }
    if (kw === 'parallel') {
      c.next();
      endColon(c);
      needBlock(ln, 'parallel');
      const branches = [];
      const labels = [];
      ln.children.forEach((ch) => {
        const bc = cursor(ch.tokens, scope);
        if (!bc.is('id', 'branch')) {
          errors.push({ line: ch.line, message: 'inside “parallel:” every block starts with “branch:” (or “branch name:”)' });
          return;
        }
        bc.next();
        labels.push(bc.is('id') ? bc.next().v : `${labels.length + 1}`);
        try {
          endColon(bc);
          needBlock(ch, 'branch');
        } catch (e) {
          errors.push({ line: ch.line, message: e.message });
          return;
        }
        branches.push(block(ch.children, scope, errors));
      });
      return { node: { type: 'parallel', branches, labels, line } };
    }
    if (kw === 'branch') throw new Err('“branch:” only goes inside “parallel:”');
    if (kw === 'wait') {
      c.next();
      if (c.is('id', 'until')) {
        c.next();
        const cond = condition(c);
        if (!c.done()) throw new Err('something extra at the end of the line');
        return { node: { type: 'wait', cond, line } };
      }
      const tok = c.take('num', undefined, '“until …” or a time');
      // 30s / 2min written together; 5m is five minutes here (not five million seconds)
      if (tok.unit) return { node: { type: 'sleep', secs: tok.unit === 's' ? tok.base : tok.base * 60, line } };
      if (tok.sfx === 'm' && !c.is('id')) return { node: { type: 'sleep', secs: tok.base * 60, line } };
      if (tok.sfx) throw new Err(`a time is in seconds or minutes — “${tok.base}${tok.sfx}” isn’t one`);
      const n = tok.v;
      const unit = c.is('id') ? c.next().v : 'seconds';
      if (!/^(second|seconds|s|sec|secs|minute|minutes|min|mins|m)$/.test(unit)) throw new Err('a time is in seconds or minutes');
      return { node: { type: 'sleep', secs: /^m/.test(unit) ? n * 60 : n, line } };
    }
    if (kw === 'return') {
      if (ctx.mode !== 'stat') throw new Err('“return” is for statistics — a macro ends with “stop”');
      c.next();
      if (c.done()) return { node: { type: 'return', line } };
      const e = expr(c);
      if (!c.done()) throw new Err('something extra at the end of the line');
      if (e.t === 'val') return { node: { type: 'return', e: e.e, line } };
      checkCond(e);
      return { node: { type: 'return', cond: e, line } };
    }
    if (kw === 'stop') {
      c.next();
      return { node: { type: 'stop', line } };
    }
    if (kw === 'log') {
      c.next();
      if (c.done()) return { node: { type: 'log', text: '', line } };
      // log "text" — or log <a value>, written out when it runs
      const e = sum(c);
      if (!c.done()) throw new Err('something extra at the end of the line');
      if (e.v === 'lit') return { node: { type: 'log', text: String(e.x), line } };
      return { node: { type: 'log', e, line } };
    }
    if (kw === 'switch') {
      c.next();
      const to = c.take('id', undefined, '“on” or “off”').v;
      if (to !== 'on' && to !== 'off') throw new Err('switch on … / switch off …');
      // switch on a, b, "c d": several macros, one line
      const nodes = [];
      for (;;) {
        const which = c.next();
        if (!which) throw new Err('which macro? (its id, or its name in quotes)');
        const m = CA.Macros.get(which.v) || CA.Macros.list().find((x) => x.name.toLowerCase() === String(which.v).toLowerCase());
        if (!m) throw new Err(`there’s no macro “${which.v}”`);
        nodes.push({ type: 'do', action: 'macro.set', params: { macro: m.id, to }, line });
        if (c.done()) break;
        if (!c.is('p', ',')) throw new Err('macros in a list are split by commas');
        c.next();
      }
      return { node: nodes.length === 1 ? nodes[0] : nodes };
    }
    // an action
    const a = CA.Actions.get(kw);
    if (!a) {
      if (KEYWORDS.includes(kw)) throw new Err(`“${kw}” can’t start a line`);
      throw new Err(`“${kw}” isn’t an action — pick one from the list beside the editor`);
    }
    c.next();
    let ar = { pos: [], named: {} };
    if (c.is('p', '(')) {
      c.next();
      ar = args(c);
    }
    if (!c.done()) throw new Err('something extra at the end of the line');
    return { node: { type: 'do', action: kw, params: bind(a, ar, kw), line } };
  }

  /** Before compiling: the named blocks (top level only) and every name that's a variable. */
  function prescan(root, errors) {
    root.children.forEach((ln) => {
      const t = ln.tokens;
      if (!(t[0] && t[0].t === 'id' && t[0].v === 'def')) return;
      try {
        const c = cursor(t, {});
        c.next();
        const name = c.take('id', undefined, 'a name for the block').v;
        if (taken(name)) throw new Err(`“${name}” is already a word of the language — pick another name`);
        if (ctx.defs[name]) throw new Err(`there are two blocks named “${name}”`);
        const params = [];
        if (c.is('p', '(')) {
          c.next();
          while (!c.is('p', ')')) {
            params.push(c.take('id', undefined, 'an option name').v);
            if (c.is('p', ',')) c.next();
            else if (!c.is('p', ')')) throw new Err('options are separated by commas');
          }
          c.next();
        }
        endColon(c);
        needBlock(ln, 'def');
        ctx.defs[name] = { params, ln };
        params.forEach((p) => ctx.vars.add(p));
      } catch (e) {
        if (!e.script) throw e;
        ln.bad = true;
        errors.push({ line: ln.line, message: e.message });
      }
    });
    const walk = (ln) => {
      const t = ln.tokens;
      if (t[0] && t[0].t === 'id' && t[1] && t[1].t === 'op' && t[1].v === '=') ctx.vars.add(t[0].v);
      if (t[0] && t[0].t === 'id' && t[0].v === 'for' && t[1] && t[2] && t[2].v === 'in' && t[3] && !(t[3].t === 'p' && t[3].v === '[')) ctx.vars.add(t[1].v);
      ln.children.forEach(walk);
    };
    root.children.forEach(walk);
  }

  // what a statistic can't do: it only reads the game, and has to finish at once
  const NOT_IN_STATS = {
    do: 'a statistic only reads the game — it can’t act (that’s for macros)',
    wait: 'a statistic is worked out at once — it can’t wait',
    sleep: 'a statistic is worked out at once — it can’t wait',
    until: 'a statistic is worked out at once — “while” and “repeat until” could run on and on (use for, or repeat N times)',
    forever: 'a statistic is worked out at once — “forever” never ends',
    parallel: 'a statistic is worked out at once — it has no branches side by side',
    stop: 'a statistic ends with “return” (or with nothing to show)',
  };
  function checkStat(nodes, errors) {
    (nodes || []).forEach((n) => {
      if (NOT_IN_STATS[n.type]) errors.push({ line: n.line || 0, message: NOT_IN_STATS[n.type] });
      ['then', 'else', 'body'].forEach((k) => checkStat(n[k], errors));
      (n.branches || []).forEach((b) => checkStat(b, errors));
    });
  }

  /**
   * Source → { flow: blocks, errors: [{ line, message }] }. opts.vars: names that are variables from
   * the start (a macro's inputs; a statistic's `item`); opts.mode: 'macro' (the default) or 'stat';
   * opts.item: a statistic about an item (its words, item.price()…, allowed).
   */
  function compile(source, opts = {}) {
    const { root, errors } = lineTree(source);
    let flow = [];
    ctx = freshCtx(opts.vars, opts);
    try {
      prescan(root, errors);
      flow = block(root.children, {}, errors);
      if (opts.mode === 'stat') checkStat(flow, errors);
    } catch (e) {
      errors.push({ line: 0, message: String(e.message || e) });
    } finally {
      ctx = freshCtx();
    }
    const seen = new Set();
    const unique = errors.filter((e) => {
      const k = `${e.line}|${e.message}`;
      return !seen.has(k) && seen.add(k);
    });
    unique.sort((x, y) => x.line - y.line);
    return { flow, errors: unique };
  }

  // ---- evaluating values and conditions (with an explanation) -------------------------------------

  const fmtNum = (v) => CA.Format.beautify(v, Number.isInteger(v) ? 0 : 2);
  const num = (v) => (typeof v === 'boolean' ? (v ? 1 : 0) : Number(v));
  /** A value's value now; `env`: the variables of the run. */
  function valueOf(o, env) {
    if (!o) return NaN;
    if (o.v === 'lit') return o.x;
    if (o.v === 'var') return env && Object.prototype.hasOwnProperty.call(env, o.name) ? env[o.name] : undefined;
    if (o.v === 'neg') return -num(valueOf(o.a, env));
    if (o.v === 'list') return o.items.map((x) => valueOf(x, env));
    if (o.v === 'bin') {
      const a = valueOf(o.a, env);
      const b = valueOf(o.b, env);
      if (o.op === '+') return typeof a === 'string' || typeof b === 'string' ? `${a}${b}` : num(a) + num(b);
      if (o.op === '-') return num(a) - num(b);
      if (o.op === '*') return num(a) * num(b);
      if (o.op === '/') return num(a) / num(b);
      return num(a) % num(b);
    }
    const def = valueById[o.id];
    try {
      return def ? def.get(...(o.args || []).map((x) => valueOf(x, env))) : NaN;
    } catch (e) {
      return NaN;
    }
  }
  /** An action's / condition's params with their expressions worked out. */
  function resolve(params, env) {
    if (!params) return params;
    let out = null;
    Object.keys(params).forEach((k) => {
      const v = params[k];
      if (v && typeof v === 'object' && v.$e) {
        out = out || { ...params };
        out[k] = valueOf(v.$e, env);
      }
    });
    return out || params;
  }
  const showVal = (v) => (v === undefined ? '(not set)' : Array.isArray(v) ? `[${v.length} item${v.length === 1 ? '' : 's'}]` : typeof v === 'number' ? fmtNum(v) : String(v));
  const shown = (o, v) => (o.v === 'lit' ? exprText(o) : `${exprText(o)} = ${showVal(v)}`);
  const truthy = (v) => !!v && !(typeof v === 'number' && !Number.isFinite(v)) && !(Array.isArray(v) && !v.length);

  /** Evaluates a condition: { ok, text } — text with the values it saw ("owned(christmas, upgrades) = 12 ≥ 15 ✗"). */
  function evaluate(e, env) {
    if (!e) return { ok: false, text: '?' };
    if (e.all) return { ok: CA.Conditions.test(e), text: CA.Conditions.describe(e) }; // blocks from before v2.24
    if (e.t === 'and' || e.t === 'or') {
      const a = evaluate(e.a, env);
      // short-circuit like the words say
      if (e.t === 'and' && !a.ok) return { ok: false, text: `${a.text} and …` };
      if (e.t === 'or' && a.ok) return { ok: true, text: `${a.text} or …` };
      const b = evaluate(e.b, env);
      return { ok: e.t === 'and' ? a.ok && b.ok : a.ok || b.ok, text: `${a.text} ${e.t} ${b.text}` };
    }
    if (e.t === 'not') {
      const a = evaluate(e.a, env);
      return { ok: !a.ok, text: `not (${a.text})` };
    }
    if (e.t === 'cond') {
      const one = { all: [{ cond: e.id, params: resolve(e.params, env), not: false }] };
      const ok = CA.Conditions.test(one);
      return { ok, text: `${CA.Conditions.describe(one)} ${ok ? '✓' : '✗'}` };
    }
    if (e.t === 'val') {
      const v = valueOf(e.e, env);
      const ok = truthy(v);
      return { ok, text: `${shown(e.e, v)} ${ok ? '✓' : '✗'}` };
    }
    const l = valueOf(e.l, env);
    const r = valueOf(e.r, env);
    let ok = false;
    const nl = num(l);
    const nr = num(r);
    const numeric = Number.isFinite(nl) && Number.isFinite(nr) && typeof l !== 'string' && typeof r !== 'string';
    if (e.op === '==') ok = numeric ? nl === nr : String(l) === String(r);
    else if (e.op === '!=') ok = numeric ? nl !== nr : String(l) !== String(r);
    else if (numeric) ok = e.op === '>=' ? nl >= nr : e.op === '<=' ? nl <= nr : e.op === '>' ? nl > nr : nl < nr;
    const sym = { '>=': '≥', '<=': '≤', '==': '=', '!=': '≠', '>': '>', '<': '<' }[e.op];
    return { ok, text: `${shown(e.l, l)} ${sym} ${shown(e.r, r)} ${ok ? '✓' : '✗'}` };
  }

  // ---- blocks → source (the code a shortcut macro amounts to; v2.22's blocks) -----------------------

  /** A value as code: bare when it's a plain word (hand → hand), quoted otherwise ("hand of fate", ">="). */
  const litText = (v) => (typeof v === 'string' && !/^[A-Za-z_][\w.\-']*$/.test(v) ? `"${v}"` : String(v));
  const PREC = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2 };
  /** A value node as code, with the brackets it needs where it sits. */
  function exprText(o, outer = 0, right = false) {
    if (!o) return '?';
    // a word that's also a value's name, a keyword or true / false stays quoted ("building" is text; building would be the value)
    if (o.v === 'lit') return typeof o.x === 'string' && (valueById[o.x] || KEYWORDS.includes(o.x) || o.x === 'true' || o.x === 'false') ? `"${o.x}"` : litText(o.x);
    if (o.v === 'var') return o.name;
    // inside a call's brackets a word is always text: no quotes needed there
    if (o.v === 'fn') return `${o.id}(${(o.args || []).map((a) => (a.v === 'lit' ? litText(a.x) : exprText(a))).join(', ')})`;
    if (o.v === 'neg') return `-${exprText(o.a, 3)}`;
    if (o.v === 'list') return `[${o.items.map((x) => exprText(x)).join(', ')}]`;
    const p = PREC[o.op] || 1;
    const s = `${exprText(o.a, p)} ${o.op} ${exprText(o.b, p, true)}`;
    return p < outer || (right && p === outer) ? `(${s})` : s;
  }
  const paramText = (v) => (v && typeof v === 'object' && v.$e ? exprText(v.$e) : litText(v));
  function argText(def, params) {
    const list = (def && def.params) || [];
    const vals = list.map((p) => (params && params[p.key] !== undefined ? params[p.key] : p.default));
    // trailing defaults are left out — unless they were written out (params has them)
    const given = (k) => !!params && params[list[k].key] !== undefined;
    while (vals.length && list[vals.length - 1] && vals[vals.length - 1] === list[vals.length - 1].default && !given(vals.length - 1)) vals.pop();
    return vals.map(paramText).join(', ');
  }
  /** A condition as code; `within` (and / or / not) is what it sits in, for the parentheses it needs. */
  function condText(c, within) {
    if (!c) return 'true';
    const wrap = (s, t) => (within === 'not' || (within === 'and' && t === 'or') ? `(${s})` : s);
    if (c.all) return wrap(c.all.map((x) => `${x.not ? 'not ' : ''}${x.cond}(${argText(CA.Conditions.get(x.cond), x.params)})`).join(' and '), c.all.length > 1 ? 'and' : '');
    if (c.t === 'and' || c.t === 'or') return wrap(`${condText(c.a, c.t)} ${c.t} ${condText(c.b, c.t)}`, c.t);
    if (c.t === 'not') return `not ${condText(c.a, 'not')}`;
    if (c.t === 'cond') return `${c.id}(${argText(CA.Conditions.get(c.id), c.params)})`;
    if (c.t === 'val') return exprText(c.e);
    return `${exprText(c.l)} ${c.op} ${exprText(c.r)}`;
  }
  function decompile(nodes, depth = 0) {
    const pad = '  '.repeat(depth);
    return (nodes || [])
      .map((n) => {
        if (n.type === 'do') return `${pad}${n.action}(${argText(CA.Actions.get(n.action), n.params)})`;
        if (n.type === 'wait') return `${pad}wait until ${condText(n.cond)}`;
        if (n.type === 'sleep') return `${pad}wait ${n.secs} seconds`;
        if (n.type === 'until') return `${pad}repeat until ${condText(n.cond)}:\n${decompile(n.body, depth + 1) || `${pad}  log "…"`}`;
        if (n.type === 'times') return `${pad}repeat ${n.n} times:\n${decompile(n.body, depth + 1)}`;
        if (n.type === 'forever') return `${pad}forever:\n${decompile(n.body, depth + 1)}`;
        if (n.type === 'each') return `${pad}for ${n.name} in ${exprText(n.list)}:\n${decompile(n.body, depth + 1)}`;
        if (n.type === 'set') return `${pad}${n.name} = ${n.cond ? condText(n.cond) : exprText(n.e)}`;
        if (n.type === 'stop') return `${pad}stop`;
        if (n.type === 'return') return `${pad}return${n.cond ? ` ${condText(n.cond)}` : n.e ? ` ${exprText(n.e)}` : ''}`;
        if (n.type === 'log') return n.e ? `${pad}log ${exprText(n.e)}` : `${pad}log "${n.text}"`;
        if (n.type === 'if') return `${pad}if ${condText(n.cond)}:\n${decompile(n.then, depth + 1)}${n.else && n.else.length ? `\n${pad}else:\n${decompile(n.else, depth + 1)}` : ''}`;
        if (n.type === 'parallel') return `${pad}parallel:\n${(n.branches || []).map((b, i) => `${pad}  branch${n.labels && n.labels[i] ? ` ${n.labels[i]}` : ''}:\n${decompile(b, depth + 2)}`).join('\n')}`;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }

  // ---- running a statistic --------------------------------------------------------------------------

  const STEP_LIMIT = 5000;
  const TRACE_MAX = 300;
  /** A value, short, for a trace: 1.25e+6, "text", yes, [1, 2, 3]. */
  function brief(x) {
    if (typeof x === 'boolean') return x ? 'yes' : 'no';
    if (typeof x === 'string') return JSON.stringify(x.length > 40 ? `${x.slice(0, 40)}…` : x);
    if (typeof x === 'number') return Number.isFinite(x) ? String(Number(x.toPrecision(6))) : String(x);
    if (Array.isArray(x)) return `[${x.slice(0, 5).map(brief).join(', ')}${x.length > 5 ? ', …' : ''}]`;
    return x === undefined ? 'nothing' : String(x);
  }
  /**
   * Runs a statistic's blocks (compiled with { mode: 'stat' }) start to finish. `env`: its variables
   * to start with (item). → { returned, value, vars, steps, error } — vars: every variable as it ended
   * (a statistic may set label, note, color); error: what stopped it (the step limit). opts.trace:
   * also → trace, what each line did in order ([{ line, text }], the first TRACE_MAX), for the editor.
   */
  function runStat(flow, env = {}, opts = {}) {
    const vars = { ...env };
    let steps = 0;
    const DONE = {};
    let out = { returned: false, value: undefined };
    const trace = opts.trace ? [] : null;
    const note = (n, text) => trace && trace.length < TRACE_MAX && trace.push({ line: n.line || 0, text });
    const run = (nodes) => {
      (nodes || []).forEach((n) => {
        if (++steps > STEP_LIMIT) throw new Error(`still going after ${STEP_LIMIT} steps — a loop too long?`);
        if (n.type === 'set') {
          vars[n.name] = n.cond ? evaluate(n.cond, vars).ok : valueOf(n.e, vars);
          note(n, `${n.name} = ${brief(vars[n.name])}`);
        } else if (n.type === 'if') {
          const ok = evaluate(n.cond, vars).ok;
          note(n, ok ? 'if: yes' : 'if: no');
          run(ok ? n.then : n.else);
        } else if (n.type === 'times') {
          note(n, `repeat ${n.n} times`);
          for (let i = 0; i < n.n; i++) run(n.body);
        }
        else if (n.type === 'each') {
          const list = valueOf(n.list, vars);
          const items = Array.isArray(list) ? list.slice() : [];
          note(n, `for ${n.name}: ${items.length} item${items.length === 1 ? '' : 's'}`);
          items.forEach((it) => {
            vars[n.name] = it;
            run(n.body);
          });
        } else if (n.type === 'return') {
          out = { returned: true, value: n.cond ? evaluate(n.cond, vars).ok : n.e ? valueOf(n.e, vars) : undefined };
          note(n, `return ${brief(out.value)}`);
          throw DONE;
        } else if (n.type === 'log') note(n, `log ${n.e ? brief(valueOf(n.e, vars)) : n.text}`);
      });
    };
    try {
      run(flow);
    } catch (e) {
      if (e !== DONE) return { returned: false, value: undefined, vars, steps, error: String(e.message || e), trace };
    }
    return { ...out, vars, steps, trace };
  }

  // ---- the library beside the editor ------------------------------------------------------------

  /** Everything you can write, for the side table: [{ kind, id, sig, desc, group, insert }]. opts.mode 'stat': a statistic's (words about its item too, no actions). */
  function library(opts = {}) {
    const stat = opts.mode === 'stat';
    const items = [];
    const sig = (id, def) => `${id}(${((def && def.params) || []).map((p) => p.key).join(', ')})`;
    const snippet = (id, def) => `${id}(${argText(def, {}) || ((def && def.params) || []).map((p) => (p.default !== undefined && p.default !== '' ? litText(p.default) : p.key)).join(', ')})`;
    if (!stat) CA.Actions.all().filter((a) => !a.hidden).forEach((a) => items.push({ kind: 'action', id: a.id, sig: sig(a.id, a), desc: a.name, group: a.group, icon: a.icon, insert: snippet(a.id, a) }));
    CA.Conditions.all().forEach((c) => items.push({ kind: 'condition', id: c.id, sig: sig(c.id, c), desc: c.name, group: 'Conditions', icon: c.icon, insert: snippet(c.id, c) }));
    VALUES.filter((v) => !v.hidden && (stat || !v.context)).forEach((v) => items.push({ kind: 'value', id: v.id, origin: originOf(v.id), sig: `${v.id}(${(v.params || []).join(', ')})`, desc: v.desc, group: v.group ? `Values · ${v.group}` : 'Values', icon: 'graphs', insert: `${v.id}(${(v.params || []).join(', ')})` }));
    [
      ['repeat until …:', 'run the block each pass until something holds', 'repeat until cookies() >= 1e12:\n  '],
      ['while …:', 'run the block each pass while something holds', 'while buff(Frenzy):\n  '],
      ['if … / elif … / else:', 'one way or another', 'if cookies() > 1e12:\n  \nelse:\n  '],
      ['for … in [ … ]:', 'the block once per item', 'for season in [easter, halloween]:\n  '],
      ['for … in list():', 'the block for each item of a live list', 'for b in buildings():\n  '],
      ['name = …', 'a variable: a number, text, or yes / no', 'target = cookies() * 0.1'],
      ['def name(…):', 'a named block, called like an action', 'def name(x):\n  '],
      ['repeat N times:', 'the block N times', 'repeat 5 times:\n  '],
      ['forever:', 'the block again and again', 'forever:\n  '],
      ['parallel:', 'branches side by side', 'parallel:\n  branch a:\n    \n  branch b:\n    '],
      ['wait until …', 'wait for something', 'wait until magic() >= 80'],
      ['wait N seconds', 'pause', 'wait 30 seconds'],
      ['switch on / off …', 'switch other macros, one or several', 'switch on golden, wrath'],
      ['stop', 'end the macro here', 'stop'],
      ['log …', 'write to its trace (text, or a value)', 'log "here"'],
      ['return …', 'a statistic’s result (no return: nothing to show)', 'return '],
    ]
      .filter(([s]) => (stat ? !/^(repeat until|while|forever|parallel|wait|switch|stop)/.test(s) : s !== 'return …'))
      .forEach(([s, d, ins]) => items.push({ kind: 'keyword', id: s, sig: s, desc: d, group: 'Keywords', icon: 'edit', insert: ins }));
    return items;
  }

  // ---- the Lookup: the names that go inside ( ) — spells, effects, macros, seasons, buildings… ----

  const lookupsExtra = [];
  /** A list of names for the Lookup that no action's or condition's choice already gives: { name, uses, items() → [{ v, label }] }. */
  const defineLookup = (l) => lookupsExtra.push(l);
  /**
   * Every list of names you can write inside ( ), grouped: [{ name, uses: ['spell.cast(spell)', …],
   * items: [{ v, label, code }] }] — from the choices of every action and condition (one list per kind
   * of choice: "Spell", "Effect", "Macro"…) and the ones defined with defineLookup (buildings…).
   */
  function lookups() {
    const by = {};
    const group = (name) => by[name] || (by[name] = { name, uses: new Set(), items: new Map() });
    const add = (g, list) =>
      (list || []).forEach((o) => {
        if (!o || o.v == null || o.v === '' || g.items.has(String(o.v))) return;
        g.items.set(String(o.v), { v: o.v, label: String(o.label != null ? o.label : o.v), code: litText(o.v) });
      });
    [...CA.Actions.all(), ...CA.Conditions.all()].forEach((d) =>
      (d.params || []).forEach((p) => {
        if (p.type !== 'select') return;
        let opts;
        try {
          opts = typeof p.options === 'function' ? p.options() : p.options;
        } catch (e) {
          return;
        }
        const g = group(p.label);
        g.uses.add(`${d.id}(${p.key})`);
        add(g, opts);
      })
    );
    lookupsExtra.forEach((l) => {
      const g = group(l.name);
      (l.uses || []).forEach((u) => g.uses.add(u));
      try {
        add(g, l.items());
      } catch (e) {
        /* not available yet */
      }
    });
    return Object.values(by)
      .filter((g) => g.items.size)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((g) => ({ name: g.name, uses: [...g.uses], items: [...g.items.values()] }));
  }
  /**
   * The fixed lists each call's params pick from (the Lookup's, by call): { id: [{ key, name, items }] }
   * — spell.cast(spell) → the spells; the code editor's library lists them under the call.
   */
  function choiceLists() {
    const out = {};
    const put = (id, key, name, items) => {
      const list = (out[id] = out[id] || []);
      if (items.length && !list.some((c) => c.key === key)) list.push({ key, name, items });
    };
    const itemsOf = (list) => {
      const seen = new Set();
      return (list || []).filter((o) => o && o.v != null && o.v !== '' && !seen.has(String(o.v)) && seen.add(String(o.v))).map((o) => ({ v: o.v, label: String(o.label != null ? o.label : o.v), code: litText(o.v) }));
    };
    // each call's own choices (the Lookup merges lists that share a name: every family's "Profile")
    [...CA.Actions.all(), ...CA.Conditions.all()].forEach((d) =>
      (d.params || []).forEach((p) => {
        if (p.type !== 'select') return;
        try {
          put(d.id, p.key, p.label, itemsOf(typeof p.options === 'function' ? p.options() : p.options));
        } catch (e) {
          /* not available yet */
        }
      })
    );
    lookupsExtra.forEach((l) => {
      let items;
      try {
        items = itemsOf(l.items());
      } catch (e) {
        return;
      }
      (l.uses || []).forEach((u) => {
        const m = String(u).match(/^(.+)\((\w+)\)$/);
        if (m) put(m[1], m[2], l.name, items);
      });
    });
    return out;
  }
  /** A call written with one param picked (callWith('spell.cast', 'spell', 'hand of fate') → spell.cast("hand of fate")); the others as the library writes them. */
  function callWith(id, key, v) {
    const def = (CA.Actions && CA.Actions.get(id)) || (CA.Conditions && CA.Conditions.get(id));
    const ps = def ? (def.params || []).map((p) => (typeof p === 'string' ? { key: p } : p)) : ((valueById[id] && valueById[id].params) || [key]).map((p) => ({ key: p }));
    const has = (p) => p.default !== undefined && p.default !== '';
    const vals = ps.map((p) => (p.key === key ? litText(v) : has(p) ? paramText(p.default) : p.key));
    // trailing defaults are left out
    while (vals.length > 1 && ps[vals.length - 1].key !== key && has(ps[vals.length - 1])) vals.pop();
    return `${id}(${vals.join(', ')})`;
  }
  // the values' own names
  defineLookup({ name: 'Building', uses: ['building(name)'], items: () => Object.keys((typeof Game !== 'undefined' && Game.Objects) || {}).map((n) => ({ v: n, label: n })) });

  /** Adds a value conditions can compare (e.g. the garden's): { id, desc, params, get(...args) }. */
  let rev = 0; // goes up when the values change (a statistic added, renamed, deleted)
  function defineValue(v) {
    if (valueById[v.id]) return valueById[v.id];
    rev++;
    VALUES.push(v);
    valueById[v.id] = v;
    return v;
  }
  /** Takes a value away again (a statistic deleted or renamed). */
  function removeValue(id) {
    const v = valueById[id];
    if (!v) return;
    rev++;
    delete valueById[id];
    VALUES.splice(VALUES.indexOf(v), 1);
  }
  const isValue = (id) => !!valueById[id];

  return { compile, evaluate, value: valueOf, resolve, exprText, decompile, library, lookups, choiceLists, callWith, defineLookup, litText, defineValue, removeValue, isValue, originOf, ORIGINS, revision: () => rev, runStat, VALUES, KEYWORDS, tokenize };
})();
