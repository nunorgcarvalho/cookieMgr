// v3.29.0: warnings are statistics. The three bank warnings (Lucky!, Conjure, Frenzy Lucky!) are
// built-in warning statistics with a `keep` knob; a statistic of yours can be a warning ("Shows as: a
// warning", in its color); the Tooltips page lists the warnings in use (order, remove, add, Reset);
// the catalog has a Warnings filter, and its button uses / stops a warning.
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { boot, sleep, waitFor, makeAssert, click } from '../harness/game.mjs';
import { cpsModel } from '../harness/cps.mjs';

const { assert, done } = makeAssert();
const idb = { factory: new IDBFactory(), IDBKeyRange };
const g = boot({ idb });
const { window: w, Game } = g;
const doc = w.document;
const CA = w.CookieMgr;
await sleep(400);
const ST = CA.Stats;
const SI = CA.UI.StoreInsight;
const SE = CA.UI.StatEditor;

const spec = { Cursor: [15, 0.1], Grandma: [100, 1], Farm: [1100, 8] };
Object.keys(spec).forEach((n, i) => {
  const b = Game.Objects[n];
  Object.assign(b, { id: i, basePrice: spec[n][0], free: 0, amount: 5, locked: false });
  b.tooltip = () => `<div class="name">${n}</div>`;
  const el = doc.createElement('div');
  el.id = `product${i}`;
  el.innerHTML = `<div class="price" id="productPrice${i}"></div>`;
  doc.body.appendChild(el);
});
const kitten = new Game.Upgrade('Kitten helpers', 5000);
kitten.type = 'upgrade';
Game.UpgradesInStore = [kitten];
Game.crateTooltip = (me) => `<div class="name">${me.name}</div>`;
cpsModel(Game, { base: 10, each: Object.fromEntries(Object.keys(spec).map((n) => [n, spec[n][1]])), mults: { 'Kitten helpers': 1.5 } });
Game.buyMode = 1;
Game.buyBulk = 1;
await waitFor(() => /ca-tt/.test(Game.Objects.Farm.tooltip()));
const change = (el, v) => {
  el.value = v;
  el.dispatchEvent(new w.Event('change', { bubbles: true }));
};
const type = (el, v) => {
  el.value = v;
  el.dispatchEvent(new w.Event('input', { bubbles: true }));
};
const lucky = CA.GoldenMath.lucky().bank;
const ctx = (n) => ST.contextOf(n, 'building');
const ids = (ws) => ws.map((x) => x.id).join();

// ---- the built-ins
const warns = ST.all().filter((s) => s.warn);
assert(ids(warns) === 'warnLucky,warnConjure,warnFrenzy' && warns.every((s) => s.builtin && s.group === 'Bank'), `three built-in warnings, in Bank (${ids(warns)})`);
assert(warns.map((s) => s.color).join() === 'red,orange,yellow', 'in their colors');
assert(!SI.LINES.some((l) => /^warn/.test(l.id)), 'not tooltip lines');
assert(SI.warningList().join() === 'warnLucky,warnConjure,warnFrenzy' && SI.warningsDefault(), 'in use by default, smallest bank first');
assert(CA.UI.CodeKnobs.scan(ST.get('warnLucky').source).some((k) => k.name === 'keep'), 'a keep knob: the threshold');
assert(CA.Script.VALUES.some((v) => v.id === 'stat.warnLucky'), 'a value word too');

// ---- off: nothing; on: the Grandma tips a Lucky! bank
Game.cookies = lucky + 50;
assert(SI.warnings(ctx('Grandma')).length === 0, 'off: no warnings');
CA.Settings.set('storeWarnings', true);
const ws = SI.warnings(ctx('Grandma'));
assert(ids(ws) === 'warnLucky' && ws[0].color === 'red' && ws[0].label === 'Lucky! bank', `on: the Lucky! one (${ids(ws)})`);
assert(SI.warnings(ctx('Cursor')).length === 0, 'a cheap buy: none');
SI.paint();
assert(doc.querySelector('#product1 > .ca-bank-mark.ca-pp-bg-red') && !doc.querySelector('#product0 > .ca-bank-mark'), 'the store’s mark');
assert(/ca-tt-bank-red">Lucky! bank <small>−/.test(Game.Objects.Grandma.tooltip()), 'the tooltip’s tag');

// ---- the threshold, customized: keep half the bank → the Grandma no longer breaks it
ST.update('warnLucky', { source: CA.UI.CodeKnobs.setIn(ST.get('warnLucky').source, 'keep', 0.5) });
assert(ST.get('warnLucky').customized && SI.warnings(ctx('Grandma')).length === 0, 'keep = 0.5: no warning');
ST.remove('warnLucky');
assert(!ST.get('warnLucky').customized, 'back to the original');

// ---- one of yours, from the editor
// v3.43: the warnings in use are on the Settings page; the editor on the Statistics page
let pageId = 'settings';
const goTo = async (id) => {
  pageId = id.split(':')[0];
  CA.UI.Menu.openPage(id);
  await sleep(30);
};
await goTo('settings:store');
const page = () => doc.querySelector(`[data-page="${pageId}"]`);
const ed = () => page().querySelector('[data-stat-editor]');
const twRows = () => [...page().querySelectorAll('[data-tw-row]')];
assert(twRows().length === 3 && /Lucky! bank/.test(twRows()[0].textContent) && twRows()[0].querySelector('.ca-tl-color.red'), 'the page: the warnings in use, with their colors');
assert(/−/.test(page().querySelector('[data-tw-val="0"]').textContent), `with their value now (${page().querySelector('[data-tw-val="0"]').textContent})`);
await goTo('tooltips');
click(w, page().querySelector('[data-st-new]'));
change(ed().querySelector('[data-se="warn"]'), 'yes');
assert(SE.draft().warn && SE.draft().color === 'red' && !ed().querySelector('[data-se="scope"] option[value="game"]'), 'Shows as: a warning (red; never about the game)');
type(ed().querySelector('[data-se="label"]'), 'Under ten hours');
change(ed().querySelector('[data-se="color"]'), 'blue');
type(ed().querySelector('[data-code-ed="stat"] [data-code]'), 'left = cookies() - item.price()\nif left < cps() * 36000:\n  return "<10h of CpS left"');
change(ed().querySelector('[data-se-item]'), 'b:Cursor');
assert(ed().querySelector('.ca-se-warn .ca-tt-bank-blue') && /<10h of CpS left/.test(ed().querySelector('.ca-se-warn').textContent), 'the result: as its tag');
click(w, ed().querySelector('[data-se-act="save"]'));
const mine = ST.all().find((s) => s.label === 'Under ten hours');
assert(mine && mine.warn && mine.color === 'blue' && SI.warningList().slice(-1)[0] === mine.id, 'saved, and in use at the end');
assert(ids(SI.warnings(ctx('Cursor'))) === mine.id, 'it warns about the Cursor');
assert(/# warn: yes/.test(ST.toText(mine)) && ST.fromText(ST.toText(mine)).warn === true, 'as text, and back');

// ---- the list: up, remove, add, reset
await goTo('settings:store');
click(w, page().querySelector('[data-tw-up="3"]'));
assert(SI.warningList()[2] === mine.id, 'moved up');
SI.paint();
Game.cookies = lucky + 50;
SI.paint();
assert(ids(SI.warnings(ctx('Grandma'))) === `warnLucky,${mine.id}`, 'both, in order');
click(w, page().querySelector('[data-tw-del="0"]'));
assert(!SI.warningList().includes('warnLucky'), 'removed');
SI.paint();
assert(doc.querySelector('#product1 > .ca-bank-mark.ca-pp-bg-blue'), 'the mark: the first that warns (blue)');
change(page().querySelector('[data-tw-add]'), 'warnLucky');
assert(SI.warningList().slice(-1)[0] === 'warnLucky', 'added back, at the end');

// ---- the catalog: a Warnings filter; its button stops / uses one
await goTo('tooltips');
click(w, page().querySelector('[data-st-filter="warnings"]'));
const cards = [...page().querySelectorAll('[data-st-card]')];
assert(cards.length === 4 && cards.every((c) => /⚠ warning/.test(c.textContent)), `the Warnings filter (${cards.length})`);
const btn = () => page().querySelector('[data-st-tt="warnConjure"]');
assert(/warning on/.test(btn().textContent), 'in use: ✓');
click(w, btn());
assert(!SI.warningList().includes('warnConjure') && /use as a warning/.test(btn().textContent), 'stopped');
click(w, btn());
assert(SI.warningList().includes('warnConjure'), 'used again');
await goTo('settings:store');
click(w, page().querySelector('[data-tw-reset]'));
assert(SI.warningsDefault() && SI.warningList().join() === 'warnLucky,warnConjure,warnFrenzy', 'Reset: the three bank warnings');

// ---- deleting yours takes it out of the warnings
SI.setWarnings(SI.warningList().concat([mine.id]));
await goTo('tooltips');
click(w, page().querySelector('[data-st-filter="yours"]'));
const del = page().querySelector(`[data-st-del="${mine.id}"]`);
click(w, del);
click(w, page().querySelector(`[data-st-del="${mine.id}"]`));
assert(!ST.get(mine.id) && !SI.warningList().includes(mine.id), 'deleted, and gone from the warnings');

// ---- saved with the game
const again = ST.add({ label: 'Mine to keep', warn: true, color: 'purple', source: 'return "x"' });
SI.setWarnings(['warnFrenzy', again.id]);
Game.WriteSave();
const raw = Game.modSaveData.CookieMgr;
w.localStorage.clear();
w.close();
const g2 = boot({ idb, save: raw });
await sleep(400);
const C2 = g2.window.CookieMgr;
const back = C2.Stats.get(again.id);
assert(back && back.warn && back.color === 'purple' && C2.UI.StoreInsight.warningList().join() === `warnFrenzy,${again.id}`, 'restored after a reload');
g2.window.close();

assert(g.errors.length === 0, 'no runtime errors' + (g.errors.length ? `: ${g.errors.slice(0, 3).join(' | ')}` : ''));
done();
process.exit();
