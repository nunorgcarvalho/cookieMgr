// The code editor for algorithmic code (features/script.js), and the library beside it — used by
// the macro editor and the Garden page's rules. Any number of editors can be on a page, each with
// its own key.
//
//   CA.UI.CodeEditor.html(key, source, { title, hint })   the editor: numbered, colored lines, the
//                                                          problems under it, what it's doing when it
//                                                          runs, and a "how it reads" crib sheet
//   CA.UI.CodeEditor.lineHtml(key, source, { placeholder, bad })
//                                                          a one-line editor (a condition, a value):
//                                                          colored, its words hover like the editor's;
//                                                          Enter leaves it (its change event fires)
//   CA.UI.CodeEditor.libraryHtml(key, { first, mode })     every action / condition / value / keyword,
//                                                          searchable, ★ to pin (in place: nothing
//                                                          moves); a call whose param picks from a
//                                                          fixed list (spell.cast(spell)) opens that
//                                                          list under its row, each value with what
//                                                          it is, click one to write the call with it;
//                                                          `first`: group names
//                                                          (or prefixes) to list first; mode 'stat': a
//                                                          statistic's (CA.Script.library)
//   html(…, { mode: 'stat', item })                        the code is a statistic's (about an item, or
//                                                          the game): checked as one
//   CA.UI.CodeEditor.bind(root, { onChange(key, source), onPick(key, item) })
//                                                          listens on `root`; onPick may handle a
//                                                          library click itself (return true), else
//                                                          the item is inserted into editor `key`
//                                                          (a possible value picked: item.params has
//                                                          it, item.insert the call written with it)
//   CA.UI.CodeEditor.setLive(root, key, { lines, html })   lights up running lines, shows what it does
//   CA.UI.CodeEditor.legendHtml()                          what the colors mean (under each editor,
//                                                          atop the Statistics catalog)
//
// The code is a <textarea> lying exactly on a highlighted copy of itself — only the outer box
// scrolls, so the caret can't drift from the text.

CA.UI = CA.UI || {};

CA.UI.CodeEditor = (() => {
  const I = (n, s) => CA.UI.Icons.html(n, s);
  const esc = (s) => CA.Util.escapeHtml(s);
  const LIB_FAVS = 'libFavs';
  let libItems = [];

  // ---- the library ------------------------------------------------------------------------

  const favs = () =>
    String(CA.Settings.get(LIB_FAVS) || '')
      .split('\n')
      .filter(Boolean);
  function toggleFav(k) {
    const list = favs();
    const i = list.indexOf(k);
    if (i >= 0) list.splice(i, 1);
    else list.push(k);
    CA.Settings.set(LIB_FAVS, list.join('\n'));
  }

  const favBtn = (k, on) =>
    `<button type="button" class="ca-iconbtn ca-lib-fav${on ? ' on' : ''}" data-lib-fav="${esc(k)}" data-tip="${on ? 'Unpin' : 'Pin: a copy waits in Pinned, at the top'}">${I(on ? 'star' : 'starOutline', 11)}</button>`;

  let lookItems = []; // the Lookup's names, by index (data-lib-lit)
  /** The Lookup tab: every list of names that go inside ( ), click one to write it where the cursor is. */
  function lookupHtml() {
    lookItems = [];
    return CA.Script.lookups()
      .map(
        (g) =>
          `<div class="ca-lib-group ca-lib-look"><div class="ca-lib-ghead">${esc(g.name)} <span class="ca-lib-uses">${esc(g.uses.slice(0, 3).join(' · '))}${g.uses.length > 3 ? ' …' : ''}</span></div>` +
          g.items
            .map((it) => {
              lookItems.push(it);
              return (
                `<div class="ca-lib-row ca-lib-lit" data-lib-text="${esc(`${it.code} ${it.label} ${g.name}`.toLowerCase())}">` +
                `<button type="button" class="ca-lib-ins" data-lib-lit="${lookItems.length - 1}"><code>${esc(it.code)}</code></button>` +
                (it.label !== String(it.v) ? `<span class="ca-lib-desc">${esc(it.label)}</span>` : '') +
                '</div>'
              );
            })
            .join('') +
          '</div>'
      )
      .join('');
  }

  // ---- a call's possible values (spell.cast(spell) → the spells), listed under its row ----------

  let libChoices = {}; // call id → [{ key, name, items }] (CA.Script.choiceLists), for the library on show
  const choicesOf = (it) => (it && (it.kind === 'action' || it.kind === 'condition' || it.kind === 'value') && libChoices[it.id]) || [];
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  // "9 spells", "21 auras"; a list named by a question ("How", "Which") or by several words: "3 choices"
  const countOf = (c) => {
    const w = String(c.name).toLowerCase();
    return /^[a-z]+$/.test(w) && !/(s|h|x)$/.test(w) && !['how', 'what', 'where', 'which', 'is', 'of'].includes(w) ? plural(c.items.length, w) : plural(c.items.length, 'choice');
  };
  /** What one possible value is, in a line: its word's card (a spell's effect…), else nothing. */
  function optDesc(it, c, o) {
    if (!CA.ScriptWords) return ''; // the simulator's GUI has no ScriptWords
    const src = CA.Script.callWith(it.id, c.key, o.v);
    const at = src.lastIndexOf(o.code);
    let info = null;
    try {
      info = at >= 0 ? CA.ScriptWords.explain(src, 1, at) : null;
    } catch (e) {
      info = null;
    }
    if (!info || info.kind === 'choice' || info.kind === 'param') return '';
    const d = String(info.desc || '').trim();
    return d && d !== o.label ? d : '';
  }
  /** The list under a row: each possible value of each of its lists, click one to write the call with it. */
  function optsHtml(i) {
    const it = libItems[i];
    return (
      `<div class="ca-lib-opts" data-lib-opts="${i}">` +
      choicesOf(it)
        .map(
          (c, ci) =>
            `<div class="ca-lib-ophead">${esc(c.name)} <span class="ca-lib-uses">${esc(c.key)} · ${plural(c.items.length, 'choice')} · click one to write it</span></div>` +
            c.items
              .map((o, oi) => {
                const d = optDesc(it, c, o);
                return (
                  `<button type="button" class="ca-lib-opt" data-lib-opt="${i}:${ci}:${oi}" data-lib-text="${esc(`${o.code} ${o.label}`.toLowerCase())}"${d ? ` data-tip="${esc(d)}"` : ''}>` +
                  `<code>${esc(o.code)}</code>` +
                  (o.label !== String(o.v) ? `<span class="ca-lib-opt-label">${esc(o.label)}</span>` : '') +
                  (d ? `<span class="ca-lib-opt-desc">${esc(d)}</span>` : '') +
                  '</button>'
                );
              })
              .join('')
        )
        .join('') +
      '</div>'
    );
  }
  /** Opens (or closes) the possible values under a row; `open` forces it. */
  function toggleOpts(row, open) {
    const i = Number(row.querySelector('[data-lib-insert]').dataset.libInsert);
    const btn = row.querySelector('[data-lib-open]');
    let box = row.nextElementSibling && row.nextElementSibling.matches('[data-lib-opts]') ? row.nextElementSibling : null;
    const want = open !== undefined ? open : !box || box.hidden;
    if (want && !box) {
      const tmp = document.createElement('div');
      tmp.innerHTML = optsHtml(i);
      box = tmp.firstChild;
      row.after(box);
    }
    if (box) box.hidden = !want;
    row.classList.toggle('open', want);
    if (btn) btn.setAttribute('aria-expanded', String(want));
    return box;
  }

  function libraryHtml(key, opts = {}) {
    libItems = CA.Script.library({ mode: opts.mode });
    try {
      libChoices = CA.Script.choiceLists ? CA.Script.choiceLists() : {};
    } catch (e) {
      libChoices = {};
    }
    const pins = favs();
    const fk = (it) => `${it.kind}:${it.id}`;
    const row = (it, i) => {
      const ch = choicesOf(it);
      const n = ch.reduce((a, c) => a + c.items.length, 0);
      // its possible values join its search text, so "hand of fate" finds spell.cast
      const optText = ch.map((c) => c.items.map((o) => `${o.code} ${o.label}`).join(' ')).join(' ');
      return (
        `<div class="ca-lib-row ca-lib-${it.kind}${it.origin ? ` ca-lib-o-${it.origin}` : ''}" data-lib-text="${esc(`${it.sig} ${it.desc} ${it.group} ${it.origin ? CA.Script.ORIGINS[it.origin].name : ''}`.toLowerCase())}"${optText ? ` data-lib-opt-text="${esc(optText.toLowerCase())}"` : ''}>` +
        // a word's code is a code view: hovering it shows its card, which links to more
        `<button type="button" class="ca-lib-ins" data-lib-insert="${i}">${I(it.icon || 'bolt', 12)}<code class="ca-hl"${it.kind === 'value' || it.kind === 'action' || it.kind === 'condition' ? ` data-code-view="${esc(it.sig)}"` : ''}>${it.kind === 'keyword' ? esc(it.sig) : highlightLine(it.sig)}</code></button>` +
        `<span class="ca-lib-desc">${esc(it.desc)}${
          n
            ? ` <button type="button" class="ca-lib-more" data-lib-open aria-expanded="false" data-tip="${esc(`What ${ch.map((c) => c.key).join(' / ')} can be: each one, what it is — click one to write it`)}"><i class="ca-lib-caret">▸</i>${ch.map((c) => esc(countOf(c))).join(' · ')}</button>`
            : ''
        }</span>` +
        favBtn(fk(it), pins.includes(fk(it))) +
        '</div>'
      );
    };
    const pinned = libItems.map((it, i) => [it, i]).filter(([it]) => pins.includes(fk(it)));
    const groups = {};
    const gname = (it) => (it.kind === 'action' ? `Actions · ${it.group}` : it.group);
    libItems.forEach((it, i) => (groups[gname(it)] = groups[gname(it)] || []).push([it, i]));
    // groups named in opts.first (exactly, or by prefix) come first
    const first = opts.first || [];
    const rank = (g) => {
      const k = first.findIndex((f) => g === f || g.startsWith(f) || g.endsWith(f));
      return k < 0 ? first.length : k;
    };
    const names = Object.keys(groups).sort((a, b) => rank(a) - rank(b));
    return (
      `<aside class="ca-ed-lib" data-ed-lib="${esc(key)}" data-first="${esc(first.join('|'))}"${opts.mode ? ` data-mode="${esc(opts.mode)}"` : ''}>` +
      `<div class="ca-lib-head">${I('search', 12)}<input type="search" placeholder="Actions, conditions, values, names…" data-lib-search></div>` +
      '<div class="ca-lib-tabs">' +
      `<button type="button" class="ca-chip on" data-lib-tab="words">${I('bolt', 11)} Library</button>` +
      `<button type="button" class="ca-chip" data-lib-tab="lookup" data-tip="The names that go inside ( ): spells, effects, macros, seasons, buildings…">${I('search', 11)} Lookup</button>` +
      '</div>' +
      `<div class="ca-lib-body ca-lib-lookup" data-lib-pane="lookup" hidden>${lookupHtml()}</div>` +
      '<div class="ca-lib-body" data-lib-pane="words">' +
      `<div class="ca-lib-group ca-lib-pinned"><div class="ca-lib-ghead">${I('star', 11)} Pinned</div>${
        pinned.length ? pinned.map(([it, i]) => row(it, i)).join('') : '<div class="ca-lib-empty">★ an item to keep it here</div>'
      }</div>` +
      names.map((g) => `<div class="ca-lib-group"><div class="ca-lib-ghead">${esc(g)}</div>${groups[g].map(([it, i]) => row(it, i)).join('')}</div>`).join('') +
      '</div></aside>'
    );
  }

  // ---- the code ---------------------------------------------------------------------------

  // syntax coloring (one line at a time). A word is colored by what it is and where it comes from
  // (CA.ScriptWords.words): a value by its origin (CA.Script.originOf) — the game's, cookieMgr's, a
  // statistic, yours, a function — and a name inside ( ) by what it names: cookieMgr's own (a macro,
  // a profile) or the game's (a building, a spell…).
  const KW = new Set(['if', 'elif', 'else', 'for', 'in', 'def', 'repeat', 'until', 'while', 'times', 'forever', 'parallel', 'branch', 'wait', 'seconds', 'second', 'minutes', 'minute', 'stop', 'log', 'switch', 'on', 'off', 'and', 'or', 'not', 'true', 'false', 'return']);
  const MINE = new Set(['macro', 'manager', 'setting']); // and profile.*
  const GAMES = new Set(['building', 'upgrade', 'spell', 'season', 'effect', 'spirit', 'aura']);
  function wordClass(kind, id) {
    if (kind === 'keyword') return 'hk';
    if (kind === 'action') return 'ha';
    if (kind === 'condition') return 'hq';
    if (kind === 'value') return `hv hv-${CA.Script.originOf(id) || 'cookieMgr'}`;
    if (MINE.has(kind) || /^profile\./.test(kind)) return 'hm';
    if (GAMES.has(kind)) return 'hg';
    return 'hi';
  }
  const fallbackClass = (w) => (KW.has(w) ? 'hk' : CA.Actions.get(w) ? 'ha' : CA.Conditions.get(w) ? 'hq' : CA.Script.isValue(w) ? `hv hv-${CA.Script.originOf(w)}` : 'hi');
  /** One line of code, colored. opts: { decl: CA.ScriptWords.declared(the whole code), vars: names it's given }. */
  function highlightLine(line, opts = {}) {
    let out = '';
    let i = 0;
    const span = (cls, t) => `<span class="${cls}">${esc(t)}</span>`;
    const at = {};
    try {
      CA.ScriptWords.words(line, opts).forEach((w) => (at[w.from] = w));
    } catch (e) {
      /* colored by the word alone */
    }
    while (i < line.length) {
      const rest = line.slice(i);
      let m;
      if (rest[0] === '#') {
        out += span('hc', rest);
        break;
      }
      if ((m = rest.match(/^("[^"]*"?|'[^']*'?)/))) out += span('hs', m[0]);
      else if ((m = rest.match(/^\d+(?:\.\d+)?(?:e[+-]?\d+)?(?:qa|qi|k|m|b|t)?(?![A-Za-z_])/i))) out += span('hn', m[0]);
      else if ((m = rest.match(/^[A-Za-z_][\w.\-']*\w|^[A-Za-z_]/))) {
        const w = m[0];
        const k = at[i];
        out += span(k && k.to - k.from === w.length ? wordClass(k.kind, k.id) : fallbackClass(w), w);
      } else if ((m = rest.match(/^(>=|<=|==|!=|>|<|=)/))) out += span('ho', m[0]);
      else {
        m = [rest[0]];
        out += esc(rest[0]);
      }
      i += m[0].length;
    }
    return out;
  }
  /** Every line of some code, colored (its variables known from the whole of it). */
  const highlightCode = (src, vars = []) => {
    const decl = CA.ScriptWords ? CA.ScriptWords.declared(src) : undefined; // the simulator's GUI has no ScriptWords
    return String(src || '')
      .split('\n')
      .map((l) => highlightLine(l, { decl, vars }));
  };

  // what the colors mean: [class, name, what it is]
  const LEGEND = [
    ['hv hv-game', 'Game', 'Read straight from the game: cookies(), stock.price(…), a building’s or spell’s name'],
    ['hv hv-cookieMgr', 'cookieMgr', 'Worked out by cookieMgr: payback periods, golden cookie odds, banks, item.payback()…'],
    ['hv hv-stat', 'Statistic', 'A built-in statistic (stat.…): code you can open, read and change'],
    ['hv hv-mine', 'Your statistic', 'A statistic you wrote'],
    ['hv hv-function', 'Function', 'Works on what you give it: fmt.number(x), count(list), finite(x)'],
    ['hm', 'Macro / profile', 'One of cookieMgr’s macros, managers or profiles, named in ( )'],
    ['ha', 'Action', 'Does something: clicks, buys, casts, switches'],
    ['hq', 'Condition', 'A yes / no check, after if, while, until'],
    ['hk', 'Keyword', 'The language itself: if, for, wait, return…'],
  ];
  /** What the colors mean: a row of colored names, each with a tip. */
  const legendHtml = () =>
    `<div class="ca-code-legend ca-hl" data-code-legend>${LEGEND.map(([cls, name, tip]) => `<span class="ca-code-key" data-tip="${esc(tip)}"><i class="${cls}">●</i><span class="${cls}">${esc(name)}</span></span>`).join('')}<span class="ca-code-key-more">hover a word: what it is · its card links to more</span></div>`;

  /** The code's lines, colored; its problems. copts: how it compiles ({ mode: 'stat', item } for a statistic's). */
  function view(src, vars, copts = {}) {
    const lines = String(src || '').split('\n');
    const { errors } = CA.Script.compile(src, { ...copts, vars });
    const bad = new Set(errors.map((e) => e.line));
    return {
      gutter: lines.map((_, i) => `<span class="${bad.has(i + 1) ? 'err' : ''}">${i + 1}</span>`).join(''),
      hl: highlightCode(src, vars).map((h, i) => `<span class="ca-hl-line${bad.has(i + 1) ? ' err' : ''}">${h || ' '}</span>`).join('\n') + '\n',
      status: errors.length
        ? `<div class="ca-code-bad">${I('close', 11)} ${errors.length} problem${errors.length === 1 ? '' : 's'}</div>` +
          errors
            .slice(0, 6)
            .map((e) => `<div class="ca-code-err" data-code-goto="${e.line}">line ${e.line}: ${esc(e.message)}</div>`)
            .join('')
        : `<div class="ca-code-ok">${I('play', 11)} ${lines.length} line${lines.length === 1 ? '' : 's'} · reads fine</div>`,
      errors,
    };
  }

  const HELP = [
    'pop.golden()                         run an action (options in brackets)',
    'season.keep(christmas)               …by position, or season.keep(season=christmas)',
    'switch on reindeer                   switch another macro on / off',
    'wait until magic() >= 80             wait for something  ·  wait 30 seconds',
    'repeat until owned(easter) >= 20:    a block, each pass, until it holds',
    'while buff(Frenzy):                  …as long as it holds',
    'repeat 5 times:   forever:',
    'if …:   elif …:   else:',
    'for season in [easter, halloween]:   once per item, “season” standing for it',
    'parallel:                            side by side:',
    '  branch a:                            each branch its own block',
    'stop     log "text"     # a comment',
    'conditions: and · or · not · ( … ) · comparisons: >= <= > < == !=',
    'numbers: 1e12, 25K, 2.5M, 3B, 1T',
  ].join('\n');

  function html(key, source, opts = {}) {
    const vars = opts.vars || [];
    const v = view(source, vars, compileOpts(opts.mode, opts.item));
    return (
      `<div class="ca-ed-sec ca-ed-code" data-code-ed="${esc(key)}"${vars.length ? ` data-code-vars="${esc(vars.join(','))}"` : ''}${opts.mode ? ` data-code-mode="${esc(opts.mode)}"` : ''}${opts.item ? ' data-code-item' : ''}><div class="ca-ed-sec-head">${I('edit', 12)} ${esc(opts.title || 'Algorithm')} <span class="ca-hint">${esc(
        opts.hint || 'indent a block under a line ending in “:” · Tab indents · click the library to insert'
      )}</span></div>` +
      '<div class="ca-code">' +
      `<div class="ca-code-gutter" data-code-gutter>${v.gutter}</div>` +
      `<div class="ca-code-box"><pre class="ca-code-hl" data-code-hl aria-hidden="true">${v.hl}</pre>` +
      `<textarea class="ca-code-ta" data-code spellcheck="false" wrap="off" autocomplete="off">${esc(source || '')}</textarea></div>` +
      '</div>' +
      `<div class="ca-code-status" data-code-status>${v.status}</div>` +
      '<div class="ca-code-live" data-code-live></div>' +
      legendHtml() +
      `<details class="ca-code-help"><summary>How it reads</summary><pre>${esc(HELP)}</pre></details></div>`
    );
  }

  const lineHl = (src) => `<span class="ca-hl-line">${highlightLine(String(src || '')) || ' '}</span>`;
  /** A one-line editor: no gutter or problems list (the page says what it makes of the code). */
  function lineHtml(key, source, opts = {}) {
    return (
      `<div class="ca-code-line${opts.bad ? ' bad' : ''}" data-code-ed="${esc(key)}" data-code-line>` +
      `<pre class="ca-code-hl" data-code-hl aria-hidden="true">${lineHl(source)}</pre>` +
      `<textarea class="ca-code-ta" data-code rows="1" spellcheck="false" wrap="off" autocomplete="off" placeholder="${esc(opts.placeholder || '')}">${esc(source || '')}</textarea>` +
      '</div>'
    );
  }

  const editorOf = (el) => el && el.closest && el.closest('[data-code-ed]');
  const compileOpts = (mode, item) => (mode ? { mode, item: !!item } : {});

  /** After typing: the colouring, the line numbers and the problems follow the code. */
  function refresh(ta) {
    const ed = editorOf(ta);
    if (!ed) return;
    if (ed.dataset.codeLine !== undefined) {
      const hl = ed.querySelector('[data-code-hl]');
      if (hl) {
        hl.innerHTML = lineHl(ta.value);
        hl.scrollLeft = ta.scrollLeft;
      }
      return;
    }
    const v = view(ta.value, (ed.dataset.codeVars || '').split(',').filter(Boolean), compileOpts(ed.dataset.codeMode, ed.dataset.codeItem !== undefined));
    const hl = ed.querySelector('[data-code-hl]');
    if (hl) hl.innerHTML = v.hl;
    const gut = ed.querySelector('[data-code-gutter]');
    if (gut) gut.innerHTML = v.gutter;
    const st = ed.querySelector('[data-code-status]');
    if (st) st.innerHTML = v.status;
  }

  /** Puts `text` into the code where the cursor is: on its own line, at that line's indentation. */
  function insert(ta, text) {
    const v = ta.value;
    const pos = ta.selectionStart != null ? ta.selectionStart : v.length;
    const lineStart = v.lastIndexOf('\n', pos - 1) + 1;
    let lineEnd = v.indexOf('\n', pos);
    if (lineEnd < 0) lineEnd = v.length;
    const line = v.slice(lineStart, lineEnd);
    const indent = (line.match(/^\s*/) || [''])[0] + (/:\s*$/.test(line) ? '  ' : '');
    const body = text.split('\n').join(`\n${indent}`);
    let next;
    let caret;
    if (!line.trim()) {
      next = v.slice(0, lineStart) + indent + body + v.slice(lineEnd);
      caret = lineStart + indent.length + body.length;
    } else {
      next = `${v.slice(0, lineEnd)}\n${indent}${body}${v.slice(lineEnd)}`;
      caret = lineEnd + 1 + indent.length + body.length;
    }
    ta.value = next;
    ta.focus({ preventScroll: true });
    if (ta.setSelectionRange) ta.setSelectionRange(caret, caret);
    refresh(ta);
  }

  /** Puts `text` right where the cursor is (a name inside parentheses), replacing a selection. */
  function insertInline(ta, text) {
    const v = ta.value;
    const a = ta.selectionStart != null ? ta.selectionStart : v.length;
    const b = ta.selectionEnd != null ? ta.selectionEnd : a;
    ta.value = v.slice(0, a) + text + v.slice(b);
    ta.focus({ preventScroll: true });
    if (ta.setSelectionRange) ta.setSelectionRange(a + text.length, a + text.length);
    refresh(ta);
  }

  /** Tab / Shift+Tab indent, Enter keeps the indentation (one deeper after a “:”). Returns whether it changed the code. */
  function onKey(e) {
    const ta = e.target;
    if (!ta.matches || !ta.matches('[data-code]')) return false;
    e.stopPropagation(); // the game and cookieMgr's hotkeys don't see what you type
    const ed = editorOf(ta);
    if (ed && ed.dataset.codeLine !== undefined) {
      // one line: Enter is done (no new line), Tab moves on
      if (e.key === 'Enter') {
        e.preventDefault();
        ta.blur();
      }
      return false;
    }
    const v = ta.value;
    const a = ta.selectionStart;
    const b = ta.selectionEnd;
    const lineStart = v.lastIndexOf('\n', a - 1) + 1;
    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        const cut = v.slice(lineStart, lineStart + 2) === '  ' ? 2 : v[lineStart] === ' ' ? 1 : 0;
        ta.value = v.slice(0, lineStart) + v.slice(lineStart + cut);
        ta.setSelectionRange(Math.max(lineStart, a - cut), Math.max(lineStart, b - cut));
      } else {
        ta.value = `${v.slice(0, a)}  ${v.slice(b)}`;
        ta.setSelectionRange(a + 2, a + 2);
      }
      refresh(ta);
      return true;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const line = v.slice(lineStart, a);
      const indent = (line.match(/^\s*/) || [''])[0] + (/:\s*$/.test(line) ? '  ' : '');
      ta.value = `${v.slice(0, a)}\n${indent}${v.slice(b)}`;
      ta.setSelectionRange(a + 1 + indent.length, a + 1 + indent.length);
      refresh(ta);
      return true;
    }
    return false;
  }

  function onLibSearch(input) {
    const q = input.value.trim().toLowerCase();
    const lib = input.closest('[data-ed-lib]');
    lib.querySelectorAll('.ca-lib-row').forEach((r) => {
      const own = !q || r.dataset.libText.includes(q);
      // found by one of its possible values ("hand of fate" → spell.cast): open them, just the matching ones
      const byOpt = !own && !!r.dataset.libOptText && r.dataset.libOptText.includes(q);
      r.classList.toggle('hidden', !own && !byOpt);
      if (byOpt && !r.classList.contains('open')) {
        toggleOpts(r, true);
        r.dataset.libAutoOpen = '1';
      } else if (!byOpt && r.dataset.libAutoOpen) {
        delete r.dataset.libAutoOpen;
        toggleOpts(r, false);
      }
      const box = r.nextElementSibling && r.nextElementSibling.matches('[data-lib-opts]') ? r.nextElementSibling : null;
      if (box) {
        if (r.classList.contains('hidden')) box.hidden = true;
        else if (r.classList.contains('open')) box.hidden = false;
        box.querySelectorAll('[data-lib-opt]').forEach((o) => o.classList.toggle('hidden', byOpt && !o.dataset.libText.includes(q)));
        // a list none of whose values match: its heading goes too
        box.querySelectorAll('.ca-lib-ophead').forEach((h) => {
          let n = h.nextElementSibling;
          let any = false;
          for (; n && n.matches('[data-lib-opt]'); n = n.nextElementSibling) any = any || !n.classList.contains('hidden');
          h.classList.toggle('hidden', !any);
        });
      }
    });
    lib.querySelectorAll('.ca-lib-group').forEach((g) => g.classList.toggle('hidden', !!q && !g.querySelector('.ca-lib-row:not(.hidden)')));
  }

  /**
   * ★ on a library row: pins or unpins it without redrawing the library, so nothing moves — the row
   * stays under the mouse (its copy comes or goes in Pinned, at the top, and the list scrolls to
   * make up for it).
   */
  function pinInPlace(lib, fav) {
    const k = fav.dataset.libFav;
    const favOf = (r) => (r.querySelector('[data-lib-fav]') || { dataset: {} }).dataset.libFav;
    toggleFav(k);
    const on = favs().includes(k);
    const body = lib.querySelector('[data-lib-pane="words"]');
    const pinned = lib.querySelector('.ca-lib-pinned');
    const row = fav.closest('.ca-lib-row');
    const inPinned = !!row.closest('.ca-lib-pinned');
    // what to hold still: the row clicked, or (unpinning from Pinned) the first row below Pinned
    const anchor = inPinned ? pinned.nextElementSibling : row;
    const before = anchor ? anchor.getBoundingClientRect().top : 0;
    lib.querySelectorAll('[data-lib-fav]').forEach((b) => b.dataset.libFav === k && (b.outerHTML = favBtn(k, on)));
    const copy = [...pinned.querySelectorAll('.ca-lib-row')].find((r) => favOf(r) === k);
    if (on && !copy) {
      const src = [...lib.querySelectorAll('.ca-lib-group:not(.ca-lib-pinned) .ca-lib-row')].find((r) => favOf(r) === k);
      if (src) {
        const c = src.cloneNode(true);
        c.classList.remove('open', 'hidden');
        delete c.dataset.libAutoOpen;
        const at = (r) => Number(r.querySelector('[data-lib-insert]').dataset.libInsert);
        // in the library's own order, as a redraw would put it
        const next = [...pinned.querySelectorAll('.ca-lib-row')].find((r) => at(r) > at(c));
        const empty = pinned.querySelector('.ca-lib-empty');
        if (empty) empty.remove();
        pinned.insertBefore(c, next || null);
      }
    } else if (!on && copy) {
      const box = copy.nextElementSibling && copy.nextElementSibling.matches('[data-lib-opts]') ? copy.nextElementSibling : null;
      if (box) box.remove();
      copy.remove();
      if (!pinned.querySelector('.ca-lib-row')) pinned.insertAdjacentHTML('beforeend', '<div class="ca-lib-empty">★ an item to keep it here</div>');
    }
    const s = lib.querySelector('[data-lib-search]');
    if (s && s.value.trim()) onLibSearch(s);
    if (anchor && anchor.isConnected && body) body.scrollTop += anchor.getBoundingClientRect().top - before;
  }

  /** The editor a library belongs to (same key), within `root`. */
  const codeFor = (root, key) => {
    const ed = [...root.querySelectorAll('[data-code-ed]')].find((x) => x.dataset.codeEd === key);
    return ed && ed.querySelector('[data-code]');
  };

  /**
   * Listens on `root` for typing, keys, the library and problem links. handlers.onChange(key, source)
   * after every change; handlers.onPick(key, item) for a library click (return true if handled).
   * Returns a function that stops listening.
   */
  function bind(root, handlers = {}) {
    const changed = (ta) => {
      const ed = editorOf(ta);
      if (ed && handlers.onChange) handlers.onChange(ed.dataset.codeEd, ta.value);
    };
    const onInput = (e) => {
      const t = e.target;
      if (t.matches && t.matches('[data-code]')) {
        refresh(t);
        changed(t);
      } else if (t.matches && t.matches('[data-lib-search]')) onLibSearch(t);
    };
    const onKeyDown = (e) => {
      if (onKey(e)) changed(e.target);
    };
    const onClick = (e) => {
      const t = e.target;
      const lib = t.closest && t.closest('[data-ed-lib]');
      if (lib) {
        const key = lib.dataset.edLib;
        const fav = t.closest('[data-lib-fav]');
        if (fav) {
          e.stopPropagation();
          CA.Util.sound('snd/tick.mp3');
          pinInPlace(lib, fav);
          return;
        }
        const more = t.closest('[data-lib-open]');
        if (more) {
          e.stopPropagation();
          const r = more.closest('.ca-lib-row');
          delete r.dataset.libAutoOpen;
          toggleOpts(r);
          return;
        }
        const opt = t.closest('[data-lib-opt]');
        if (opt) {
          e.stopPropagation();
          const [i, ci, oi] = opt.dataset.libOpt.split(':').map(Number);
          const it = libItems[i];
          const c = choicesOf(it)[ci];
          const o = c && c.items[oi];
          if (!o) return;
          CA.Util.sound('snd/tick.mp3');
          // the call, written with this one: like clicking its row, with the value filled in
          const picked = { ...it, insert: CA.Script.callWith(it.id, c.key, o.v), params: { [c.key]: o.v } };
          if (handlers.onPick && handlers.onPick(key, picked)) return;
          const ta = codeFor(root, key);
          if (ta) {
            insert(ta, picked.insert);
            changed(ta);
          }
          return;
        }
        const tab = t.closest('[data-lib-tab]');
        if (tab) {
          e.stopPropagation();
          lib.querySelectorAll('[data-lib-tab]').forEach((b) => b.classList.toggle('on', b === tab));
          lib.querySelectorAll('[data-lib-pane]').forEach((p) => (p.hidden = p.dataset.libPane !== tab.dataset.libTab));
          return;
        }
        const lit = t.closest('[data-lib-lit]');
        if (lit) {
          e.stopPropagation();
          const it = lookItems[Number(lit.dataset.libLit)];
          const ta = codeFor(root, key);
          if (!it || !ta) return;
          CA.Util.sound('snd/tick.mp3');
          insertInline(ta, it.code);
          changed(ta);
          return;
        }
        const ins = t.closest('[data-lib-insert]');
        if (!ins) return;
        e.stopPropagation();
        const it = libItems[Number(ins.dataset.libInsert)];
        if (!it) return;
        CA.Util.sound('snd/tick.mp3');
        if (handlers.onPick && handlers.onPick(key, it)) return;
        const ta = codeFor(root, key);
        if (ta) {
          insert(ta, it.insert);
          changed(ta);
        }
        return;
      }
      // the code's box is taller than its lines: a click below them puts the caret at the end
      if (t.classList && t.classList.contains('ca-code')) {
        const ta = t.querySelector('[data-code]');
        if (ta) {
          ta.focus({ preventScroll: true });
          if (ta.setSelectionRange) ta.setSelectionRange(ta.value.length, ta.value.length);
        }
        return;
      }
      const go = t.closest && t.closest('[data-code-goto]');
      if (go) {
        const ta = editorOf(go) && editorOf(go).querySelector('[data-code]');
        const n = Number(go.dataset.codeGoto);
        if (ta && n > 0) {
          const pos = ta.value.split('\n').slice(0, n - 1).join('\n').length + (n > 1 ? 1 : 0);
          ta.focus({ preventScroll: true });
          if (ta.setSelectionRange) ta.setSelectionRange(pos, pos);
        }
      }
    };
    // a one-line editor scrolls sideways: its colored copy follows
    const onScroll = (e) => {
      const t = e.target;
      const ed = t.matches && t.matches('[data-code]') && editorOf(t);
      const hl = ed && ed.dataset.codeLine !== undefined && ed.querySelector('[data-code-hl]');
      if (hl) hl.scrollLeft = t.scrollLeft;
    };
    root.addEventListener('input', onInput);
    root.addEventListener('keydown', onKeyDown);
    root.addEventListener('click', onClick, true);
    root.addEventListener('scroll', onScroll, true);
    return () => {
      root.removeEventListener('input', onInput);
      root.removeEventListener('keydown', onKeyDown);
      root.removeEventListener('click', onClick, true);
      root.removeEventListener('scroll', onScroll, true);
    };
  }

  /** While code runs: its lines light up in the gutter, and `html` (what it's doing) shows under it. */
  function setLive(root, key, live) {
    const ed = [...root.querySelectorAll('[data-code-ed]')].find((x) => x.dataset.codeEd === key);
    if (!ed) return;
    const lines = (live && live.lines) || [];
    ed.querySelectorAll('[data-code-gutter] span').forEach((sp, i) => sp.classList.toggle('run', lines.includes(i + 1)));
    const box = ed.querySelector('[data-code-live]');
    if (box) CA.UI.Dom.morph(box, (live && live.html) || '');
  }

  // ---- hover cards: what a word of the code is (CA.ScriptWords / CA.Words) --------------------------
  //
  // A card can have a link to where its word is edited or explained (openers, by kind: the macro's
  // editor, a profile's page…). Leaving code with unsaved changes asks first: save, don't save, or
  // stay (each page with an editor says how, with guard()). A Back chip then returns to the code.
  //
  //   CA.UI.CodeEditor.defineOpen(kind, fn(id, info) → { label, page, focus, go() } | null)
  //       page: a page to open (CA.UI.Menu.openPage), focus: a selector on it to scroll to and flash,
  //       go(): or anything else; { label, line } jumps to a line of the same code
  //   CA.UI.CodeEditor.guard(page, { dirty() → bool, name() → text, leave(how) → { error } | { back() } })
  //       how: 'save', 'discard', or 'keep' (nothing to save); back() reopens what was left

  const HOVER_MS = 250;
  const LEAVE_MS = 350; // time to move the mouse from the word onto its card
  let card = null;
  let hovered = null; // the highlighted word under the mouse (a span of the coloured copy)
  let hoverTimer = null;
  let hideTimer = null;
  let hoveredAt = null; // where it was, to tell a scroll that moved it
  let shown = null; // the card's word: { info, open, span }
  let asking = null; // a question the card or Back chip is asking: { go(how) }
  const openers = {};
  const guards = {};
  const trail = []; // where Back goes: [{ label, back() }]
  let chip = null;

  const defineOpen = (kind, fn) => (openers[kind] = fn);
  const guard = (page, g) => (guards[page] = g);

  /** The span of coloured code at a point: under an editor's textarea (which lies on top), or in a code view. */
  function spanAt(t, x, y) {
    if (t.matches && t.matches('[data-code]')) {
      const ed = editorOf(t);
      const hl = ed && ed.querySelector('[data-code-hl]');
      if (!hl || !document.elementFromPoint) return null;
      const was = t.style.pointerEvents;
      t.style.pointerEvents = 'none';
      hl.style.pointerEvents = 'auto';
      const el = document.elementFromPoint(x, y);
      t.style.pointerEvents = was;
      hl.style.pointerEvents = '';
      return el && el.parentElement && hl.contains(el) && el.closest('.ca-hl-line') !== el && el.matches('span:not(.ca-hl-line)') ? el : null;
    }
    const el = t.closest && t.closest('[data-code-view] span');
    return el || null;
  }

  /** Where a span of coloured code is: { line (from 1), col (from 0), source, vars }. */
  function placeOf(span) {
    const box = span.closest('[data-code-hl], [data-code-view]');
    let off = 0;
    const walk = document.createTreeWalker(box, 4 /* text */);
    let n;
    while ((n = walk.nextNode()) && !span.contains(n)) off += n.nodeValue.length;
    const before = box.textContent.slice(0, off);
    const ed = editorOf(box);
    const ta = box.matches('[data-code-hl]') && ed && ed.querySelector('[data-code]');
    return {
      line: before.split('\n').length + (Number(box.dataset.codeFirst) || 0),
      col: off - before.lastIndexOf('\n') - 1,
      source: ta ? ta.value : box.dataset.codeView || box.textContent,
      vars: ((ed && ed.dataset.codeVars) || box.dataset.codeVars || '').split(',').filter(Boolean),
    };
  }

  /** Where a word can be opened: { label, page, focus, go, line } or null. */
  function openerOf(info) {
    if (!info) return null;
    if ((info.kind === 'variable' || info.kind === 'function') && info.rows && info.line) {
      const at = /^line (\d+)$/.exec((info.rows[0] || [])[1] || '');
      return at && Number(at[1]) !== info.line ? { label: `Go to line ${at[1]}`, line: Number(at[1]) } : null;
    }
    const fn = openers[info.kind];
    try {
      return fn ? fn(info.id, info) || null : null;
    } catch (e) {
      return null;
    }
  }

  /** A word's card: what it is, how it's written, what it does, its live numbers, and where to open it. */
  function cardHtml(info, open) {
    return (
      `<div class="ca-tip-head">${esc(info.title)}<span class="${info.origin ? `ca-word-tag hv-${info.origin}` : ''}">${esc(info.tag || '')}</span></div>` +
      (info.sig && info.sig.toLowerCase() !== String(info.title).toLowerCase() ? `<div class="ca-word-sig"><code>${highlightLine(info.sig)}</code></div>` : '') +
      (info.desc ? `<div class="ca-word-desc">${esc(info.desc)}</div>` : '') +
      (info.how ? `<div class="ca-word-desc ca-word-how"><b>How:</b> ${esc(info.how)}.</div>` : '') +
      (info.rows || []).map(([k, v]) => `<div class="ca-tip-row"><b>${esc(k)}</b><span>${esc(v)}</span></div>`).join('') +
      (info.note ? `<div class="ca-tip-note">${esc(info.note)}</div>` : '') +
      // a statistic: its code (at most 8 lines)
      (info.code ? `<pre class="ca-word-code">${highlightCode(info.code.split('\n').slice(0, 8).join('\n'), ['item']).join('\n')}${info.code.split('\n').length > 8 ? '\n…' : ''}</pre>` : '') +
      (open ? `<div class="ca-word-open"><button type="button" class="ca-word-go" data-word-open>${esc(open.label)} →</button></div>` : '')
    );
  }

  /** The question before leaving unsaved code. */
  const askHtml = (name, error) =>
    `<div class="ca-word-ask"><div class="ca-word-ask-q">${I('edit', 11)} Unsaved changes${name ? ` to <b>${esc(name)}</b>` : ''}. Save them first?</div>` +
    (error ? `<div class="ca-word-ask-err">${esc(error)}</div>` : '') +
    '<div class="ca-word-ask-btns"><button type="button" class="ca-word-go on" data-word-leave="save">Save and go</button>' +
    '<button type="button" class="ca-word-go" data-word-leave="discard">Don’t save</button>' +
    '<button type="button" class="ca-word-go" data-word-leave="stay">Stay</button></div></div>';

  function hideCard() {
    clearTimeout(hoverTimer);
    clearTimeout(hideTimer);
    hoverTimer = hideTimer = null;
    hovered = null;
    shown = null;
    if (asking && asking.where === 'card') asking = null;
    if (card) card.style.display = 'none';
  }

  function showCard(span) {
    if (!span.isConnected) return hideCard();
    const at = placeOf(span);
    const info = CA.ScriptWords.explain(at.source, at.line, at.col, { vars: at.vars });
    if (!info) return;
    clearTimeout(hideTimer);
    const open = openerOf(info);
    shown = { info, open, span };
    // an upgrade: its info card (ui/upgradeTip.js), as everywhere else
    const up = info.card && info.card.pop === 'upgrade' && CA.UI.UpgradeTip ? CA.UI.UpgradeTip.html(info.card.data.upgrade) : '';
    if (!card || !card.isConnected) card = CA.UI.Tips.float('ca-tip ca-word-tip');
    card.className = up ? 'ca-float ca-word-tip' : 'ca-tip ca-word-tip';
    card.innerHTML = up || cardHtml(info, open);
    card.style.display = 'block';
    CA.UI.Tips.place(card, span, true);
  }

  // ---- going to a word's place, and back ----------------------------------------------------------

  const tab = () => CA.Settings.get('tab');
  const pageLabel = (id) => (((CA.UI.Pages.resolve && CA.UI.Pages.resolve(id)) || {}).page || {}).label || id;

  /** Scrolls to `sel` on the page now showing, and flashes it. */
  function focusOn(sel) {
    setTimeout(() => {
      const el = sel && document.querySelector(`#CookieMgrMenu ${sel}`);
      if (!el) return;
      CA.Util.scrollInPanel(el, 'center');
      // a ring drawn over it in the layer (the page redraws its own elements every tick), following
      // it while the panel scrolls there
      const ring = CA.UI.Tips.float('ca-word-flash');
      const follow = () => {
        const now = document.querySelector(`#CookieMgrMenu ${sel}`) || el;
        const r = now.getBoundingClientRect();
        Object.assign(ring.style, { left: `${r.left - 3}px`, top: `${r.top - 3}px`, width: `${r.width + 6}px`, height: `${r.height + 6}px` });
      };
      follow();
      const t = setInterval(follow, 40);
      setTimeout(() => {
        clearInterval(t);
        ring.remove();
      }, 1800);
    }, 30);
  }

  function arrive(open) {
    if (open.go) open.go();
    else if (open.page) CA.UI.Menu.openPage(open.page);
    focusOn(open.focus);
  }

  /** Leaves the code for `then` — asking first when the page's code has unsaved changes. */
  function leave(where, then) {
    const from = tab();
    const g = guards[from];
    const label = (g && g.name && g.name()) || pageLabel(from); // what it is before it's saved or closed
    const go = (how) => {
      let back = () => CA.UI.Menu.openPage(from);
      if (g) {
        const r = g.leave(how) || {};
        if (r.error) return askIn(where, g, go, r.error);
        if (r.back) back = r.back;
      }
      asking = null;
      then({ label, back });
    };
    let dirty = false;
    try {
      dirty = !!(g && g.dirty());
    } catch (e) {
      dirty = false;
    }
    if (dirty) askIn(where, g, go, '');
    else go('keep');
  }
  function askIn(where, g, go, error) {
    asking = { where, go };
    const el = where === 'card' ? card : chip;
    if (!el) return;
    const box = el.querySelector('[data-word-asked]') || el;
    if (where === 'card') {
      const was = el.querySelector('.ca-word-ask');
      if (was) was.remove();
      const open = el.querySelector('.ca-word-open');
      if (open) open.remove();
      el.insertAdjacentHTML('beforeend', askHtml(g.name && g.name(), error));
    } else box.innerHTML = askHtml(g.name && g.name(), error);
  }

  /** The card's link: to a line of this code, or away (with Back to here). */
  function openShown() {
    const s = shown;
    if (!s || !s.open) return;
    if (s.open.line) {
      const ed = editorOf(s.span);
      const ta = ed && ed.querySelector('[data-code]');
      if (ta) {
        const pos = ta.value.split('\n').slice(0, s.open.line - 1).join('\n').length + (s.open.line > 1 ? 1 : 0);
        ta.focus({ preventScroll: true });
        if (ta.setSelectionRange) ta.setSelectionRange(pos, pos);
      }
      return hideCard();
    }
    leave('card', (here) => {
      hideCard();
      trail.push(here);
      arrive(s.open);
      showChip();
    });
  }

  /** The Back chip, at the bottom of the panel while there's somewhere to go back to. */
  function showChip() {
    if (!trail.length) return hideChip();
    if (!chip || !chip.isConnected) chip = CA.UI.Tips.float('ca-word-back');
    const last = trail[trail.length - 1];
    chip.innerHTML =
      `<button type="button" class="ca-word-go on" data-word-back>← Back to ${esc(last.label)}</button>` +
      '<button type="button" class="ca-word-x" data-word-backx aria-label="Close">×</button><div data-word-asked></div>';
    chip.style.display = 'block';
    placeChip();
  }
  function placeChip() {
    if (!chip || chip.style.display === 'none') return;
    if (!CA.UI.Menu.isOpen() || !document.getElementById('CookieMgrMenu')) return hideChip();
    const host = document.getElementById('centerArea') || document.getElementById('CookieMgrMenu');
    const r = host.getBoundingClientRect();
    chip.style.top = `${Math.round(Math.min(r.bottom, innerHeight) - chip.offsetHeight - 14)}px`; // at the bottom: out of the way
    chip.style.left = `${Math.round(r.left + r.width / 2 - chip.offsetWidth / 2)}px`;
  }
  function hideChip() {
    trail.length = 0;
    if (asking && asking.where === 'chip') asking = null;
    if (chip) chip.style.display = 'none';
  }
  function goBack() {
    const last = trail[trail.length - 1];
    if (!last) return hideChip();
    leave('chip', () => {
      trail.pop();
      last.back();
      if (trail.length) showChip();
      else hideChip();
    });
  }

  function onLayerClick(e) {
    const t = e.target;
    if (!t.closest || !t.closest('.ca-word-tip, .ca-word-back')) return;
    e.stopPropagation();
    if (t.closest('[data-word-open]')) openShown();
    else if (t.closest('[data-word-back]')) goBack();
    else if (t.closest('[data-word-backx]')) hideChip();
    else if (t.closest('[data-word-leave]')) {
      const how = t.closest('[data-word-leave]').dataset.wordLeave;
      const a = asking;
      if (!a) return;
      if (how === 'stay') {
        asking = null;
        if (a.where === 'card') hideCard();
        else showChip();
      } else a.go(how);
    }
  }

  function onHover(e) {
    const t = e.target;
    if (t && t.closest && t.closest('.ca-word-tip')) {
      clearTimeout(hideTimer); // on its way to the card's link
      return;
    }
    if (asking && asking.where === 'card') return; // a question waits for its answer
    const inMenu = t && t.closest && t.closest('#CookieMgrMenu');
    const span = inMenu ? spanAt(t, e.clientX, e.clientY) : null;
    if (span && span === hovered) {
      clearTimeout(hideTimer);
      return;
    }
    clearTimeout(hoverTimer);
    hoverTimer = null;
    if (shown && card && card.style.display === 'block') {
      if (!hideTimer) hideTimer = setTimeout(hideCard, LEAVE_MS);
    } else if (hovered) hideCard();
    hovered = null;
    if (!span || span.classList.contains('hc') || span.classList.contains('ho')) return;
    hovered = span;
    hoveredAt = span.getBoundingClientRect();
    // the page may redraw its code meanwhile (live status): look again at the same point
    const x = e.clientX;
    const y = e.clientY;
    hoverTimer = setTimeout(() => {
      const now = hovered === span && span.isConnected ? span : spanAt(t.isConnected ? t : document.elementFromPoint(x, y) || t, x, y);
      if (now && now.textContent === span.textContent) {
        hovered = now;
        hoveredAt = now.getBoundingClientRect();
        showCard(now);
      }
    }, HOVER_MS);
  }

  /** Where each kind of word is edited or explained. */
  function defineOpeners() {
    const prof = (page, sel) => (id) => ({ label: `Open on the ${pageLabel(page)} page`, page, focus: sel(id) });
    const q = (s) => String(s).replace(/["\\]/g, '\\$&');
    defineOpen('macro', (id) => {
      const m = CA.Macros.get(id) || CA.Macros.list().find((x) => x.name.toLowerCase() === String(id).toLowerCase());
      return m ? { label: m.mode === 'flow' || !m.builtin ? 'Edit it on the Macros page' : 'Open it on the Macros page', go: () => CA.UI.MacrosPage.edit(m.id) } : null;
    });
    defineOpen('profile.buyer', prof('payback', (id) => `[data-ab-use="${q(id)}"]`));
    defineOpen('profile.dragon', prof('dragon', (id) => `[data-dragon-prof="${q(id)}"]`));
    defineOpen('profile.pantheon', prof('pantheon', (id) => `[data-pp-row="${q(id)}"]`));
    defineOpen('profile.grimoire', prof('wizard', (id) => `.ca-ct-prof[data-id="${q(id)}"]`));
    defineOpen('profile.stocks', prof('stocks', () => '[data-st-card]'));
    defineOpen('spell', () => ({ label: 'Open the Grimoire page', page: 'wizard' }));
    defineOpen('spirit', () => ({ label: 'Open the Pantheon page', page: 'pantheon' }));
    defineOpen('aura', () => ({ label: 'Open the Dragon page', page: 'dragon' }));
    // a statistic's word: its editor; any other action, condition or value: the page it's about
    defineOpen('value', (id) => {
      const m = /^stat\.(.+)$/.exec(id);
      const st = m && CA.Stats.all().find((x) => x.key === m[1]);
      return st
        ? {
            label: st.builtin ? 'Open the statistic (its code)' : 'Edit your statistic',
            go: () => {
              CA.UI.StatEditor.open(st.id);
              CA.UI.Menu.openPage('tooltips');
              CA.UI.Menu.render();
            },
            focus: '[data-stat-editor]',
          }
        : pageFor(id);
    });
    defineOpen('action', pageFor);
    defineOpen('condition', pageFor);
  }

  // where a word of the language is about, by its name: [pattern, page (or 'page:tab'), a part of it to
  // flash, what the link says]. Page 'modes': the payback modes, on the Statistics page.
  const PAGE_OF = [
    [/^(item\.(payback|paybackIn|gain|gainIn|rawGain|timeToAfford|earnBack|paybackOf)|payback\.(mode|modes|income|actualIncome|clickRate|perClick|actualRatio)|(building|upgrade)\.(gain|gainOf|payback|paybackIn|paybackOf)|timeTo|paybackActual|paybackActualRatio|actualIncome)$/, 'modes', '', 'How income and gain are counted: the payback modes'],
    [/^(item\.|payback\.|pp\.|cm\.|buyer\.|best$|clickRate$|buy\.|building\.(buy|sell|price|priceOf|toNext)|upgrade\.)/, 'payback'],
    [/^(golden\.|reindeer\.|buff\.(goldenChance|effectiveMult))/, 'graphs:golden', '[data-st-spawn]'],
    [/^(bank\.|reward\.)/, 'graphs:golden', '[data-st-bank]'],
    [/^prestige\./, 'graphs:prestige', '[data-st-prestige]'],
    [/^(state|cookies|cps|rawCps)$/, 'graphs:cookies'],
    [/^(lump\.ripeIn|autosave\.in|magic\.fullIn)$/, 'graphs:misc', '[data-st-timers]'],
    [/^(wrinkler)/, 'graphs:misc', '[data-st-wrinklers]'],
    [/^missing\./, 'graphs:misc', '[data-st-collection]'],
    [/^garden\./, 'garden'],
    [/^(grimoire\.|spell\.|fthof\.|magic$|spellAffordable$|magicPct$)/, 'wizard'],
    [/^pantheon\./, 'pantheon'],
    [/^dragon\./, 'dragon'],
    [/^(stock\.|stocks)/, 'stocks'],
    [/^manager\./, 'managers'],
    [/^macro\./, 'clickers'],
    [/^widgets\./, 'widgets'],
  ];
  const TAB_NAMES = { cookies: 'Cookies', golden: 'Golden cookies', prestige: 'Prestige', misc: 'Misc' };
  /** The page a word is about: { label, page, focus } or null. */
  function pageFor(id) {
    const hit = PAGE_OF.find(([re]) => re.test(id));
    if (!hit) return null;
    const [, page, focus, label] = hit;
    if (page === 'modes') return { label, go: () => CA.UI.TooltipsPage.showGroup('Payback modes') };
    const r = CA.UI.Pages.resolve(page);
    if (!r) return null;
    return { label: label || `Open the ${r.page.label}${r.sub ? ` → ${TAB_NAMES[r.sub] || r.sub}` : ''} page`, page, focus: focus || undefined };
  }

  function init() {
    CA.Settings.defineOption({ key: LIB_FAVS, group: 'ui', name: 'Pinned library items', desc: '', default: '' });
    defineOpeners();
    document.addEventListener('mousemove', onHover, true);
    document.addEventListener('click', onLayerClick, true);
    document.addEventListener('keydown', () => !asking && hideCard(), true);
    document.addEventListener('input', hideCard, true);
    document.addEventListener(
      'mousedown',
      (e) => {
        if (e.target.closest && e.target.closest('.ca-word-tip, .ca-word-back')) return;
        if (!asking || asking.where === 'card') hideCard();
      },
      true
    );
    // only a scroll that moves the word (the game sends scroll events of its own all the time)
    addEventListener(
      'scroll',
      () => {
        placeChip();
        if (!hovered || (asking && asking.where === 'card')) return;
        const r = hovered.getBoundingClientRect();
        if (!hoveredAt || Math.abs(r.top - hoveredAt.top) > 2 || Math.abs(r.left - hoveredAt.left) > 2) hideCard();
      },
      true
    );
    setInterval(placeChip, 1000); // follows the panel; gone when it closes
  }

  return { init, html, lineHtml, libraryHtml, legendHtml, highlightCode, bind, setLive, insert, insertInline, refresh, view, highlightLine, cardHtml, placeOf, showCard, hideCard, defineOpen, guard, goBack, trail: () => trail.slice() };
})();
