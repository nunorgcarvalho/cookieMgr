// **Widgets**: small things on the game's left panel (around the big cookie) that you drag around.
// This is the engine — placing, dragging, sizing, settings, saving. What each widget shows lives in
// ui/widgetTypes.js.
//
// Two looks: framed boxes (dragged by their title bar) and bare widgets — buttons, the status bar
// and the round minigame widgets — with no frame, dragged from anywhere (a press that doesn't move
// is a click). Every widget resizes from its bottom-right corner: bare ones scale (keeping their
// shape), framed boxes take any width and height.
//
// Settings: every widget's ⚙ opens its own settings on the Widgets page (also reachable from the
// list of placed widgets there): text size for all, size for bare ones, a title and a background for
// framed ones, and whatever its type adds (which Quick stats, how many events…).
//
// Background: framed boxes are solid by default; Faint or None makes them see-through — the text gets
// a dark outline to stay readable over the game, and the box (title bar too) fades in while hovered.
// A type can start see-through (bg: 0).
//
// Positions are fractions of the panel, applied with CSS percentages (left: x·100% plus a
// translate of −x·100% of the widget's own size), so a widget follows the panel's layout by
// itself — nothing is measured or re-placed in JavaScript, so nothing jumps when the game (or
// Cookie Monster) resizes the panel while loading. The list is saved with your settings.
// The layer sits above the game's big-cookie click target but below its popups and golden cookies.
//
// Content refreshes twice a second by patching the existing DOM (morph()), never replacing it, so
// whatever is under the mouse — and its popup — stays put.
//
//   CA.UI.Widgets.defineType({ id, name, icon, desc, bare, width, hidden, resize, bg, settings, html(inst),
//                              group, sprite, short, ring, legacy })
//     For the "Add a widget" picker on the Widgets page: group = the id of a shelf (see defineGroup; unknown or
//     missing ones land in "More"); sprite = [col, row] of the game's img/icons.png, or { sheet, pos: [col, row] }
//     for another 48px sheet (img/gardenPlants.png) — without one the `icon` is drawn instead; short = a one-line
//     summary under the name; ring = the color of a round (bare) widget's ring on its tile (default gold).
//   CA.UI.Widgets.defineGroup({ id, name, sprite, order })   a shelf of the picker; shelves sort by order
//
// legacy: { oldTypeId: (saved) => settings } — saved widgets of a type it replaced load as this one (migrate()).
// iconOf(inst): an icon of its own per widget (a chart's: its chart's); nameOf(inst): a name of its own
// (a Statistic widget's: its statistic's).
// live(inst, body) runs after each render and refresh, for a widget that draws into its own nodes
// (a chart's canvas); removed(inst) when it's taken away.
//
// Layouts: the whole panel saved under a name (profiles; see "layout profiles" below) — Use, Save over,
// rename, delete, Undo; widgets.profile(name) in code.
//
// Copies (v3.52): every kind can be placed as often as you like, each copy with its own settings. The
// Widgets page lists them by kind (a second Grimoire is "Grimoire 2" until you name it), and a widget's
// settings switch between its copies and Duplicate it (same settings, placed beside it).
//
// Stars: a page's ☆ (CA.UI.C.widgetStar) adds a ready-made widget — a preset, its type and the
// settings that make it that one — and takes it away again; hasPreset() says whether it's there.
//
// settings: [{ key, label, type: 'multi' | 'select' | 'number', default, options() | min, max, unit, when(inst), hint }]
//   options(): [{ v, label, tip, icon, color, sample(inst) }]. An option with a sample(inst) — the HTML of what
//   picking it shows, as the widget draws it — is a tile in a live picker (v3.41): its name over the sample,
//   refreshed as the widget is, lit while it's picked; the tiles share the widget's own styles (.ca-wsample).
//   Without samples it's a plain tick list / drop-down. when(inst): the field shows only while it's true
//   (the Graph's axis, with the graph on). hint: a line under the label. tile: 'small' — narrower tiles, for
//   samples that are a value (a statistic's). default may be a function of the widget (its own default).

CA.UI = CA.UI || {};

CA.UI.Widgets = (() => {
  const TICK_MS = 500;
  const DRAG_PX = 4; // a press that moves less than this is a click, not a drag
  const HOLD_DELAY_MS = 350; // holding a buying macro's button this long…
  const HOLD_MS = 80; // …runs it this often until you let go
  const BUTTON_PX = 44; // macro button size incl. spacing, for laying out new ones
  const SCALE_MIN = 0.6;
  const SCALE_MAX = 3;
  const FONT_MIN = 60;
  const FONT_MAX = 200;
  const MIN_W = 140;
  const MIN_H = 60;
  const SAVED = ['plot', 'stat', 'item', 'count', 'types', 'stats', 'nums', 'axis', 'font', 'title', 'target', 'targetMagic', 'bg', 'sort', 'barScale', 'legend']; // per-widget settings that are saved
  const BG = [[100, 'Solid'], [40, 'Faint'], [0, 'None']]; // background opacity (%) while not hovered
  const S = () => CA.Settings;
  const I = (n, s) => CA.UI.Icons.html(n, s);
  const esc = (s) => CA.Util.escapeHtml(s);

  const types = [];
  const typeById = {};
  const groups = [];
  let widgets = []; // { id, type, x, y, collapsed, macro?, scale?, w?, h?, count?, types?, stats?, nums?, axis?, font?, title?, bg?, sort?, barScale?, legend? }
  let layer = null;
  let press = null; // { w, el, sx, sy, dx, dy, moved }
  let swallowClick = false;
  let anchor = null; // where a v2.1 Shortcuts widget was, for laying out its buttons
  let editing = null; // id of the widget whose settings the Widgets page shows

  function defineType(t) {
    const d = { width: 220, bare: false, hidden: false, icon: 'widget', settings: [], ...t };
    types.push(d);
    typeById[d.id] = d;
    return d;
  }

  /** A shelf of the "Add a widget" picker: { id, name, sprite: [col, row] of img/icons.png, order }. */
  function defineGroup(g) {
    const d = { order: 100, sprite: [10, 0], ...g };
    const i = groups.findIndex((x) => x.id === d.id);
    if (i >= 0) groups[i] = d;
    else groups.push(d);
    return d;
  }

  // ---- instances ------------------------------------------------------------------------------

  const newId = () => `w${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

  function add(type0, pos, extra0) {
    // a replaced type's id (a v3.37 golden widget) adds the type that replaced it, set up the same
    const [{ type, ...extra }] = typeById[type0] ? [{ ...(extra0 || {}), type: type0 }] : migrate([{ ...(extra0 || {}), type: type0 }]);
    const t = typeById[type];
    if (!t) return null;
    let p = pos;
    if (!p && t.bare) p = nextButtonPos(); // round widgets line up with the buttons
    if (!p) {
      const n = widgets.filter((w) => !typeById[w.type].bare).length;
      p = { x: 0.04, y: Math.min(0.85, 0.52 + n * 0.06) };
    }
    const w = { id: newId(), type, x: p.x, y: p.y, collapsed: false, ...extra };
    widgets.push(w);
    changed();
    return w;
  }

  /** Where columns of buttons stop going up: just below the cookieMgr sidebar on the right edge
   *  of the panel (or a third of the way down if it can't be measured). */
  function columnTop(host, H) {
    const tab = document.getElementById('CookieMgrTab');
    if (tab && tab.getBoundingClientRect && host.getBoundingClientRect) {
      const r = tab.getBoundingClientRect();
      if (r.height) return Math.max(0, r.bottom - host.getBoundingClientRect().top + 8);
    }
    return H * 0.35;
  }

  /** The next free spot for a small widget: from the bottom-right corner upwards (clear of the
   *  bottom-left, where the dragon and Santa live), then the next column to the left, again from
   *  the bottom. A v2.1 Shortcuts widget's buttons start where it was instead. */
  function nextButtonPos() {
    const host = layer && layer.parentNode;
    const W = (host && host.clientWidth) || 400;
    const H = (host && host.clientHeight) || 800;
    const fx = (px) => (W > BUTTON_PX ? px / (W - BUTTON_PX) : 0);
    const fy = (py) => (H > BUTTON_PX ? py / (H - BUTTON_PX) : 0);
    const taken = widgets.filter((w) => typeById[w.type] && typeById[w.type].bare && w.type !== 'status').map((w) => ({ x: w.x * (W - BUTTON_PX), y: w.y * (H - BUTTON_PX) }));
    const free = (x, y) => !taken.some((t) => Math.abs(t.x - x) < BUTTON_PX / 2 && Math.abs(t.y - y) < BUTTON_PX / 2);
    if (anchor) return { x: Math.min(1, fx(anchor.x * (W - BUTTON_PX) + taken.length * BUTTON_PX)), y: anchor.y };
    const bottom = H - BUTTON_PX - 12;
    const rows = Math.max(1, Math.floor((bottom - columnTop(host, H)) / BUTTON_PX) + 1);
    const cols = Math.max(1, Math.floor((W - 8) / BUTTON_PX));
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const x = W - BUTTON_PX - 8 - c * BUTTON_PX;
        const y = bottom - r * BUTTON_PX;
        if (free(x, y)) return { x: fx(x), y: fy(y) };
      }
    }
    return { x: fx(W - BUTTON_PX - 8), y: fy(bottom) };
  }

  /** Keeps macro buttons in step with ★ favorites: one button per favorite, none for the rest. */
  function reconcile() {
    let dirty = false;
    const seen = new Set();
    widgets = widgets.filter((w) => {
      if (w.type !== 'macro') return true;
      const m = CA.Macros.get(w.macro);
      // a renamed built-in's button (v3.43: Best building / Best upgrade → Auto buyer) becomes the new one's — once
      if (m && m.id !== w.macro) {
        w.macro = m.id;
        dirty = true;
      }
      const keep = m && CA.Macros.isFav(m.id) && !seen.has(m.id);
      if (m) seen.add(m.id);
      if (!keep) dirty = true;
      return keep;
    });
    CA.Macros.list().forEach((m) => {
      if (!CA.Macros.isFav(m.id) || widgets.some((w) => w.type === 'macro' && w.macro === m.id)) return;
      widgets.push({ id: newId(), type: 'macro', macro: m.id, ...nextButtonPos(), collapsed: false });
      dirty = true;
    });
    anchor = null;
    if (dirty) changed();
  }

  function remove(id) {
    const w = widgets.find((x) => x.id === id);
    if (!w) return;
    if (editing === id) editing = null;
    if (w.type === 'macro') {
      CA.Macros.setFav(w.macro, false); // → reconcile() takes the button away
      return;
    }
    widgets.splice(widgets.indexOf(w), 1);
    const t = typeById[w.type];
    if (t && t.removed) t.removed(w);
    changed();
  }

  /** Another copy of a widget: the same settings and size, placed just beside it (macro buttons: one per macro). */
  function duplicate(id) {
    const w = get(id);
    if (!w || w.type === 'macro' || !typeById[w.type]) return null;
    const step = (v) => round(v > 0.9 ? v - 0.06 : v + 0.06);
    const [copy] = fromSaved(serializeList([w]));
    copy.id = newId();
    copy.x = step(w.x);
    copy.y = step(w.y);
    widgets.splice(widgets.indexOf(w) + 1, 0, copy);
    changed();
    return copy;
  }

  function changed() {
    render();
    syncStars();
    CA.Events.emit('widgets');
  }

  // ---- stars: ready-made widgets from the pages --------------------------------------------------

  // (a list in a preset — which parts a widget shows — matches the same list, in the same order)
  const same = (a, b) => a === b || (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]));
  const matches = (w, preset) => Object.keys(preset).every((k) => same(w[k], preset[k]));
  const hasPreset = (preset) => widgets.some((w) => matches(w, preset));
  const presetOf = (el) => {
    try {
      const p = JSON.parse(el.dataset.wStar);
      return p && typeof p.type === 'string' ? p : null;
    } catch (e) {
      return null;
    }
  };

  /** A star was clicked: adds its widget (showing widgets if they were hidden), or takes it away. */
  function toggleStar(el) {
    const preset = presetOf(el);
    if (!preset || !typeById[preset.type]) return;
    const name = el.dataset.name || nameOf(preset);
    if (hasPreset(preset)) {
      widgets.filter((w) => matches(w, preset)).forEach((w) => remove(w.id));
      return;
    }
    const { type, ...extra } = preset;
    add(type, null, extra);
    if (!S().get('widgetsShown')) S().set('widgetsShown', true);
    CA.Util.notify(name, 'Added as a widget on the left panel — drag it wherever you like.', CA.ICON, 2);
  }

  /** Every star on screen shows whether its widget is there. */
  function syncStars() {
    document.querySelectorAll('[data-w-star]').forEach((el) => {
      const preset = presetOf(el);
      if (!preset) return;
      const on = hasPreset(preset);
      if (el.classList.contains('on') === on) return;
      el.classList.toggle('on', on);
      el.setAttribute('aria-pressed', String(on));
      el.dataset.tip = CA.UI.C.starTip(on, el.dataset.name || '');
      el.innerHTML = I(on ? 'star' : 'starOutline', 14);
    });
  }

  const list = () => widgets.slice();
  const has = (type) => widgets.some((w) => w.type === type);
  const get = (id) => widgets.find((w) => w.id === id) || null;
  /** The name a widget shows (its title, or its type's name — a macro button: the macro's). */
  function nameOf(w) {
    if (w.title) return w.title;
    if (w.type === 'macro') {
      const m = CA.Macros.get(w.macro);
      return m ? m.name : 'Macro button';
    }
    const t = typeById[w.type];
    if (t && t.nameOf) return t.nameOf(w) || t.name;
    return (t || {}).name || w.type;
  }
  /** The other widgets of a widget's kind, itself included, in the order they were placed. */
  const copiesOf = (w) => widgets.filter((x) => x.type === w.type);
  /** The name a widget goes by on the Widgets page: its name, numbered while another copy has the same one ("Grimoire 2"). */
  function labelOf(w) {
    const name = nameOf(w);
    const same = widgets.filter((x) => x.type === w.type && nameOf(x) === name);
    const i = same.indexOf(w);
    return same.length > 1 && i > 0 ? `${name} ${i + 1}` : name;
  }

  // ---- rendering ------------------------------------------------------------------------------

  function ensureLayer() {
    if (layer && layer.isConnected) return layer;
    const host = document.getElementById('sectionLeft');
    if (!host) return null;
    layer = document.createElement('div');
    layer.id = 'CookieMgrWidgets';
    layer.addEventListener('mousedown', onMouseDown);
    layer.addEventListener('click', onClick);
    layer.addEventListener('mouseover', onLayerHover);
    layer.addEventListener('mouseleave', () => setLinked(null));
    host.appendChild(layer);
    return layer;
  }

  const RESIZE = '<span class="ca-w-resize" data-w-resize aria-label="Resize"></span>';
  const fontOf = (w) => Math.max(FONT_MIN, Math.min(FONT_MAX, w.font || 100)) / 100;
  /** A framed widget's background opacity while not hovered, 0–1 (its own setting, else its type's: solid). */
  const bgOf = (w) => {
    const v = w.bg !== undefined ? w.bg : (typeById[w.type] || {}).bg;
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
  };

  // glowing: hovered on the Widgets page, or its settings open there
  const glow = (w) => (isLinked(w) || (w.id === editing && pageRoot) ? ' ca-w-linked' : '');

  function frameHtml(w) {
    const t = typeById[w.type];
    const fs = `--wfs:${fontOf(w)}`;
    if (t.bare) {
      return (
        `<div class="ca-w ca-w-bare ca-w-${w.type}${glow(w)}" data-widget="${w.id}" data-w-drag style="${fs}">` +
        `<div class="ca-w-body" data-w-body>${safeHtml(t, w)}</div>` +
        `<button type="button" class="ca-w-x" data-w-remove aria-label="${w.type === 'macro' ? 'Remove (un-favorites the macro)' : 'Remove widget'}">${I('close', 8)}</button>` +
        `<button type="button" class="ca-w-x ca-w-gear" data-w-settings aria-label="Settings">${I('settings', 8)}</button>` +
        RESIZE +
        '</div>'
      );
    }
    const bg = bgOf(w);
    return (
      `<div class="ca-w${w.collapsed ? ' collapsed' : ''}${w.h ? ' sized' : ''}${bg < 1 ? ' ca-w-clear' : ''}${glow(w)}" data-widget="${w.id}" style="${fs}${bg < 1 ? `;--wbg:${bg}` : ''};width:${w.w || t.width}px${w.h && !w.collapsed ? `;height:${w.h}px` : ''}">` +
      '<div class="ca-w-head" data-w-drag>' +
      `${I(t.iconOf ? t.iconOf(w) : t.icon, 12)}<span class="ca-w-title">${esc(nameOf(w))}</span>` +
      `<button type="button" class="ca-w-btn" data-w-settings aria-label="Settings">${I('settings', 10)}</button>` +
      `<button type="button" class="ca-w-btn" data-w-collapse aria-label="${w.collapsed ? 'Expand' : 'Collapse'}">${w.collapsed ? '▸' : '▾'}</button>` +
      `<button type="button" class="ca-w-btn" data-w-remove aria-label="Remove widget">${I('close', 10)}</button>` +
      '</div>' +
      `<div class="ca-w-body ca-wt" data-w-body>${w.collapsed ? '' : safeHtml(t, w)}</div>` +
      (w.collapsed ? '' : RESIZE) +
      '</div>'
    );
  }

  function safeHtml(t, w) {
    try {
      return t.html(w);
    } catch (e) {
      return `<div class="ca-w-empty">Couldn’t draw this widget (${esc(e.message)}).</div>`;
    }
  }

  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const scaleOf = (w) => (typeById[w.type] && typeById[w.type].resize === 'scale' ? w.scale || 1 : 1);

  /** Positions a widget purely with CSS (see the top of this file): it follows the panel by itself. */
  function place(el, w) {
    const sc = scaleOf(w);
    const x = clamp01(w.x);
    const y = clamp01(w.y);
    el.style.left = `${x * 100}%`;
    el.style.top = `${y * 100}%`;
    el.style.transform = `translate(${-x * sc * 100}%, ${-y * sc * 100}%)${sc !== 1 ? ` scale(${sc})` : ''}`;
    el.classList.toggle('pop-below', y < 0.25);
    el.classList.toggle('pop-left', x > 0.5);
  }

  /** Where a widget actually is right now, in px (for dragging and resizing). */
  function geom(w, el) {
    const host = layer.parentNode;
    const W = host.clientWidth || 0;
    const H = host.clientHeight || 0;
    const sc = scaleOf(w);
    const vw = (el.offsetWidth || 0) * sc;
    const vh = (el.offsetHeight || 0) * sc;
    return { W, H, sc, vw, vh, left: clamp01(w.x) * Math.max(0, W - vw), top: clamp01(w.y) * Math.max(0, H - vh) };
  }

  /** Sets the fractions so the widget's top-left lands at (left, top) px. */
  function moveTo(w, el, left, top) {
    const g = geom(w, el);
    w.x = g.W > g.vw ? clamp01(left / (g.W - g.vw)) : 0;
    w.y = g.H > g.vh ? clamp01(top / (g.H - g.vh)) : 0;
    place(el, w);
  }

  function render() {
    if (!ensureLayer()) return;
    layer.classList.toggle('ca-hidden', !S().get('widgetsShown'));
    layer.classList.toggle('locked', !!S().get('widgetsLocked'));
    layer.innerHTML = widgets.filter((w) => typeById[w.type]).map(frameHtml).join('');
    widgets.forEach((w) => {
      const el = layer.querySelector(`[data-widget="${w.id}"]`);
      if (el) place(el, w);
    });
    widgets.forEach(live);
  }

  /** A type that draws into its own nodes (a chart) gets its body after every render and refresh. */
  function live(w) {
    const t = typeById[w.type];
    if (!t || !t.live || w.collapsed || !layer) return;
    const body = layer.querySelector(`[data-widget="${w.id}"] [data-w-body]`);
    if (!body) return;
    try {
      t.live(w, body);
    } catch (e) {
      /* drawn again next refresh */
    }
  }

  /** Refreshes each widget's content in place (positions untouched). */
  function tick() {
    if (!layer || !layer.isConnected) return render();
    if (!S().get('widgetsShown') || (press && press.moved)) return;
    widgets.forEach((w) => {
      if (w.collapsed) return;
      const body = layer.querySelector(`[data-widget="${w.id}"] [data-w-body]`);
      const t = typeById[w.type];
      if (body && t) CA.UI.Dom.morph(body, safeHtml(t, w));
      live(w);
    });
  }

  // ---- interaction ----------------------------------------------------------------------------

  function onMouseDown(e) {
    // keep presses on widgets from reaching the big cookie / the game's panel handlers
    e.stopPropagation();
    if (S().get('widgetsLocked') || e.button !== 0) return;
    const grip = e.target.closest('[data-w-resize]');
    const handle = grip || e.target.closest('[data-w-drag]');
    if (!handle || e.target.closest('[data-w-remove],[data-w-collapse],[data-w-settings]')) return;
    const el = handle.closest('[data-widget]');
    const w = widgets.find((x) => x.id === el.dataset.widget);
    if (!w) return;
    // framed widgets: buttons in the title bar aren't drag handles; bare ones drag from anywhere
    if (!grip && !typeById[w.type].bare && e.target.closest('button')) return;
    e.preventDefault();
    const g = geom(w, el);
    press = {
      mode: grip ? 'resize' : 'move',
      w,
      el,
      sx: e.clientX,
      sy: e.clientY,
      left: g.left,
      top: g.top,
      sc: g.sc,
      baseW: el.offsetWidth || 1,
      baseH: el.offsetHeight || 1,
      moved: false,
    };
    // holding down a buying macro's button buys fast (one run of its steps every HOLD_MS)
    const m = w.type === 'macro' && !grip ? CA.Macros.get(w.macro) : null;
    if (m && m.holdRepeat) {
      const p = press;
      p.holdStart = setTimeout(() => {
        p.holding = true;
        const btn = el.querySelector('[data-w-trigger]');
        if (btn) btn.classList.add('ca-holding');
        const once = () => {
          if (CA.Macros.runOnce(m.id) > 0) CA.Util.sound('snd/buy1.mp3');
        };
        once();
        p.holdTimer = setInterval(once, HOLD_MS);
      }, HOLD_DELAY_MS);
    }
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  function onMouseMove(e) {
    if (!press) return;
    const dx = e.clientX - press.sx;
    const dy = e.clientY - press.sy;
    if (!press.moved) {
      if (Math.abs(dx) < DRAG_PX && Math.abs(dy) < DRAG_PX) return;
      press.moved = true;
      stopHold(press);
      press.el.classList.add(press.mode === 'resize' ? 'resizing' : 'dragging');
    }
    const { w, el } = press;
    if (press.mode === 'move') {
      moveTo(w, el, press.left + dx, press.top + dy);
      return;
    }
    // resize from the bottom-right corner, keeping the top-left where it is
    if (typeById[w.type].resize === 'scale') {
      const grow = Math.max(dx / press.baseW, dy / press.baseH); // keeps the shape
      w.scale = Math.max(SCALE_MIN, Math.min(SCALE_MAX, press.sc + grow));
    } else {
      const g = geom(w, el);
      w.w = Math.round(Math.max(MIN_W, Math.min(g.W - press.left, press.baseW + dx)));
      w.h = Math.round(Math.max(MIN_H, Math.min(g.H - press.top, press.baseH + dy)));
      el.style.width = `${w.w}px`;
      el.style.height = `${w.h}px`;
      el.classList.add('sized');
    }
    moveTo(w, el, press.left, press.top);
  }

  function stopHold(p) {
    clearTimeout(p.holdStart);
    clearInterval(p.holdTimer);
    const btn = p.el.querySelector('[data-w-trigger]');
    if (btn) btn.classList.remove('ca-holding');
  }

  function onMouseUp() {
    if (!press) return;
    const moved = press.moved;
    const held = !!press.holding;
    stopHold(press);
    press.el.classList.remove('dragging', 'resizing');
    press = null;
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    if (moved || held) {
      swallowClick = true; // the click that follows a drag (or a hold) isn't a click
      setTimeout(() => (swallowClick = false), 0);
    }
    if (moved) CA.Events.emit('widgets');
  }

  function onClick(e) {
    e.stopPropagation();
    if (swallowClick) {
      swallowClick = false;
      return;
    }
    const el = e.target.closest('[data-widget]');
    const w = el && widgets.find((x) => x.id === el.dataset.widget);
    if (!w) return;
    if (e.target.closest('[data-w-remove]')) {
      CA.Util.sound('snd/tick.mp3');
      remove(w.id);
      return;
    }
    if (e.target.closest('[data-w-settings]')) {
      CA.Util.sound('snd/tick.mp3');
      openSettings(w.id);
      return;
    }
    if (e.target.closest('[data-w-collapse]')) {
      CA.Util.sound('snd/tick.mp3');
      w.collapsed = !w.collapsed;
      changed();
      return;
    }
    const trig = e.target.closest('[data-w-trigger]');
    if (trig) {
      const m = CA.Macros.get(trig.dataset.wTrigger);
      if (!m) return;
      // shift-click: flip the macro's shift setting (e.g. the stock autobuyer: buy or only sell)
      if (e.shiftKey && m.shift) {
        const v = CA.Macros.shiftToggle(m.id);
        CA.Util.sound(v ? 'snd/clickOn2.mp3' : 'snd/clickOff2.mp3');
        CA.Util.notify(m.name, `Now ${v ? m.shift.on : m.shift.off}.`, CA.ICON, 2);
        tick();
        return;
      }
      if (m.mode !== 'once') CA.Util.sound(CA.Macros.isOn(m.id) ? 'snd/clickOff2.mp3' : 'snd/clickOn2.mp3'); // once macros: run() picks the sound
      if (m.mode === 'once') CA.UI.MacrosPage.run(m.id, trig);
      else {
        CA.Macros.trigger(m.id);
        // switched on but it can't do anything yet (a buyer that can't afford its pick): say so
        const r = CA.Macros.isOn(m.id) && CA.UI.WidgetTypes.readyState(m);
        if (r && r.cls === 'cant') {
          CA.UI.Dom.replay(trig, 'ca-shake', 500);
          CA.Util.notify(m.name, `On — but nothing it can do yet: ${esc(r.text)}.`, CA.ICON, 3);
        }
      }
      tick();
      return;
    }
    const mg = e.target.closest('[data-w-open-mg]');
    if (mg) {
      CA.Util.sound('snd/tick.mp3');
      CA.UI.WidgetTypes.openMinigame(mg.dataset.wOpenMg);
      return;
    }
    const open = e.target.closest('[data-w-open]');
    if (open) {
      CA.Util.sound('snd/tick.mp3');
      CA.UI.Menu.openPage(open.dataset.wOpen);
      return;
    }
    const ca = e.target.closest('[data-ca]');
    if (ca && CA.UI.MacrosPage.handle(ca.dataset.ca, ca)) tick();
  }

  // ---- settings ------------------------------------------------------------------------------

  /** Opens the Widgets page on widget `id`'s settings. */
  function openSettings(id) {
    editing = id;
    if (CA.UI.Menu.isOpen() && CA.Settings.get('tab') === 'widgets') CA.UI.Menu.render();
    else CA.UI.Menu.openPage('widgets');
    revealEditor();
  }

  /** Scrolls the panel to a widget's settings (at the top of the Widgets page) and flashes them. */
  function revealEditor() {
    const ed = document.querySelector('#CookieMgrMenu [data-w-editor]');
    if (!ed) return;
    CA.Util.scrollInPanel(ed, 'start');
    CA.UI.Dom.replay(ed, 'ca-reveal');
  }

  /** Applies one setting change from the editor and redraws the widget. */
  function setOption(w, key, value) {
    w[key] = value;
    changed();
  }


  /** An option's sample — what picking it shows — or a dash when it can't be drawn right now. */
  function sampleHtml(o, w) {
    try {
      return o.sample(w) || '<span class="ca-w-empty">—</span>';
    } catch (e) {
      return '<span class="ca-w-empty">—</span>';
    }
  }

  /** The settings a type lets you choose, each with what it has now (a hidden field is left out). */
  /** A setting's default (a function: the widget's own — a chart's Show starts at the one chart it had). */
  const defaultOf = (s, w) => (typeof s.default === 'function' ? s.default(w) : s.default);
  const shownSettings = (w) => ((typeById[w.type] || {}).settings || []).filter((s) => !s.when || s.when(w)).map((s) => ({ s, opts: s.type === 'number' ? [] : s.options(), cur: w[s.key] !== undefined ? w[s.key] : defaultOf(s, w) }));

  /**
   * The Shows section: a field per setting — a tick list, a drop-down, a number — or, when its options
   * come with samples, a picker of live tiles: each option's name over what picking it shows, drawn as
   * the widget draws it. Redrawn (in place) after every change, so a field that depends on another
   * (the graph's axis, once the graph is on) comes and goes.
   */
  function showsHtml(w) {
    const field = (label, input, hint) =>
      `<div class="ca-wf"><span class="ca-wf-label">${label}</span><div class="ca-wf-input">${input}</div>${hint ? `<span class="ca-wf-hint">${hint}</span>` : ''}</div>`;
    const wide = (label, body, hint) => `<div class="ca-wf ca-wf-wide"><span class="ca-wf-label">${label}${hint ? ` <span class="ca-wf-hint">${hint}</span>` : ''}</span>${body}</div>`;
    const head = (o) => `${o.icon ? `<span style="color:${o.color || 'inherit'}">${I(o.icon, 13)}</span>` : ''}<span>${esc(o.label)}</span>`;
    let h = '';
    shownSettings(w).forEach(({ s, opts, cur }) => {
      const hint = s.hint ? esc(s.hint) : '';
      if (s.type === 'number') {
        h += field(esc(s.label), `<input type="number" min="${s.min}" max="${s.max}" value="${esc(cur)}" data-w-opt="${s.key}" data-type="number" data-min="${s.min}" data-max="${s.max}">${s.unit ? `<em>${esc(s.unit)}</em>` : ''}`, hint);
        return;
      }
      const multi = s.type === 'multi';
      const chosen = new Set(multi ? cur || [] : [String(cur)]);
      const on = (o) => chosen.has(multi ? o.v : String(o.v));
      const input = (o) =>
        multi
          ? `<input type="checkbox" data-w-multi="${s.key}" value="${esc(o.v)}"${on(o) ? ' checked' : ''}>`
          : `<input type="radio" name="ca-wopt-${esc(w.id)}-${s.key}" data-w-opt="${s.key}" data-type="choice" value="${esc(o.v)}"${on(o) ? ' checked' : ''}>`;
      if (opts.some((o) => o.sample)) {
        // the live picker: a tile per option, its sample refreshed with the widget (syncPage)
        h += wide(
          esc(s.label),
          `<div class="ca-wopts${multi ? '' : ' ca-wopts-one'}${s.tile === 'small' ? ' ca-wopts-small' : ''}">${opts
            .map(
              (o) =>
                `<label class="ca-wopt${on(o) ? ' on' : ''}"${o.tip ? ` data-tip="${esc(o.tip)}"` : ''}>${input(o)}` +
                `<span class="ca-wopt-head"><i class="ca-wopt-mark"></i>${head(o)}</span>` +
                `<div class="ca-wsample" data-w-sample="${s.key}:${esc(o.v)}">${o.sample ? sampleHtml(o, w) : ''}</div></label>`
            )
            .join('')}</div>`,
          hint
        );
      } else if (multi) {
        h += wide(esc(s.label), `<div class="ca-members">${opts.map((o) => `<label class="ca-member${on(o) ? ' on' : ''}"${o.tip ? ` data-tip="${esc(o.tip)}"` : ''}>${input(o)}${head(o)}</label>`).join('')}</div>`, hint);
      } else {
        h += field(esc(s.label), `<select data-w-opt="${s.key}" data-type="choice">${opts.map((o) => `<option value="${esc(o.v)}"${on(o) ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`, hint);
      }
    });
    return h;
  }

  /** After a change: the Shows section drawn again in place (fields that depend on the change come and go). */
  function refreshShows(w) {
    const box = pageRoot && pageRoot.querySelector(`[data-w-editor="${w.id}"] [data-w-shows]`);
    if (box) CA.UI.Dom.morph(box, showsHtml(w));
  }

  /** Each tick: the picker tiles' samples, as the widget itself is refreshed. */
  function refreshSamples() {
    const w = editing && get(editing);
    const box = w && pageRoot && pageRoot.querySelector(`[data-w-editor="${w.id}"] [data-w-shows]`);
    if (!box) return;
    shownSettings(w).forEach(({ s, opts }) =>
      opts.forEach((o) => {
        if (!o.sample) return;
        const el = box.querySelector(`[data-w-sample="${s.key}:${o.v}"]`);
        if (el) CA.UI.Dom.morph(el, sampleHtml(o, w));
      })
    );
  }

  /**
   * A widget's settings: a header (what it is, Remove, Done) over two sections — Look (text size,
   * size or title) and Shows (what its type lets you choose). Changes apply at once; the widget
   * glows on the left panel while its settings are open.
   */
  function editorHtml(w) {
    const t = typeById[w.type];
    const C = CA.UI.C;
    const field = (label, input, hint) =>
      `<div class="ca-wf"><span class="ca-wf-label">${label}</span><div class="ca-wf-input">${input}</div>${hint ? `<span class="ca-wf-hint">${hint}</span>` : ''}</div>`;
    const range = (key, min, max, val, type) =>
      `<input type="range" min="${min}" max="${max}" step="5" value="${val}" data-w-opt="${key}" data-type="${type}"><span class="ca-range-val">${val}%</span>`;
    // one-click sizes beside each slider
    const presets = (key, list, cur) =>
      `<div class="ca-wpresets">${list.map(([v, label]) => `<button type="button" class="ca-chip${Math.round(cur) === v ? ' on' : ''}" data-w-preset="${key}" data-val="${v}">${label}</button>`).join('')}</div>`;
    const font = Math.round(fontOf(w) * 100);
    let look = field('Text size', presets('font', [[80, 'S'], [100, 'M'], [130, 'L'], [170, 'XL']], font) + range('font', FONT_MIN, FONT_MAX, font, 'number'));
    if (t.resize === 'scale') {
      const sc = Math.round(scaleOf(w) * 100);
      look += field('Size', presets('scale', [[75, 'S'], [100, 'M'], [150, 'L'], [200, 'XL']], sc) + range('scale', SCALE_MIN * 100, SCALE_MAX * 100, sc, 'percent'), 'or drag its corner');
      // a round widget shows no title; a name tells its copies apart here
      if (w.type !== 'macro') look += field('Name', `<input type="text" maxlength="40" value="${esc(w.title || '')}" placeholder="${esc(w.title ? t.name : labelOf(w))}" data-w-opt="title" data-type="text">`);
    }
    else {
      look += field('Title', `<input type="text" maxlength="40" value="${esc(w.title || '')}" placeholder="${esc(t.name)}" data-w-opt="title" data-type="text">`);
      look += field('Background', presets('bg', BG, bgOf(w) * 100), 'see-through ones show it on hover');
    }
    const shows = showsHtml(w);
    // where it sits: snap to a corner, an edge or the middle of the left panel
    const spots = [0, 0.5, 1];
    const at = (v) => spots.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
    const place =
      `<div class="ca-wsnap">${[].concat(
        ...spots.map((y) =>
          spots.map((x) => `<button type="button" class="ca-wsnap-cell${at(w.x) === x && at(w.y) === y && Math.abs(w.x - x) < 0.02 && Math.abs(w.y - y) < 0.02 ? ' on' : ''}" data-w-snap="${x},${y}" data-tip="Move it here"><i></i></button>`)
        )
      ).join('')}</div><span class="ca-wf-hint">or drag it anywhere</span>`;
    return (
      `<div class="ca-card ca-weditor ca-wtheme-${esc(w.type)}" data-w-editor="${esc(w.id)}" data-wlink="${esc(w.id)}">` +
      '<div class="ca-weditor-head">' +
      `<span class="ca-weditor-ico">${I(t.icon, 20)}</span>` +
      `<div class="ca-weditor-title"><b>${esc(labelOf(w))}</b><span>${esc(w.type === 'macro' ? 'Macro button' : t.name)}</span></div>` +
      copiesHtml(w) +
      (w.type === 'macro' ? '' : C.button(`${I('copy', 11)} Duplicate`, `data-w-page-dup="${esc(w.id)}" data-tip="Another one with these settings, placed beside it"`, 'ca-btn-small')) +
      C.button(`${I('close', 11)} Remove`, `data-w-page-del="${esc(w.id)}"`, 'ca-btn-small ca-btn-off') +
      C.button('Done', 'data-w-edit-done', 'ca-btn-small ca-btn-on') +
      '</div>' +
      '<div class="ca-weditor-body">' +
      `<div class="ca-weditor-sec"><div class="ca-weditor-sec-head">${I('widget', 12)} Look</div>${look}</div>` +
      (shows ? `<div class="ca-weditor-sec${/ca-wopts/.test(shows) ? ' ca-weditor-sec-wide' : ''}"><div class="ca-weditor-sec-head">${I('filter', 12)} Shows</div><div class="ca-weditor-shows" data-w-shows>${shows}</div></div>` : '') +
      `<div class="ca-weditor-sec ca-weditor-place"><div class="ca-weditor-sec-head">${I('grip', 12)} Place</div>${place}</div>` +
      '</div></div>'
    );
  }

  /** The copies of a widget's kind as numbered buttons, to switch whose settings show (none for a lone one). */
  function copiesHtml(w) {
    const all = w.type === 'macro' ? [] : copiesOf(w);
    if (all.length < 2) return '';
    return (
      `<div class="ca-wcopies" data-tip="Its copies — each keeps its own settings">${all
        .map((x, i) => `<button type="button" class="ca-wcopy${x.id === w.id ? ' on' : ''}" data-wlink="${esc(x.id)}" data-w-page-edit="${esc(x.id)}" data-tip="${esc(labelOf(x))}">${i + 1}</button>`)
        .join('')}</div>`
    );
  }

  // ---- linking: a widget on the page ⇄ the same widget on the left panel ------------------

  let linked = null; // the widget hovered on either side (its id), or every widget of a kind: 'type:<id>' (a picker tile)

  const isLinked = (w) => !!w && (w.id === linked || (!!linked && linked === `type:${w.type}`));

  /** Puts the glow on the widgets that should have it (without redrawing them). */
  function refreshGlow() {
    if (layer) layer.querySelectorAll('[data-widget]').forEach((el) => el.classList.toggle('ca-w-linked', isLinked(get(el.dataset.widget)) || (el.dataset.widget === editing && !!pageRoot)));
  }

  function setLinked(id) {
    if (id === linked) return;
    linked = id;
    refreshGlow();
    if (pageRoot) {
      pageRoot.querySelectorAll('[data-wlink]').forEach((el) => el.classList.toggle('linked', isLinked(get(el.dataset.wlink))));
      // a tile lights up with its widgets: hovered itself, or one of them hovered on the panel
      pageRoot.querySelectorAll('[data-wlink-type]').forEach((el) => el.classList.toggle('linked', linked === `type:${el.dataset.wlinkType}` || (!!linked && (get(linked) || {}).type === el.dataset.wlinkType)));
    }
  }

  /** Where each widget sits on the left panel, in % of it (measured; from its saved place when it can't be). */
  function placeOf(w) {
    const host = layer && layer.parentNode;
    const el = layer && layer.querySelector(`[data-widget="${w.id}"]`);
    if (host && el && host.getBoundingClientRect) {
      const H = host.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      if (H.width && H.height && r.width) {
        return { l: ((r.left - H.left) / H.width) * 100, t: ((r.top - H.top) / H.height) * 100, w: (r.width / H.width) * 100, h: (r.height / H.height) * 100 };
      }
    }
    const bare = typeById[w.type] && typeById[w.type].bare;
    const sw = bare ? 10 : 40;
    const sh = bare ? 5 : 14;
    return { l: clamp01(w.x) * (100 - sw), t: clamp01(w.y) * (100 - sh), w: sw, h: sh };
  }

  /** A small map of the left panel with every widget where it is (and the big cookie, to get your bearings). */
  function mapHtml() {
    const host = layer && layer.parentNode;
    const H = host && host.getBoundingClientRect ? host.getBoundingClientRect() : null;
    const ratio = H && H.width && H.height ? H.width / H.height : 0.55;
    const cookie = document.getElementById('bigCookie');
    let ck = '';
    if (H && H.width && cookie && cookie.getBoundingClientRect) {
      const c = cookie.getBoundingClientRect();
      if (c.width) ck = `<i class="ca-wmap-cookie" style="left:${((c.left - H.left) / H.width) * 100}%;top:${((c.top - H.top) / H.height) * 100}%;width:${(c.width / H.width) * 100}%;height:${(c.height / H.height) * 100}%"></i>`;
    }
    return (
      `<div class="ca-wmap" style="aspect-ratio:${ratio.toFixed(3)}">${ck}` +
      widgets
        .filter((w) => typeById[w.type])
        .map((w) => {
          const p = placeOf(w);
          const t = typeById[w.type];
          const icon = w.type === 'macro' && CA.Macros.get(w.macro) ? CA.UI.MacrosPage.icon(CA.Macros.get(w.macro), true) : I(t.icon, 12);
          return (
            `<button type="button" class="ca-wmap-item${t.bare ? ' bare' : ''}${isLinked(w) ? ' linked' : ''}${w.id === editing ? ' editing' : ''}" data-wlink="${esc(w.id)}" data-w-page-edit="${esc(w.id)}" ` +
            `style="left:${p.l.toFixed(2)}%;top:${p.t.toFixed(2)}%;width:${p.w.toFixed(2)}%;height:${p.h.toFixed(2)}%" data-tip="${esc(nameOf(w))} — click for its settings">${icon}</button>`
          );
        })
        .join('') +
      '</div>'
    );
  }

  /** The placed widgets as chips (icon, name, ⚙, ×), grouped by kind; a kind's + adds another copy of it. */
  function chipsHtml() {
    const kinds = [];
    widgets
      .filter((w) => typeById[w.type])
      .forEach((w) => {
        const k = kinds.find((x) => x.type === w.type);
        if (k) k.list.push(w);
        else kinds.push({ type: w.type, list: [w] });
      });
    const chip = (w) => {
      const t = typeById[w.type];
      const icon = w.type === 'macro' && CA.Macros.get(w.macro) ? CA.UI.MacrosPage.icon(CA.Macros.get(w.macro), true) : I(t.iconOf ? t.iconOf(w) : t.icon, 13);
      return (
        `<span class="ca-wchip${w.id === editing ? ' editing' : ''}${isLinked(w) ? ' linked' : ''}" data-wlink="${esc(w.id)}">` +
        `<button type="button" class="ca-wchip-main" data-w-page-edit="${esc(w.id)}" data-tip="Settings">${icon}<b>${esc(labelOf(w))}</b>${I('settings', 11)}</button>` +
        `<button type="button" class="ca-wchip-x" data-w-page-del="${esc(w.id)}" data-tip="Remove">${I('close', 9)}</button></span>`
      );
    };
    return kinds
      .map(({ type, list }) => {
        const t = typeById[type];
        const name = type === 'macro' ? 'Macro buttons' : t.name;
        const more = type === 'macro' ? '' : `<button type="button" class="ca-wkind-add" data-w-page-add="${esc(type)}" data-tip="Add another ${esc(t.name)}">${I('plus', 10)}</button>`;
        return (
          `<div class="ca-wkind" data-w-kind="${esc(type)}"><div class="ca-wkind-head"${type === 'macro' ? '' : ` data-wlink-type="${esc(type)}"`}><span>${esc(name)}</span>` +
          `${list.length > 1 ? `<span class="ca-wkind-n">×${list.length}</span>` : ''}${more}</div>` +
          `<div class="ca-wkind-chips">${list.map(chip).join('')}</div></div>`
        );
      })
      .join('');
  }

  /** Keeps the map in step with the left panel while the page is open. */
  function syncPage() {
    if (!pageRoot || !pageRoot.isConnected) return;
    const map = pageRoot.querySelector('[data-w-map]');
    if (map) CA.UI.Dom.morph(map, mapHtml());
    refreshSamples();
    pageRoot.querySelectorAll('[data-wp-status]').forEach((st) => {
      const p = profileOf(st.dataset.wpStatus);
      if (!p) return;
      const on = profileActive(p.id);
      const row = st.closest('[data-wp-row]');
      if (row.classList.contains('on') === on) return;
      row.classList.toggle('on', on);
      CA.UI.Dom.morph(st, profileStatus(p));
      row.querySelectorAll('[data-wp-act="save"]').forEach((b) => (b.disabled = on));
    });
  }

  function onEditorInput(e) {
    const el = e.target;
    if (el.dataset && el.dataset.wpName) {
      if (e.type === 'change') renameProfile(el.dataset.wpName, el.value);
      return;
    }
    const box = el.closest && el.closest('[data-w-editor]');
    const w = box && get(box.dataset.wEditor);
    if (!w) return;
    if (el.dataset.wMulti) {
      const key = el.dataset.wMulti;
      const t = typeById[w.type];
      const def = defaultOf(t.settings.find((s) => s.key === key) || {}, w) || [];
      const set = new Set(w[key] !== undefined ? w[key] : def);
      if (el.checked) set.add(el.value);
      else set.delete(el.value);
      el.closest('.ca-member,.ca-wopt').classList.toggle('on', el.checked);
      setOption(w, key, [...set]);
      refreshShows(w);
      return;
    }
    const key = el.dataset.wOpt;
    if (!key) return;
    let v = el.value;
    if (el.dataset.type === 'number' || el.dataset.type === 'percent') {
      v = Number(v);
      if (!Number.isFinite(v)) return;
      if (el.dataset.min) v = Math.max(Number(el.dataset.min), Math.min(Number(el.dataset.max), Math.round(v)));
      if (el.dataset.type === 'percent') v /= 100;
    } else v = el.dataset.type === 'choice' ? String(v) : String(v).trim().slice(0, 40);
    const label = el.parentNode.querySelector('.ca-range-val');
    if (label) label.textContent = `${Math.round(el.dataset.type === 'percent' ? v * 100 : v)}%`;
    setOption(w, key, v);
    if (el.dataset.type === 'choice') refreshShows(w);
  }

  // ---- save / load ------------------------------------------------------------------------

  const round = (v) => Math.round(v * 1000) / 1000;

  /** A list of widgets as they're saved (the current layout's, or a profile's). */
  function serializeList(list) {
    return list.map((wd) => {
      const out = { id: wd.id, type: wd.type, x: round(wd.x), y: round(wd.y), collapsed: wd.collapsed };
      if (wd.macro) out.macro = wd.macro;
      if (wd.scale && wd.scale !== 1) out.scale = round(wd.scale);
      if (wd.w) out.w = wd.w;
      if (wd.h) out.h = wd.h;
      SAVED.forEach((k) => {
        if (wd[k] === undefined || wd[k] === '' || (Array.isArray(wd[k]) && !wd[k].length && k === 'types')) return;
        out[k] = Array.isArray(wd[k]) ? wd[k].slice() : wd[k];
      });
      return out;
    });
  }
  const serialize = () => serializeList(widgets);

  /**
   * Saved widgets of a type that's been replaced become the type that replaced it: a type's
   * `legacy: { oldId: (saved) => settings }` gives the settings that make it show what the old one did
   * (v3.39: Next golden cookie, Golden timeline and Golden cookie frequency → Golden cookies).
   */
  function migrate(data) {
    if (!Array.isArray(data)) return data;
    const by = {};
    types.forEach((t) => Object.keys(t.legacy || {}).forEach((old) => (by[old] = { type: t.id, fn: t.legacy[old] })));
    return data.map((w) => (w && by[w.type] ? { ...w, ...by[w.type].fn(w), type: by[w.type].type } : w));
  }

  const okPos = (w) => w && Number.isFinite(w.x) && Number.isFinite(w.y);

  /** Saved widgets (the layout's, or a profile's) → clean widget objects; nothing else changes. */
  function fromSaved(saved) {
    const data = migrate(saved); // a replaced type → the type that replaced it
    if (!Array.isArray(data)) return [];
    // a type that's gone is dropped (v3.19: the Golden cookies ring, now the Next golden cookie widget)
    return data
      .filter((w) => okPos(w) && typeById[w.type])
      .map((w) => {
        // ids go into attributes and selectors: only plain ones are kept
        const out = { id: /^[\w-]{1,40}$/.test(String(w.id)) ? String(w.id) : newId(), type: w.type, x: w.x, y: w.y, collapsed: !!w.collapsed };
        if (w.macro) out.macro = String(w.macro);
        if (typeof w.plot === 'string') out.plot = w.plot.slice(0, 40);
        if (Number.isFinite(w.scale)) out.scale = Math.max(SCALE_MIN, Math.min(SCALE_MAX, w.scale));
        if (Number.isFinite(w.w)) out.w = Math.max(MIN_W, w.w);
        if (Number.isFinite(w.h)) out.h = Math.max(MIN_H, w.h);
        if (Number.isFinite(w.count)) out.count = w.count;
        if (typeof w.target === 'string') out.target = w.target.slice(0, 40);
        if (typeof w.axis === 'string') out.axis = w.axis.slice(0, 20);
        if (typeof w.stat === 'string') out.stat = w.stat.slice(0, 60);
        if (typeof w.item === 'string') out.item = w.item.slice(0, 120);
        if (Number.isFinite(w.targetMagic)) out.targetMagic = w.targetMagic;
        if (Number.isFinite(w.font)) out.font = Math.max(FONT_MIN, Math.min(FONT_MAX, w.font));
        if (typeof w.title === 'string') out.title = w.title.slice(0, 40);
        if (Number.isFinite(w.bg)) out.bg = Math.max(0, Math.min(1, w.bg));
        if (typeof w.sort === 'string') out.sort = w.sort.slice(0, 20);
        if (typeof w.barScale === 'string') out.barScale = w.barScale.slice(0, 20);
        if (typeof w.legend === 'string') out.legend = w.legend.slice(0, 20);
        if (Array.isArray(w.types)) out.types = w.types.map(String);
        if (Array.isArray(w.stats)) out.stats = w.stats.map(String);
        if (Array.isArray(w.nums)) out.nums = w.nums.map(String);
        return out;
      });
  }

  function load(data) {
    if (!Array.isArray(data)) return;
    // v2.1 had one Shortcuts widget for all favorites; its buttons now start where it was
    const old = data.find((w) => okPos(w) && w.type === 'shortcuts');
    anchor = old ? { x: old.x, y: old.y } : null;
    widgets = fromSaved(data);
    render();
    reconcile();
  }

  // ---- layout profiles ------------------------------------------------------------------------
  // A profile is a whole layout saved under a name: every widget, where it sits, its size and its
  // settings (macro buttons too). Using one swaps the left panel for it — the macros it has buttons
  // for get their ★, the rest lose it — and Undo goes back to the layout you had before. Saved in
  // their own section ('widgetProfiles'), through fromSaved() like the layout itself.

  let profiles = []; // { id, name, widgets: [saved widget] }
  let undo = null; // { name, widgets } — the layout before the last profile was used (this session only)

  const profileName = (n, fallback) => String(n == null ? '' : n).trim().slice(0, 40) || fallback;
  /** A profile from its id or its name (any case), or null. */
  function profileOf(x) {
    if (x == null || x === '') return null;
    const k = String(x).toLowerCase();
    return profiles.find((p) => p.id === String(x)) || profiles.find((p) => p.name.toLowerCase() === k) || null;
  }
  const profileList = () => profiles.map((p) => ({ id: p.id, name: p.name, widgets: serializeList(fromSaved(p.widgets)) }));
  // a layout to compare: its widgets without their ids, in any order
  const sig = (list) => list.map(({ id, ...rest }) => JSON.stringify(rest)).sort().join('\n');
  /** Whether the left panel is a profile's layout right now. */
  function profileActive(x) {
    const p = profileOf(x);
    return !!p && sig(serializeList(fromSaved(p.widgets))) === sig(serialize());
  }
  function activeProfile() {
    const now = sig(serialize());
    const p = profiles.find((x) => sig(serializeList(fromSaved(x.widgets))) === now);
    return p ? p.id : '';
  }

  /** Puts a layout on the left panel instead of the one there (macro ★s follow its buttons). */
  function swapLayout(next) {
    widgets.forEach((w) => {
      const t = typeById[w.type];
      if (t && t.removed) t.removed(w);
    });
    // favorites first: each change re-checks the buttons, which would drop the new layout's
    const want = new Set(next.filter((w) => w.type === 'macro').map((w) => w.macro));
    CA.Macros.list().forEach((m) => {
      if (CA.Macros.isFav(m.id) !== want.has(m.id)) CA.Macros.setFav(m.id, want.has(m.id));
    });
    widgets = next;
    editing = null;
    anchor = null;
    reconcile();
    changed();
  }

  /** Uses a profile (its id or its name): the left panel becomes its layout. How many widgets it placed. */
  function useProfile(x) {
    const p = profileOf(x);
    if (!p) return 0;
    if (profileActive(p.id)) return 0;
    const stamp = newId();
    const next = fromSaved(p.widgets).map((w, i) => ({ ...w, id: `${stamp}${i.toString(36)}` }));
    undo = { name: p.name, widgets: serialize() };
    swapLayout(next);
    if (!S().get('widgetsShown')) S().set('widgetsShown', true);
    return widgets.length;
  }
  /** Back to the layout from before the last profile was used. */
  function undoProfile() {
    if (!undo) return 0;
    const back = fromSaved(undo.widgets);
    undo = null;
    swapLayout(back);
    return widgets.length;
  }
  /** A new profile of the layout now: its id. */
  function addProfile(name) {
    let id = `l${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
    while (profileOf(id)) id += 'x';
    profiles.push({ id, name: profileName(name, `Layout ${profiles.length + 1}`), widgets: serialize() });
    CA.Events.emit('widgets');
    return id;
  }
  /** Saves the layout now over a profile. */
  function overwriteProfile(id) {
    const p = profiles.find((x) => x.id === id);
    if (!p) return;
    p.widgets = serialize();
    CA.Events.emit('widgets');
  }
  function renameProfile(id, name) {
    const p = profiles.find((x) => x.id === id);
    if (!p || !String(name).trim()) return;
    p.name = profileName(name, p.name);
    CA.Events.emit('widgets');
  }
  function removeProfile(id) {
    const n = profiles.length;
    profiles = profiles.filter((x) => x.id !== id);
    if (profiles.length !== n) CA.Events.emit('widgets');
  }
  const serializeProfiles = () => ({ profiles: profileList() });
  function loadProfiles(data) {
    const ps = data && Array.isArray(data.profiles) ? data.profiles : [];
    profiles = ps
      .filter((x) => x && /^[\w-]{1,40}$/.test(String(x.id)) && Array.isArray(x.widgets))
      .map((x) => ({ id: String(x.id), name: profileName(x.name, 'Layout'), widgets: serializeList(fromSaved(x.widgets)) }))
      .filter((x, i, a) => a.findIndex((y) => y.id === x.id) === i);
  }

  /** A small picture of a saved layout: a box for each widget, where it sits on the panel. */
  function thumbHtml(list) {
    const host = layer && layer.parentNode;
    const Hr = host && host.getBoundingClientRect ? host.getBoundingClientRect() : null;
    const W = (Hr && Hr.width) || 400;
    const H = (Hr && Hr.height) || 730;
    return (
      `<div class="ca-wthumb" style="aspect-ratio:${(W / H).toFixed(3)}">` +
      list
        .map((w) => {
          const t = typeById[w.type];
          const bare = t.bare;
          const sc = t.resize === 'scale' ? w.scale || 1 : 1;
          const pw = Math.min(100, ((bare ? BUTTON_PX : w.w || t.width) * sc * 100) / W);
          const ph = Math.min(100, ((bare ? BUTTON_PX : w.collapsed ? 22 : w.h || 90) * sc * 100) / H);
          return `<i class="${bare ? 'bare' : ''}" style="left:${(clamp01(w.x) * (100 - pw)).toFixed(1)}%;top:${(clamp01(w.y) * (100 - ph)).toFixed(1)}%;width:${pw.toFixed(1)}%;height:${ph.toFixed(1)}%"></i>`;
        })
        .join('') +
      '</div>'
    );
  }

  /** What a profile holds, in words: "4 widgets · 3 macro buttons". */
  function profileSummary(list) {
    const btn = list.filter((w) => w.type === 'macro').length;
    const n = list.length - btn;
    const parts = [];
    if (n || !btn) parts.push(`${n} widget${n === 1 ? '' : 's'}`);
    if (btn) parts.push(`${btn} macro button${btn === 1 ? '' : 's'}`);
    return parts.join(' · ');
  }
  /** A layout's Use button — "In use" while it's the one on the panel. */
  const profileStatus = (p) => CA.UI.C.useButton(profileActive(p.id), `data-wp-act="use" data-id="${esc(p.id)}"`, profileActive(p.id) ? 'It’s the layout on the panel' : 'Put this layout on the panel');

  function profileRow(p) {
    const C = CA.UI.C;
    const list = fromSaved(p.widgets);
    const on = profileActive(p.id);
    return (
      `<div class="ca-pprof ca-wprof${on ? ' on' : ''}" data-wp-row="${esc(p.id)}">` +
      thumbHtml(list) +
      '<div class="ca-dprof-name">' +
      `<input type="text" class="ca-gname" maxlength="40" value="${esc(p.name)}" data-wp-name="${esc(p.id)}" data-tip="the layout’s name — macros use it, or its id: ${esc(p.id)}">` +
      `<code>${esc(profileSummary(list))}</code></div>` +
      '<span class="ca-pprof-end">' +
      C.button(`${I('save', 12)} Save`, `data-wp-act="save" data-id="${esc(p.id)}" data-arm-label="Replace it?" data-tip="Save the layout on the panel now over this one"${on ? ' disabled' : ''}`, 'ca-btn-small') +
      `<span class="ca-use-slot" data-wp-status="${esc(p.id)}">${profileStatus(p)}</span>` +
      C.trash(`data-wp-act="delete" data-id="${esc(p.id)}"`, 'Delete it?', 'Delete this layout') +
      '</span></div>'
    );
  }

  function profilesCard() {
    const C = CA.UI.C;
    return (
      '<div class="ca-card ca-pprofs ca-wprofs">' +
      C.cardHead('Layouts', 'save', '<div class="ca-card-meta"><span class="ca-hint">macros: widgets.profile(name)</span></div>') +
      (profiles.length ? profiles.map(profileRow).join('') : '<div class="ca-card-note">No saved layouts yet. Save the one on the panel now to come back to it later.</div>') +
      '<div class="ca-pprof-foot">' +
      C.button(`${I('plus', 12)} Save current layout`, `data-wp-act="new"${widgets.length ? '' : ' disabled'}`, 'ca-btn-small') +
      (undo ? C.button(`${I('refresh', 12)} Undo`, `data-wp-act="undo" data-tip="Back to the layout you had before “${esc(undo.name)}”"`, 'ca-btn-small') : '') +
      '<span class="ca-hint">Use swaps the whole left panel for that layout.</span>' +
      '</div></div>'
    );
  }

  /** A click on the Layouts card (true when it was one). */
  function onProfileClick(t) {
    const { wpAct: act, id } = t.dataset;
    if (act === 'delete' || act === 'save') {
      if (!CA.UI.Dom.armed(t)) return true;
    }
    if (act === 'delete') removeProfile(id);
    else if (act === 'save') overwriteProfile(id);
    else if (act === 'use') useProfile(id);
    else if (act === 'undo') undoProfile();
    else if (act === 'new') addProfile();
    return true;
  }

  // ---- the Widgets page ------------------------------------------------------------------

  // ---- the picker: shelves of tiles ---------------------------------------------------------------

  const spriteVar = (p) => `--bgp:${-p[0] * 48}px ${-p[1] * 48}px`;

  function tileHtml(o) {
    // o: { id, name, short, desc, round, ring, sprite, sheet, svg, placed, link, badge }
    const n = o.placed || 0;
    let act = 'Click to place it on the left panel';
    let pill = '+ Add';
    if (o.link) {
      act = 'Click to open the Macros page';
      pill = 'Open';
    } else if (n) {
      act = `${n} placed — click to remove the newest; + Add places another (each with its own settings)`;
      pill = 'Remove';
    }
    const cls = `ca-wtile${n || o.badge ? ' placed' : ''}`;
    const attr = (n && !o.link ? `data-w-page-remove="${o.id}"` : o.link ? 'data-ca="open-macros"' : `data-w-page-add="${o.id}"`) + (o.link ? '' : ` data-wlink-type="${o.id}"`);
    const more = n && !o.link ? `<button type="button" class="ca-btn ca-btn-small ca-wtile-add" data-w-page-add="${o.id}">${I('plus', 10)} Add</button>` : '';
    const tag = o.link ? o.badge : n ? `×${n}` : '';
    let ico;
    if (o.sprite) ico = `<i class="${o.sheet ? 'ca-wcrate-plant' : ''}" style="${spriteVar(o.sprite)}"></i>`;
    else ico = `<i class="ca-wcrate-svg">${I(o.svg || 'widget', 26)}</i>`;
    return (
      `<div class="${cls}" data-pop ${attr} data-w-tile="${o.id}">` +
      `<div class="ca-wcrate${o.round ? ' round' : ''}" style="--ring:${o.ring || '#ffd36a'}">${ico}` +
      (tag ? `<span class="ca-wtag">${tag}</span>` : '') +
      `<span class="ca-wadd${pill === 'Remove' ? ' remove' : ''}">${pill}</span></div>` +
      `<div class="ca-wtile-name">${esc(o.name)}</div>` +
      (o.short ? `<div class="ca-wtile-sub">${esc(o.short)}</div>` : '') +
      more +
      `<div class="ca-wpop ca-wtip"><div class="ca-wtip-head">${esc(o.name)}</div>${o.descHtml || esc(o.desc || '')}<div class="ca-wtip-act">${act}</div></div>` +
      '</div>'
    );
  }

  function pickerHtml(favCount) {
    const C = CA.UI.C;
    const typeTile = (t) =>
      tileHtml({
        id: t.id,
        name: t.name,
        short: t.short,
        desc: t.desc,
        round: t.bare,
        ring: t.ring,
        sprite: t.sprite && (Array.isArray(t.sprite) ? t.sprite : t.sprite.pos),
        sheet: t.sprite && !Array.isArray(t.sprite),
        svg: t.icon,
        placed: widgets.filter((w) => w.type === t.id).length,
      });
    const macroTile = tileHtml({
      id: 'macro-buttons',
      name: 'Macro buttons',
      short: '★ a macro or spell to get one',
      descHtml: `★ a macro (or a spell on the Grimoire page) and it gets its own round button on the panel: click to switch it on/off or run it. Opens the Macros page.`,
      round: true,
      svg: 'star',
      link: true,
      badge: favCount || '',
    });
    const shelves = groups.slice().sort((a, b) => a.order - b.order);
    const known = new Set(shelves.map((g) => g.id));
    const visible = types.filter((t) => !t.hidden);
    const rows = shelves.map((g) => ({ g, tiles: visible.filter((t) => t.group === g.id).map(typeTile) }));
    const more = visible.filter((t) => !known.has(t.group)).map(typeTile);
    if (more.length) rows.push({ g: { id: 'more', name: 'More', sprite: [10, 0] }, tiles: more });
    const macros = rows.find((r) => r.g.id === 'macros');
    if (macros) macros.tiles.unshift(macroTile);
    else rows.push({ g: { id: 'macros', name: 'Macros', sprite: [12, 0] }, tiles: [macroTile] });
    return (
      '<div class="ca-card">' +
      C.cardHead('Add a widget', 'plus') +
      '<div class="ca-wpick">' +
      rows
        .filter((r) => r.tiles.length)
        .map((r) => `<div class="ca-wshelf" data-w-shelf="${esc(r.g.id)}"><div class="ca-wshelf-head"><i class="ca-wshelf-ico" style="${spriteVar(r.g.sprite)}"></i>${esc(r.g.name)}</div><div class="ca-wshelf-tiles">${r.tiles.join('')}</div></div>`)
        .join('') +
      '</div>' +
      '<div class="ca-wpick-foot"><span class="ca-wkey"><i class="round"></i> round dial</span><span class="ca-wkey"><i></i> framed panel</span>' +
      '<span class="ca-wkey hint">Drag a widget to move it, its corner to resize it; hover one for × and ⚙.</span></div>' +
      '</div>'
    );
  }

  function pageHtml() {
    const C = CA.UI.C;
    const favs = CA.Macros.list().filter((m) => CA.Macros.isFav(m.id));
    let h = '';
    const ed = editing && get(editing);
    if (ed) h += editorHtml(ed);
    else editing = null;

    // what's placed: a map of the left panel, and the same widgets as chips — hover either (or the
    // widget itself) and they light up together; click for its settings
    if (widgets.length) {
      h +=
        '<div class="ca-card">' +
        C.cardHead('Your widgets', 'widget') +
        `<div class="ca-wplaced"><div class="ca-wmap-wrap" data-w-map>${mapHtml()}</div><div class="ca-wchips">${chipsHtml()}</div></div>` +
        '</div>';
    }

    h += profilesCard();
    h += pickerHtml(favs.length);
    h +=
      `<div class="ca-card">${C.cardHead('Options', 'settings')}<div class="ca-optgrid">${S().optionsIn('widgets').map(CA.UI.Menu.optionTile).join('')}</div><div class="ca-list">` +
      '<div class="ca-row ca-row-option">' +
      `<span class="ca-row-ico">${I('trash', 16)}</span>` +
      '<div class="ca-row-text"><div class="ca-row-name">Remove all widgets</div><div class="ca-row-desc">Clears the left panel (and un-stars your macros).</div></div>' +
      C.button('Remove all', 'data-w-page-clear data-arm-label="Remove them all?"', 'ca-btn-small ca-btn-off') +
      '</div></div></div>';
    return h;
  }

  let pageRoot = null;
  function onPageHover(e) {
    const el = e.target.closest && e.target.closest('[data-wlink],[data-wlink-type]');
    setLinked(el ? el.dataset.wlink || `type:${el.dataset.wlinkType}` : null);
  }
  function onLayerHover(e) {
    const el = e.target.closest && e.target.closest('[data-widget]');
    setLinked(el ? el.dataset.widget : null);
  }
  function onPageClick(e) {
    const wp = e.target.closest('[data-wp-act]');
    if (wp) {
      e.stopPropagation();
      CA.Util.sound('snd/tick.mp3');
      onProfileClick(wp);
      if (!wp.dataset.armed) CA.UI.Menu.render();
      return;
    }
    const pre = e.target.closest('[data-w-preset],[data-w-snap]');
    if (pre) {
      e.stopPropagation();
      CA.Util.sound('snd/tick.mp3');
      const w = get(editing);
      if (!w) return;
      if (pre.dataset.wPreset === 'font') w.font = Number(pre.dataset.val);
      else if (pre.dataset.wPreset === 'scale') w.scale = Number(pre.dataset.val) / 100;
      else if (pre.dataset.wPreset === 'bg') w.bg = Number(pre.dataset.val) / 100;
      else if (pre.dataset.wSnap) {
        const [x, y] = pre.dataset.wSnap.split(',').map(Number);
        w.x = x;
        w.y = y;
      }
      changed();
      CA.UI.Menu.render();
      return;
    }
    const t = e.target.closest('[data-w-page-add],[data-w-page-remove],[data-w-page-clear],[data-w-page-edit],[data-w-page-del],[data-w-page-dup],[data-w-edit-done]');
    if (!t) return;
    e.stopPropagation();
    CA.Util.sound('snd/tick.mp3');
    const d = t.dataset;
    if ('wPageAdd' in d) {
      add(d.wPageAdd);
      if (!S().get('widgetsShown')) S().set('widgetsShown', true);
    } else if ('wPageRemove' in d) {
      const of = widgets.filter((w) => w.type === d.wPageRemove);
      if (of.length) remove(of[of.length - 1].id);
    }
    else if ('wPageDup' in d) {
      const copy = duplicate(d.wPageDup);
      if (copy) editing = copy.id; // its settings show next, to change what this one shows
    }
    else if ('wPageEdit' in d) {
      editing = d.wPageEdit;
      CA.UI.Menu.render();
      revealEditor();
      return;
    }
    else if ('wPageDel' in d) remove(d.wPageDel);
    else if ('wEditDone' in d) editing = null;
    else if ('wPageClear' in d) {
      if (!CA.UI.Dom.armed(t)) return;
      widgets.forEach((w) => w.type !== 'macro' && typeById[w.type] && typeById[w.type].removed && typeById[w.type].removed(w));
      widgets = widgets.filter((w) => w.type === 'macro');
      widgets.forEach((w) => CA.Macros.setFav(w.macro, false));
      editing = null;
      changed();
    }
    CA.UI.Menu.render();
  }

  function init() {
    CA.Settings.registerSection('widgets', { serialize, load, event: 'widgets' });
    CA.Settings.registerSection('widgetProfiles', { serialize: serializeProfiles, load: loadProfiles, event: 'widgets' });
    [
      { id: 'golden', name: 'Golden cookies', sprite: [10, 14], order: 10 },
      { id: 'minigames', name: 'Minigames', sprite: [17, 0], order: 20 },
      { id: 'macros', name: 'Macros', sprite: [12, 0], order: 30 },
      { id: 'game', name: 'Data', sprite: [18, 7], order: 40 }, // the game's numbers, and statistics (v3.27: was Your game)
    ].forEach(defineGroup);
    CA.UI.WidgetTypes.register();
    S().defineOption({ key: 'widgetsShown', group: 'widgets', icon: 'widget', name: 'Show widgets', desc: 'Show your widgets on the left panel (they stay saved while hidden).', default: true });
    S().defineOption({ key: 'widgetsLocked', group: 'widgets', icon: 'grip', name: 'Lock widgets', desc: 'Stop widgets from being dragged around by accident (buttons still work).', default: false });
    CA.UI.Pages.register({
      id: 'widgets',
      label: 'Widgets',
      icon: 'widget',
      order: 80,
      group: 'custom',
      html: pageHtml,
      mount: (root) => {
        pageRoot = root;
        root.addEventListener('click', onPageClick);
        root.addEventListener('input', onEditorInput);
        root.addEventListener('change', onEditorInput);
        root.addEventListener('mouseover', onPageHover);
        refreshGlow(); // the edited widget glows
      },
      unmount: () => {
        if (pageRoot) {
          pageRoot.removeEventListener('click', onPageClick);
          pageRoot.removeEventListener('input', onEditorInput);
          pageRoot.removeEventListener('change', onEditorInput);
          pageRoot.removeEventListener('mouseover', onPageHover);
        }
        pageRoot = null;
        linked = null;
        refreshGlow();
      },
      tick: syncPage,
    });
    CA.Events.on('settings', (k) => {
      if (k === 'widgetsShown' || k === 'widgetsLocked' || k === null) render();
    });
    CA.Events.on('macros', () => {
      reconcile();
      tick();
    });
    setInterval(tick, TICK_MS);
    render();

    // code: widgets.profile(name) puts a saved layout on the panel
    const V = (id, desc, get, more) => CA.Script.defineValue({ id, desc, get, ...(more || {}) });
    V('widgets.profiles', 'a list: every saved widget layout (its id)', () => profiles.map((p) => p.id), { list: true });
    V('widgets.activeProfile', 'the saved widget layout on the left panel now ("" when none)', () => activeProfile());
    V('widgets.profileActive', 'whether the left panel is a saved widget layout (its id or name)', (x) => profileActive(x), { params: ['profile'], bool: true });
    CA.Actions.register({
      id: 'widgets.profile',
      name: 'Use a widget layout',
      icon: 'widget',
      group: 'Widgets',
      unit: 'placed',
      params: [{ key: 'profile', label: 'Layout', type: 'select', default: '', options: () => profiles.map((p) => ({ v: p.id, label: p.name })) }],
      run: (p) => useProfile(p.profile),
    });
  }

  return { init, defineType, defineGroup, types: () => types.slice(), add, remove, duplicate, labelOf, toggleStar, hasPreset, syncStars, list, get, has, serialize, migrate, load, fromSaved, render, tick, reconcile, openSettings, editing: () => editing,
    profiles: profileList, profileOf, profileActive, activeProfile, useProfile, undoProfile, addProfile, overwriteProfile, renameProfile, removeProfile };
})();
