// Knobs: the variables at the top of an algorithm's code, as controls above it.
//
// Every top-level line `name = <number or true/false>   # what it is` is a variable you can set
// without touching the code: a percentage gets a slider in 5% steps, a number a slider over a
// sensible range, true/false a switch — each with a box to type an exact value. Moving one writes
// the new value into that line of the code; typing in the code moves the knob. How a variable
// shows (its kind, range, step, unit — or hidden) is the algorithm's `knobs`; the built-ins come
// with theirs, and a variable without one gets a knob that suits its value (⚙ changes it).

CA.UI = CA.UI || {};

CA.UI.CodeKnobs = (() => {
  const esc = (s) => CA.Util.escapeHtml(s);
  const I = (n, s) => CA.UI.Icons.html(n, s);
  const C = () => CA.UI.C;
  const LINE = /^([A-Za-z_]\w*)[ \t]*=[ \t]*(-?\d+(?:\.\d+)?|true|false)[ \t]*(#.*)?$/;

  /** The variables: top-level `name = literal` lines, the first of each name — [{ name, value, comment, line }]. */
  function scan(src) {
    const out = [];
    const seen = new Set();
    String(src || '')
      .split('\n')
      .forEach((text, i) => {
        const m = text.replace(/\r$/, '').match(LINE);
        if (!m || seen.has(m[1])) return;
        seen.add(m[1]);
        out.push({ name: m[1], value: m[2] === 'true' ? true : m[2] === 'false' ? false : Number(m[2]), comment: (m[3] || '').replace(/^#\s*/, ''), line: i + 1 });
      });
    return out;
  }

  const lit = (v) => (typeof v === 'boolean' ? String(v) : String(Number(Number(v).toFixed(4))));
  /** The code with a variable's line set to `value` (its comment and spacing kept). */
  function setIn(src, name, value) {
    let done = false;
    return String(src || '')
      .split('\n')
      .map((text) => {
        if (done) return text;
        const m = text.match(LINE);
        if (!m || m[1] !== name) return text;
        done = true;
        const at = text.indexOf('=') + 1;
        const rest = text.slice(at);
        const lead = rest.match(/^[ \t]*/)[0];
        return text.slice(0, at) + lead + lit(value) + rest.slice(lead.length + m[2].length);
      })
      .join('\n');
  }

  const nice = (x, up) => {
    const p = 10 ** Math.floor(Math.log10(x));
    const f = x / p;
    const pick = up ? [1, 2, 5, 10].find((n) => n >= f - 1e-9) : [1, 2, 5, 10].reverse().find((n) => n <= f + 1e-9) || 1;
    return pick * p;
  };
  const PERCENT = { kind: 'percent', min: 0, max: 1, step: 0.05 };
  /** A knob that suits a value: a share (0–1, named like one) a percentage; else a number slider. */
  function infer(name, value) {
    if (typeof value === 'boolean') return { kind: 'toggle' };
    if (value >= 0 && value <= 1 && (!Number.isInteger(value) || /(share|over|above|below|chance|ratio|percent|pct|at)$/i.test(name))) return { ...PERCENT };
    const top = nice(Math.max(10, Math.abs(value) * 4), true);
    const unit = /(seconds?|secs?|window)$/i.test(name) ? 's' : /(minutes?|mins?)$/i.test(name) ? 'min' : /hours?$/i.test(name) ? 'h' : '';
    return { kind: 'number', min: value < 0 ? -top : 0, max: top, step: Number.isInteger(value) ? 1 : nice(top / 100, false), unit };
  }
  /** How a variable shows: its knob (as the algorithm has it) over what suits its value. */
  function specOf(v, knobs) {
    const own = knobs && knobs[v.name];
    const base = infer(v.name, v.value);
    if (!own) return { ...base, custom: false };
    if (own.kind === 'hidden' || own.kind === 'toggle') return { ...own, custom: true };
    // a share shown as a plain number: 0–1 in hundredths
    const kindBase = own.kind === 'percent' ? PERCENT : base.kind === 'number' ? base : { kind: 'number', min: 0, max: 1, step: 0.01, unit: '' };
    return { ...kindBase, ...own, custom: true };
  }
  const humanize = (name) => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()).replace(/ ([A-Z])(?=[a-z])/g, (m, c) => ` ${c.toLowerCase()}`);

  /** The control for one variable. */
  function controlHtml(v, sp) {
    const n = esc(v.name);
    if (sp.kind === 'toggle' || typeof v.value === 'boolean')
      return C().toggle(!!v.value, `data-knob-toggle="${n}"`, v.name) + `<span class="ca-knob-val">${v.value ? 'on' : 'off'}</span>`;
    const pct = sp.kind === 'percent';
    const k = pct ? 100 : 1;
    const shown = Math.round(v.value * k * 10000) / 10000;
    const lo = Math.min(sp.min * k, shown);
    const hi = Math.max(sp.max * k, shown);
    const step = Math.round(sp.step * k * 10000) / 10000 || (pct ? 5 : 1);
    return (
      `<input type="range" class="ca-knob-range" data-knob="${n}" min="${lo}" max="${hi}" step="${step}" value="${shown}">` +
      `<span class="ca-knob-num"><input type="number" data-knob-num="${n}" step="any" value="${shown}"><em>${pct ? '%' : esc(sp.unit || '')}</em></span>`
    );
  }

  /** ⚙: how a variable shows — its kind, range, step, unit. */
  function cfgHtml(v, sp) {
    const n = esc(v.name);
    const kinds = typeof v.value === 'boolean' ? [['toggle', 'switch'], ['hidden', 'hidden']] : [['percent', 'percentage slider'], ['number', 'number slider'], ['hidden', 'hidden']];
    const pct = sp.kind === 'percent';
    const k = pct ? 100 : 1;
    const field = (f, label) => `<label>${label}<input type="number" step="any" data-knob-field="${f}" data-knob-of="${n}" value="${sp[f] != null ? Math.round(sp[f] * k * 10000) / 10000 : ''}"></label>`;
    return (
      '<div class="ca-knob-cfg-panel">' +
      `<label>Show as<select data-knob-kind="${n}">${kinds.map(([kv, label]) => `<option value="${kv}"${sp.kind === kv ? ' selected' : ''}>${label}</option>`).join('')}</select></label>` +
      (sp.kind === 'percent' || sp.kind === 'number' ? field('min', pct ? 'from %' : 'from') + field('max', pct ? 'to %' : 'to') + field('step', pct ? 'step %' : 'step') : '') +
      (sp.kind === 'number' ? `<label>unit<input type="text" maxlength="8" data-knob-field="unit" data-knob-of="${n}" value="${esc(sp.unit || '')}"></label>` : '') +
      (sp.custom ? C().button('As it suits', `data-knob-reset="${n}"`, 'ca-btn-small') : '') +
      '</div>'
    );
  }

  /** The knobs for code `src` (inside the panel). opts.open: the variable whose ⚙ is open; opts.fixed: no ⚙ (each shows as suits its value). */
  function inner(src, knobs, opts = {}) {
    const vars = scan(src);
    if (!vars.length) return '';
    const shown = [];
    const hidden = [];
    vars.forEach((v) => (specOf(v, knobs).kind === 'hidden' ? hidden : shown).push(v));
    return (
      `<div class="ca-knobs-head">${I('settings', 12)} Variables</div>` +
      shown
        .map((v) => {
          const sp = specOf(v, knobs);
          const open = opts.open === v.name;
          return (
            `<div class="ca-knob${open ? ' open' : ''}" data-knob-row="${esc(v.name)}">` +
            `<span class="ca-knob-label"${v.comment ? ` data-tip="${esc(v.comment)}"` : ''}>${esc(humanize(v.name))}<code>${esc(v.name)}</code></span>` +
            `<span class="ca-knob-ctl">${controlHtml(v, sp)}</span>` +
            (opts.fixed ? '' : `<button type="button" class="ca-knob-cfg${sp.custom ? ' custom' : ''}" data-knob-cfg="${esc(v.name)}" data-tip="How it shows: kind, range, step">${I('settings', 11)}</button>`) +
            (open ? cfgHtml(v, sp) : '') +
            '</div>'
          );
        })
        .join('') +
      (hidden.length ? `<div class="ca-knobs-hidden"><span class="ca-hint">Hidden:</span>${hidden.map((v) => `<button type="button" class="ca-gbrush" data-knob-unhide="${esc(v.name)}">${I('plus', 10)} ${esc(v.name)}</button>`).join('')}</div>` : '')
    );
  }
  /** The panel (its contents follow the code: CA.UI.Dom.morph it with inner()). */
  const html = (key, src, knobs, opts) => `<div class="ca-knobs" data-knobs="${esc(key)}">${inner(src, knobs, opts)}</div>`;

  /** The value a knob's input stands for (a percentage as its share), or null. */
  function valueOf(el, src, knobs) {
    const name = el.dataset.knob || el.dataset.knobNum;
    const v = scan(src).find((x) => x.name === name);
    if (!v) return null;
    const x = Number(el.value);
    if (!Number.isFinite(x)) return null;
    return specOf(v, knobs).kind === 'percent' ? x / 100 : x;
  }

  return { scan, setIn, specOf, infer, inner, html, valueOf, humanize };
})();
