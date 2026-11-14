// CookieSimMgr: the server's API (live simulations, strategies, comparisons, experiments, the
// game's pictures, the add-on's UI bundle) and the page itself — its real scripts, run in jsdom
// against the real server — on every page, with a live simulation feeding it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
import { makeAssert, sleep, click } from '../harness/game.mjs';
import { gameOrSkip } from '../harness/sim.mjs';
import { startServer } from '../../sim/gui/server.mjs';

const { assert, done } = makeAssert();
await gameOrSkip();
const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../sim/gui/public');
const STRATS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../sim/strategies');

const { server, url } = await startServer({ port: 0, open: false, quiet: true });
const get = async (p) => (await fetch(url + p)).json();
const post = async (p, b) => (await fetch(url + p, { method: 'POST', body: JSON.stringify(b || {}) })).json();

// ---- the API
const meta = await get('/api/meta');
assert(meta.simVersion && meta.addonVersion && meta.gameVersion && meta.strategies.length >= 3 && meta.experiments.length >= 3, `meta: versions, strategies, experiments (${meta.strategies.map((s) => s.name)})`);
assert(meta.vocab.actions.some((a) => a.id === 'click.bigCookie') && meta.vocab.library.length > 100 && meta.vocab.macros.some((m) => m.id === 'golden') && meta.vocab.eventTypes.golden, 'meta: CookieMgr’s vocabulary, built-in macros and event types');
const bundle = await (await fetch(url + '/cm.js')).text();
assert(/CA\.UI\.CodeEditor/.test(bundle) && /CA\.Script/.test(bundle) && /CA\.UI\.Chart/.test(bundle), 'the add-on’s UI code, bundled from src/');
assert((await fetch(url + '/styles.css')).ok, 'the add-on’s stylesheet');

const { id } = await post('/api/sessions', { start: { kind: 'fresh' }, strategy: { file: 'payback' }, seed: 4 });
assert(id, 'a live simulation, with a strategy');
await post(`/api/sessions/${id}/control`, { step: 600 });
let snap = await get(`/api/sessions/${id}/snap`);
assert(Math.round(snap.t) === 600 && snap.stats.cookiesEarned > 0 && snap.buildings.length >= 20 && snap.macros.some((m) => m.id === 'golden' && m.on) && snap.samples.length >= 50, `stepped 10 minutes: ${Math.round(snap.stats.cookiesEarned)} baked, ${snap.stats.buildings} buildings`);
assert(snap.actions.length > 0 && snap.actions.every((a) => a.id && a.t) && snap.events.some((e) => e.type === 'building' || e.type === 'achievement'), 'its latest actions and events');
const act = await post(`/api/sessions/${id}/act`, { id: 'click.bigCookie' });
assert(act.n === 1, 'an action, by its CookieMgr id');
const code = await post(`/api/sessions/${id}/code`, { source: 'building.buy(Cursor, 1)\n' });
assert(typeof code.done === 'number' && Array.isArray(code.trace), `code, one pass (${JSON.stringify(code)})`);
const bad = await post(`/api/sessions/${id}/code`, { source: 'building.buy(\n' });
assert(/line 1/.test(bad.error || ''), 'code that doesn’t compile says where');
await post(`/api/sessions/${id}/macro`, { id: 'golden', on: false });
snap = await get(`/api/sessions/${id}/snap`);
assert(!snap.macros.find((m) => m.id === 'golden').on, 'a macro switched off');
const added = await post(`/api/sessions/${id}/macro`, { source: 'log "hi"\n', every: 2000, name: 'logger' });
assert(added.id, 'code kept running as a macro');
await post(`/api/sessions/${id}/control`, { speed: 0, playing: true });
await sleep(600);
snap = await get(`/api/sessions/${id}/snap`);
assert(snap.playing && snap.t > 610, `playing at full speed (${Math.round(snap.t)} s)`);
await post(`/api/sessions/${id}/control`, { playing: false });
const save = await (await fetch(`${url}/api/sessions/${id}/save`)).text();
assert(save.length > 100 && /(!|%21)END(!|%21)/.test(save), "the save exports (as the game's Export save writes it)");
const fromSave = await post('/api/sessions', { start: { kind: 'save', save }, seed: 2 });
assert(fromSave.id, 'a new simulation from that save');
const noSave = await post('/api/sessions', { start: { kind: 'save', save: '' } });
assert(/Paste a save/.test(noSave.error || ''), 'an empty save says what to do');
const noPlans = await post('/api/grimoire/plans', { save: '' });
assert(/Paste a save/.test(noPlans.error || ''), 'the Grimoire page’s comparison asks for a save too');
const img = await fetch(url + '/game/img/icons.png');
assert(img.ok && (img.headers.get('content-type') || '').includes('png'), 'the game’s pictures, through the cache');

// strategies: save (checked by CookieMgr's compiler), delete
const nope = await (await fetch(url + '/api/strategies/zz-test.cmgr', { method: 'PUT', body: JSON.stringify({ source: 'building.buy(\n' }) })).json();
assert(/Not saved — line 1/.test(nope.error || '') && !fs.existsSync(path.join(STRATS, 'zz-test.cmgr')), 'a strategy that doesn’t compile isn’t saved');
await fetch(url + '/api/strategies/zz-test.cmgr', { method: 'PUT', body: JSON.stringify({ source: '# test\nbuy.best(all)\n' }) });
assert(fs.existsSync(path.join(STRATS, 'zz-test.cmgr')), 'one that does is saved in sim/strategies/');
await fetch(url + '/api/strategies/zz-test.cmgr', { method: 'DELETE' });
assert(!fs.existsSync(path.join(STRATS, 'zz-test.cmgr')), 'and deleted');

// a comparison and an experiment, streamed
const job = await post('/api/compare', { strategies: ['cheapest'], seeds: 1, span: '2m' });
const readStream = async (p, until, ms = 60000) => {
  const res = await fetch(url + p);
  const reader = res.body.getReader();
  let text = '';
  const t0 = Date.now();
  while (!until(text) && Date.now() - t0 < ms) {
    const { value, done: end } = await reader.read();
    if (end) break;
    text += new TextDecoder().decode(value);
  }
  reader.cancel();
  return text;
};
const cmp = await readStream(`/api/jobs/${job.id}/stream`, (t) => /event: done/.test(t));
assert(/event: result/.test(cmp) && /event: done/.test(cmp) && /"strategy":"cheapest"/.test(cmp), 'a comparison runs in child processes and streams its results');
const ex = await post('/api/experiments/garden-clover-cohort', { args: '--hours 50' });
const exOut = await readStream(`/api/jobs/${ex.id}/stream`, (t) => /event: done/.test(t));
assert(/steady/.test(exOut) && /cohort/.test(exOut), 'an experiment runs and streams its output');
const gf = await post('/api/garden/frequency', { level: 8, tulips: [4], hours: 100, seeds: 1 });
assert(gf.w === 6 && gf.h === 5 && gf.results.length === 6 && gf.results.every((r) => r.bins.length && Math.abs(r.bins.reduce((a, b) => a + b, 0) - 1) < 1e-6), `the Garden page's study: a level-8 plot (6×5), a histogram per gardener (${gf.results && gf.results.map((r) => r.id)})`);

// ---- the page: its real scripts in jsdom, against this server
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push(String((e && (e.stack || e.message)) || e)));
vc.on('error', (...a) => errors.push(a.map(String).join(' ')));
const dom = new JSDOM(fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, ''), { url: `${url}/#sim/${id}`, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
const w = dom.window;
w.fetch = (u, o) => fetch(new URL(u, url), o);
w.scrollTo = () => {}; // jsdom has no layout
w.ResizeObserver = class {
  observe() {}
  disconnect() {}
};
w.HTMLCanvasElement.prototype.getContext = function () {
  // as tests/harness/game.mjs's: every call a no-op, the few that return something returning it
  const noop = () => {};
  return new Proxy(
    {},
    {
      get: (_t, p) => (p === 'measureText' ? (s) => ({ width: String(s).length * 6 }) : p === 'createLinearGradient' || p === 'createRadialGradient' ? () => ({ addColorStop: noop }) : p === 'getImageData' ? () => ({ data: [] }) : noop),
      set: () => true,
    }
  );
};
Object.defineProperty(w.HTMLCanvasElement.prototype, 'clientWidth', { get: () => 640 });
Object.defineProperty(w.HTMLCanvasElement.prototype, 'clientHeight', { get: () => 220 });
// the live stream: one snapshot from the server, delivered as the stream would
const streams = [];
w.EventSource = class {
  constructor(u) {
    this.u = u;
    this.l = {};
    this.readyState = 1;
    streams.push(this);
  }
  addEventListener(t, f) {
    this.l[t] = f;
  }
  close() {
    this.readyState = 2;
  }
  async push() {
    const m = this.u.match(/sessions\/(\w+)\/stream/);
    if (m && this.l.snap) this.l.snap({ data: JSON.stringify(await (await fetch(`${url}/api/sessions/${m[1]}/snap`)).json()) });
    const j = this.u.match(/jobs\/(\w+)\/stream/);
    if (j && this.l.state) {
      this.l.state({ data: JSON.stringify(await (await fetch(`${url}/api/jobs/${j[1]}`)).json()) });
      if (this.l.done) this.l.done({ data: '{}' });
    }
  }
};
w.eval('window.Game = { resPath: "/game/" };');
w.eval(bundle);
for (const f of ['mirrors.js', 'chart.js', 'app.js']) w.eval(fs.readFileSync(path.join(PUBLIC, f), 'utf8'));
const doc = w.document;
const $ = (s) => doc.querySelector(s);
await sleep(1500);
for (const s of streams) await s.push();
await sleep(600);
for (const s of streams) await s.push();
await sleep(300);
assert(/the simulator/.test($('[data-sim-versions]').textContent) && doc.querySelectorAll('[data-nav]').length === 7, 'the page: versions, seven pages on the beam');
assert($('[data-sim-runbar]') && /Speed/.test($('[data-sim-runbar]').textContent) && $('[data-sim-stats] .ca-stat'), 'Simulate: the run bar and the stats tiles');
assert(doc.querySelectorAll('[data-sim-bld] .sim-bld').length >= 2 && /Cursor/.test($('[data-sim-bld]').textContent), `the buildings (${doc.querySelectorAll('[data-sim-bld] .sim-bld').length})`);
assert(doc.querySelectorAll('[data-sim-macros] .sim-macro').length >= 3 && $('[data-sim-macros] .ca-switch'), 'CookieMgr’s macros, with switches');
assert(doc.querySelectorAll('[data-sim-actions] .sim-act-row').length > 0 && /click\.bigCookie/.test($('[data-sim-actions]').textContent), 'the action log');
// the add-on's own pages, hosted, on what CookieMgr recorded in the simulated game
assert(w.CA.Recorder.frames().length >= 500 && Math.abs(w.CA.Recorder.frames().at(-1).t - w.CookieSimClock.now) < 2000 && Number.isFinite(w.CA.Recorder.frames().at(-1).cps), `the add-on’s recorder holds the simulation’s frames (${w.CA.Recorder.frames().length})`);
const gh = $('[data-host="graphs"]');
assert(gh && gh.querySelectorAll('.ca-subtab').length >= 2 && gh.querySelectorAll('canvas').length >= 2 && /Cookies per second/.test(gh.textContent), 'the add-on’s Graphs page: its tabs and charts');
assert(gh.querySelector('[data-option="graphEffects"]') && /Effect shading/.test(gh.textContent), 'its options card (effect shading, event markers…)');
const eh = $('[data-host="events"]');
assert(eh && eh.querySelectorAll('.ca-ev-row').length > 0 && /Building|Achievement/.test(eh.textContent), `the add-on’s Events page, with the simulation’s events (${eh ? eh.querySelectorAll('.ca-ev-row').length : 0} rows)`);
// a tab of the hosted Graphs page: the page draws itself again (through CA.UI.Menu.render)
click(w, gh.querySelector('[data-graph-tab="prestige"]'));
await sleep(100);
assert(/prestige/i.test($('[data-host="graphs"]').textContent) && $('[data-host="graphs"] canvas'), 'its Prestige tab (prestige from the simulated game)');
assert(/Prestige/.test($('[data-host="graphs"] .ca-subtab.on').textContent), 'its tabs switch, as in the add-on');
click(w, $('[data-host="graphs"] [data-graph-tab="cookies"]'));
const opt = $('[data-host="graphs"] [data-ca="option"][data-key="graphEffects"]');
const was = w.CA.Settings.get('graphEffects');
click(w, opt);
await sleep(50);
assert(w.CA.Settings.get('graphEffects') === !was, 'its option switches work');
click(w, $('[data-host="graphs"] [data-ca="option"][data-key="graphEffects"]'));
await sleep(50);
assert($('[data-code-ed="console"]') && $('[data-doaction]').options.length > 20, 'the code console (the add-on’s code editor) and the action picker');
// a finished comparison, as the Compare page shows it
w.localStorage.setItem('CookieSimMgr.cmpJob', JSON.stringify(job.id));
w.location.hash = '#compare';
await sleep(250);
for (const s of streams) await s.push();
await sleep(200);
assert(doc.querySelectorAll('[data-ctable] tr').length === 2 && /cheapest/.test($('[data-ctable]').textContent) && $('[data-cchart]'), 'compare: a finished comparison — its table and chart');
for (const page of ['compare', 'strategies', 'garden', 'grimoire', 'experiments', 'vocab', 'sim']) {
  w.location.hash = `#${page}`;
  await sleep(250);
  assert($('[data-sim-main]').children.length > 0 && $(`[data-nav="${page}"].selected`), `${page}: renders`);
  if (page === 'strategies') {
    assert($('[data-code-ed="strat"]') && $('[data-ed-lib="strat"]') && doc.querySelectorAll('[data-sfile]').length >= 3, 'strategies: the files, the code editor and its library');
    // cheapest.cmgr has a top-level number (lowest = -1): the add-on's knobs show it, and moving one writes the code
    click(w, $('[data-sfile="cheapest.cmgr"]'));
    await sleep(100);
    const knob = $('[data-knobs="strat"] [data-knob-num="lowest"]');
    assert(knob, 'its variables as knobs (the add-on’s CodeKnobs)');
    if (knob) {
      knob.value = '-3';
      knob.dispatchEvent(new w.Event('input', { bubbles: true }));
      assert(/^lowest = -3/m.test($('[data-code-ed="strat"] [data-code]').value) && /unsaved/.test($('.ca-editor2 .ca-card-head').textContent), 'a knob writes its line of the code (unsaved)');
    }
  }
  if (page === 'vocab') assert(doc.querySelectorAll('[data-lib-insert]').length > 100 && /staging/.test($('[data-sim-main]').textContent), 'vocabulary: the library, staging words marked');
  if (page === 'compare') assert(doc.querySelectorAll('[data-cpick]').length >= 3 && $('[data-cgo]'), 'compare: strategies to pick, and Go');
  if (page === 'garden') {
    for (let i = 0; i < 120 && !$('[data-gcard]'); i++) await sleep(250);
    const cards = doc.querySelectorAll('[data-gcard]');
    assert(cards.length >= 4 && cards[0].querySelector('svg.sim-hist .sim-h-bar') && cards[0].querySelector('.sim-h-mean') && /level 8/.test($('[data-sim-main]').textContent), `garden: a histogram per gardener, with its mean, on the level-8 plot (${cards.length})`);
    assert(doc.querySelectorAll('.sim-table tr').length === cards.length + 1, 'garden: the summary table, a row per gardener');
  }
  if (page === 'experiments') assert(doc.querySelectorAll('[data-ex]').length >= 3 && $('[data-exrun]'), 'experiments: the list, and Run');
  if (page === 'grimoire') assert($('[data-grrun]') && $('[data-grsave]') && doc.querySelectorAll('[data-grsweep]').length === 2 && /spell plan/i.test($('[data-sim-main]').textContent), 'grimoire: the save, the plans to compare, and Compare');
}
assert(errors.length === 0, `no errors in the page${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);

server.close();
done();
process.exit();
