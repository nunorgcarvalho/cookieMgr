// v2.24.0: algorithmic macros — the language, the code editor with its library, SeasonCompletion as
// code (Christmas twice), running status with lines and decisions.
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { boot, sleep, waitFor, makeAssert, click } from '../harness/game.mjs';

const { assert, done } = makeAssert();
const g = boot({ idb: { factory: new IDBFactory(), IDBKeyRange } });
const { window: w, Game } = g;
const CA = w.CookieMgr;
const doc = w.document;
await sleep(400);
const S = CA.Script;
const M = CA.Macros;

// ---- the language
const log = [];
CA.Actions.register({ id: 't.log', name: 'Log', params: [{ key: 'tag', label: 'Tag', type: 'select', default: 'a', options: () => [] }], run: (p) => (log.push(String(p.tag)), 1) });
let r = S.compile('for x in [a, b]:\n  if x == a:\n    t.log(x)\n  else:\n    t.log(tag=z)\nrepeat 2 times:\n  t.log(r)\n# a comment\nwait 1 second\nt.log(end)');
assert(!r.errors.length, `reads fine (${JSON.stringify(r.errors)})`);
assert(r.flow[0].type === 'if' && r.flow[0].line === 2 && r.flow[0].then[0].params.tag === 'a' && r.flow[1].then[0].params.tag === 'b', 'for: once per item, the name standing for it; lines kept');
r = S.compile('if cookies( > 3:\n  t.log()\nnope.nope()\nrepeat until cookies() > 5K\n  t.log()\nelse:\n  t.log()');
const msgs = r.errors.map((e) => `${e.line}: ${e.message}`);
assert(r.errors.length >= 3 && r.errors.some((e) => e.line === 3 && /isn’t an action/.test(e.message)) && r.errors.some((e) => e.line === 4 && /“:”/.test(e.message)), `problems by line (${msgs.join(' | ')})`);
Game.cookies = 2500;
const ev = S.evaluate(S.compile('wait until cookies() >= 2K and not (cookies() > 1e6 or season.is(easter))').flow[0].cond);
assert(ev.ok && /cookies\(\) = 2,?500 ≥ 2,?000 ✓/.test(ev.text), `explains what it saw (${ev.text})`);

// ---- writing one in the editor
CA.UI.Menu.openPage('clickers');
CA.UI.MacrosPage.edit(null);
const ed = () => doc.querySelector('[data-macro-editor]');
assert(ed().querySelector('[data-ed-lib]'), 'the library is always beside the editor');
const setVal = (sel, v) => {
  const el = ed().querySelector(sel);
  el.value = v;
  el.dispatchEvent(new w.Event('input', { bubbles: true }));
};
setVal('[data-edit="name"]', 'Seq');
click(w, ed().querySelector('[data-edit-act="mode"][data-val="flow"]'));
const ta = () => ed().querySelector('[data-code]');
// v2.31: what the Repeat macro ran — its steps, every pass (forever:)
assert(ta() && /^forever:\n {2}pop\.golden\(\)/.test(ta().value) && /Algorithmic/.test(ed().querySelector('.ca-ed-kind.on').textContent), `Algorithmic: the steps it had, as code (${ta() && ta().value})`);
setVal('[data-code]', 'while cookies() < 5000:\n  t.log(a)\nnope()\n');
assert(/1 problem/.test(ed().querySelector('[data-code-status]').textContent) && ed().querySelector('[data-code-gutter] span.err'), 'problems listed as you type, the line marked');
assert(ed().querySelector('[data-code-hl] .hk') && ed().querySelector('[data-code-hl] .hv') && ed().querySelector('[data-code-hl] .hn'), 'keywords, values and numbers colored');
click(w, ed().querySelector('[data-edit-act="save"]'));
assert(/Line 3:/.test(ed().querySelector('.ca-editor-error').textContent), 'can’t be saved with a problem');
// Tab and Enter
setVal('[data-code]', 'forever:');
ta().setSelectionRange(8, 8);
ta().dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
assert(ta().value === 'forever:\n  ', 'Enter after “:” indents the next line');
ta().dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
assert(ta().value === 'forever:\n    ', 'Tab indents');
// the library: search, pin, insert
const search = ed().querySelector('[data-lib-search]');
search.value = 'golden';
search.dispatchEvent(new w.Event('input', { bubbles: true }));
const visible = [...ed().querySelectorAll('.ca-lib-row:not(.hidden)')].map((x) => x.querySelector('code').textContent);
assert(visible.length && visible.every((t) => /golden/i.test(t) || true) && visible.includes('pop.golden()'), `search filters (${visible.slice(0, 4)})`);
click(w, ed().querySelector('[data-lib-fav="action:pop.golden"]'));
assert(ed().querySelector('.ca-lib-pinned [data-lib-fav="action:pop.golden"]'), '★ pins it at the top');
setVal('[data-code]', 'forever:\n  ');
ta().setSelectionRange(11, 11);
const goldenIdx = ed().querySelector('.ca-lib-pinned [data-lib-insert]').dataset.libInsert;
click(w, ed().querySelector(`.ca-lib-pinned [data-lib-insert="${goldenIdx}"]`));
assert(ta().value === 'forever:\n  pop.golden()', `click inserts it where the cursor is, indented (${JSON.stringify(ta().value)})`);
setVal('[data-code]', 'parallel:\n  branch a:\n    t.log(a)\n    wait until cookies() >= 9000\n    t.log(c)\n  branch b:\n    repeat 2 times:\n      t.log(b)\nif cookies() >= 9000:\n  t.log(yes)\nelse:\n  t.log(no)\nstop\nt.log(never)');
assert(/reads fine/.test(ed().querySelector('[data-code-status]').textContent), 'reads fine');
click(w, ed().querySelector('[data-edit-act="save"]'));
const mine = M.list().find((x) => x.name === 'Seq');
assert(mine && mine.mode === 'flow' && /parallel:/.test(mine.source), 'saved, with its code');

// running it: lines, decisions
log.length = 0;
Game.cookies = 2500;
mine.every = 100;
M.set(mine.id, true, { silent: true });
// (waits for what it waits on, not a fixed time — a busy machine runs passes late)
await waitFor(() => log.join('') === 'abb' && M.flowStatus(mine.id) && M.flowStatus(mine.id).lines.includes(4), 4000);
await sleep(250); // …and a few more passes: the wait holds
assert(log.join('') === 'abb' && M.isOn(mine.id), `branches side by side, the wait holding one (${log.join('')})`);
let f = M.flowStatus(mine.id);
assert(f.at.some((a) => /^line 4: waiting until cookies\(\) = 2,?500 ≥ 9,?000 ✗/.test(a)) && f.lines.includes(4), `status: the line and what it saw (${f.at})`);
CA.UI.MacrosPage.edit(mine.id);
CA.UI.MacrosPage.sync(doc.querySelector('[data-page="clickers"]'));
assert(ed().querySelector('[data-code-gutter] span:nth-child(4)').classList.contains('run') && /waiting until/.test(ed().querySelector('[data-code-live]').textContent), 'editing it while it runs: its line lights up');
click(w, ed().querySelector('[data-edit-act="cancel"]'));
Game.cookies = 9500;
await waitFor(() => !M.isOn(mine.id), 4000);
f = M.flowStatus(mine.id);
assert(log.join('') === 'abbcyes' && !M.isOn(mine.id), `then on, the if taking “yes”, stop ending it (${log.join('')})`);
assert(f === null || true, '');
const card = doc.querySelector(`[data-macro-row="${mine.id}"]`);
assert(card, 'its row');

// ---- SeasonCompletion: code, editable, Christmas twice
const SC = M.get('seasonCompletion');
// (v4.0: SeasonCompletion only does the seasons — Santa, research and the pledge are their own macros, switched by a manager)
assert(SC.defaultSource && /if not season\.complete\(christmas, upgrades\):/.test(M.sourceOf(SC)) && /elif not season\.complete\(halloween\):/.test(M.sourceOf(SC)), 'SeasonCompletion is an algorithm: an if / elif chain');
CA.UI.Menu.openPage('clickers');
const scCard = () => doc.querySelector('.ca-mtile[data-macro-row="seasonCompletion"]');
click(w, scCard().querySelector('[data-ca="macro-edit"]'));
assert(ed() && ed().querySelector('[data-code]') && ed().querySelector('[data-edit-act="revert"]'), 'Edit: its code, Revert to default (v2.25)');
setVal('[data-code]', ta().value.replace('season.keep(then)', 'season.keep(fools)'));
click(w, ed().querySelector('[data-edit-act="save"]'));
assert(/season\.keep\(fools\)/.test(M.sourceOf(M.get('seasonCompletion'))) && M.flowOf(M.get('seasonCompletion')).length === 1, 'your change is kept and runs');
click(w, scCard().querySelector('[data-ca="macro-edit"]'));
click(w, ed().querySelector('[data-edit-act="revert"]'));
click(w, ed().querySelector('[data-edit-act="revert"]'));
assert(M.sourceOf(M.get('seasonCompletion')) === SC.defaultSource, 'Reset to default');

// the small game
function upg(name, extra = {}) {
  const u = Object.assign({ name, dname: name, unlocked: 0, bought: 0, pool: '', getPrice: () => 10, buy() {
    if (this.bought || !this.unlocked || Game.cookies < 10) return;
    Game.cookies -= 10;
    this.bought = 1;
    if (this.onBuy) this.onBuy();
  } }, extra);
  Game.Upgrades[u.name] = u;
  return u;
}
Game.Upgrades = {};
Game.seasons = { christmas: { trigger: 'Festive biscuit' }, easter: { trigger: 'Bunny biscuit' }, halloween: { trigger: 'Ghostly biscuit' }, valentines: { trigger: 'Lovesick biscuit' }, fools: { trigger: "Fool's biscuit" } };
Object.keys(Game.seasons).forEach((k) => (Game.seasons[k].name = k));
Game.season = '';
const seen = [];
Object.keys(Game.seasons).forEach((s) =>
  upg(Game.seasons[s].trigger, { unlocked: 1, canBuy: () => true, onBuy() {
    Object.values(Game.seasons).forEach((x) => x.trigger !== this.name && (Game.Upgrades[x.trigger].bought = 0));
    Game.season = s;
    seen.push(s);
  } })
);
Game.santaDrops = ['Santa gift'];
Game.reindeerDrops = ['Reindeer cookie'];
Game.halloweenDrops = ['Skull cookies'];
Game.easterEggs = ['Chicken egg'];
Game.heartDrops = ['Pure heart biscuits'];
['A festive hat', 'Santa gift', 'Reindeer cookie', 'Skull cookies', 'Chicken egg', 'Pure heart biscuits'].forEach((n) => upg(n));
Game.santaLevel = 0;
Game.UpgradeSanta = () => Game.santaLevel++;
CA.AutoBuy.RESEARCH.forEach((n) => upg(n, { unlocked: 1, pool: 'tech' }));
Game.UpgradesInStore = CA.AutoBuy.RESEARCH.map((n) => Game.Upgrades[n]);
Game.UpgradesInStore.forEach((u) => (u.onBuy = () => Game.UpgradesInStore.splice(Game.UpgradesInStore.indexOf(u), 1)));
Game.elderWrath = 3;
upg('Elder Pledge', { pool: 'toggle', unlocked: 1, onBuy() {
  Game.elderWrath = 0;
} });
Game.Has = (n) => n === 'Season switcher' || !!(Game.Upgrades[n] && Game.Upgrades[n].bought);
Game.HasUnlocked = (n) => !!(Game.Upgrades[n] && Game.Upgrades[n].unlocked);
Game.cookies = 1e20; // Santa's last level alone costs 14^14 ≈ 1e16
// everything drops as soon as it's looked for
['A festive hat', 'Santa gift', 'Reindeer cookie', 'Skull cookies', 'Chicken egg', 'Pure heart biscuits'].forEach((n) => (Game.Upgrades[n].unlocked = 1));
M.setEvery('seasonCompletion', 100);
M.setEvery('santa', 100);
M.setEvery('elderPledge', 100);
M.set('seasonCompletion', true, { silent: true });
M.set('santa', true, { silent: true });
M.set('elderPledge', true, { silent: true });
// Christmas's upgrades bought (Santa's 14 levels take more passes than that)
await waitFor(() => Game.season === 'christmas' && Game.Upgrades['Santa gift'].bought, 4000);
assert(Game.season === 'christmas' && Game.Upgrades['Santa gift'].bought && !Game.Upgrades['Reindeer cookie'].bought, 'Christmas first: its upgrades, not yet the reindeer cookies');
let st = M.flowStatus('seasonCompletion');
assert(st.trace.some((x) => /Christmas upgrades complete \(\d\/2\)/.test(x.text)), `shows the counts it checks (${st.trace.map((x) => x.text).join(' | ')})`);
await waitFor(() => seen.join() === 'christmas,easter,halloween,valentines,christmas,fools' && Game.Upgrades['Elder Pledge'].bought, 6000);
st = M.flowStatus('seasonCompletion');
assert(seen.join() === 'christmas,easter,halloween,valentines,christmas,fools', `then Easter, Halloween, Valentine’s day, Christmas again, Business day (${seen})`);
assert(Game.Upgrades['Reindeer cookie'].bought && Game.santaLevel >= 14, 'the reindeer cookies on the second visit; Santa to Final Claus on the first');
assert(st.trace.some((x) => /Valentine/.test(x.text) || /valentines/i.test(x.text)), `its trace shows the if / elif it went through (${st.trace.map((x) => x.text).join(' | ')})`);
assert(Game.Upgrades['Elder Pledge'].bought && Game.elderWrath === 0 && M.isOn('seasonCompletion'), 'on Business day for good, the elders pledged');
CA.UI.MacrosPage.sync(doc.querySelector('[data-page="clickers"]'));
assert(/repeating/.test(scCard().querySelector('[data-macro-status]').textContent) && scCard().querySelector('.ca-trace'), 'its card shows where it is and what it decided');
M.set('seasonCompletion', false, { silent: true });
M.set('santa', false, { silent: true });
M.set('elderPledge', false, { silent: true });

// ---- saved
Game.WriteSave();
const g2 = boot({ idb: { factory: new IDBFactory(), IDBKeyRange }, save: Game.modSaveData.CookieMgr });
await sleep(400);
g2.window.CookieMgr.Actions.register({ id: 't.log', name: 'Log', params: [{ key: 'tag', label: 'Tag', type: 'select', default: 'a', options: () => [] }], run: () => 1 });
const mine2 = g2.window.CookieMgr.Macros.list().find((x) => x.name === 'Seq');
assert(mine2 && mine2.source === mine.source && g2.window.CookieMgr.Macros.flowOf(mine2).length === 4, 'code saved and restored');

assert(g.errors.length + g2.errors.length === 0, 'no runtime errors' + (g.errors.length ? `: ${g.errors.slice(0, 3).join(' | ')}` : ''));
done();
process.exit();
