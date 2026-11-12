// v2.25.0: every built-in macro editable, with Revert to default; the interval as a number box (up
// to 50 a second for the big cookie); an Elder Pledge macro; SeasonCompletion leaves the
// Grandmapocalypse on its second Christmas visit.
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { boot, sleep, makeAssert, click } from '../harness/game.mjs';

const { assert, done } = makeAssert();
const g = boot({ idb: { factory: new IDBFactory(), IDBKeyRange } });
const { window: w, Game } = g;
const CA = w.CookieMgr;
const doc = w.document;
await sleep(400);
const M = CA.Macros;
CA.UI.Menu.openPage('clickers');
const card = (id) => doc.querySelector(`.ca-mtile[data-macro-row="${id}"]`);
const ed = () => doc.querySelector('[data-macro-editor]');
const setVal = (sel, v) => {
  const el = ed().querySelector(sel);
  el.value = v;
  el.dispatchEvent(new w.Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
};

// ---- interval: a number box
const box = () => card('bigCookie').querySelector('input[data-macro-every]');
assert(box() && box().dataset.everyAs === 'rate' && Number(box().value) === 20 && box().max === '50', 'Big cookie: times a second, 20 now, up to 50');
box().value = '40';
box().dispatchEvent(new w.Event('change', { bubbles: true }));
assert(M.everyOf(M.get('bigCookie')) === 25 && /every 0\.025s/.test(card('bigCookie').querySelector('.ca-badge').textContent), '40 a second → every 25 ms');
box().value = '500';
box().dispatchEvent(new w.Event('change', { bubbles: true }));
assert(M.everyOf(M.get('bigCookie')) === 20, 'capped at the game’s 50 a second');
const gbox = card('autoBuyer').querySelector('input[data-macro-every]');
assert(gbox.dataset.everyAs === 'rate' && card('stockTrader').querySelector('input[data-macro-every]').dataset.everyAs === 'secs', 'slower macros in seconds');

// ---- editing a built-in (v3: Golden cookies is code now — a shortcut macro with steps: Fortune news)
click(w, card('fortune').querySelector('[data-ca="macro-edit"]'));
assert(ed() && ed().querySelector('[data-edit-act="revert"]') && !ed().querySelector('[data-edit-act="delete"]') && ed().querySelector('.ca-ed-kinds'), 'Edit on a built-in: the full editor, Revert to default (no Delete)');
setVal('[data-edit="name"]', 'Goldies');
click(w, ed().querySelector('[data-edit-act="step-add"]'));
setVal('[data-edit="steps.1.action"]', 'pop.wrath');
click(w, ed().querySelector('[data-edit-act="save"]'));
let m = M.get('fortune');
assert(m.builtin && m.name === 'Goldies' && m.steps.length === 2 && m.steps[1].action === 'pop.wrath', 'saved: your version of it');
assert(M.isCustomized('fortune') && card('fortune').querySelector('.ca-badge-edited'), 'its card says “edited”');
// kept across a reload
Game.WriteSave();
const saved = Game.modSaveData.CookieMgr;
const g2 = boot({ idb: { factory: new IDBFactory(), IDBKeyRange }, save: saved });
await sleep(400);
const m2 = g2.window.CookieMgr.Macros.get('fortune');
assert(m2.name === 'Goldies' && m2.steps.length === 2 && g2.window.CookieMgr.Macros.get('bigCookie') && g2.window.CookieMgr.Macros.everyOf(g2.window.CookieMgr.Macros.get('bigCookie')) === 20, 'your version restored after a reload');
// revert
click(w, card('fortune').querySelector('[data-ca="macro-edit"]'));
click(w, ed().querySelector('[data-edit-act="revert"]'));
click(w, ed().querySelector('[data-edit-act="revert"]'));
m = M.get('fortune');
assert(m.name === 'Fortune news' && m.steps.length === 1 && !M.isCustomized('fortune') && !ed(), 'Revert to default: back to how it comes');
// favorites survive edits and reverts
M.setFav('golden', true);
M.customize('golden', { ...M.get('golden'), name: 'G' });
M.revert('golden');
assert(M.isFav('golden'), 'still a favorite after editing and reverting');
// settings count as customized too
M.setEvery('wrath', 500);
assert(M.isCustomized('wrath'), 'changed settings show as edited');
M.revert('wrath');
assert(M.everyOf(M.get('wrath')) === 100, 'and revert');

// a built-in algorithm: its code, and revert
click(w, card('seasonCompletion').querySelector('[data-ca="macro-edit"]'));
const ta = ed().querySelector('[data-code]');
assert(ta && /season\.keep\(christmas\)/.test(ta.value), 'SeasonCompletion: its code in the editor');
ta.value = ta.value.replace('forever:', 'log "my version"\nforever:');
ta.dispatchEvent(new w.Event('input', { bubbles: true }));
click(w, ed().querySelector('[data-edit-act="save"]'));
assert(/my version/.test(M.sourceOf(M.get('seasonCompletion'))) && M.isCustomized('seasonCompletion'), 'code saved');
M.revert('seasonCompletion');
assert(M.sourceOf(M.get('seasonCompletion')) === M.get('seasonCompletion').defaultSource, 'reverted');

// ---- the second Christmas visit ends the Grandmapocalypse (v4.0: Nunix late game's Reindeer stage
// switches the Elder Pledge macro on; SeasonCompletion only does the seasons)
const reindeerStage = CA.Managers.find('nunixLateGame').stages.find((st) => st.name === 'Reindeer');
assert(reindeerStage && reindeerStage.macros.elderPledge === 'on' && /season\.complete\(christmas\)/.test(reindeerStage.until), 'second Christmas visit: leaves the Grandmapocalypse');

// ---- the Elder Pledge macro
assert(card('elderPledge'), 'an Elder Pledge macro');
Game.Upgrades = { 'Elder Pledge': { name: 'Elder Pledge', unlocked: 1, bought: 0, getPrice: () => 64, buy() {
  Game.cookies -= 64;
  this.bought = 1;
  Game.elderWrath = 0;
} } };
Game.Has = (n) => !!(Game.Upgrades[n] && Game.Upgrades[n].bought);
Game.elderWrath = 2;
Game.cookies = 1000;
assert(M.runOnce('elderPledge') === 1 && Game.elderWrath === 0, 'buys the pledge while the elders are angry');
assert(M.runOnce('elderPledge') === 0, 'not while it lasts');

assert(g.errors.length + g2.errors.length === 0, 'no runtime errors' + (g.errors.length ? `: ${g.errors.slice(0, 3).join(' | ')}` : ''));
done();
process.exit();
