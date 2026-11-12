// CookieSimMgr's server: the simulator behind a page in your browser (sim/gui/public/).
//
//   npm run sim:gui                 http://localhost:8091 (opens it)
//   npm run sim:gui -- --port 9000 --no-open
//
// It runs live simulations in this process — a few at a time, in slices short enough to stay
// responsive — and streams what happens to the page (server-sent events); comparisons and
// experiments run in child processes, streamed too. The page is built from the add-on's own UI
// code and stylesheet (/cm.js, /styles.css — straight from src/, so it always looks like the
// add-on), and the game's pictures come from the game's CDN, cached under sim/.game/assets/.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createSim, SIM_VERSION } from '../sim.mjs';
import { loadStrategy, STRATEGIES, parseCmgr } from '../strategy.mjs';
import { loadScenario, runMany, SCENARIOS, parseSpan } from '../runner.mjs';
import { ensureGame, GAME_VERSION, DIR as GAME_DIR, BASE } from '../game/fetch.mjs';
import { stagingModules, ROOT } from '../mgr/host.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, 'public');
const EXPERIMENTS = path.join(ROOT, 'sim', 'experiments');
const ASSETS = path.join(GAME_DIR, 'assets');

// the add-on's code the page uses, in load order (no game needed: formatting, the registries and
// the language for the code editor, icons, components, DOM helpers, tooltips, chart helpers)
const ADDON_FILES = [
  'core/util.js',
  'core/format.js',
  'core/events.js',
  'core/actions.js',
  'core/conditions.js',
  'core/states.js',
  'core/recorder.js',
  'features/script.js',
  'features/history.js',
  'ui/icons.js',
  'ui/components.js',
  'ui/dom.js',
  'ui/tips.js',
  'ui/pages.js',
  'ui/chart.js',
  'ui/plot.js',
  'ui/graphs.js',
  'ui/eventsPage.js',
  'ui/codeEditor.js',
  'ui/codeKnobs.js',
];

const json = (res, code, data) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data, (k, v) => (v instanceof Set ? [...v] : v instanceof Map ? [...v.values()] : v)));
};
const fail = (res, code, message) => json(res, code, { error: message });
const body = (req) =>
  new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (d) => (s += d));
    req.on('end', () => {
      try {
        resolve(s ? JSON.parse(s) : {});
      } catch (e) {
        reject(new Error('Bad JSON'));
      }
    });
  });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.json': 'application/json', '.mp3': 'audio/mpeg' };
const typeOf = (f) => (TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream') + (/\.(html|js|css)$/.test(f) ? '; charset=utf-8' : '');

// ---- what the page needs to know (vocabulary, strategies, scenarios…) ------------------------------

let vocabSim = null;
async function vocab() {
  if (!vocabSim) vocabSim = await createSim({ seed: 1, sampleEvery: 0 });
  const C = vocabSim.CA;
  const opts = (p) => ({ ...p, options: typeof p.options === 'function' ? safe(() => p.options(), []) : p.options });
  const staged = new Set();
  stagingModules().forEach((m) => [...m.code.matchAll(/id: '([\w.]+)'|V\('([\w.]+)'/g)].forEach((x) => staged.add(x[1] || x[2])));
  return {
    library: C.Script.library('macro').map((x) => ({ ...x, staging: staged.has(x.id) })),
    lookups: C.Script.lookups(),
    actions: C.Actions.all().map((a) => ({ id: a.id, name: a.name, icon: a.icon, group: a.group, unit: a.unit, params: a.params.map(opts), staging: staged.has(a.id) })),
    conditions: C.Conditions.all().map((c) => ({ id: c.id, name: c.name, icon: c.icon, params: (c.params || []).map(opts) })),
    values: C.Script.VALUES.map((v) => ({ id: v.id, desc: v.desc, params: v.params || [], list: !!v.list, bool: !!v.bool, staging: staged.has(v.id) })),
    macros: C.Macros.list()
      .filter((m) => m.builtin)
      .map((m) => ({ id: m.id, name: m.name, desc: m.desc, icon: m.icon, mode: m.mode, every: m.every, section: m.section, needsCM: !!m.needsCM })),
    eventTypes: C.EventLog.types(),
    states: C.States.list().map((d) => ({ id: d.id, name: d.name, unit: d.unit, group: d.group, kind: d.kind, agg: d.agg, record: d.record, desc: d.desc })),
    buildings: Object.values(vocabSim.Game.Objects).map((o) => ({ name: o.name, icon: [o.iconColumn, 0] })),
    profiles: C.GardenLayers ? C.GardenLayers.list('profile').map((p) => ({ id: p.id, name: p.name, desc: p.desc })) : [],
  };
}
function safe(fn, dflt) {
  try {
    return fn();
  } catch (e) {
    return dflt;
  }
}
const firstComment = (text) => (String(text).split('\n').find((l) => /^\s*(#|\/\/)/.test(l)) || '').replace(/^\s*(#|\/\/)\s*/, '');
function strategies() {
  return fs
    .readdirSync(STRATEGIES)
    .filter((f) => /\.(cmgr|mjs)$/.test(f))
    .sort()
    .map((file) => {
      const text = fs.readFileSync(path.join(STRATEGIES, file), 'utf8').replace(/\r\n/g, '\n');
      const kind = file.endsWith('.cmgr') ? 'cmgr' : 'mjs';
      return { file, name: file.replace(/\.(cmgr|mjs)$/, ''), kind, desc: firstComment(text), source: text, header: kind === 'cmgr' ? parseCmgr(text) : null };
    });
}
function scenarios() {
  const list = [{ name: 'fresh', desc: 'A new game.' }];
  fs.readdirSync(SCENARIOS)
    .filter((f) => f.endsWith('.mjs'))
    .forEach((f) => list.push({ name: f.replace(/\.mjs$/, ''), desc: firstComment(fs.readFileSync(path.join(SCENARIOS, f), 'utf8')) }));
  return list;
}
function experiments() {
  return fs
    .readdirSync(EXPERIMENTS)
    .filter((f) => f.endsWith('.mjs'))
    .map((f) => {
      const text = fs.readFileSync(path.join(EXPERIMENTS, f), 'utf8');
      const usage = (text.match(/npm run sim -- experiment [^\n]*/) || [''])[0].replace(/^npm run sim -- experiment \S+\s*/, '');
      const about = text
        .split('\n')
        .filter((l) => l.startsWith('//'))
        .map((l) => l.replace(/^\/\/ ?/, ''))
        .join('\n')
        .split(/\n\s*\n/)
        .slice(2)
        .join('\n\n');
      return { name: f.replace(/\.mjs$/, ''), desc: firstComment(text), usage, about };
    });
}

// ---- live sessions --------------------------------------------------------------------------------

const sessions = new Map(); // id → session
let nextId = 1;

/** A simulation the page drives: { id, sim, playing, speed (simulated s per real s; 0 = as fast as it goes), … }. */
async function newSession({ start = {}, strategy = null, seed = 1, label = '' }) {
  const opts = { seed: Number(seed) || 1, sampleEvery: 10 };
  let sc = null;
  if (start.kind === 'save') {
    if (!String(start.save || '').trim()) throw new Error('Paste a save first (Options → Export save in the game).');
    opts.save = String(start.save).trim();
  } else if (start.kind === 'scenario' && start.scenario && start.scenario !== 'fresh') sc = await loadScenario(start.scenario);
  const sim = await createSim({ ...opts, record: true, ...(sc ? sc.options : {}) });
  if (sc) await sc.prepare(sim);
  if (opts.save && sim.Game.cookiesEarned === 0 && sim.Game.Objects.Cursor.amount === 0) throw new Error("That save didn't load — is it the whole text from Export save?");
  let stratName = '';
  if (strategy && strategy.file) {
    const st = await loadStrategy(strategy.file);
    st.setup(sim);
    stratName = st.name;
  } else if (strategy && strategy.source != null) {
    const c = parseCmgr(strategy.source);
    if (c.profile) sim.CA.GardenLayers.loadProfile(c.profile);
    c.with.forEach((id) => sim.macro(id));
    if (c.source.split('\n').some((l) => l.trim() && !l.trim().startsWith('#'))) sim.macro({ name: strategy.name || 'Strategy', source: c.source, every: c.every });
    stratName = strategy.name || 'your code';
  }
  const s = {
    id: String(nextId++),
    sim,
    label: label || stratName || 'Simulation',
    strategy: stratName,
    seed: opts.seed,
    start: start.kind === 'save' ? 'your save' : sc ? sc.name : 'a new game',
    playing: false,
    speed: 60,
    wallRun: 0, // real ms spent simulating
    created: Date.now(),
    cursor: { actions: 0, events: 0, samples: 0 },
    ivSig: '',
    clients: new Set(),
    error: '',
  };
  sessions.set(s.id, s);
  return s;
}

/** Plays every playing session a little: its speed's worth of simulated time, or ~40 ms of computing at Max. */
let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(250, now - lastTick);
  lastTick = now;
  const playing = [...sessions.values()].filter((s) => s.playing);
  if (!playing.length) return;
  const budget = Math.max(10, 45 / playing.length);
  for (const s of playing) {
    const t0 = Date.now();
    try {
      const frameS = 1 / s.sim.Game.fps;
      if (s.speed > 0) {
        s.debt = (s.debt || 0) + (s.speed * dt) / 1000;
        while (s.debt >= frameS && Date.now() - t0 < budget) {
          s.sim.frame();
          s.debt -= frameS;
        }
        if (s.debt > s.speed) s.debt = 0; // can't keep up: don't pile up
      } else while (Date.now() - t0 < budget) for (let i = 0; i < 30; i++) s.sim.frame();
      if (s.until && s.sim.t >= s.until) {
        s.playing = false;
        s.until = 0;
      }
    } catch (e) {
      s.playing = false;
      s.error = String((e && e.stack) || e).split('\n').slice(0, 4).join('\n');
    }
    s.wallRun += Date.now() - t0;
  }
}, 25);

const buffIcon = (b) => (Array.isArray(b.icon) ? b.icon : [0, 0]);
/** What the page shows of a session — what changed since `since` cursors for the logs. */
function snapshot(s, since) {
  const { sim } = s;
  const G = sim.Game;
  const C = sim.CA;
  const st = sim.stats();
  const fresh = (arr, from) => (from < arr.length ? arr.slice(from) : []);
  const events = sim.events();
  const out = {
    id: s.id,
    label: s.label,
    strategy: s.strategy,
    start: s.start,
    seed: s.seed,
    playing: s.playing,
    speed: s.speed,
    until: s.until || 0,
    error: s.error,
    t: sim.t,
    clock: sim.clock.now,
    ratio: s.wallRun ? sim.t / (s.wallRun / 1000) : 0,
    stats: { ...st, cookiesReset: G.cookiesReset, hcFactor: G.HCfactor, prestige: G.prestige, heavenlyChips: G.heavenlyChips, wrinklers: (G.wrinklers || []).filter((w) => w.phase > 0).length, elderWrath: G.elderWrath, season: G.season, magic: G.Objects['Wizard tower'].minigame ? G.Objects['Wizard tower'].minigame.magic : null, magicM: G.Objects['Wizard tower'].minigame ? G.Objects['Wizard tower'].minigame.magicM : null },
    buildings: Object.values(G.Objects).map((o) => ({ name: o.name, amount: o.amount, level: o.level, price: o.getPrice(), cps: o.storedTotalCps * G.globalCpsMult, locked: !!o.locked, icon: [o.iconColumn, 0] })),
    buffs: Object.values(G.buffs).map((b) => ({ name: b.name, icon: buffIcon(b), time: b.time / G.fps, maxTime: b.maxTime / G.fps, multCpS: b.multCpS, multClick: b.multClick })),
    shimmers: G.shimmers.map((x) => ({ type: x.type, wrath: !!x.wrath, life: x.life / G.fps })),
    upgrades: Object.values(G.Upgrades)
      .filter((u) => u.bought && u.pool !== 'prestige' && u.pool !== 'toggle')
      .slice(-60)
      .map((u) => ({ name: u.name, icon: u.icon })),
    store: (G.UpgradesInStore || []).slice(0, 30).map((u) => ({ name: u.name, icon: u.icon, price: u.getPrice() })),
    macros: C.Macros.list()
      .filter((m) => m.mode !== 'group')
      .map((m) => ({ id: m.id, name: m.name, builtin: !!m.builtin, on: C.Macros.isOn(m.id), icon: m.icon, mode: m.mode, every: C.Macros.everyOf(m), problem: C.Macros.problemOf(m.id) || '', runs: (C.Macros.status(m.id) || {}).runs || 0, section: m.section || '' })),
    actions: fresh(sim.actions, since.actions).slice(-400),
    events: fresh(events, since.events).map(plainEvent),
    samples: fresh(sim.samples, since.samples),
    rec: recFrames(sim, since),
    intervals: intervalsIfChanged(sim, since),
    cursor: { actions: sim.actions.length, events: events.length, samples: sim.samples.length, ivSig: since.ivSig },
    garden: gardenView(sim),
  };
  return out;
}
/** An event as plain data (what cookieMgr's event log holds). */
const plainEvent = (e) => ({ id: e.id, t: e.t, a: e.a, type: e.type, title: e.title, text: e.text, cookies: e.cookies, data: e.data });
/**
 * cookieMgr's recorder frames, as a change to what the page already has: { active, reset, frames }
 * the first time, then { active, keep, head, drop, tail } — the page keeps its first `keep` frames,
 * puts `head` after them in place of its frames up to index `drop`, and appends `tail`. New frames
 * only ever come at the end; past 3 hours of play the recorder merges older frames into coarser
 * ones (once a minute) — a stretch after the oldest, already merged ones — so only that stretch is
 * sent again, not the whole history. `since.list` is the frames (objects) the page has.
 */
function recFrames(sim, since) {
  const R = sim.CA.Recorder;
  const cur = R.frames();
  const had = since.list;
  const reset = () => {
    since.list = cur.slice();
    return { active: R.activeNow(), reset: true, frames: cur.slice() };
  };
  if (!had || !had.length || !cur.length) return reset();
  // what's still the same at the start
  const n = Math.min(had.length, cur.length);
  let keep = 0;
  while (keep < n && cur[keep] === had[keep]) keep++;
  let head = [];
  let drop = keep;
  let from = keep; // where, in cur, what the page has goes on
  if (keep < had.length) {
    // a stretch was merged: where the two line up again (the first frame both still have)
    const theirs = new Map();
    for (let i = keep; i < had.length; i++) theirs.set(had[i], i);
    let q = keep;
    while (q < cur.length && !theirs.has(cur[q])) q++;
    if (q === cur.length) return reset();
    head = cur.slice(keep, q);
    drop = theirs.get(cur[q]);
    from = q + (had.length - drop);
    if (cur[from - 1] !== had[had.length - 1]) return reset(); // not just a merge: start over
  }
  const out = { active: R.activeNow(), keep, head, drop, tail: cur.slice(from) };
  since.list = cur.slice();
  return out;
}
/** The golden cookie effects cookieMgr has recorded (start, end, multipliers), when they changed. */
function intervalsIfChanged(sim, since) {
  const ivs = sim.CA.History.intervals || [];
  const sig = `${ivs.length}:${ivs.filter((iv) => iv.end).length}:${ivs.length ? ivs[ivs.length - 1].start : 0}`;
  if (sig === since.ivSig) return null;
  since.ivSig = sig;
  return ivs.map(({ ref, ...iv }) => iv);
}

function gardenView(sim) {
  const G = sim.Game;
  const F = G.Objects.Farm;
  const M = F && F.minigame;
  if (!M || !M.plot || !F.level) return null;
  const tiles = [];
  const lay = sim.CA.Garden && sim.CA.Garden.active ? safe(() => sim.CA.Garden.active(), null) : null;
  for (let y = 0; y < 6; y++)
    for (let x = 0; x < 6; x++) {
      const open = M.isTileUnlocked(x, y);
      const t = M.plot[y][x];
      const me = t[0] > 0 ? M.plantsById[t[0] - 1] : null;
      const want = lay && lay.plot && lay.plot[y] ? lay.plot[y][x] : null;
      const wp = want && M.plants[want];
      tiles.push({
        x,
        y,
        open,
        plant: me ? { key: me.key, name: me.name, icon: me.icon, mature: me.mature, unlocked: !!me.unlocked, immortal: !!me.immortal } : null,
        age: me ? t[1] : 0,
        decay: me && sim.CA.Garden ? safe(() => sim.CA.Garden.decayChance(M, x, y), 0) : 0,
        want: wp ? { key: wp.key, name: wp.name, icon: wp.icon } : null,
      });
    }
  const soil = M.soilsById[M.soil];
  return {
    level: F.level,
    tiles,
    soil: soil ? soil.name : '',
    nextTick: Math.max(0, (M.nextStep - sim.clock.now) / 1000),
    tick: M.stepT,
    effs: M.effs ? { goldenCookieFreq: M.effs.goldenCookieFreq, cps: M.effs.cps } : null,
    layout: lay ? lay.name : '',
    seeds: Object.values(M.plants).filter((p) => p.unlocked).length,
  };
}

function stream(req, res, push) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
  res.write(': hi\n\n');
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const stop = push(send);
  req.on('close', () => stop && stop());
}

// ---- jobs: comparisons and experiments, in child processes ---------------------------------------------

const jobs = new Map(); // id → { id, kind, state, lines, results, listeners }
function newJob(kind, meta) {
  const j = { id: String(nextId++), kind, meta, state: 'running', lines: [], results: [], progress: { done: 0, total: 0 }, listeners: new Set(), started: Date.now() };
  jobs.set(j.id, j);
  return j;
}
const emit = (j, event, data) => j.listeners.forEach((send) => send(event, data));

// ---- the page ---------------------------------------------------------------------------------------

function cmBundle() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const parts = [
    `/* cookieMgr ${pkg.version} — the add-on's own UI code, for CookieSimMgr (built from src/ on request) */`,
    '(function () {',
    "'use strict';",
    'const CA = (window.CA = {});',
    // the add-on's pages read "now" from Date.now(): here that's the simulation's clock (the page
    // sets CookieSimClock.now from each snapshot) — so its charts' windows end at the simulated now
    `const RealDate = window.Date;
    const SimClock = (window.CookieSimClock = { now: 0 });
    class Date extends RealDate {
      constructor(...a) {
        if (a.length) super(...a);
        else super(SimClock.now);
      }
      static now() {
        return SimClock.now;
      }
    }`,
    `CA.VERSION = ${JSON.stringify(pkg.version)};`,
    // the add-on keeps its options in the game save; here, in this browser
    // the add-on's options API (core/settings.js: defineOption, optionsIn, definitions, get, set — set
    // announcing 'settings' as it does), kept in this browser's localStorage
    `CA.Settings = (() => {
      const defs = [];
      const byKey = {};
      let values = {};
      try { values = JSON.parse(localStorage.getItem('CookieSimMgr.options') || '{}'); } catch (e) { values = {}; }
      return {
        defineOption(d) {
          if (!byKey[d.key]) defs.push(d);
          byKey[d.key] = d;
          return d;
        },
        optionsIn: (group) => defs.filter((d) => d.group === group),
        definitions: () => defs.slice(),
        get: (k) => (values[k] !== undefined ? values[k] : byKey[k] ? byKey[k].default : undefined),
        set(k, v) {
          if (values[k] === v) return;
          values[k] = v;
          try { localStorage.setItem('CookieSimMgr.options', JSON.stringify(values)); } catch (e) {}
          if (CA.Events) CA.Events.emit('settings', k);
        },
      };
    })();`,
  ];
  for (const f of ADDON_FILES) parts.push(`// ---- src/${f}\n${fs.readFileSync(path.join(ROOT, 'src', f), 'utf8').replace(/\r\n/g, '\n')}`);
  parts.push('})();');
  return parts.join('\n');
}

/** A picture from the game (img/…), from the cache or the game's CDN. */
async function asset(rel, res) {
  const clean = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const file = path.join(ASSETS, clean);
  if (!file.startsWith(ASSETS)) return fail(res, 400, 'bad path');
  if (!fs.existsSync(file)) {
    try {
      const r = await fetch(BASE + clean.replace(/\\/g, '/'), { headers: { 'User-Agent': 'Mozilla/5.0 (CookieSimMgr)' } });
      if (!r.ok) return fail(res, 404, `not on the CDN: ${clean}`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    } catch (e) {
      return fail(res, 502, `couldn't fetch ${clean}`);
    }
  }
  res.writeHead(200, { 'Content-Type': typeOf(file), 'Cache-Control': 'public, max-age=86400' });
  fs.createReadStream(file).pipe(res);
}

// ---- routes -----------------------------------------------------------------------------------------

async function route(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const parts = p.split('/').filter(Boolean);
  const method = req.method;

  if (method === 'GET' && (p === '/' || p === '/index.html')) {
    res.writeHead(200, { 'Content-Type': typeOf('x.html'), 'Cache-Control': 'no-store' });
    return res.end(fs.readFileSync(path.join(PUBLIC, 'index.html')));
  }
  if (method === 'GET' && p === '/cm.js') {
    res.writeHead(200, { 'Content-Type': typeOf('x.js'), 'Cache-Control': 'no-store' });
    return res.end(cmBundle());
  }
  if (method === 'GET' && p === '/styles.css') {
    res.writeHead(200, { 'Content-Type': typeOf('x.css'), 'Cache-Control': 'no-store' });
    return res.end(fs.readFileSync(path.join(ROOT, 'src', 'ui', 'styles.css')));
  }
  if (method === 'GET' && parts[0] === 'game') return asset(parts.slice(1).join('/'), res);
  // the add-on's stylesheet names a few of the game's pictures relatively (img/perfectCookie.png)
  if (method === 'GET' && parts[0] === 'img') return asset(parts.join('/'), res);
  if (method === 'GET' && parts[0] === 'app') {
    const f = path.join(PUBLIC, parts.slice(1).join('/'));
    if (!f.startsWith(PUBLIC) || !fs.existsSync(f)) return fail(res, 404, 'not found');
    res.writeHead(200, { 'Content-Type': typeOf(f), 'Cache-Control': 'no-store' });
    return res.end(fs.readFileSync(f));
  }

  if (parts[0] !== 'api') return fail(res, 404, 'not found');

  // --- meta
  if (method === 'GET' && p === '/api/meta') {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    return json(res, 200, { simVersion: SIM_VERSION, addonVersion: pkg.version, gameVersion: GAME_VERSION, strategies: strategies(), scenarios: scenarios(), experiments: experiments(), vocab: await vocab() });
  }
  if (method === 'POST' && p === '/api/compile') {
    const { source } = await body(req);
    const v = vocabSim || (await createSim({ seed: 1, sampleEvery: 0 }));
    vocabSim = v;
    const { errors } = v.CA.Script.compile(parseCmgr(source || '').source);
    return json(res, 200, { errors });
  }

  // --- strategies (files in sim/strategies/)
  if (parts[1] === 'strategies' && parts[2]) {
    const file = path.basename(parts[2]);
    if (!/^[\w.-]+\.(cmgr|mjs)$/.test(file)) return fail(res, 400, 'A strategy file is a name ending in .cmgr (letters, digits, - _ .)');
    const full = path.join(STRATEGIES, file);
    if (method === 'PUT') {
      const { source } = await body(req);
      if (file.endsWith('.cmgr')) {
        const { errors } = (vocabSim || (vocabSim = await createSim({ seed: 1, sampleEvery: 0 }))).CA.Script.compile(parseCmgr(source || '').source);
        if (errors.length) return fail(res, 400, `Not saved — line ${errors[0].line}: ${errors[0].message}`);
      }
      fs.writeFileSync(full, String(source || '').replace(/\r\n/g, '\n'));
      return json(res, 200, { ok: true, file });
    }
    if (method === 'DELETE') {
      if (fs.existsSync(full)) fs.unlinkSync(full);
      return json(res, 200, { ok: true });
    }
  }

  // --- sessions
  if (parts[1] === 'sessions') {
    if (method === 'GET' && parts.length === 2) return json(res, 200, [...sessions.values()].map((s) => ({ id: s.id, label: s.label, strategy: s.strategy, start: s.start, seed: s.seed, t: s.sim.t, playing: s.playing, cookies: s.sim.Game.cookiesEarned })));
    if (method === 'POST' && parts.length === 2) {
      const s = await newSession(await body(req));
      return json(res, 200, { id: s.id });
    }
    const s = sessions.get(parts[2]);
    if (!s) return fail(res, 404, 'No such simulation (the server may have restarted)');
    const what = parts[3];
    if (method === 'GET' && what === 'stream')
      return stream(req, res, (send) => {
        const since = { actions: Math.max(0, s.sim.actions.length - 200), events: 0, samples: 0, list: null, ivSig: '' };
        const tick = () => {
          const snap = snapshot(s, since);
          Object.assign(since, snap.cursor);
          send('snap', snap);
        };
        tick();
        const iv = setInterval(tick, 300);
        return () => clearInterval(iv);
      });
    if (method === 'GET' && what === 'snap') return json(res, 200, snapshot(s, { actions: Math.max(0, s.sim.actions.length - 200), events: 0, samples: 0, list: null, ivSig: '' }));
    if (method === 'POST' && what === 'control') {
      const b = await body(req);
      if (b.speed != null) s.speed = Math.max(0, Number(b.speed) || 0);
      if (b.playing != null) s.playing = !!b.playing;
      if (b.run) {
        s.until = s.sim.t + parseSpanSeconds(b.run);
        s.playing = true;
      }
      if (b.step) {
        const t0 = Date.now();
        s.sim.run(Number(b.step));
        s.wallRun += Date.now() - t0;
      }
      s.error = '';
      return json(res, 200, { ok: true, t: s.sim.t });
    }
    if (method === 'POST' && what === 'act') {
      const b = await body(req);
      const n = s.sim.act(b.id, b.params || {});
      return json(res, 200, { n });
    }
    if (method === 'POST' && what === 'code') {
      const b = await body(req);
      try {
        return json(res, 200, s.sim.code(b.source || ''));
      } catch (e) {
        return fail(res, 400, e.message);
      }
    }
    if (method === 'POST' && what === 'macro') {
      const b = await body(req);
      try {
        if (b.source != null) return json(res, 200, { id: s.sim.macro({ name: b.name || 'Added in CookieSimMgr', source: parseCmgr(b.source).source, every: Number(b.every) || 1000 }) });
        if (b.on) s.sim.macro(b.id);
        else s.sim.stop(b.id);
        return json(res, 200, { ok: true });
      } catch (e) {
        return fail(res, 400, e.message);
      }
    }
    if (method === 'GET' && what === 'save') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="sim-${s.id}-${Math.round(s.sim.t / 60)}min.txt"` });
      return res.end(s.sim.exportSave());
    }
    if (method === 'DELETE') {
      s.playing = false;
      sessions.delete(s.id);
      return json(res, 200, { ok: true });
    }
  }

  // --- comparisons
  if (method === 'POST' && p === '/api/compare') {
    const b = await body(req);
    const strategiesList = (b.strategies || []).filter(Boolean);
    if (!strategiesList.length) return fail(res, 400, 'Pick at least one strategy');
    parseSpan(b.span || '1h');
    let saveFile = null;
    if (b.start && b.start.kind === 'save' && String(b.start.save || '').trim()) {
      fs.mkdirSync(path.join(ROOT, 'sim', 'out'), { recursive: true });
      saveFile = path.join(ROOT, 'sim', 'out', `compare-save-${Date.now()}.txt`);
      fs.writeFileSync(saveFile, String(b.start.save).trim());
    }
    const seeds = Math.max(1, Math.min(50, Number(b.seeds) || 3));
    const specs = [];
    strategiesList.forEach((strategy) => {
      for (let s = 1; s <= seeds; s++) specs.push({ strategy, seed: s, span: b.span || '1h', scenario: (b.start && b.start.kind === 'scenario' && b.start.scenario) || 'fresh', save: saveFile });
    });
    const j = newJob('compare', { strategies: strategiesList, seeds, span: b.span || '1h', start: saveFile ? 'your save' : specs[0].scenario });
    j.progress.total = specs.length;
    runMany(specs, {
      jobs: b.jobs ? Number(b.jobs) : undefined,
      onDone: (r) => {
        j.progress.done++;
        j.results.push(r);
        emit(j, 'result', r);
        emit(j, 'progress', j.progress);
      },
    }).then(() => {
      j.state = 'done';
      j.finished = Date.now();
      emit(j, 'done', { finished: j.finished });
    });
    return json(res, 200, { id: j.id });
  }

  // --- experiments
  if (method === 'POST' && parts[1] === 'experiments' && parts[2]) {
    const name = path.basename(parts[2]);
    if (!fs.existsSync(path.join(EXPERIMENTS, `${name}.mjs`))) return fail(res, 404, 'No such experiment');
    const b = await body(req);
    const args = String(b.args || '')
      .split(/\s+/)
      .filter(Boolean);
    const j = newJob('experiment', { name, args });
    const child = spawn(process.execPath, [path.join(ROOT, 'sim', 'cli.mjs'), 'experiment', name, ...args], { cwd: ROOT });
    j.child = child;
    const onData = (d) => {
      const text = String(d);
      j.lines.push(text);
      emit(j, 'out', text);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('close', (code) => {
      j.state = code === 0 ? 'done' : 'failed';
      j.finished = Date.now();
      emit(j, 'done', { code, finished: j.finished });
    });
    return json(res, 200, { id: j.id });
  }

  // --- the Garden page: golden cookie frequency, gardener by gardener (experiments/garden-frequency.mjs --json)
  if (method === 'POST' && p === '/api/garden/frequency') {
    const b = await body(req);
    const n = (v, d, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v)) || d));
    const args = ['--level', n(b.level, 8, 1, 9), '--hours', n(b.hours, 1000, 10, 20000), '--seeds', n(b.seeds, 3, 1, 20), '--tulips', (Array.isArray(b.tulips) ? b.tulips : [4, 8]).map((k) => n(k, 0, 0, 36)).join(',') || '0'].map(String);
    const key = args.join(' ');
    if (!gardenStudies.has(key)) {
      gardenStudies.set(key, gardenStudy(args));
      gardenStudies.get(key).catch(() => gardenStudies.delete(key));
    }
    return json(res, 200, await gardenStudies.get(key));
  }

  // --- the Garden page's scores: a save's game state (experiments/golden-state.mjs), its income curve
  // (experiments/golden-income.mjs, a job: seconds computed, minutes played, its progress streamed)
  if (method === 'POST' && p === '/api/garden/state') {
    const b = await body(req);
    const files = scoreFiles(b);
    try {
      return json(res, 200, JSON.parse(await runExperiment('golden-state', [...files.args, '--options'])));
    } finally {
      files.clean();
    }
  }
  if (method === 'POST' && p === '/api/garden/income') {
    const b = await body(req);
    const files = scoreFiles(b);
    // hours 0: computed (models/goldenExpected.mjs); else played that many hours a frequency
    const hours = Number(b.hours) ? Math.max(50, Math.min(20000, Math.round(Number(b.hours)))) : 0;
    const j = newJob('income', { hours });
    const how = hours ? ['--play', '--hours', String(hours)] : [];
    const child = spawn(process.execPath, [path.join(ROOT, 'sim', 'cli.mjs'), 'experiment', 'golden-income', ...files.args, ...how, '--json'], { cwd: ROOT });
    j.child = child;
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => {
      const text = String(d);
      j.lines.push(text);
      emit(j, 'out', text);
    });
    child.on('close', (code) => {
      files.clean();
      try {
        if (code !== 0) throw new Error(j.lines.join('').trim().split('\n').pop() || `golden-income exited with ${code}`);
        j.results = [JSON.parse(out)];
        j.state = 'done';
      } catch (e) {
        j.state = 'failed';
        j.lines.push(e.message);
      }
      j.finished = Date.now();
      emit(j, 'done', { code, finished: j.finished, state: j.state, results: j.results, out: j.lines.join('') });
    });
    return json(res, 200, { id: j.id });
  }

  // --- the Grimoire page: spell plans × the add-on's golden cookie gardens (experiments/grimoire-plans.mjs, a
  // job: each plan's income curve computed with the Grimoire in the model, then scored per garden)
  if (method === 'POST' && p === '/api/grimoire/plans') {
    const b = await body(req);
    const files = scoreFiles(b);
    const pops = Math.max(20000, Math.min(3000000, Math.round(Number(b.pops)) || 300000));
    const j = newJob('grimoire', { pops, sweep: !!b.sweep, follow: !!b.follow });
    const args = [...files.args, '--pops', String(pops), '--level', String(Math.max(1, Math.min(9, Math.round(Number(b.level)) || 9))), ...(b.sweep ? ['--sweep'] : []), ...(b.follow ? ['--follow', '--follow-pops', '2000000', '--follow-seeds', '3'] : []), '--json'];
    const child = spawn(process.execPath, [path.join(ROOT, 'sim', 'cli.mjs'), 'experiment', 'grimoire-plans', ...args], { cwd: ROOT });
    j.child = child;
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => {
      const text = String(d);
      j.lines.push(text);
      emit(j, 'out', text);
    });
    child.on('close', (code) => {
      files.clean();
      try {
        if (code !== 0) throw new Error(j.lines.join('').trim().split('\n').pop() || `grimoire-plans exited with ${code}`);
        j.results = [JSON.parse(out)];
        j.state = 'done';
      } catch (e) {
        j.state = 'failed';
        j.lines.push(e.message);
      }
      j.finished = Date.now();
      emit(j, 'done', { code, finished: j.finished, state: j.state, results: j.results, out: j.lines.join('') });
    });
    return json(res, 200, { id: j.id });
  }

  if (parts[1] === 'jobs' && parts[2]) {
    const j = jobs.get(parts[2]);
    if (!j) return fail(res, 404, 'No such job');
    if (method === 'GET' && !parts[3]) return json(res, 200, { kind: j.kind, meta: j.meta, state: j.state, progress: j.progress, results: j.results, out: j.lines.join(''), started: j.started, finished: j.finished });
    if (method === 'GET' && parts[3] === 'stream')
      return stream(req, res, (send) => {
        send('state', { kind: j.kind, meta: j.meta, state: j.state, progress: j.progress, results: j.results, out: j.lines.join(''), started: j.started, finished: j.finished });
        j.listeners.add(send);
        return () => j.listeners.delete(send);
      });
    if (method === 'DELETE') {
      if (j.child) j.child.kill();
      jobs.delete(j.id);
      return json(res, 200, { ok: true });
    }
  }
  return fail(res, 404, 'not found');
}
const gardenStudies = new Map(); // its arguments → the study (a promise), so the page asks once
function gardenStudy(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'sim', 'cli.mjs'), 'experiment', 'garden-frequency', ...args, '--json'], { cwd: ROOT });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => {
      try {
        if (code !== 0) throw new Error(err.trim().split('\n').pop() || `garden-frequency exited with ${code}`);
        resolve(JSON.parse(out));
      } catch (e) {
        reject(e);
      }
    });
  });
}
/** A save and a game state (the Garden page's score) in temporary files, as the experiments take them. */
function scoreFiles(b) {
  const save = String(b.save || '').trim();
  if (!save) throw Object.assign(new Error('Paste a save first (Options → Export save in the game)'), { status: 400 });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cookiesim-score-'));
  fs.writeFileSync(path.join(dir, 'save.txt'), save);
  const args = ['--save', path.join(dir, 'save.txt')];
  if (b.state && typeof b.state === 'object') {
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(b.state));
    args.push('--state', path.join(dir, 'state.json'));
  }
  return { args, clean: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
/** An experiment run to its end in a child process: its stdout. */
function runExperiment(name, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'sim', 'cli.mjs'), 'experiment', name, ...args], { cwd: ROOT });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(err.trim().split('\n').pop() || `${name} exited with ${code}`))));
  });
}
function parseSpanSeconds(s) {
  const sp = parseSpan(s);
  return (sp.seconds || 0) + 60 * (sp.minutes || 0) + 3600 * (sp.hours || 0) + 86400 * (sp.days || 0);
}

export async function startServer({ port = 8091, open = true, quiet = false } = {}) {
  await ensureGame({ quiet });
  const server = http.createServer((req, res) =>
    route(req, res).catch((e) => {
      if (!res.headersSent) fail(res, 500, e.message || String(e));
      else res.end();
    })
  );
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const url = `http://localhost:${server.address().port}`;
  if (!quiet) console.log(`CookieSimMgr — ${url}  (Ctrl+C to stop)`);
  if (open) exec(process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`);
  return { server, url, sessions, jobs };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k, d) => (process.argv.includes(`--${k}`) ? process.argv[process.argv.indexOf(`--${k}`) + 1] : d);
  startServer({ port: Number(arg('port', 8091)), open: !process.argv.includes('--no-open') }).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
