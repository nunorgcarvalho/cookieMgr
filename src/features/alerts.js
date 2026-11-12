// Alerts: telling you when something worth catching appears — what Cookie Monster's notifications do
// (flash the screen, play a sound, a desktop notification, the tab's title and icon), built from
// cookieMgr's own pieces so macros can use every part:
//
//   conditions  fortune (a fortune cookie is in the news ticker) · lumpRipe (the sugar lump is ripe) —
//               with the ones there already: shimmer (a golden / wrath cookie, a reindeer on screen),
//               magicPct (magic at a % of the maximum)
//   actions     alert.flash(color) · alert.sound(sound) · alert.notify(text, where) — where: the event
//               log only, the game's notifications, a desktop notification, or both (each logs an
//               "Alert" event)
//   built-ins   "When…" macros, one per alert (Macros page → Alerts — switch on the ones you want): a
//               golden cookie, a wrath cookie, a reindeer, a fortune cookie, magic full, the sugar lump ripe — each
//               flashes, plays a sound and notes it; its card picks the color, the sound, where to note
//   the tab     while a golden (or wrath) cookie is on screen the tab's title starts with ✦ (⚠) and its
//               icon becomes the cookie — so you see it from another tab (option alertTab)

CA.Alerts = (() => {
  const SOUNDS = [
    { v: 'chime', label: 'chime', file: 'snd/chime.mp3' },
    { v: 'shimmer', label: 'shimmer', file: 'snd/shimmerClick.mp3' },
    { v: 'spell', label: 'spell', file: 'snd/spell.mp3' },
    { v: 'fortune', label: 'fortune', file: 'snd/fortune.mp3' },
    { v: 'jingle', label: 'jingle', file: 'snd/jingle.mp3' },
    { v: 'cymbal', label: 'cymbal', file: 'snd/cymbalRev.mp3' },
    { v: 'tick', label: 'tick', file: 'snd/tick.mp3' },
  ];
  const COLORS = [
    { v: 'gold', label: 'gold', css: 'rgba(255, 215, 90, 0.55)' },
    { v: 'red', label: 'red', css: 'rgba(255, 80, 60, 0.55)' },
    { v: 'green', label: 'green', css: 'rgba(120, 255, 120, 0.45)' },
    { v: 'blue', label: 'blue', css: 'rgba(110, 195, 255, 0.5)' },
    { v: 'purple', label: 'purple', css: 'rgba(200, 150, 255, 0.5)' },
    { v: 'white', label: 'white', css: 'rgba(255, 255, 255, 0.55)' },
  ];
  const WHERE = [
    { v: 'log', label: 'the event log' },
    { v: 'game', label: 'a game notification' },
    { v: 'desktop', label: 'a desktop notification' },
    { v: 'both', label: 'game + desktop' },
  ];

  // ---- outputs ------------------------------------------------------------------------------------

  /** Flashes the screen in a color (a full-screen layer that fades out). */
  function flash(color) {
    const c = COLORS.find((x) => x.v === color) || COLORS[0];
    if (typeof document === 'undefined' || !document.body || !document.createElement) return 0;
    const el = document.createElement('div');
    el.className = 'ca-alert-flash';
    el.style.background = c.css;
    document.body.appendChild(el);
    setTimeout(() => el.remove && el.remove(), 900);
    return 1;
  }
  function sound(which) {
    const s = SOUNDS.find((x) => x.v === which) || SOUNDS[0];
    CA.Util.sound(s.file);
    return 1;
  }
  /** A desktop notification (asks for permission the first time). */
  function desktop(title, text) {
    const N = typeof window !== 'undefined' ? window.Notification : null;
    if (!N) return false;
    const show = () => {
      try {
        new N(title, { body: text, icon: CA.Util.res('img/goldCookie.png') });
      } catch (e) {
        /* blocked */
      }
    };
    if (N.permission === 'granted') show();
    else if (N.permission !== 'denied' && typeof N.requestPermission === 'function') N.requestPermission().then((p) => p === 'granted' && show());
    return true;
  }
  function notify(text, where = 'log') {
    const t = String(text || 'Alert');
    if (where === 'game' || where === 'both') CA.Util.notify('cookieMgr', CA.Util.escapeHtml(t), CA.ICON, 4);
    if (where === 'desktop' || where === 'both') desktop('Cookie Clicker', t);
    CA.EventLog.add({ type: 'alert', title: t, data: { where } });
    return 1;
  }

  // ---- the tab: title and icon while a golden / wrath cookie is on screen ----------------------------------

  let shown = ''; // what the tab shows now: '' | 'golden' | 'wrath'
  let iconWas = null;
  function onScreen() {
    const s = (Game.shimmers || []).filter((x) => x && x.type === 'golden' && !x.popped && !(x.forceObj && x.forceObj.type === 'cookie storm drop'));
    if (!s.length) return '';
    return s.some((x) => !x.wrath) ? 'golden' : 'wrath';
  }
  function tab() {
    if (typeof document === 'undefined' || !document.querySelector) return;
    const want = CA.Settings.get('alertTab') ? onScreen() : '';
    const mark = { golden: '✦ ', wrath: '⚠ ' };
    // the game rewrites the title every few frames: put the mark back each time
    const title = String(document.title || '').replace(/^(✦|⚠) /, '');
    document.title = (want ? mark[want] : '') + title;
    if (want === shown) return;
    shown = want;
    const link = document.querySelector('link[rel~="icon"]');
    if (!link) return;
    if (want) {
      if (iconWas === null) iconWas = link.getAttribute('href');
      link.setAttribute('href', CA.Util.res(want === 'golden' ? 'img/goldCookie.png' : 'img/wrathCookie.png'));
    } else if (iconWas !== null) {
      link.setAttribute('href', iconWas);
      iconWas = null;
    }
  }

  // ---- built-ins -----------------------------------------------------------------------------------

  const ALERTS = [
    { id: 'alertGolden', name: 'Golden cookie alert', cond: 'shimmer', params: { type: 'golden' }, color: 'gold', sound: 'chime', text: 'A golden cookie!', icon: [10, 14], desc: 'When a golden cookie appears: a gold flash, a chime, and a note in the event log (pick a desktop notification on its card to hear about it from another tab).' },
    { id: 'alertWrath', name: 'Wrath cookie alert', cond: 'shimmer', params: { type: 'wrath' }, color: 'red', sound: 'cymbal', text: 'A wrath cookie!', icon: [15, 5], desc: 'When a wrath cookie appears: a red flash and a sound.' },
    { id: 'alertReindeer', name: 'Reindeer alert', cond: 'shimmer', params: { type: 'reindeer' }, color: 'green', sound: 'jingle', text: 'A reindeer!', icon: [12, 9], desc: 'When a reindeer runs by (Christmas): a green flash and a jingle.' },
    { id: 'alertFortune', name: 'Fortune alert', cond: 'fortune', params: {}, color: 'purple', sound: 'fortune', text: 'A fortune cookie in the news!', icon: [29, 8], desc: 'When the news ticker has a fortune cookie to click: a purple flash and a sound.' },
    { id: 'alertMagic', name: 'Magic full alert', cond: 'magicPct', params: { op: '>=', value: 100 }, color: 'blue', sound: 'spell', text: 'The Grimoire’s magic is full.', icon: [21, 11], desc: 'When the Grimoire’s magic is full: a blue flash and a sound.' },
    { id: 'alertLump', name: 'Sugar lump alert', cond: 'lumpRipe', params: {}, color: 'white', sound: 'tick', text: 'The sugar lump is ripe.', icon: [29, 14], desc: 'When the sugar lump is ripe (harvesting it always pays).' },
  ];

  function init() {
    CA.EventLog.defineType('alert', { name: 'Alert', icon: 'bell', color: '#ffd36a' });
    CA.Settings.defineOption({
      key: 'alertTab',
      group: 'events',
      icon: 'bell',
      name: 'Golden cookie in the tab',
      desc: 'While a golden cookie is on screen the tab’s title starts with ✦ (a wrath cookie: ⚠) and its icon becomes the cookie — so you see it from another tab.',
      default: true,
    });
    const C = CA.Conditions.register;
    C({ id: 'fortune', name: 'A fortune cookie is in the news', icon: 'sparkle', params: [], describe: () => 'a fortune cookie is in the news', test: () => !!(Game.TickerEffect && Game.TickerEffect.type === 'fortune') });
    C({
      id: 'lumpRipe',
      name: 'The sugar lump is ripe',
      icon: 'lump',
      params: [],
      describe: () => 'the sugar lump is ripe',
      test: () => !!Game.lumpT && Game.lumpRipeAge > 0 && Date.now() - Game.lumpT >= Game.lumpRipeAge,
    });
    const A = CA.Actions.register;
    const opts = (list) => () => list.map(({ v, label }) => ({ v, label }));
    A({ id: 'alert.flash', name: 'Flash the screen', icon: 'bell', group: 'Alerts', unit: 'flashes', params: [{ key: 'color', alias: 'colour', label: 'Color', type: 'select', default: 'gold', options: opts(COLORS) }], run: (p) => flash(p.color) });
    A({ id: 'alert.sound', name: 'Play a sound', icon: 'bell', group: 'Alerts', unit: 'sounds', params: [{ key: 'sound', label: 'Sound', type: 'select', default: 'chime', options: opts(SOUNDS) }], run: (p) => sound(p.sound) });
    A({
      id: 'alert.notify',
      name: 'Note it (event log, game or desktop notification)',
      icon: 'bell',
      group: 'Alerts',
      unit: 'alerts',
      params: [
        { key: 'text', label: 'Text', type: 'text', default: 'Alert' },
        { key: 'where', label: 'Where', type: 'select', default: 'log', options: opts(WHERE) },
      ],
      run: (p) => notify(p.text, p.where),
    });
    ALERTS.forEach((a) =>
      CA.Macros.addBuiltin({
        id: a.id,
        name: a.name,
        desc: a.desc,
        icon: { icon: a.icon },
        mode: 'when',
        every: 250,
        when: { all: [{ cond: a.cond, params: a.params }], edge: 'rise' },
        steps: [
          { action: 'alert.flash', params: { color: a.color } },
          { action: 'alert.sound', params: { sound: a.sound } },
          { action: 'alert.notify', params: { text: a.text, where: 'log' } },
        ],
        options: [
          { step: 0, key: 'color' },
          { step: 1, key: 'sound' },
          { step: 2, key: 'where' },
        ],
        defaultKey: '',
        section: 'alerts',
      })
    );
    if (typeof Game.registerHook === 'function') Game.registerHook('draw', tab);
    setInterval(tab, 500);
  }

  return { init, flash, sound, notify, onScreen, tab, ALERTS, SOUNDS, COLORS };
})();
