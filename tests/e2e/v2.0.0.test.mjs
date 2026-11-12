// v2.0.0: macros — hotkey → macro(s) → action(s), built-ins, editor, status, migration of v1 saves.
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { boot, sleep, makeAssert, click } from '../harness/game.mjs';

const { assert, done } = makeAssert();
const browser = { factory: new IDBFactory(), IDBKeyRange };

// a save written by v1.6: old hotkey ids, old running-state shape
const v1save = JSON.stringify({
  v: 1,
  options: { rememberStates: true, notifications: false },
  hotkeys: { 'clicker.golden': 'KeyH', 'clicker.stockTrader': 'KeyT' },
  clickers: { bigCookie: false, golden: true, wrath: false },
  stockTrader: true,
});
const g = boot({ idb: browser, save: v1save });
const { window: w, Game, M, goods } = g;
const CA = w.CookieMgr;
const doc = w.document;
const key = (code, opts = {}) => w.dispatchEvent(new w.KeyboardEvent('keydown', { code, bubbles: true, ...opts }));
await sleep(300);

// ---- built-ins + migration
const ids = CA.Macros.list().map((m) => m.id);
assert(['bigCookie', 'golden', 'wrath', 'reindeer', 'fortune', 'wrinklers', 'stockTrader', 'sellAll'].every((id) => ids.includes(id)), `built-in macros (${ids})`);
assert(CA.Macros.list().every((m) => m.builtin), 'all built-in so far');
assert(CA.Macros.isOn('golden') && CA.Macros.isOn('stockTrader') && !CA.Macros.isOn('bigCookie'), 'v1 running states restored into macros');
assert(CA.Settings.getHotkey('macro.golden') === 'KeyH' && CA.Settings.getHotkey('macro.stockTrader') === 'KeyT', 'v1 hotkeys migrated to macro ids');
assert(CA.Settings.getHotkey('macro.wrath') === 'KeyW', 'default keys');

// ---- hotkey → macro
key('KeyH');
assert(!CA.Macros.isOn('golden'), 'hotkey toggles its macro off');
CA.Settings.setHotkey('macro.wrath', 'KeyH');
const shared = CA.Settings.setHotkey('macro.reindeer', 'KeyH');
assert(shared.includes('macro.golden') && shared.includes('macro.wrath'), 'binding a used key shares it (nothing unbound)');
key('KeyH');
assert(CA.Macros.isOn('golden') && CA.Macros.isOn('wrath') && CA.Macros.isOn('reindeer'), 'one hotkey → several macros');
key('KeyH');
assert(!CA.Macros.isOn('golden') && !CA.Macros.isOn('wrath'), 'and off again');

// ---- repeat macro runs its action + status
const hand0 = Game.handmadeCookies;
CA.Macros.set('bigCookie', true);
await sleep(400);
assert(Game.handmadeCookies - hand0 >= 50, `big cookie macro clicks (${Game.handmadeCookies - hand0})`);
const st = CA.Macros.status('bigCookie');
assert(st.steps[0].total >= 5 && st.runs >= 5, 'per-step status counts');
CA.Macros.set('bigCookie', false);

// golden pops through the action
let popped = 0;
Game.shimmers.push({ type: 'golden', wrath: 0, pop() { popped++; Game.shimmers.splice(Game.shimmers.indexOf(this), 1); } });
CA.Macros.set('golden', true);
await sleep(250);
// v3: the Golden cookies macro is code (shimmer blocks) — what it did is its run's count
assert(popped === 1 && CA.Macros.flowStatus('golden').done === 1, 'pops the golden cookie');

// ---- All autoclickers: removed in v2.19 (group macros do it)
assert(!CA.Hotkeys.get('clickers.toggleAll'), 'no All autoclickers hotkey (v2.19)');

// ---- once macro: Sell all
M.buyGood(0, 5);
M.buyGood(1, 5);
CA.Macros.trigger('sellAll');
assert(goods.every((x) => x.stock === 0), 'Sell all macro sells everything');
assert(!CA.Macros.isOn('stockTrader'), 'and switched the autobuyer off first');
assert(CA.Macros.status('sellAll').steps[1].total === 2, 'sold count in status');

// ---- Macros page
CA.UI.Menu.openPage('clickers');
await sleep(50);
const page = doc.querySelector('[data-page="clickers"]');
assert(doc.querySelector('#CookieMgrTab [data-tab-item="clickers"] .ca-tab-label').textContent === 'Macros', 'sidebar says Macros');
assert(page.querySelectorAll('[data-macro-row]').length === CA.Macros.list().length, 'a row per macro');
click(w, page.querySelector('[data-macro-row="bigCookie"] [data-ca="macro-toggle"]'));
assert(CA.Macros.isOn('bigCookie'), 'row switch toggles the macro');
await sleep(600);
CA.UI.MacrosPage.sync(page);
const block = page.querySelector('[data-macro-row="bigCookie"] [data-macro-status]'); // v2.19: on its card
assert(/Click the big cookie/.test(block.textContent) && /clicks/.test(block.textContent), `a running card shows the action status (${block.textContent.slice(0, 80)})`);
assert(page.querySelector('[data-macro-row="bigCookie"]').classList.contains('on'), 'row marked on');
click(w, page.querySelector('[data-macro-row="bigCookie"] [data-ca="macro-toggle"]'));
assert(page.querySelector('[data-macro-row="sellAll"] [data-ca="macro-run"]'), 'once macros get a Run button');

// favorites
click(w, page.querySelector('[data-macro-row="golden"] [data-ca="macro-fav"]'));
assert(CA.Macros.isFav('golden'), 'favorite star');

// ---- editor: new "when" macro
const pg = () => doc.querySelector('[data-page="clickers"]');
click(w, pg().querySelector('[data-ca="macro-new"]'));
let ed = pg().querySelector('[data-macro-editor]');
assert(ed, 'New macro opens the editor');
click(w, ed.querySelector('[data-edit-act="save"]'));
ed = pg().querySelector('[data-macro-editor]');
assert(/name/i.test(ed.querySelector('.ca-editor-error').textContent), 'validation: name required');
const setInput = (sel, val) => {
  const el = pg().querySelector(sel);
  if (el.type === 'checkbox') el.checked = val;
  else el.value = val;
  el.dispatchEvent(new w.Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
};
setInput('[data-edit="name"]', 'Frenzy clicker');
click(w, pg().querySelector('[data-edit-act="mode"][data-val="when"]'));
assert(pg().querySelector('[data-edit="when.all.0.cond"]'), 'when-mode shows the condition editor');
setInput('[data-edit="when.all.0.params.name"]', 'Frenzy');
setInput('[data-edit="steps.0.action"]', 'macro.set');
assert(pg().querySelector('[data-edit="steps.0.params.macro"]'), 'action params appear for the chosen action');
setInput('[data-edit="steps.0.params.macro"]', 'bigCookie');
setInput('[data-edit="steps.0.params.to"]', 'on');
click(w, pg().querySelector('[data-edit-act="step-add"]'));
setInput('[data-edit="steps.1.action"]', 'pop.wrinklers');
click(w, pg().querySelector('[data-edit-act="step-up"][data-val="1"]'));
click(w, pg().querySelector('[data-edit-act="save"]'));
const mine = CA.Macros.list().filter((m) => !m.builtin);
assert(mine.length === 1 && mine[0].name === 'Frenzy clicker' && mine[0].mode === 'when', 'macro saved');
assert(mine[0].steps[0].action === 'pop.wrinklers' && mine[0].steps[1].action === 'macro.set', 'step order kept');
assert(mine[0].when.all[0].cond === 'buff' && mine[0].when.all[0].params.name === 'Frenzy', 'condition saved');
assert(!pg().querySelector('[data-macro-editor]') && pg().querySelector(`[data-macro-row="${mine[0].id}"]`), 'editor closes; row listed under Your macros');

// run it
CA.Macros.set(mine[0].id, true);
await sleep(300);
assert(!CA.Macros.isOn('bigCookie'), 'condition not met yet');
Game.buffs.Frenzy = { name: 'Frenzy', time: 300, maxTime: 300, multCpS: 7 };
await sleep(400);
assert(CA.Macros.isOn('bigCookie'), 'when Frenzy starts, the macro switches Big cookie on');
CA.Macros.set('bigCookie', false);
await sleep(400);
assert(!CA.Macros.isOn('bigCookie'), '"rise" fires once per occurrence, not on every check');
delete Game.buffs.Frenzy;
CA.Macros.set(mine[0].id, false);

// hotkey for a custom macro
CA.Settings.setHotkey(`macro.${mine[0].id}`, 'Shift+KeyM');
key('KeyM', { shiftKey: true });
assert(CA.Macros.isOn(mine[0].id), 'custom macro has a hotkey');
key('KeyM', { shiftKey: true });

// state condition
assert(CA.Conditions.test({ cond: 'state', params: { state: 'cookies', op: '>=', value: 1 } }), 'state condition (cookies ≥ 1)');
assert(!CA.Conditions.test({ cond: 'state', params: { state: 'cookies', op: '<', value: 1 } }), 'state condition false');
assert(CA.Conditions.test({ cond: 'buff', params: { name: 'Frenzy' }, not: true }), 'negated condition');

// duplicate a built-in; edit; delete
click(w, pg().querySelector('[data-macro-row="wrath"] [data-ca="macro-dup"]'));
ed = pg().querySelector('[data-macro-editor]');
assert(ed && pg().querySelector('[data-edit="name"]').value === 'Wrath cookies (copy)', 'duplicate opens an editable copy');
click(w, pg().querySelector('[data-edit-act="cancel"]'));
const copy = CA.Macros.list().find((m) => m.name === 'Wrath cookies (copy)');
assert(copy && !copy.builtin && copy.mode === 'flow' && /shimmer\.pop\(s\)/.test(copy.source), 'copy saved as your own (v3: its code)');
// v2.25: built-ins can be edited (your version over the original), never removed
const ed2 = CA.Macros.save({ ...CA.Macros.get('golden'), name: 'Mine now' });
assert(ed2 && ed2.builtin && ed2.name === 'Mine now' && !CA.Macros.remove('golden'), 'built-ins can be edited, not removed');
CA.Macros.revert('golden');
click(w, pg().querySelector(`[data-macro-row="${copy.id}"] [data-ca="macro-edit"]`));
const del = pg().querySelector('[data-edit-act="delete"]');
click(w, del);
assert(CA.Macros.get(copy.id), 'delete needs a second click');
click(w, pg().querySelector('[data-edit-act="delete"]'));
assert(!CA.Macros.get(copy.id), 'deleted');

// recursion guard
const a = CA.Macros.save({ name: 'A', mode: 'once', steps: [{ action: 'macro.run', params: { macro: 'x' } }] });
const b = CA.Macros.save({ name: 'B', mode: 'once', steps: [{ action: 'macro.run', params: { macro: a.id } }] });
CA.Macros.save({ ...CA.Macros.get(a.id), steps: [{ action: 'macro.run', params: { macro: b.id } }] });
CA.Macros.runOnce(a.id);
assert(true, 'macros running each other stop at the depth limit');
CA.Macros.remove(a.id);
CA.Macros.remove(b.id);

// ---- stock page + bank toolbar stay in sync
CA.UI.Menu.openPage('stocks');
await sleep(50);
const stRow = doc.querySelector('[data-page="stocks"] [data-macro-row="stockTrader"]');
assert(stRow, 'autobuyer row on the Stock market page');
click(w, stRow.querySelector('[data-ca="macro-toggle"]'));
assert(CA.Macros.isOn('stockTrader') && CA.StockTrader.isOn(), 'stock page switch = the macro');
await sleep(1100);
assert(/Autobuyer: on/.test(doc.querySelector('[data-cm-bt="auto"]').textContent) && !doc.querySelector('[data-cm-bt="auto"]').classList.contains('bankButtonOff'), 'Bank toolbar shows it on');

// ---- ascension
CA.Macros.set('golden', true);
CA.Events.emit('ascend');
assert(!CA.Macros.isOn('golden') && !CA.Macros.isOn('stockTrader'), 'ascending stops every macro (v2.13: the autobuyer too)');
CA.Macros.set('stockTrader', true, { silent: true });

// ---- save / reload
CA.Settings.set('rememberStates', true);
CA.Macros.set(mine[0].id, true);
Game.WriteSave();
const saved = Game.modSaveData.CookieMgr;
const data = JSON.parse(saved);
assert(Array.isArray(data.macros.custom) && data.macros.custom.length === 1 && data.macros.prefs.golden.fav, 'save holds your macros and favorites');
assert(data.running.includes(mine[0].id) && data.running.includes('stockTrader'), 'save holds running macros');
w.localStorage.clear();
g.window.close();

const g2 = boot({ idb: browser, save: saved });
await sleep(300);
const CB = g2.window.CookieMgr;
const m2 = CB.Macros.list().filter((m) => !m.builtin);
assert(m2.length === 1 && m2[0].name === 'Frenzy clicker' && m2[0].steps.length === 2, 'custom macro survives a reload');
assert(CB.Macros.isOn(m2[0].id) && CB.Macros.isOn('stockTrader'), 'running macros restored');
assert(CB.Settings.getHotkey(`macro.${m2[0].id}`) === 'Shift+KeyM' && CB.Macros.isFav('golden'), 'its hotkey and favorites too');
g2.window.close();

assert(g.errors.length === 0 && g2.errors.length === 0, 'no runtime errors' + (g.errors.length ? `: ${g.errors.slice(0, 3).join(' | ')}` : '') + (g2.errors.length ? `: ${g2.errors[0]}` : ''));
done();
process.exit();
