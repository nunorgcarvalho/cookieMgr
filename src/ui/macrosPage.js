// The Macros page: every macro (features/macros.js) as a card or row with its trigger, steps,
// hotkey, favorite star, switch and settings; a strip of what's running; and the editor for
// building your own macros (or changing a built-in) out of actions, conditions and code.
//
// Macro rows (row()) are also used on the Stock market, Garden and Grimoire pages; their settings
// are handled wherever they are (handleSetting, via ui/menu.js).

CA.UI = CA.UI || {};

CA.UI.MacrosPage = (() => {
  const C = () => CA.UI.C;
  const I = (name, size) => CA.UI.Icons.html(name, size);
  const esc = (s) => CA.Util.escapeHtml(s);
  const M = () => CA.Macros;
  const STATUS_MS = 500;

  const SECTIONS = [
    { id: 'autoclickers', title: 'Autoclickers', icon: 'cookie' },
    { id: 'stocks', title: 'Stock market', icon: 'stocks', page: 'stocks' },
    { id: 'grimoire', title: 'Grimoire', icon: 'wizard', page: 'wizard' },
    { id: 'garden', title: 'Garden', icon: 'leaf', page: 'garden' },
    { id: 'buying', title: 'Buying', icon: 'dollar' },
    { id: 'upkeep', title: 'Seasons, lumps & the dragon', icon: 'calendar' },
    { id: 'managers', title: 'Managers', icon: 'ascend', page: 'managers' },
    { id: 'alerts', title: 'Alerts', icon: 'bell' },
  ];
  const ICONS = ['bolt', 'cookie', 'star', 'sparkle', 'play', 'clock', 'stocks', 'dollar', 'wizard', 'wrinkler', 'lump', 'trophy', 'graphs', 'tag', 'marker', 'ascend'];
  const MODES = [
    { v: 'repeat', label: 'Repeat', icon: 'refresh', hint: 'While it’s on, runs its steps every so often.' },
    { v: 'when', label: 'When…', icon: 'filter', hint: 'While it’s on, watches for a condition and runs its steps when it happens.' },
    { v: 'once', label: 'Once', icon: 'play', hint: 'No on/off: its button or hotkey runs the steps one time.' },
    { v: 'group', label: 'Group', icon: 'widget', hint: 'A switch for several macros at once: on turns them all on, off turns them all off.' },
    { v: 'flow', label: 'Algorithmic', icon: 'edit', hint: 'Written like pseudo-code: loops, if / else, waits, branches side by side.' },
  ];

  let root = null;
  const openSettings = new Set(); // cards whose ⚙ settings are unfolded
  let draft = null; // macro being edited (a copy), or null
  let draftError = '';
  let draftWas = ''; // the draft as it opened, to tell unsaved changes
  let life = null; // the mounted page (CA.UI.Pages.scope)

  // ---- pieces shared with other pages ----------------------------------------------------

  /** The picture for a macro: a game sprite/image, or one of our icons. */
  function icon(m, small) {
    const ic = m.icon || {};
    if (ic.ico) return `<span class="ca-icon ca-icon-ico${small ? ' small' : ''}">${I(ic.ico, small ? 16 : 24)}</span>`;
    return C().icon({ img: ic.img, icon: ic.sprite, sheet: ic.sheet });
  }

  function ago(t) {
    if (!t) return 'never';
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 2) return 'just now';
    return `${CA.UI.Plot.fmt.span(s)} ago`;
  }

  function stepChip(step) {
    const a = CA.Actions.get(step.action);
    return `<span class="ca-step">${I(a ? a.icon : 'close', 12)}${esc(CA.Actions.describe(step))}</span>`;
  }

  /** An algorithm's step chip: how long its code is — or what's wrong with it. */
  function codeChip(m) {
    const problem = M().problemOf(m.id);
    if (problem) return `<span class="ca-step ca-step-problem">${I('close', 12)}${esc(problem)}</span>`;
    const n = M().sourceOf(m).split('\n').filter((l) => l.trim() && !/^\s*#/.test(l)).length;
    return `<span class="ca-step">${I('edit', 12)}code · ${n} line${n === 1 ? '' : 's'}</span>`;
  }

  function memberChips(m) {
    const members = M().membersOf(m);
    if (!members.length) return '<span class="ca-step">no members</span>';
    return members.map((x) => `<span class="ca-step ca-step-member">${icon(x, true)}${esc(x.name)}</span>`).join('');
  }

  const everyLabel = (ms) => (ms < 1000 ? `${Math.round(1000 / ms)}× a second` : ms < 60000 ? `every ${ms / 1000}s` : `every ${ms / 60000} min`);

  /** One choice on a card (an input, or an action's option): its field and how it reads in the summary. */
  function choiceField(p, cur, attrs) {
    if (p.type === 'bool') return { html: `<input type="checkbox" ${attrs} data-type="bool"${cur ? ' checked' : ''}>`, summary: cur ? p.label : `no: ${p.label.toLowerCase()}` };
    if (p.type === 'number') return { html: `<input type="number" step="any" ${attrs} data-type="number" value="${esc(cur)}"${p.min != null ? ` min="${p.min}"` : ''}>`, summary: typeof p.summary === 'function' ? p.summary(cur) : `${p.label}: ${cur}` };
    if (p.type === 'text') return { html: `<input type="text" ${attrs} data-type="string" value="${esc(cur)}">`, summary: `${p.label}: ${cur}` };
    const list = typeof p.options === 'function' ? p.options() : p.options || [];
    const sel = list.find((x) => String(x.v) === String(cur));
    return {
      html: `<select ${attrs}>${list.map((x) => `<option value="${esc(x.v)}"${String(x.v) === String(cur) ? ' selected' : ''}>${esc(x.label)}</option>`).join('')}</select>`,
      summary: sel ? sel.label : String(cur),
    };
  }

  /** A built-in's settings as [{ label, html, summary }]: how often it runs, its inputs, then its actions' choices. */
  function settingsOf(m) {
    if (!m.builtin) return [];
    const out = [];
    if (m.mode === 'repeat' || m.mode === 'when' || m.mode === 'flow') {
      const cur = M().everyOf(m);
      // fast ones (under a second) as "times a second" — up to the game's own limit of 50 clicks a
      // second (main.js ignores clicks closer than 20 ms); slower ones in seconds
      const rate = m.every < 1000;
      const max = 1000 / M().MIN_EVERY;
      const val = rate ? Math.round((1000 / cur) * 100) / 100 : Math.round((cur / 1000) * 100) / 100;
      out.push({
        label: rate ? (m.mode === 'when' ? 'Checks a second' : 'Times a second') : m.mode === 'when' ? 'Check every (s)' : m.mode === 'flow' ? 'A pass every (s)' : 'Every (s)',
        summary: everyLabel(cur),
        html: `<input type="number" class="ca-every-num" data-macro-every="${esc(m.id)}" data-every-as="${rate ? 'rate' : 'secs'}" min="${rate ? 0.1 : M().MIN_EVERY / 1000}" ${rate ? `max="${max}"` : ''} step="any" value="${val}">` + (rate ? `<em class="ca-shift-hint">max ${max}</em>` : ''),
      });
    }
    const ins = M().inputsOf(m);
    (m.inputs || []).forEach((p) => {
      const f = choiceField(p, ins[p.key], `data-macro-input="${esc(m.id)}" data-key="${esc(p.key)}"`);
      out.push({ label: p.label, html: f.html, summary: f.summary, shift: !!(m.shift && m.shift.input === p.key) });
    });
    const steps = M().stepsOf(m);
    (m.options || []).forEach((o) => {
      const a = CA.Actions.get(steps[o.step].action);
      const p = a && a.params.find((x) => x.key === o.key);
      if (!p) return;
      const cur = CA.Actions.paramsFor(steps[o.step].action, steps[o.step].params)[o.key];
      const f = choiceField(p, cur, `data-macro-param="${esc(m.id)}" data-step="${o.step}" data-key="${esc(o.key)}"`);
      out.push({ label: p.label, html: f.html, summary: f.summary, shift: !!(m.shift && m.shift.step === o.step && m.shift.key === o.key) });
    });
    return out;
  }

  /** A built-in's settings as fields (rows show them inline; cards in their ⚙ panel). */
  function optionsHtml(m) {
    const set = settingsOf(m);
    if (!set.length) return '';
    return (
      '<div class="ca-macro-options">' +
      set.map((x) => (x.wide ? `<div class="ca-field ca-field-wide"><span>${esc(x.label)}</span>${x.html}</div>` : `<label class="ca-field"><span>${esc(x.label)}</span>${x.html}${x.shift ? '<em class="ca-shift-hint">shift-click its button</em>' : ''}</label>`)).join('') +
      '</div>'
    );
  }

  /** The settings in a few words, for a card with its settings folded away. */
  const settingsSummary = (m) =>
    settingsOf(m)
      .map((x) => x.summary)
      .join(' · ');

  /** What a running algorithm is doing: the lines it's on, the decisions it took. */
  const liveHtml = (f) =>
    `<div class="ca-code-live-head">${I('play', 11)} running</div>${f.at.map((a) => `<div class="ca-code-live-at">${esc(a)}</div>`).join('')}${f.trace
      .slice(-6)
      .map((x) => `<div class="ca-code-live-tr">${esc(x.text)}</div>`)
      .join('')}`;

  /** What each step has done, for a macro that's running (on its card / row). */
  function stepLines(m) {
    if (m.mode === 'flow') {
      const f = M().flowStatus(m.id);
      if (!f) return '';
      return (
        (f.at.length ? f.at.map((a) => `<div class="ca-status-step hot">${I('play', 11)}<span class="ca-status-name">${esc(a)}</span></div>`).join('') : '') +
        (f.trace.length ? `<div class="ca-trace">${f.trace.slice(-4).map((x) => `<div>${esc(x.text)}</div>`).join('')}</div>` : '') +
        `<div class="ca-status-step${f.error ? ' err' : ''}">${I('bolt', 11)}<span class="ca-status-name">${f.error ? esc(f.error) : 'things done'}</span><span class="ca-status-val">${CA.UI.Plot.fmt.beautify(f.done, 0)}</span></div>`
      );
    }
    const st = M().status(m.id);
    const { beautify } = CA.UI.Plot.fmt;
    return M()
      .stepsOf(m)
      .map((step, i) => {
        const s = (st && st.steps[i]) || {};
        const a = CA.Actions.get(step.action) || {};
        const avail = a.available ? a.available() : true;
        return (
          `<div class="ca-status-step${s.error ? ' err' : !avail ? ' idle' : s.lastAt && Date.now() - s.lastAt < 3000 ? ' hot' : ''}">` +
          `${I(a.icon || 'close', 11)}<span class="ca-status-name">${esc(CA.Actions.describe(step))}</span>` +
          `<span class="ca-status-val">${s.error ? esc(s.error) : !avail ? 'not available' : `${beautify(s.total || 0, 0)}${a.unit ? ' ' + esc(a.unit) : ''} · ${ago(s.lastAt)}`}</span></div>`
        );
      })
      .join('');
  }

  /** After a settings change: the card's folded summary and its trigger badge. */
  function refreshSummary(el) {
    const card = el.closest('[data-macro-row]');
    const m = card && M().get(card.dataset.macroRow);
    if (!m) return;
    const sum = card.querySelector('.ca-mtile-sum span');
    if (sum) sum.textContent = settingsSummary(m);
    const badge = card.querySelector('.ca-badge');
    if (badge) badge.textContent = M().triggerText(m);
  }

  /** One macro as a row: picture, name + trigger, steps, status, and its controls. */
  function row(m) {
    const once = m.mode === 'once';
    const fav = M().isFav(m.id);
    let h =
      `<div class="ca-row ca-macro" data-macro-row="${esc(m.id)}">` +
      icon(m) +
      '<div class="ca-row-text">' +
      `<div class="ca-row-name">${esc(m.name)} <span class="ca-badge ca-badge-${m.mode}">${esc(M().triggerText(m))}</span></div>` +
      (m.desc ? `<div class="ca-row-desc">${esc(m.desc)}</div>` : '') +
      `<div class="ca-steps">${m.mode === 'group' ? memberChips(m) : m.mode === 'flow' ? codeChip(m) : M().stepsOf(m).map(stepChip).join('<span class="ca-step-arrow">›</span>')}</div>` +
      optionsHtml(m) +
      '<div class="ca-macro-status" data-macro-status></div>' +
      '</div>' +
      '<div class="ca-controls">' +
      `<button type="button" class="ca-iconbtn ca-fav${fav ? ' on' : ''}" data-ca="macro-fav" data-id="${esc(m.id)}" data-tip="${fav ? 'Un-favorite (removes its button from the left panel)' : 'Favourite: gives it its own button on the left panel'}">${I(fav ? 'star' : 'starOutline', 15)}</button>`;
    if (m.builtin) h += `<button type="button" class="ca-iconbtn" data-ca="macro-dup" data-id="${esc(m.id)}" data-tip="Duplicate into your own editable macro">${I('plus', 14)}</button>`;
    else {
      h += `<button type="button" class="ca-iconbtn" data-ca="macro-edit" data-id="${esc(m.id)}" data-tip="Edit">${I('edit', 14)}</button>`;
      h += `<button type="button" class="ca-iconbtn" data-ca="macro-dup" data-id="${esc(m.id)}" data-tip="Duplicate">${I('plus', 14)}</button>`;
    }
    h += C().hotkey(`macro.${m.id}`);
    h += once
      ? C().button(`${I('play', 12)} Run`, `data-ca="macro-run" data-id="${esc(m.id)}"`, 'ca-btn-small ca-btn-run')
      : C().toggle(false, `data-ca="macro-toggle" data-id="${esc(m.id)}"`, m.name);
    h += '</div></div>';
    return h;
  }

  /**
   * A built-in macro as a card (the built-in sections lay these out in a grid): picture, name and
   * trigger, its switch or Run button, what it does, its choices, an activity meter, and ★ /
   * duplicate / hotkey along the bottom. Same data attributes as a row, so sync() keeps it live.
   */
  function tile(m) {
    const once = m.mode === 'once';
    const fav = M().isFav(m.id);
    return (
      `<div class="ca-mtile ca-macro" data-macro-row="${esc(m.id)}">` +
      '<div class="ca-mtile-head">' +
      icon(m) +
      `<div class="ca-mtile-name"><b>${esc(m.name)}</b><span class="ca-badge ca-badge-${m.mode}">${esc(M().triggerText(m))}</span>${M().isCustomized(m.id) ? '<span class="ca-badge ca-badge-edited" data-tip="Changed from how it comes — Edit → Revert to default to undo">edited</span>' : ''}</div>` +
      (once
        ? C().button(`${I('play', 12)} Run`, `data-ca="macro-run" data-id="${esc(m.id)}"`, 'ca-btn-small ca-btn-run')
        : C().toggle(false, `data-ca="macro-toggle" data-id="${esc(m.id)}"`, m.name)) +
      '</div>' +
      (m.desc ? `<div class="ca-mtile-desc">${esc(m.desc)}</div>` : '') +
      (settingsOf(m).length
        ? `<div class="ca-mtile-settings${openSettings.has(m.id) ? ' open' : ''}">` +
          `<div class="ca-mtile-sum" data-ca="macro-settings" data-id="${esc(m.id)}" data-tip="Change its settings">${I('settings', 11)} <span>${esc(settingsSummary(m))}</span></div>` +
          optionsHtml(m) +
          '</div>'
        : '') +
      '<div class="ca-mtile-heat" data-macro-heat data-tip="How busy it has been lately"><i></i></div>' +
      '<div class="ca-macro-status" data-macro-status></div>' +
      '<div class="ca-mtile-foot">' +
      `<button type="button" class="ca-iconbtn ca-fav${fav ? ' on' : ''}" data-ca="macro-fav" data-id="${esc(m.id)}" data-tip="${fav ? 'Un-favorite (removes its button from the left panel)' : 'Favourite: gives it its own button on the left panel'}">${I(fav ? 'star' : 'starOutline', 14)}</button>` +
      `<button type="button" class="ca-iconbtn" data-ca="macro-dup" data-id="${esc(m.id)}" data-tip="Duplicate into your own editable macro">${I('plus', 13)}</button>` +
      C().button(`${I('edit', 11)} Edit`, `data-ca="macro-edit" data-id="${esc(m.id)}"`, 'ca-btn-small') +
      C().hotkey(`macro.${m.id}`) +
      '</div></div>'
    );
  }

  // ---- the editor ----------------------------------------------------------------------------
  //
  // A header (the icon, name and description, Save / Cancel / Delete), the kind of macro as five
  // cards, how often it runs, then what it does: numbered step cards, the conditions of a "When…"
  // macro, a group's members, or an algorithm's code (ui/codeEditor.js) with the library beside
  // it. Inputs carry data-edit="path.in.draft"; buttons data-edit-act + data-path.

  function blankDraft() {
    return { id: null, name: '', desc: '', icon: { ico: 'bolt' }, mode: 'repeat', every: 1000, steps: [{ action: 'pop.golden', params: {} }], members: [], when: blankWhen(), source: '' };
  }
  const blankCond = () => ({ cond: 'buff', params: {}, not: false });
  const blankWhen = () => ({ all: [blankCond()], edge: 'rise' });
  function getPath(obj, path) {
    return path.split('.').reduce((o, k) => (o == null ? o : o[/^\d+$/.test(k) ? Number(k) : k]), obj);
  }
  function setPath(obj, path, value) {
    const parts = path.split('.');
    let o = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const k = /^\d+$/.test(parts[i]) ? Number(parts[i]) : parts[i];
      o = o[k] = o[k] || {};
    }
    o[parts[parts.length - 1]] = value;
  }

  function field(p, value, path) {
    const opts = typeof p.options === 'function' ? p.options() : p.options || [];
    const v = value === undefined ? p.default : value;
    let input;
    if (p.type === 'select') {
      const has = opts.some((o) => String(o.v) === String(v));
      input =
        `<select data-edit="${path}" data-type="${typeof p.default === 'number' ? 'number' : 'string'}">` +
        (has || v === '' || v == null ? '' : `<option value="${esc(v)}" selected>${esc(v)}</option>`) +
        (v === '' ? '<option value="" selected disabled>Choose…</option>' : '') +
        opts.map((o) => `<option value="${esc(o.v)}"${String(o.v) === String(v) ? ' selected' : ''}>${esc(o.label)}</option>`).join('') +
        '</select>';
    } else if (p.type === 'bool') {
      input = `<input type="checkbox" data-edit="${path}" data-type="bool"${v ? ' checked' : ''}>`;
    } else if (p.type === 'text') {
      input = `<input type="text" data-edit="${path}" data-type="string" value="${esc(v)}">`;
    } else {
      input = `<input type="number" step="any" data-edit="${path}" data-type="number" value="${esc(v)}"${p.min != null ? ` min="${p.min}"` : ''}>`;
    }
    return `<label class="ca-field"><span>${esc(p.label)}</span>${input}</label>`;
  }

  function actionSelect(action, path) {
    const groups = {};
    CA.Actions.all().filter((a) => !a.hidden).forEach((a) => (groups[a.group] = groups[a.group] || []).push(a));
    return (
      `<select class="ca-ed-main" data-edit="${path}" data-structural>` +
      Object.keys(groups)
        .map((g) => `<optgroup label="${esc(g)}">${groups[g].map((a) => `<option value="${a.id}"${a.id === action ? ' selected' : ''}>${esc(a.name)}</option>`).join('')}</optgroup>`)
        .join('') +
      '</select>'
    );
  }

  const tools = (act, listPath, i, n) =>
    '<span class="ca-ed-tools">' +
    `<button type="button" class="ca-iconbtn" data-edit-act="${act}-up" data-path="${listPath}" data-val="${i}" data-tip="Move up"${i === 0 ? ' disabled' : ''}>▲</button>` +
    `<button type="button" class="ca-iconbtn" data-edit-act="${act}-down" data-path="${listPath}" data-val="${i}" data-tip="Move down"${i === n - 1 ? ' disabled' : ''}>▼</button>` +
    `<button type="button" class="ca-iconbtn" data-edit-act="${act}-del" data-path="${listPath}" data-val="${i}" data-tip="Remove">${I('close', 12)}</button>` +
    '</span>';

  /** A step: its action and the action's choices. */
  function stepBody(s, path) {
    const a = CA.Actions.get(s.action);
    return (
      `<span class="ca-ed-aico">${I((a && a.icon) || 'bolt', 14)}</span>` +
      actionSelect(s.action, `${path}.action`) +
      (a && a.params.length ? `<div class="ca-ed-params">${a.params.map((p) => field(p, (s.params || {})[p.key], `${path}.params.${p.key}`)).join('')}</div>` : '')
    );
  }

  /** Conditions that must all hold (each can be negated), with "And…". */
  function condsHtml(listPath, list) {
    return (
      '<div class="ca-ed-conds">' +
      list
        .map((one, j) => {
          const cond = CA.Conditions.get(one.cond) || CA.Conditions.all()[0];
          return (
            `<div class="ca-ed-cond"><span class="ca-ed-and">${j ? 'and' : 'when'}</span>` +
            `<select class="ca-ed-main" data-edit="${listPath}.${j}.cond" data-structural>${CA.Conditions.all()
              .map((c) => `<option value="${c.id}"${c.id === one.cond ? ' selected' : ''}>${esc(c.name)}</option>`)
              .join('')}</select>` +
            cond.params.map((p) => field(p, (one.params || {})[p.key], `${listPath}.${j}.params.${p.key}`)).join('') +
            `<label class="ca-field ca-check"><input type="checkbox" data-edit="${listPath}.${j}.not" data-type="bool"${one.not ? ' checked' : ''}><span>not</span></label>` +
            (list.length > 1 ? `<button type="button" class="ca-iconbtn" data-edit-act="cond-del" data-path="${listPath}" data-val="${j}" data-tip="Remove this condition">${I('close', 12)}</button>` : '') +
            '</div>'
          );
        })
        .join('') +
      `<button type="button" class="ca-btn ca-btn-small ca-ed-add" data-edit-act="cond-add" data-path="${listPath}">${I('plus', 11)} And…</button>` +
      '</div>'
    );
  }

  // ---- algorithmic macros: the code editor and the library (ui/codeEditor.js) ---------------

  const CE = () => CA.UI.CodeEditor;
  const inputKeys = (d) => (d.inputs || []).map((i) => i.key);
  const codeHtml = (d) => CE().html('macro', d.source, { vars: inputKeys(d) });
  const libraryHtml = () => CE().libraryHtml('macro');

  /** A library click while the macro isn't algorithmic: add the action as a step, or the condition. */
  function onPick(key, it) {
    if (key !== 'macro' || !draft) return true;
    if (draft.mode === 'flow') return false; // into the code
    if (it.kind === 'action' && draft.mode !== 'group') {
      draft.steps.push({ action: it.id, params: { ...(it.params || {}) } }); // a possible value picked under its row fills its param
      renderEditor();
    } else if (it.kind === 'condition' && draft.mode === 'when') {
      draft.when.all.push({ cond: it.id, params: { ...(it.params || {}) }, not: false });
      renderEditor();
    } else CA.Util.notify('Library', 'That one is for algorithmic macros — switch the kind to Algorithmic to write with it.', CA.ICON, 3);
    return true;
  }

  // how often presets for the interval row
  const EVERY_PRESETS = [100, 250, 1000, 5000, 30000];

  /** Every macro is code underneath: what this one's settings write out, and a way to carry on in code. */
  function asCodeHtml(d) {
    return (
      `<details class="ca-ed-sec ca-ed-ascode"${asCodeOpen ? ' open' : ''} data-ascode>` +
      `<summary class="ca-ed-sec-head">${I('edit', 12)} As code <span class="ca-hint">what it runs — every macro is algorithmic code underneath; these settings are a shortcut for it</span></summary>` +
      `<pre class="ca-code-hl ca-ascode-pre" data-ascode-pre>${CE().view(M().codeFor(d)).hl}</pre>` +
      `<button type="button" class="ca-btn ca-btn-small" data-edit-act="to-code">${I('edit', 12)} Carry on as code</button>` +
      '</details>'
    );
  }
  let asCodeOpen = false;
  /** After a change in the form: the code view follows. */
  function refreshAsCode() {
    const pre = root && root.querySelector('[data-macro-editor] [data-ascode-pre]');
    if (pre && draft) pre.innerHTML = CE().view(M().codeFor(draft)).hl;
  }

  function editorHtml() {
    const d = draft;
    let h =
      '<div class="ca-card ca-editor ca-editor2" data-macro-editor>' +
      // header: icon, name, description, the buttons
      '<div class="ca-ed-head">' +
      `<span class="ca-ed-icon">${icon({ icon: d.icon })}</span>` +
      '<div class="ca-ed-names">' +
      `<input type="text" class="ca-ed-name" maxlength="60" data-edit="name" value="${esc(d.name)}" placeholder="${d.id ? 'Name' : 'Name your macro…'}">` +
      `<input type="text" class="ca-ed-desc" maxlength="300" data-edit="desc" value="${esc(d.desc)}" placeholder="What it does (optional)">` +
      (d.builtinEdit ? '<span class="ca-ed-fixed-sub">a built-in — change anything; “Revert to default” brings back the original</span>' : '') +
      '</div>' +
      '<div class="ca-ed-actions">' +
      C().button(`${I('save', 13)} Save`, 'data-edit-act="save"', 'ca-btn-on') +
      C().button('Cancel', 'data-edit-act="cancel"') +
      (d.builtinEdit ? C().button(`${I('refresh', 12)} Revert to default`, 'data-edit-act="revert" data-arm-label="Back to the original?"') : '') +
      (d.id && !d.builtinEdit ? C().button(`${I('trash', 13)}`, 'data-edit-act="delete" data-arm-label="Delete it?" data-tip="Delete this macro"', 'ca-btn-off') : '') +
      '</div></div>' +
      (draftError ? `<div class="ca-editor-error">${esc(draftError)}</div>` : '') +
      // the editor, with the library always beside it
      '<div class="ca-ed-layout"><div class="ca-editor-body">' +
      // the kind of macro, as cards
      (`<div class="ca-ed-kinds">${MODES.map(
            (x) => `<button type="button" class="ca-ed-kind${x.v === d.mode ? ' on' : ''}" data-edit-act="mode" data-val="${x.v}">${I(x.icon, 16)}<b>${x.label}</b><span>${esc(x.hint)}</span></button>`
          ).join('')}</div>`);
    if (d.mode !== 'once' && d.mode !== 'group') {
      const secs = d.every / 1000;
      h +=
        '<div class="ca-ed-row">' +
        `<span class="ca-ed-label">${I('clock', 12)} ${d.mode === 'when' ? 'Check every' : d.mode === 'flow' ? 'A pass every' : 'Every'}</span>` +
        `<input type="number" class="ca-ed-secs" step="any" min="${M().MIN_EVERY / 1000}" data-edit="everySec" data-type="number" value="${secs}"><em>seconds</em>` +
        `<span class="ca-chipgroup">${EVERY_PRESETS.map((ms) => `<button type="button" class="ca-chip${ms === d.every ? ' on' : ''}" data-edit-act="every" data-val="${ms}">${ms / 1000}s</button>`).join('')}</span>` +
        '</div>';
    }
    if (d.mode === 'when') {
      h +=
        `<div class="ca-ed-sec"><div class="ca-ed-sec-head">${I('filter', 12)} When</div>` +
        condsHtml('when.all', d.when.all) +
        `<label class="ca-field"><span>Run</span><select data-edit="when.edge"><option value="rise"${d.when.edge !== 'while' ? ' selected' : ''}>once each time it happens</option><option value="while"${d.when.edge === 'while' ? ' selected' : ''}>on every check while it holds</option></select></label>` +
        '</div>';
    }
    if (d.mode === 'group') {
      const choices = M()
        .list()
        .filter((m) => m.mode !== 'once' && m.mode !== 'group' && m.id !== d.id);
      h +=
        `<div class="ca-ed-sec"><div class="ca-ed-sec-head">${I('widget', 12)} Members <span class="ca-hint">switching the group switches all of these together</span></div><div class="ca-members">` +
        choices
          .map(
            (m) =>
              `<label class="ca-member${d.members.includes(m.id) ? ' on' : ''}"><input type="checkbox" data-member="${esc(m.id)}"${d.members.includes(m.id) ? ' checked' : ''}>` +
              `${icon(m, true)}<span>${esc(m.name)}</span></label>`
          )
          .join('') +
        '</div></div>';
    } else if (d.mode === 'flow') {
      h += codeHtml(d);
    } else {
      h +=
        `<div class="ca-ed-sec"><div class="ca-ed-sec-head">${I('bolt', 12)} Steps <span class="ca-hint">run in order, every time it ${d.mode === 'once' ? 'runs' : 'fires'}</span></div><div class="ca-ed-steps">` +
        d.steps.map((s, i) => `<div class="ca-ed-step"><span class="ca-step-n">${i + 1}</span><div class="ca-ed-step-body">${stepBody(s, `steps.${i}`)}</div>${tools('step', 'steps', i, d.steps.length)}</div>`).join('') +
        `<button type="button" class="ca-btn ca-btn-small ca-ed-add" data-edit-act="step-add" data-path="steps">${I('plus', 12)} Add step</button></div></div>` +
        asCodeHtml(d);
    }
    h +=
      (`<div class="ca-ed-sec ca-ed-icons"><div class="ca-ed-sec-head">${I('star', 12)} Icon</div><div class="ca-iconpick">${ICONS.map(
            (n) => `<button type="button" class="ca-iconbtn${(d.icon || {}).ico === n ? ' on' : ''}" data-edit-act="icon" data-val="${n}" data-tip="${n}">${I(n, 16)}</button>`
          ).join('')}</div></div>`) +
      '</div>' +
      libraryHtml() +
      '</div></div>';
    return h;
  }

  /**
   * A macro row's own settings (how often, its actions' choices) — wherever the row is shown (the
   * Macros, Garden, Grimoire, Stock market pages): ui/menu.js sends every change in the panel here.
   * Returns true when it was one.
   */
  function handleSetting(e) {
    const el = e.target;
    if (el.dataset && el.dataset.macroEvery) {
      if (e.type !== 'change') return;
      CA.Util.sound('snd/tick.mp3');
      const v = Number(el.value);
      if (!(v > 0)) return;
      M().setEvery(el.dataset.macroEvery, el.dataset.everyAs === 'rate' ? 1000 / Math.min(v, 1000 / M().MIN_EVERY) : el.dataset.everyAs === 'secs' ? v * 1000 : v);
      refreshSummary(el);
      return true;
    }
    if (el.dataset && el.dataset.macroInput) {
      if (e.type !== 'change') return;
      CA.Util.sound('snd/tick.mp3');
      const v = el.dataset.type === 'bool' ? el.checked : el.dataset.type === 'number' ? Number(el.value) : el.value;
      if (el.dataset.type === 'number' && !Number.isFinite(v)) return;
      M().setInput(el.dataset.macroInput, el.dataset.key, v);
      // a setting kept elsewhere (the Auto-gardener's layout and gardener): the page shows it too
      const m = M().get(el.dataset.macroInput);
      const inp = m && (m.inputs || []).find((i) => i.key === el.dataset.key);
      if (inp && typeof inp.set === 'function') CA.UI.Menu.render();
      else refreshSummary(el);
      return true;
    }
    if (el.dataset && el.dataset.macroParam) {
      if (e.type !== 'change') return;
      CA.Util.sound('snd/tick.mp3');
      const v = el.dataset.type === 'bool' ? el.checked : el.dataset.type === 'number' ? Number(el.value) : el.value;
      if (el.dataset.type === 'number' && !Number.isFinite(v)) return;
      M().setParam(el.dataset.macroParam, Number(el.dataset.step), el.dataset.key, v);
      refreshSummary(el);
      // the row's step chip says what it does now
      const row = el.closest('[data-macro-row]');
      const m = M().get(el.dataset.macroParam);
      const chips = row && row.querySelector('.ca-steps');
      if (chips && m) chips.innerHTML = M().stepsOf(m).map(stepChip).join('<span class="ca-step-arrow">›</span>');
      return true;
    }
    return false;
  }

  function onEditInput(e) {
    const el = e.target;
    if (el.matches && (el.matches('[data-code]') || el.matches('[data-lib-search]'))) return; // ui/codeEditor.js
    if (el.dataset && (el.dataset.macroEvery || el.dataset.macroParam || el.dataset.macroInput)) return; // handleSetting (via ui/menu.js)
    if (el.dataset && el.dataset.member && draft) {
      const id = el.dataset.member;
      draft.members = (draft.members || []).filter((x) => x !== id);
      if (el.checked) draft.members.push(id);
      el.closest('.ca-member').classList.toggle('on', el.checked);
      return;
    }
    if (!el.dataset || !el.dataset.edit || !draft) return;
    const type = el.dataset.type;
    let v = type === 'bool' ? el.checked : type === 'number' ? Number(el.value) : el.value;
    if (type === 'number' && !Number.isFinite(v)) return;
    if (el.dataset.edit === 'everySec') {
      draft.every = Math.round(v * 1000);
      return;
    }
    const path = el.dataset.edit;
    if ('structural' in el.dataset) {
      // another action / condition: its own defaults
      setPath(draft, path, v);
      if (/\.action$/.test(path)) setPath(draft, path.replace(/action$/, 'params'), {});
      if (/\.cond$/.test(path)) setPath(draft, path.replace(/cond$/, 'params'), {});
      renderEditor();
      return;
    }
    setPath(draft, path, v);
    refreshAsCode();
  }

  /** Every "do" block of compiled code (to check them), however deep. */
  function flowDos(nodes, out = []) {
    (nodes || []).forEach((n) => {
      if (n.type === 'do') out.push(n);
      flowDos(n.body, out);
      flowDos(n.then, out);
      flowDos(n.else, out);
      (n.branches || []).forEach((b) => flowDos(b, out));
    });
    return out;
  }
  function validate(d) {
    if (!d.name.trim()) return 'Give it a name.';
    if (d.mode === 'group') return d.members && d.members.length ? '' : 'Tick at least one macro for the group.';
    if (d.mode !== 'flow' && !d.steps.length) return 'Add at least one step.';
    if (d.mode !== 'once' && !(d.every >= M().MIN_EVERY)) return `Run it at most every ${M().MIN_EVERY / 1000}s.`;
    const steps = d.mode === 'flow' ? flowDos(CA.Script.compile(d.source || '', { vars: inputKeys(d) }).flow) : d.steps;
    const self = steps.find((s) => (s.action === 'macro.run' || s.action === 'macro.set') && d.id && s.params.macro === d.id);
    if (self) return 'A macro can’t switch or run itself.';
    const missing = steps.find((s) => (s.action === 'macro.run' || s.action === 'macro.set') && !s.params.macro);
    if (missing) return 'Pick which macro the step should switch or run.';
    return '';
  }

  function onEditAct(t) {
    const act = t.dataset.editAct;
    const i = Number(t.dataset.val);
    const d = draft;
    const list = t.dataset.path ? getPath(d, t.dataset.path) : null;
    const swap = (arr, x, y) => ([arr[x], arr[y]] = [arr[y], arr[x]]);
    if (act === 'icon') d.icon = { ico: t.dataset.val };
    else if (act === 'every') d.every = Number(t.dataset.val);
    else if (act === 'mode') {
      const was = d.mode;
      d.mode = t.dataset.val;
      if (d.mode === 'when' && !(d.when && d.when.all && d.when.all.length)) d.when = blankWhen();
      if (d.mode === 'when' && d.every >= 1000) d.every = 250;
      // an algorithm starts as the steps it had, written out (and steps from an algorithm's top lines)
      // an algorithm starts as what the macro ran: its steps — and a When…'s conditions — written out
      if (d.mode === 'flow' && !(d.source || '').trim()) d.source = M().codeFor({ ...d, mode: was === 'group' ? 'once' : was });
      if (was === 'flow' && d.mode !== 'flow' && d.mode !== 'group') {
        const dos = CA.Script.compile(d.source || '').flow.filter((n) => n.type === 'do').map((n) => ({ action: n.action, params: { ...n.params } }));
        if (dos.length) d.steps = dos;
      }
    } else if (list && /-(up|down|del)$/.test(act)) {
      if (act.endsWith('-up') && i > 0) swap(list, i - 1, i);
      else if (act.endsWith('-down') && i < list.length - 1) swap(list, i, i + 1);
      else if (act.endsWith('-del')) list.splice(i, 1);
    } else if (act === 'step-add' && list) list.push({ action: 'pop.golden', params: {} });
    else if (act === 'cond-add' && list) list.push(blankCond());
    else if (act === 'cond-del' && list) list.splice(i, 1);
    else if (act === 'to-code') {
      d.source = M().codeFor(d);
      d.mode = 'flow';
    } else if (act === 'cancel') {
      draft = null;
      draftError = '';
      return rerender();
    } else if (act === 'delete') {
      if (!CA.UI.Dom.armed(t)) return;
      M().remove(d.id);
      draft = null;
      return rerender();
    } else if (act === 'revert') {
      if (!CA.UI.Dom.armed(t)) return;
      M().revert(d.id);
      CA.Util.notify(d.name, 'Back to how it comes.', CA.ICON, 2);
      draft = null;
      return rerender();
    } else if (act === 'save' && d.mode === 'flow') {
      // an algorithm: it has to read right before it's kept
      const r = CA.Script.compile(d.source || '', { vars: inputKeys(d) });
      if (r.errors.length) {
        draftError = `Line ${r.errors[0].line}: ${r.errors[0].message}${r.errors.length > 1 ? ` (and ${r.errors.length - 1} more)` : ''}`;
        return renderEditor();
      }
      if (!r.flow.length) {
        draftError = 'Write at least one line.';
        return renderEditor();
      }
      draftError = validate(d);
      if (draftError) return renderEditor();
      try {
        const saved = M().save(d);
        CA.Util.notify('Macro saved', esc(saved.name), CA.ICON, 2);
        draft = null;
        return rerender();
      } catch (e) {
        draftError = e.message;
      }
    } else if (act === 'save') {
      // fill in each param's default so the saved macro is explicit
      d.steps.forEach((x) => (x.params = CA.Actions.paramsFor(x.action, x.params)));
      if (d.mode === 'when') d.when.all.forEach((c) => (c.params = CA.Conditions.paramsFor(c.cond, c.params)));
      draftError = validate(d);
      if (draftError) return renderEditor();
      try {
        const saved = M().save(d);
        CA.Util.notify('Macro saved', esc(saved.name), CA.ICON, 2);
        draft = null;
        return rerender();
      } catch (e) {
        draftError = e.message;
      }
    }
    renderEditor();
  }

  function renderEditor() {
    const el = root && root.querySelector('[data-macro-editor]');
    if (el) el.outerHTML = editorHtml();
  }

  /** Opens the editor on macro `id`, or a new macro (optionally starting from `preset` fields). */
  function edit(id, preset) {
    const m = id ? M().get(id) : null;
    // a built-in: edited as it runs now (its row choices, interval and code included)
    draft = m
      ? JSON.parse(
          JSON.stringify({
            ...m,
            steps: M().stepsOf(m),
            every: M().everyOf(m),
            source: m.mode === 'flow' ? M().sourceOf(m) : m.source,
            builtinEdit: !!m.builtin,
          })
        )
      : { ...blankDraft(), ...(preset || {}) };
    if (typeof draft.source !== 'string') draft.source = '';
    if (!draft.when || !Array.isArray(draft.when.all)) draft.when = blankWhen();
    if (!Array.isArray(draft.members)) draft.members = [];
    if (!draft.steps.length) draft.steps = [{ action: 'pop.golden', params: {} }]; // a group switched to another mode
    if (CA.Settings.get('tab') !== 'clickers' && CA.UI.Menu.isOpen()) CA.Settings.set('tab', 'clickers');
    draftError = '';
    draftWas = JSON.stringify(draft);
    rerender();
    const el = root && root.querySelector('[data-macro-editor]');
    if (el) CA.Util.scrollInPanel(el);
  }

  // ---- page ------------------------------------------------------------------------------

  function sectionCard(sec, macros, extraHead, extraTop) {
    return (
      '<div class="ca-card">' +
      C().cardHead(sec.page ? C().link(sec.title, sec.page) : sec.title, sec.icon, extraHead || '') +
      (extraTop || '') +
      `<div class="ca-mtiles">${macros.map(tile).join('')}</div>` +
      '</div>'
    );
  }

  function html() {
    const all = M().list();
    // what's running, at a glance: a chip per running macro (click to find its card, × to stop it);
    // each card shows its own details while it runs
    let h =
      '<div class="ca-card ca-runbar">' +
      '<div class="ca-runbar-head">' +
      `<span class="ca-runbar-title">${I('play', 13)} Running</span><span class="ca-pill" data-ca-count></span>` +
      '<div class="ca-runchips" data-macro-runbar></div>' +
      `<button type="button" class="ca-iconbtn" data-ca="widget-add" data-type="status" data-tip="Put this on the left panel as a status bar">${I('widget', 13)}</button>` +
      C().button(`${I('close', 11)} Stop all`, 'data-ca="stop-all"', 'ca-btn-small ca-btn-off') +
      '</div></div>';
    if (draft) h += editorHtml();
    SECTIONS.forEach((sec) => {
      const list = all.filter((m) => m.builtin && m.section === sec.id);
      if (!list.length) return;
      h += sectionCard(sec, list, '', '');
    });
    const mine = all.filter((m) => !m.builtin);
    h +=
      '<div class="ca-card">' +
      C().cardHead('Your macros', 'edit', `<div class="ca-card-meta">${C().button(`${I('plus', 12)} New macro`, 'data-ca="macro-new"', 'ca-btn-small')}</div>`) +
      (mine.length
        ? `<div class="ca-list">${mine.map(row).join('')}</div>`
        : '<div class="ca-card-note">Chain actions into your own macros: pop everything at once, sell stocks when a value crosses a line, switch other macros on when an effect starts… Built-in macros can be duplicated as a starting point.</div>') +
      '</div>';
    h += CA.UI.Menu.optionsCard('Options', 'settings', 'macros');
    return h;
  }

  /** Brings every macro row and status block inside `el` up to date. */
  function sync(el) {
    if (!el) return;
    el.querySelectorAll('[data-macro-row]').forEach((r) => {
      const id = r.dataset.macroRow;
      const m = M().get(id);
      if (!m) return;
      const on = M().isOn(id);
      r.classList.toggle('on', on);
      const sw = r.querySelector('.ca-switch');
      if (sw) {
        sw.classList.toggle('on', on);
        sw.setAttribute('aria-checked', String(on));
      }
      const heat = r.querySelector('[data-macro-heat]');
      if (heat) {
        const lvl = M().activityLevel(id);
        heat.className = `ca-mtile-heat h${lvl}`;
        heat.firstChild.style.width = `${(lvl / 5) * 100}%`;
      }
      const st = r.querySelector('[data-macro-status]');
      if (st) {
        const s = M().status(id);
        const n = s ? s.steps.reduce((x, y) => x + (y.total || 0), 0) : 0;
        if (on && m.mode !== 'group') {
          // running: what each of its steps has done (morphed, so nothing flickers)
          CA.UI.Dom.morph(st, `<div class="ca-status-up">on for ${CA.UI.Plot.fmt.span((Date.now() - M().since(id)) / 1000)}${n ? ` · ${n.toLocaleString()} done` : ''}</div>${stepLines(m)}`);
        } else st.textContent = on ? `Running · ${CA.UI.Plot.fmt.span((Date.now() - M().since(id)) / 1000)}` : s && s.lastRun ? `Last ran ${ago(s.lastRun)}` : '';
        // a built-in's hint (why it may not do anything now), on or off
        let hint = '';
        try {
          hint = typeof m.hint === 'function' ? m.hint(M().inputsOf(m)) || '' : '';
        } catch (e) {
          hint = '';
        }
        if (hint) st.insertAdjacentHTML('beforeend', `<div class="ca-status-hint">⚠ ${esc(hint)}</div>`);
      }
    });
    if (draft && draft.id && el.querySelector('[data-macro-editor] [data-code-ed]')) {
      const f = M().isOn(draft.id) ? M().flowStatus(draft.id) : null;
      CE().setLive(el, 'macro', f ? { lines: f.lines, html: liveHtml(f) } : null);
    }
    const strip = el.querySelector('[data-macro-runbar]');
    if (strip) {
      const ids = M().runningIds();
      CA.UI.Dom.morph(
        strip,
        ids.length
          ? ids
              .map((rid) => {
                const m = M().get(rid);
                if (!m) return '';
                const lvl = M().activityLevel(rid);
                return (
                  `<span class="ca-runchip h${lvl}" data-ca="macro-locate" data-id="${esc(rid)}" data-tip="${esc(m.name)} — click to find it">${icon(m, true)}<b>${esc(m.name)}</b>` +
                  `<button type="button" class="ca-runchip-x" data-ca="macro-toggle" data-id="${esc(rid)}" data-tip="Stop ${esc(m.name)}">${I('close', 9)}</button></span>`
                );
              })
              .join('')
          : '<span class="ca-runbar-idle">nothing — switch a macro on below, or press its hotkey</span>'
      );
    }
    const stopAll = el.querySelector('[data-ca="stop-all"]');
    if (stopAll) stopAll.disabled = !M().activeCount();
    const count = el.querySelector('[data-ca-count]');
    if (count) {
      const n = M().activeCount();
      count.textContent = n ? `${n} running` : 'all off';
      count.classList.toggle('on', n > 0);
    }
  }

  /**
   * Runs a once-macro from a button — with feedback when it couldn't do anything because a spell
   * it casts needs more magic than there is: the button shakes, the game's spell-fail sound plays,
   * and a notice says how much it costs and when it'll be ready.
   */
  function run(id, el) {
    const m = M().get(id);
    if (!m) return 0;
    const spells = m.steps.filter((x) => x.action === 'spell.cast').map((x) => x.params && x.params.spell);
    const n = M().runOnce(id);
    if (n > 0 || !spells.length) {
      CA.Util.sound('snd/clickOn2.mp3');
      return n;
    }
    CA.Util.sound('snd/spellFail.mp3');
    CA.UI.Dom.replay(el, 'ca-shake', 500);
    const mg = CA.Grimoire.magicNow();
    if (!mg) {
      CA.Util.notify(m.name, 'The Grimoire isn’t open yet (Wizard tower level 1).', [22, 11], 3);
      return 0;
    }
    const s = CA.Grimoire.spells().find((x) => spells.includes(x.key) && !x.affordable);
    if (s) {
      const { span } = CA.UI.Plot.fmt;
      const when = Number.isFinite(s.wait) ? `ready in ${span(s.wait)}` : `more than your maximum of ${Math.floor(mg.max)}`;
      CA.Util.notify('Not enough magic', `${esc(s.name)} needs <b>${s.cost}</b> magic — you have ${Math.floor(mg.magic)} (${when}).`, s.icon, 3);
    }
    return 0;
  }

  function rerender() {
    if (CA.UI.Menu.isOpen()) CA.UI.Menu.render();
  }

  /** Clicks on macro controls anywhere in the panel (menu.js forwards data-ca="macro-…"). */
  function handle(kind, t) {
    const id = t.dataset.id;
    switch (kind) {
      case 'macro-toggle':
        CA.Util.sound(M().isOn(id) ? 'snd/clickOff2.mp3' : 'snd/clickOn2.mp3');
        M().toggle(id);
        return true;
      case 'macro-run':
        run(id, t);
        return true;
      case 'macro-fav': {
        CA.Util.sound('snd/tick.mp3');
        const fav = !M().isFav(id);
        M().setFav(id, fav); // → its own button widget appears / goes (ui/widgets.js)
        if (fav) {
          if (!CA.Settings.get('widgetsShown')) CA.Settings.set('widgetsShown', true);
          CA.Util.notify(M().get(id).name, 'Added as a button on the left panel — drag it wherever you like.', CA.ICON, 2);
        }
        rerender();
        return true;
      }
      case 'macro-dup': {
        CA.Util.sound('snd/tick.mp3');
        const copy = M().duplicate(id);
        if (CA.Settings.get('tab') !== 'clickers') CA.UI.Menu.openPage('clickers');
        if (copy) edit(copy.id);
        return true;
      }
      case 'macro-edit': {
        CA.Util.sound('snd/tick.mp3');
        const m = M().get(id);
        // a built-in edited on its own page (the Auto-gardener: the Garden page's Rules card)
        if (m && m.editAt) {
          CA.UI.Menu.openPage(m.editAt);
          const card = document.querySelector(`#CookieMgrMenu [data-edits="${id}"]`);
          if (card) {
            CA.Util.scrollInPanel(card, 'start');
            CA.UI.Dom.replay(card, 'ca-flash');
          }
          return true;
        }
        edit(id);
        return true;
      }
      case 'macro-new':
        CA.Util.sound('snd/tick.mp3');
        edit(null);
        return true;
      case 'widget-add': {
        CA.Util.sound('snd/tick.mp3');
        const type = t.dataset.type;
        const had = CA.UI.Widgets.has(type);
        if (!had) CA.UI.Widgets.add(type); // a shortcut to the one; more copies come from the Widgets page
        if (!CA.Settings.get('widgetsShown')) CA.Settings.set('widgetsShown', true);
        const name = (CA.UI.Widgets.types().find((x) => x.id === type) || {}).name || 'Widget';
        CA.Util.notify(name, had ? 'Already on the left panel — the Widgets page adds more copies.' : 'Added to the left panel — drag it wherever you like.', CA.ICON, 2);
        return true;
      }
      case 'stop-all':
        CA.Util.sound('snd/clickOff2.mp3');
        M()
          .runningIds()
          .forEach((rid) => M().set(rid, false, { silent: true }));
        return true;
      case 'macro-settings': {
        CA.Util.sound('snd/tick.mp3');
        const box = t.closest('.ca-mtile-settings');
        const open = !openSettings.has(id);
        if (open) openSettings.add(id);
        else openSettings.delete(id);
        if (box) box.classList.toggle('open', open);
        return true;
      }
      case 'macro-locate': {
        const card = root && [...root.querySelectorAll('.ca-macro[data-macro-row]')].find((c) => c.dataset.macroRow === id);
        if (card) {
          CA.Util.scrollInPanel(card);
          CA.UI.Dom.replay(card, 'ca-flash');
        }
        return true;
      }
      default:
        return false;
    }
  }

  function onToggle(e) {
    if (e.target.matches && e.target.matches('[data-ascode]')) asCodeOpen = e.target.open;
  }

  function onRootClick(e) {
    const t = e.target.closest('[data-edit-act]');
    if (!t || !draft) return;
    e.stopPropagation();
    CA.Util.sound('snd/tick.mp3');
    onEditAct(t);
  }

  function mount(el) {
    unmount();
    root = el;
    life = CA.UI.Pages.scope(el).on('click', onRootClick).on('change', onEditInput).on('input', onEditInput).on('toggle', onToggle, true);
    life.add(
      CE().bind(root, {
        onChange: (key, src) => key === 'macro' && draft && (draft.source = src),
        onPick,
      })
    );
    sync(root);
    life.every(STATUS_MS, () => sync(root));
  }

  function unmount() {
    if (life) life.close();
    life = null;
    root = null;
  }

  function init() {
    CA.UI.Pages.register({ id: 'clickers', label: 'Macros', icon: 'bolt', order: 70, group: 'custom', html, mount, unmount, tick: () => sync(root) });
    // Cookie Monster arriving unlocks the macros that need it
    CA.Events.on('integrations', () => CA.Settings.get('tab') === 'clickers' && rerender());
    // a code card's link leaving the editor (ui/codeEditor.js): unsaved changes are asked about first
    CA.UI.CodeEditor.guard('clickers', {
      dirty: () => !!draft && JSON.stringify(draft) !== draftWas,
      name: () => (draft ? draft.name || 'the new macro' : 'Macros'),
      leave(how) {
        const d = draft;
        const page = () => CA.UI.Menu.openPage('clickers');
        if (!d) return { back: page };
        if (how === 'save') {
          onEditAct({ dataset: { editAct: 'save' } });
          if (draft) return { error: draftError || 'It couldn’t be saved.' };
          const m = (d.id && M().get(d.id)) || M().list().find((x) => x.name === d.name);
          return { back: () => (m ? edit(m.id) : page()) };
        }
        if (how === 'discard') {
          draft = null;
          draftError = '';
          return { back: () => (d.id ? edit(d.id) : page()) };
        }
        const copy = JSON.parse(JSON.stringify(d));
        return { back: () => (d.id ? edit(d.id) : edit(null, copy)) };
      },
    });
  }

  return { init, row, tile, sync, handle, handleSetting, icon, edit, run, draft: () => draft };
})();
