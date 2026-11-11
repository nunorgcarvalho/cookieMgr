// The Stock market page's Trader card: which trader profile the autobuyer runs (features/
// stockTrader.js), and that profile's code to read or change.
//
//   Profile bar   pick the profile in use (built-ins, then yours); Save / Discard what you've
//                 changed, Save as new (a profile of yours), Revert a built-in you edited, Delete or
//                 rename one of yours
//   Knobs         the code's top-level numbers as sliders (ui/codeKnobs.js): Trends and prices'
//                 buy-under and sell-over thresholds, in $ from the stock's resting value
//   Code          the code editor with the library beside it (the market's words first); `buy` and
//                 `brokers` are the autobuyer's choices (on its row above), known to the code

CA.UI = CA.UI || {};

CA.UI.StockTraderCard = (() => {
  const C = () => CA.UI.C;
  const I = (n, s) => CA.UI.Icons.html(n, s);
  const esc = (s) => CA.Util.escapeHtml(s);
  const T = () => CA.StockTrader;
  const CE = () => CA.UI.CodeEditor;
  const CK = () => CA.UI.CodeKnobs;
  const KEY = 'stocks';
  const VARS = ['buy', 'brokers'];
  const HINT = 'run once a second while the autobuyer is on · buy and brokers are its choices · Tab indents · click the library to insert';

  let root = null;
  let life = null;
  let draft = null; // { id, data: { code, knobs } } — the profile's code being edited, not saved yet
  let error = '';
  let knobOpen = null;

  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const saved = (p) => ({ code: p.code, knobs: p.knobs });
  const dataOf = (p) => (draft && draft.id === p.id ? draft.data : saved(p));
  const isDirty = (p) => !!draft && draft.id === p.id && !same(draft.data, saved(p));

  function optionsHtml(cur) {
    const groups = [
      ['Built-in', T().list().filter((p) => p.builtin)],
      ['Yours', T().list().filter((p) => !p.builtin)],
    ].filter(([, xs]) => xs.length);
    return groups
      .map(([g, xs]) => `<optgroup label="${g}">` + xs.map((x) => `<option value="${esc(x.id)}"${x.id === cur ? ' selected' : ''}>${esc(x.name)}${x.edited ? ' (edited)' : ''}</option>`).join('') + '</optgroup>')
      .join('');
  }

  function head(p) {
    const dirty = isDirty(p);
    return (
      '<div class="ca-gprof" data-st-head>' +
      `<label class="ca-field"><span>${I('save', 12)} Profile</span><select data-st-pick>${optionsHtml(p.id)}</select></label>` +
      (p.builtin ? (p.edited ? '<span class="ca-badge ca-badge-edited">edited</span>' : '<span class="ca-pill">built-in</span>') : '<span class="ca-pill">yours</span>') +
      (dirty ? '<span class="ca-pill ca-pill-warn">unsaved</span>' : '') +
      '<span class="ca-controls">' +
      C().button(`${I('save', 12)} Save`, 'data-st-act="save"', `ca-btn-small${dirty ? ' ca-btn-on' : ''}`) +
      (dirty ? C().button('Discard', 'data-st-act="discard"', 'ca-btn-small') : '') +
      C().button(`${I('plus', 12)} Save as new`, 'data-st-act="new"', 'ca-btn-small') +
      (p.builtin && p.edited ? C().button(`${I('refresh', 12)} Revert to default`, 'data-st-act="revert" data-arm-label="Back to the built-in profile?"', 'ca-btn-small') : '') +
      (p.builtin ? '' : C().trash('data-st-act="delete"', 'Delete this profile?', 'Delete this profile')) +
      '</span>' +
      (p.builtin ? '' : `<input type="text" class="ca-gname" maxlength="40" value="${esc(p.name)}" data-st-name>`) +
      '</div>'
    );
  }

  /** The card's inside (under the autobuyer's row). */
  function html() {
    const p = T().current();
    const d = dataOf(p);
    return (
      '<div class="ca-st-trader" data-st-card>' +
      head(p) +
      `<div class="ca-hint">${esc(p.desc || 'Yours: what the autobuyer buys and sells, as code.')}</div>` +
      (error ? `<div class="ca-hint ca-bad">${esc(error)}</div>` : '') +
      '<div class="ca-ed-layout"><div class="ca-editor-body">' +
      CK().html(KEY, d.code, d.knobs, { open: knobOpen }) +
      CE().html(KEY, d.code, { title: 'What the autobuyer does', hint: HINT, vars: VARS }) +
      '</div>' +
      CE().libraryHtml(KEY, { first: ['Stock market', 'Values'] }) +
      '</div>' +
      '</div>'
    );
  }

  const rerender = () => CA.UI.Menu.render();

  function act(what) {
    const p = T().current();
    const data = dataOf(p);
    error = '';
    if (what === 'save' || what === 'new') {
      const { errors } = CA.Script.compile(data.code, { vars: VARS });
      if (errors.length) {
        error = `Not saved — line ${errors[0].line}: ${errors[0].message}`;
        return;
      }
    }
    if (what === 'save') {
      T().setProfile(p.id, data);
      draft = null;
      CA.Util.notify('Trader profile saved', `“${esc(p.name)}” — the autobuyer follows it from its next pass.`, CA.ICON, 3);
    } else if (what === 'new') {
      const id = T().add(`${p.name.replace(/ \(copy\)$/, '')} (copy)`, data);
      draft = null;
      T().use(id);
      CA.Util.notify('Trader profile saved', `“${esc(T().find(id).name)}” — yours to change, and in use.`, CA.ICON, 3);
    } else if (what === 'discard') draft = null;
    else if (what === 'revert') {
      T().setProfile(p.id, null);
      draft = null;
    } else if (what === 'delete') {
      T().remove(p.id);
      draft = null;
    }
  }

  // ---- the head and the knobs follow the code -------------------------------------------------

  function swapHead(p, was) {
    if (!root || was === isDirty(p)) return;
    const h = root.querySelector('[data-st-head]');
    const tmp = document.createElement('div');
    tmp.innerHTML = head(p);
    if (h && tmp.firstChild) h.replaceWith(tmp.firstChild);
  }
  function syncKnobs() {
    const kp = root && root.querySelector(`[data-st-card] [data-knobs]`);
    if (!kp) return;
    const d = dataOf(T().current());
    CA.UI.Dom.morph(kp, CK().inner(d.code, d.knobs, { open: knobOpen }));
    kp.querySelectorAll('input[data-knob], input[data-knob-num]').forEach((el) => {
      if (el !== document.activeElement && el.value !== el.getAttribute('value')) el.value = el.getAttribute('value');
    });
  }
  function setCode(src) {
    const p = T().current();
    const was = isDirty(p);
    draft = { id: p.id, data: { ...dataOf(p), code: src } };
    swapHead(p, was);
  }
  function knobSet(name, value) {
    const d = dataOf(T().current());
    const src = CK().setIn(d.code, name, value);
    setCode(src);
    const ta = root.querySelector(`[data-code-ed="${KEY}"] [data-code]`);
    if (ta && ta.value !== src) {
      ta.value = src;
      CE().refresh(ta);
    }
  }
  function knobSpec(name, spec) {
    const p = T().current();
    const d = dataOf(p);
    const knobs = { ...(d.knobs || {}) };
    if (spec) knobs[name] = spec;
    else delete knobs[name];
    draft = { id: p.id, data: { ...d, knobs } };
  }
  function specNow(name) {
    const d = dataOf(T().current());
    const v = CK().scan(d.code).find((x) => x.name === name);
    if (!v) return null;
    const sp = { ...CK().specOf(v, d.knobs) };
    delete sp.custom;
    return sp;
  }

  const inCard = (el) => !!(el && el.closest && el.closest('[data-st-card]'));

  function onClick(e) {
    const t = e.target.closest('[data-st-act],[data-knob-toggle],[data-knob-cfg],[data-knob-reset],[data-knob-unhide]');
    if (!t || !inCard(t)) return;
    e.stopPropagation();
    const d = t.dataset;
    if (d.stAct) {
      if ((d.stAct === 'revert' || d.stAct === 'delete') && !CA.UI.Dom.armed(t)) return;
      act(d.stAct);
    } else if (d.knobToggle) {
      const v = CK()
        .scan(dataOf(T().current()).code)
        .find((x) => x.name === d.knobToggle);
      if (v) knobSet(v.name, !v.value);
    } else if (d.knobCfg) knobOpen = knobOpen === d.knobCfg ? null : d.knobCfg;
    else if (d.knobReset || d.knobUnhide) knobSpec(d.knobReset || d.knobUnhide, null);
    CA.Util.sound('snd/tick.mp3');
    rerender();
  }

  function onChange(e) {
    const el = e.target;
    if (e.type !== 'change' || !inCard(el)) return;
    const d = el.dataset || {};
    if ('stPick' in d) {
      T().use(el.value);
      draft = null;
      error = '';
      knobOpen = null;
    } else if ('stName' in d) T().rename(T().activeId(), el.value);
    else if (d.knobNum) {
      const src = dataOf(T().current());
      const v = CK().valueOf(el, src.code, src.knobs);
      if (v == null) return;
      knobSet(d.knobNum, v);
      syncKnobs();
      return;
    } else if (d.knobKind) knobSpec(d.knobKind, { kind: el.value });
    else if (d.knobField) {
      const sp = specNow(d.knobOf);
      if (!sp) return;
      if (d.knobField === 'unit') sp.unit = el.value.trim();
      else if (el.value.trim() === '' || !Number.isFinite(Number(el.value))) delete sp[d.knobField];
      else sp[d.knobField] = Number(el.value) / (sp.kind === 'percent' ? 100 : 1);
      knobSpec(d.knobOf, sp);
    } else return;
    rerender();
  }

  function onInput(e) {
    const el = e.target;
    if (!el.dataset || !el.dataset.knob || !inCard(el)) return;
    const d = dataOf(T().current());
    const v = CK().valueOf(el, d.code, d.knobs);
    if (v == null) return;
    const num = root.querySelector(`[data-st-card] [data-knob-num="${el.dataset.knob}"]`);
    if (num) num.value = el.value;
    knobSet(el.dataset.knob, v);
  }

  function mount(el) {
    unmount();
    root = el;
    life = CA.UI.Pages.scope(el).on('click', onClick).on('change', onChange).on('input', onInput);
    life.add(
      CE().bind(root, {
        onChange: (key, src) => {
          if (key !== KEY) return;
          setCode(src);
          syncKnobs();
        },
      })
    );
  }
  function unmount() {
    if (life) life.close();
    life = null;
    root = null;
  }

  function init() {
    // a profile switched elsewhere (a manager, code, another page): drop an edit of the old one
    CA.Events.on('stockTrader', () => {
      if (draft && draft.id !== T().activeId()) draft = null;
    });
    // a code card's link leaving unsaved trader code (ui/codeEditor.js): asked about first
    CE().guard(KEY, {
      dirty: () => !!draft && isDirty(T().current()),
      name: () => T().current().name,
      leave(how) {
        const back = () => CA.UI.Menu.openPage('stocks');
        if (how === 'save' && draft) {
          act('save');
          if (draft) return { error: error || 'It couldn’t be saved.' };
        } else if (how === 'discard') draft = null;
        return { back };
      },
    });
  }

  return { init, html, mount, unmount, tick() {}, dirty: () => !!draft && isDirty(T().current()) };
})();
