// The statistic editor: writing your own statistics (features/stats.js), and changing the built-ins.
// It opens on the Tooltips page (ui/tooltipsPage.js) in place of the catalog, as the macro editor
// does on the Macros page, and shares its parts: the code editor and the library (ui/codeEditor.js),
// the knobs for the code's top-level `name = 0.5` lines (ui/codeKnobs.js).
//
//   head      the label, what it shows; Save, Cancel — Reset (a built-in you've changed: back to the
//             original), Delete (yours), Copy as text
//   fields    its code name (stat.<name>(item)), what it's about, how its value reads, its color,
//             its group, whether it shows as a tooltip line or as a warning (a "!" in the store, a tag
//             in the ⚠ line) — a built-in keeps its name, what it's about, its group and how it shows
//   code      the statistic's code, checked as a statistic as you type; the library beside it lists
//             what a statistic can use, the item's words first
//   result    what it shows, now, about an item you pick (the best, by default) — as its tooltip line
//             would — and what each line did to get there (the trace)
//
// open(id) edits one (a built-in: your version of it), openNew(def) a new one (from New, or pasted
// text). The page draws html() while isOpen(), and calls bind(root) on mount, sync(root) each tick.

CA.UI = CA.UI || {};

CA.UI.StatEditor = (() => {
  const C = () => CA.UI.C;
  const I = (n, s) => CA.UI.Icons.html(n, s);
  const esc = (s) => CA.Util.escapeHtml(s);
  const ST = () => CA.Stats;
  const CE = () => CA.UI.CodeEditor;
  const CK = () => CA.UI.CodeKnobs;
  const KEY = 'stat'; // the code editor's key
  const COLOURS = [
    ['none', 'none'],
    ['payback', 'its payback color'],
    ...['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'].map((c) => [c, c]),
  ];
  const SCOPE_NAMES = { item: 'a building or an upgrade', building: 'a building', upgrade: 'an upgrade', game: 'the game' };
  const NEW_SOURCE = '# what it works out about the building or upgrade (item)\nreturn item.price() / cps()';

  let draft = null; // { id, builtin, label, key, desc, scope, format, color, group, source }
  let error = '';
  let draftWas = ''; // the draft as it opened, to tell unsaved changes
  let item = 'best'; // what the result is about
  let sharing = false; // the "as text" panel open
  let lastSig = '';

  const isOpen = () => !!draft;
  /** How a macro calls it: stat.<its code name, or the label's>(item). */
  const callOf = (d) => `stat.${d.key.trim() || ST().keyOf(d.label)}(${d.scope === 'game' ? '' : 'item'})`;
  const fields = (s) => ({
    id: s.id || null,
    builtin: !!s.builtin,
    customized: !!s.customized,
    label: s.label || '',
    key: s.key || '',
    desc: s.desc || '',
    scope: s.scope || 'item',
    format: s.format || 'auto',
    colour: s.colour || 'none',
    group: s.group || '',
    warn: !!s.warn,
    mode: !!s.mode,
    source: s.source || '',
  });

  /** Edits a statistic (a built-in: your version of it). */
  function open(id) {
    const s = ST().get(id);
    if (!s) return false;
    draft = fields(s);
    draftWas = JSON.stringify(draft);
    error = '';
    item = 'best';
    sharing = false;
    return true;
  }
  /** A new statistic: from New (def empty) or pasted text. Nothing is saved until Save. */
  function openNew(def = {}) {
    draft = fields({ label: 'New statistic', scope: 'item', format: 'auto', source: NEW_SOURCE, ...def, id: null, builtin: false });
    draftWas = def.label || def.source ? '' : JSON.stringify(draft); // pasted: unsaved from the start
    error = '';
    item = 'best';
    sharing = false;
  }
  function close() {
    draft = null;
    error = '';
    sharing = false;
  }

  /** The draft as a statistic to run (not saved). */
  const asStat = () => ({ ...draft, id: draft.id || 'draft', builtin: false });
  const compileOpts = () => ({ mode: 'stat', item: draft.scope !== 'game', vars: draft.scope !== 'game' ? ['item'] : [] });

  // ---- what it shows ------------------------------------------------------------------------------

  function itemChoices() {
    const sc = draft.scope;
    if (sc === 'game') return [];
    const out = [{ v: 'best', label: sc === 'building' ? 'the best building' : sc === 'upgrade' ? 'the best upgrade' : 'the best buy' }];
    if (sc !== 'upgrade')
      Object.values(Game.Objects || {})
        .filter((b) => !b.locked || b.amount > 0)
        .forEach((b) => out.push({ v: `b:${b.name}`, label: b.dname || b.name }));
    if (sc !== 'building')
      (Game.UpgradesInStore || [])
        .filter((u) => !CA.Payback.isSwitch(u))
        .forEach((u) => out.push({ v: `u:${u.name}`, label: `${u.dname || u.name} (upgrade)` }));
    return out;
  }

  /** A payback mode's result about the item: the income it sets, the gain it returns, the payback period they make. */
  function modeHtml(s, c) {
    const m = ST().runMode(s, c);
    const F = CA.Format;
    if (!(m.income > 0)) return '<div class="ca-se-none">As a payback mode: not ready — it sets no income above nothing (set <code>income = …</code>). Until it does, payback periods count in CpS.</div>';
    const price = c && c.r ? c.r.price : NaN;
    const short = Math.max(0, price - CA.Payback.bank());
    const afford = short / m.income;
    const earn = m.gain > 0 ? price / m.gain : Infinity;
    const pp = Number.isFinite(earn) && Number.isFinite(price) ? afford + earn : Infinity;
    const t = (x) => (!Number.isFinite(x) ? 'never' : x <= 0 ? 'now' : F.span(x));
    return `<div class="ca-se-line ca-se-mode"><span>As a payback mode</span><b>income ${F.beautify(m.income)}/s · gain ${Number.isFinite(m.gain) ? `${F.beautify(m.gain)}/s` : '—'} · payback ${F.payback(pp)} <small>(${t(afford)} to afford + ${t(earn)} to earn back)</small></b></div>`;
  }

  function resultHtml() {
    const s = asStat();
    const c = ST().pick(s.scope, item);
    const comp = CA.Script.compile(s.source, compileOpts());
    if (comp.errors.length)
      return `<div class="ca-se-none">${I('close', 11)} Fix the code first: line ${comp.errors[0].line}: ${esc(comp.errors[0].message)}</div>`;
    if (s.scope !== 'game' && !c)
      return '<div class="ca-se-none">Nothing to work it out about: no building or upgrade in the store fits.</div>';
    let r;
    let row = null;
    let w = null;
    try {
      r = ST().run(s, c, { trace: true });
      row = r.error ? null : ST().line(s, c);
      w = row && s.warn ? ST().warning(s, c) : null;
    } catch (e) {
      r = { error: String(e.message || e), trace: [] };
    }
    const shows = r.error
      ? `<div class="ca-se-bad">${I('close', 11)} ${esc(r.error)}</div>`
      : w
        ? `<div class="ca-se-line ca-se-warn"><span>⚠ It warns</span><b><span class="ca-tt-bank ca-tt-bank-${w.colour}">${w.label} <small>${w.html}</small></span></b></div>`
        : row
          ? `<div class="ca-se-line"><span>${row[0]}</span><b class="${row[2]}">${row[1]}</b></div>`
          : s.warn
            ? `<div class="ca-se-none">No warning about this item (${r.returned ? 'it returned nothing to show' : 'no return'}).</div>`
            : `<div class="ca-se-none">${r.returned ? 'It returned nothing to show (empty), so its line is left out.' : 'No return: its line is left out.'}</div>`;
    const lines = s.source.split('\n');
    const asMode = s.mode && !r.error ? modeHtml(s, c) : '';
    const trace = (r.trace || [])
      .map(
        (t) =>
          `<div class="ca-se-tr"><span class="ca-se-tr-n" data-se-goto="${t.line}" data-tip="Go to line ${t.line}">${t.line}</span><code>${CE().highlightLine((lines[t.line - 1] || '').trim())}</code><b>${esc(t.text)}</b></div>`
      )
      .join('');
    return (
      shows +
      asMode +
      (trace
        ? `<div class="ca-se-trace"><div class="ca-se-tr-head">What it did <em>${r.steps} step${r.steps === 1 ? '' : 's'}</em></div>${trace}</div>`
        : '') +
      (r.vars && (r.vars.label !== undefined || r.vars.note !== undefined || r.vars.color !== undefined || r.vars.colour !== undefined)
        ? `<div class="ca-hint">sets ${['label', 'note', 'color'].filter((k) => r.vars[k] !== undefined || (k === 'color' && r.vars.colour !== undefined)).join(', ')}</div>`
        : '')
    );
  }

  // ---- the editor ---------------------------------------------------------------------------------

  function fieldsHtml() {
    const d = draft;
    const off = d.builtin ? ' disabled' : '';
    const sel = (key, list, cur, attrs = '') =>
      `<select data-se="${key}"${attrs}>${list.map(([v, label]) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select>`;
    const call = callOf(d);
    return (
      '<div class="ca-se-fields">' +
      `<label class="ca-field"><span>Code name</span><input type="text" maxlength="40" spellcheck="false" data-se="key" value="${esc(d.key)}" placeholder="from the label"${off}></label>` +
      `<label class="ca-field"><span>Shows as</span>${sel(
        'warn',
        [
          ['', 'a tooltip line'],
          ['yes', 'a warning'],
          ['mode', 'a payback mode'],
        ],
        d.warn ? 'yes' : d.mode ? 'mode' : '',
        `${off} data-tip="A warning marks the store’s items it has something to show about, with a “!” in its color, and a tag in their tooltips. A payback mode sets income (what payback periods count in) and returns what the item adds to it — pick it on the Payback page"`
      )}</label>` +
      `<label class="ca-field"><span>About</span>${sel(
        'scope',
        ST()
          .SCOPES.filter((x) => !(d.warn || d.mode) || x !== 'game')
          .map((x) => [x, SCOPE_NAMES[x]]),
        d.scope,
        off
      )}</label>` +
      `<label class="ca-field"><span>Reads as</span>${sel(
        'format',
        ST().FORMATS.map((f) => [f.id, f.name]),
        d.format
      )}</label>` +
      `<label class="ca-field"><span>Color</span>${sel('colour', COLOURS, d.colour)}</label>` +
      `<label class="ca-field"><span>Group</span>${sel('group', [['', '—']].concat(ST().GROUPS.map((g) => [g, g])), d.group, off)}</label>` +
      `<code class="ca-st-call" data-se-call data-tip="Use it in a macro or another statistic">${esc(call)}</code>` +
      '</div>'
    );
  }

  function html() {
    const d = draft;
    const stat = d.scope !== 'game';
    const choices = itemChoices();
    return (
      '<div class="ca-card ca-editor ca-editor2 ca-st-editor" data-stat-editor>' +
      '<div class="ca-ed-head">' +
      `<span class="ca-se-icon">${I('graphs', 22)}</span>` +
      '<div class="ca-ed-names">' +
      `<input type="text" class="ca-ed-name" maxlength="80" data-se="label" value="${esc(d.label)}" placeholder="Name your statistic…">` +
      `<input type="text" class="ca-ed-desc" maxlength="200" data-se="desc" value="${esc(d.desc)}" placeholder="What it shows (optional)"${d.builtin ? ' disabled' : ''}>` +
      (d.builtin
        ? '<span class="ca-ed-fixed-sub">a built-in</span>'
        : '') +
      '</div>' +
      '<div class="ca-ed-actions">' +
      C().button(`${I('save', 13)} Save`, 'data-se-act="save"', 'ca-btn-on') +
      C().button('Cancel', 'data-se-act="cancel"') +
      C().button(
        `${I('upload', 12)} As text`,
        `data-se-act="share" data-tip="Copy it as text, to share or keep"`,
        sharing ? 'ca-btn-on' : ''
      ) +
      (d.builtin && d.customized
        ? C().button(`${I('refresh', 12)} Reset`, 'data-se-act="reset" data-arm-label="Back to the original?"')
        : '') +
      (d.id && !d.builtin
        ? C().button(
            `${I('trash', 13)}`,
            'data-se-act="delete" data-arm-label="Delete it?" data-tip="Delete this statistic (its tooltip lines go too)"',
            'ca-btn-off'
          )
        : '') +
      '</div></div>' +
      (error ? `<div class="ca-editor-error" data-se-error>${esc(error)}</div>` : '') +
      (sharing
        ? `<div class="ca-se-share"><textarea readonly spellcheck="false" data-se-text>${esc(ST().toText(d))}</textarea><span class="ca-hint">Copied — paste it on the Tooltips page (Paste) to add it there.</span></div>`
        : '') +
      '<div class="ca-ed-layout"><div class="ca-editor-body">' +
      `<div data-se-fields>${fieldsHtml()}</div>` +
      CK().html(KEY, d.source, {}, { fixed: true }) +
      CE().html(KEY, d.source, {
        mode: 'stat',
        item: stat,
        vars: stat ? ['item'] : [],
        title: 'Code',
        hint: stat
          ? 'item is the building or upgrade · end with return …'
          : 'end with return …',
      }) +
      `<div class="ca-ed-sec ca-se-result"><div class="ca-ed-sec-head">${I('play', 12)} What it shows ` +
      (choices.length
        ? `<select data-se-item>${choices.map((o) => `<option value="${esc(o.v)}"${o.v === item ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`
        : '') +
      `</div><div data-se-result>${resultHtml()}</div></div>` +
      '</div>' +
      CE().libraryHtml(KEY, {
        mode: 'stat',
        first: ['Values · This item', 'Keywords', 'Values · Statistics', 'Values · Text', 'Values · Numbers'],
      }) +
      '</div></div>'
    );
  }

  // ---- changes --------------------------------------------------------------------------------

  function redraw() {
    CA.UI.Menu.render();
  }
  /** The parts that follow the draft without redrawing the code: the result, the call, the knobs. */
  function follow(root) {
    const res = root.querySelector('[data-se-result]');
    if (res) CA.UI.Dom.morph(res, resultHtml());
    const call = root.querySelector('[data-se-call]');
    if (call) call.textContent = callOf(draft);
    const kp = root.querySelector('[data-knobs]');
    if (kp) {
      CA.UI.Dom.morph(kp, CK().inner(draft.source, {}, { fixed: true }));
      kp.querySelectorAll('input[data-knob], input[data-knob-num]').forEach((el) => {
        if (el !== document.activeElement && el.value !== el.getAttribute('value')) el.value = el.getAttribute('value');
      });
    }
    const txt = root.querySelector('[data-se-text]');
    if (txt) txt.value = ST().toText(draft);
  }
  /** A knob moved: its line of the code takes the value. */
  function knobSet(root, name, value) {
    draft.source = CK().setIn(draft.source, name, value);
    const ta = root.querySelector(`[data-code-ed="${KEY}"] [data-code]`);
    if (ta && ta.value !== draft.source) {
      ta.value = draft.source;
      CE().refresh(ta);
    }
    follow(root);
  }

  function save() {
    const d = draft;
    const comp = CA.Script.compile(d.source, compileOpts());
    if (comp.errors.length) {
      error = `Fix the code first — line ${comp.errors[0].line}: ${comp.errors[0].message}`;
      return false;
    }
    if (!d.label.trim()) {
      error = 'Give it a label.';
      return false;
    }
    const def = {
      label: d.label.trim(),
      key: d.key.trim(),
      desc: d.desc,
      scope: d.scope,
      format: d.format,
      colour: d.colour,
      group: d.group,
      warn: d.warn,
      mode: d.mode,
      source: d.source,
    };
    if (d.builtin) {
      const orig = ST().BUILTINS.find((b) => b.id === d.id);
      const same = ['label', 'source', 'format', 'colour'].every((k) => String(orig[k]) === String(def[k]));
      if (same)
        ST().remove(d.id); // as it came: no version of yours
      else ST().update(d.id, def);
      return true;
    }
    const was = d.id ? !!(ST().get(d.id) || {}).warn : false;
    const s = d.id ? ST().update(d.id, def) : ST().add(def);
    // a new warning of yours (or one that just became one) is used straight away
    const SI = CA.UI.StoreInsight;
    if (s && s.warn && !was && !SI.warningList().includes(s.id)) SI.setWarnings(SI.warningList().concat([s.id]));
    return true;
  }

  function removeIt(id) {
    const SI = CA.UI.StoreInsight;
    SI.setLines(SI.lines().filter((x) => (SI.statOf(x) || {}).id !== id || (x && typeof x === 'object' && x.word)));
    if (SI.warningList().includes(id)) SI.setWarnings(SI.warningList().filter((x) => x !== id));
    ST().remove(id);
  }

  function copyText() {
    const text = ST().toText(draft);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).catch(() => {});
    } catch (e) {
      /* no clipboard: the text is on screen to copy */
    }
  }

  function onClick(e, root) {
    if (!draft) return;
    const t = e.target.closest && e.target.closest('[data-se-act],[data-knob-toggle],[data-se-goto]');
    if (!t || !root.contains(t)) return;
    e.stopPropagation();
    const d = t.dataset;
    if (d.seGoto) {
      // a line of the trace: the cursor to it in the code
      const ta = root.querySelector(`[data-code-ed="${KEY}"] [data-code]`);
      const n = Number(d.seGoto);
      if (ta && n > 0) {
        const pos =
          ta.value
            .split('\n')
            .slice(0, n - 1)
            .join('\n').length + (n > 1 ? 1 : 0);
        ta.focus({ preventScroll: true });
        if (ta.setSelectionRange) ta.setSelectionRange(pos, pos);
      }
      return;
    }
    if (d.knobToggle) {
      const v = CK()
        .scan(draft.source)
        .find((x) => x.name === d.knobToggle);
      if (v) knobSet(root, v.name, !v.value);
      return;
    }
    const act = d.seAct;
    if ((act === 'reset' || act === 'delete') && !CA.UI.Dom.armed(t)) return;
    CA.Util.sound('snd/tick.mp3');
    if (act === 'save') {
      if (save()) close();
    } else if (act === 'cancel') close();
    else if (act === 'reset') {
      ST().remove(draft.id);
      close();
    } else if (act === 'delete') {
      removeIt(draft.id);
      close();
    } else if (act === 'share') {
      sharing = !sharing;
      if (sharing) copyText();
    }
    redraw();
    if (act === 'share' && sharing) {
      const ta = document.querySelector('[data-stat-editor] [data-se-text]');
      if (ta && ta.select) ta.select();
    }
  }

  function onChange(e, root) {
    if (!draft) return;
    const el = e.target;
    const d = el.dataset || {};
    if (d.seItem !== undefined) {
      item = el.value;
      follow(root);
      return;
    }
    if (d.knobNum) {
      const v = CK().valueOf(el, draft.source, {});
      if (v != null) knobSet(root, d.knobNum, v);
      return;
    }
    if (!d.se) return;
    if (d.se === 'warn') {
      draft.warn = el.value === 'yes';
      draft.mode = el.value === 'mode';
      if ((draft.warn || draft.mode) && draft.scope === 'game') draft.scope = 'item';
      if (draft.mode && !draft.group) draft.group = 'Payback modes';
      if (draft.warn && draft.colour === 'none') draft.colour = 'red';
      item = 'best';
      redraw();
      return;
    }
    if (d.se === 'scope') {
      draft.scope = el.value;
      item = 'best';
      redraw(); // the code is checked another way: the editor again
      return;
    }
    draft[d.se] = el.value;
    follow(root);
  }

  function onInput(e, root) {
    if (!draft) return;
    const el = e.target;
    const d = el.dataset || {};
    if (d.knob) {
      const v = CK().valueOf(el, draft.source, {});
      if (v == null) return;
      const num = root.querySelector(`[data-knob-num="${d.knob}"]`);
      if (num) num.value = el.value;
      knobSet(root, d.knob, v);
    } else if (d.se === 'label' || d.se === 'key' || d.se === 'desc') {
      draft[d.se] = el.value;
      follow(root);
    }
  }

  /** Listens on the page's root; returns what stops it. */
  function bind(root) {
    const click = (e) => onClick(e, root);
    const change = (e) => onChange(e, root);
    const input = (e) => onInput(e, root);
    root.addEventListener('click', click);
    root.addEventListener('change', change);
    root.addEventListener('input', input);
    const offCode = CE().bind(root, {
      onChange: (key, src) => {
        if (key !== KEY || !draft) return;
        draft.source = src;
        follow(root);
      },
    });
    return () => {
      root.removeEventListener('click', click);
      root.removeEventListener('change', change);
      root.removeEventListener('input', input);
      offCode();
    };
  }

  /** Each tick: the result follows the game (only when it changed, so a selection in it stays). */
  function sync(root) {
    if (!draft) return;
    const res = root.querySelector('[data-se-result]');
    if (!res) return;
    const h = resultHtml();
    if (h === lastSig) return;
    lastSig = h;
    CA.UI.Dom.morph(res, h);
  }

  /** Unsaved changes? */
  const dirty = () => !!draft && JSON.stringify(draft) !== draftWas;
  /** Saves and closes: '' when it did, else why not. */
  const saveNow = () => (save() ? (close(), '') : error || 'It couldn’t be saved.');

  return { open, openNew, close, isOpen, html, bind, sync, dirty, saveNow, draft: () => (draft ? { ...draft } : null) };
})();
