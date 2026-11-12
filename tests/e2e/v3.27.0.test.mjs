// v3.27.0: the Tooltips page (ui/tooltipsPage.js) — the store tooltip's layout in fixed columns with
// each line's value now (drag a row, or ↑ ↓ ✕), live previews; the catalog of statistics (filter,
// search, add to the tooltip, duplicate, delete yours); the Values list; and the Statistic widget (one
// statistic, live, about the best item or one you pick). The Payback page keeps the two switches.
import { boot, sleep, waitFor, makeAssert, click } from '../harness/game.mjs';
import { cpsModel } from '../harness/cps.mjs';

const { assert, done } = makeAssert();
const g = boot({});
const { window: w, Game } = g;
const doc = w.document;
const CA = w.CookieMgr;
await sleep(400);
const ST = CA.Stats;
const SI = CA.UI.StoreInsight;

const spec = { Cursor: [15, 0.1], Grandma: [100, 1], Farm: [1100, 8] };
Object.keys(spec).forEach((n, i) => {
  const b = Game.Objects[n];
  Object.assign(b, { id: i, basePrice: spec[n][0], free: 0, amount: 5, locked: false });
  b.tooltip = () => `<div class="name">${n}</div>`;
});
const kitten = new Game.Upgrade('Kitten helpers', 5000);
kitten.type = 'upgrade';
Game.UpgradesInStore = [kitten];
Game.crateTooltip = (me) => `<div class="name">${me.name}</div>`;
cpsModel(Game, { base: 1000, each: Object.fromEntries(Object.keys(spec).map((n) => [n, spec[n][1]])), mults: { 'Kitten helpers': 1.5 } });
Game.cookies = 1e4;
Game.buyMode = 1;
Game.buyBulk = 1;
await waitFor(() => /ca-tt/.test(Game.Objects.Farm.tooltip()));
const change = (el, v) => {
  el.value = v;
  el.dispatchEvent(new w.Event('change', { bubbles: true }));
};

// ---- the page
const items = [...doc.querySelectorAll('#CookieMgrTab [data-tab-item]')].map((i) => i.dataset.tabItem);
assert(items.indexOf('tooltips') === items.indexOf('clickers') - 1, `a Tooltips page, right before Macros (v4.0) (${items})`);
// v3.43: the layout is on the Settings page; the catalog on the Statistics page (id still 'tooltips')
let pageId = 'settings';
const goTo = async (id) => {
  pageId = id.split(':')[0];
  CA.UI.Menu.openPage(id);
  await sleep(30);
};
CA.UI.StoreInsight.setLines(['bonus', 'actualGain', 'payback', 'actual', 'afford', 'share', 'next', 'nextUpgrade', 'wins']); // the lines before tooltip layouts changed the Default
await goTo('settings:store');
const page = () => doc.querySelector(`[data-page="${pageId}"]`);
const rows = () => [...page().querySelectorAll('[data-tl-lines] .ca-tl-row')];
assert(rows().length === SI.lines().length, `a row per line (${rows().length})`);
assert(rows().every((r) => r.children.length === 9), 'every row: the same nine columns (grip, #, name, about, now, format, ↑ ↓ ✕)');
assert(page().querySelector('.ca-tl-cols'), 'column heads');
const valOf = (id) => {
  const i = SI.lines().indexOf(id);
  return page().querySelector(`[data-tl-val="${i}"]`);
};
const best = ST.bestOf('building');
assert(best && best.kind === 'building', `the best building (${best && best.name})`);
assert(valOf('payback').textContent === CA.Format.payback(best.r.pp) && valOf('payback').classList.contains(`ca-pp-${best.r.color}`), `a line’s value now, in its color (${valOf('payback').textContent})`);
assert(/Kitten helpers/.test(page().querySelector('[data-tl-preview]').textContent), 'the previews: a building, the best upgrade');
// pick the previewed building: the values follow
change(page().querySelector('[data-tl-b]'), 'Cursor');
const cur = ST.contextOf('Cursor', 'building');
assert(valOf('payback').textContent === CA.Format.payback(cur.r.pp), 'pick a building: the values are its');

// ---- drag a row
const drag = (type, el, y) => {
  const e = new w.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'clientY', { value: y });
  el.dispatchEvent(e);
};
const before = SI.lines().slice();
drag('dragstart', rows()[0], 0);
drag('dragover', rows()[2], 5);
assert(rows()[2].classList.contains('drop-below') && rows()[0].classList.contains('dragging'), 'dragging: where it lands shows');
drag('drop', rows()[2], 5);
drag('dragend', rows()[0], 5);
assert(JSON.stringify(SI.lines()) === JSON.stringify([before[1], before[2], before[0], ...before.slice(3)]), `drop it below the third: it moves there (${SI.lines()})`);
assert(page().querySelector('[data-tl-reset]'), 'changed: Reset');
click(w, page().querySelector('[data-tl-reset]'));
assert(SI.isDefault(), 'Reset: Cookie Monster’s layout');

// ---- the switches here
const warn = CA.Settings.get('storeWarnings');
click(w, page().querySelector('[data-tl-opt="storeWarnings"]'));
assert(CA.Settings.get('storeWarnings') === !warn, 'the Bank warnings switch');
click(w, page().querySelector('[data-tl-opt="storeWarnings"]'));
assert(CA.Settings.get('storeWarnings') === warn, '…and back');

// ---- the catalog
await goTo('tooltips');
const cards = () => [...page().querySelectorAll('[data-st-card]')];
assert(cards().length === ST.all().length, `a card per statistic (${cards().length})`);
const card = (id) => page().querySelector(`[data-st-card="${id}"]`);
assert(card('payback').querySelector('.ca-code-hl .hv') && /item\.payback/.test(card('payback').textContent), 'its code, colored');
assert(card('payback').querySelector('[data-st-val="payback"]').textContent === CA.Format.payback(cur.r.pp), 'its value for the previewed building');
assert(/stat\.payback\(item\)/.test(card('payback').textContent), 'how to call it from a macro');
assert(card('click').querySelector('.ca-st-live span').textContent === 'Kitten helpers', 'an upgrade’s: about the best upgrade');
const bulks = card('bulks');
assert(bulks.querySelector('details.ca-st-more') === null || bulks.querySelector('.ca-st-code'), 'long code: behind "more"');
assert(card('bonus').querySelector('details.ca-st-more'), 'the long built-in (Bonus income): folded');
// filters
click(w, page().querySelector('[data-st-filter="Payback"]'));
assert(cards().map((c) => c.dataset.stCard).join() === 'payback,actual,paybackRaw,paybackCps,paybackClicking,paybackModes,paybackParts,income,bulks', `the Payback group (v3.43: + the payback modes' lines) (${cards().map((c) => c.dataset.stCard)})`);
click(w, page().querySelector('[data-st-filter="yours"]'));
assert(cards().length === 0 && /duplicate a statistic/.test(page().querySelector('[data-st-body]').textContent), 'none of yours yet: says how');
click(w, page().querySelector('[data-st-filter="all"]'));
const search = page().querySelector('[data-st-search]');
search.value = 'share';
search.dispatchEvent(new w.Event('input', { bubbles: true }));
assert(cards().map((c) => c.dataset.stCard).join() === 'bonus,share', `search: label, description, code (${cards().map((c) => c.dataset.stCard)})`);
search.value = '';
search.dispatchEvent(new w.Event('input', { bubbles: true }));
// in the tooltip, one click
const tt = (id) => card(id).querySelector(`[data-st-tt="${id}"]`);
assert(tt('paybackRaw').classList.contains('on') && !tt('bulks').classList.contains('on'), 'which are in the tooltip');
click(w, tt('bulks'));
assert(SI.lines()[SI.lines().length - 1] === 'bulks' && tt('bulks').classList.contains('on'), 'add one: at the end');
assert(/Payback ×1 \/ 10 \/ 100/.test(Game.Objects.Farm.tooltip()), 'the tooltip has it');
click(w, tt('bulks'));
assert(!SI.lines().includes('bulks'), 'and take it out');
// duplicate: yours
click(w, card('payback').querySelector('[data-st-dup]'));
const mine = ST.all().filter((s) => !s.builtin);
assert(mine.length === 1 && mine[0].label === 'Payback period (copy)' && mine[0].source === 'return item.payback()' && mine[0].group === 'Payback', 'Duplicate: a copy, yours');
assert(cards().length === 1 && card(mine[0].id).classList.contains('yours'), 'shown under Yours');
assert(mine[0].key === 'paybackPeriodCopy' && CA.Script.isValue('stat.paybackPeriodCopy'), 'a word of its own');
click(w, tt(mine[0].id));
const last = SI.lines()[SI.lines().length - 1];
assert(last && last.stat === mine[0].id, 'yours in the tooltip: { stat: id }');
assert(/Payback period \(copy\)/.test(Game.Objects.Farm.tooltip()), 'in the tooltip');
await goTo('settings:store');
assert(![...page().querySelectorAll('[data-tl-add] option')].some((o) => o.value === `s:${mine[0].id}`), 'the add menu: not offered again');
await goTo('tooltips');
// delete it: two clicks, and its line goes
const del = card(mine[0].id).querySelector('[data-st-del]');
click(w, del);
assert(ST.get(mine[0].id), 'Delete: armed first');
click(w, del);
assert(!ST.get(mine[0].id) && !SI.lines().some((e) => e && e.stat === mine[0].id), 'deleted, and out of the tooltip');
// the add menu offers yours
const yours = ST.add({ label: 'Price in CpS', scope: 'item', format: 'time', source: 'return item.price() / cps()' });
await goTo('settings:store');
const opt = [...page().querySelectorAll('[data-tl-add] option')].find((o) => o.value === `s:${yours.id}`);
assert(opt && opt.parentNode.label === 'Your statistics', 'the add menu: your statistics');
change(page().querySelector('[data-tl-add]'), `s:${yours.id}`);
assert(SI.lines().some((e) => e && e.stat === yours.id), 'add yours from it');
assert(rows().some((r) => /Price in CpS/.test(r.textContent)), 'its row');

// ---- values
await goTo('tooltips');
click(w, page().querySelector('[data-st-tab="values"]'));
await sleep(10);
const vrow = (id) => [...page().querySelectorAll('.ca-vl-row')].find((r) => r.querySelector('code').textContent.startsWith(`${id}(`));
assert(page().querySelectorAll('.ca-vl-row').length > 100, `every value word (${page().querySelectorAll('.ca-vl-row').length})`);
assert(page().querySelector('.ca-vl-group').textContent.startsWith('This item'), 'the item words first');
assert(vrow('item.price').querySelector('b').textContent === CA.Format.beautify(cur.r.price), `item.price(): the previewed building’s (${vrow('item.price').querySelector('b').textContent})`);
assert(vrow('cps').querySelector('b').textContent === CA.Format.beautify(Game.cookiesPs), 'cps(): the game’s');
assert(vrow('stat.paybackPeriod') || vrow('stat.payback'), 'statistics are words too');
const vs = page().querySelector('[data-st-search]');
vs.value = 'item.';
vs.dispatchEvent(new w.Event('input', { bubbles: true }));
assert([...page().querySelectorAll('.ca-vl-row code')].every((c) => /item/.test(c.parentNode.textContent)), 'search the values');
vs.value = '';
vs.dispatchEvent(new w.Event('input', { bubbles: true }));
click(w, page().querySelector('[data-st-tab="stats"]'));

// ---- the Payback page: the switches, a link here
CA.UI.Menu.openPage('payback');
await sleep(30);
const pp = doc.querySelector('[data-page="payback"]');
assert(!pp.querySelector('[data-tl-lines]') && pp.querySelector('[data-ca="goto"][data-page="tooltips"]') && pp.querySelector('[data-pp-opt="storeWarnings"]'), 'Payback: the two switches and a link to Tooltips (v3.43: the Statistics page)');

// ---- the Statistic widget
const W = CA.UI.Widgets;
assert(W.types().some((t) => t.id === 'statistic' && t.group === 'game'), 'a Statistic widget, on the Data shelf');
const box = (id) => doc.querySelector(`#CookieMgrWidgets [data-widget="${id}"]`);
const one = W.add('statistic', null, { stat: 'payback' });
W.render();
assert(box(one.id).querySelector('.ca-w-title').textContent === 'Payback period', 'named after its statistic');
const bb = ST.bestOf('building') && ST.bestOf('item');
assert(box(one.id).querySelector('.ca-w-stat b').textContent === CA.Format.payback(bb.r.pp) && new RegExp(`the best: ${bb.name}`).test(box(one.id).textContent), `about the best buy (${box(one.id).textContent})`);
one.item = 'b:Farm';
W.render();
assert(box(one.id).querySelector('.ca-w-stat b').textContent === CA.Format.payback(ST.contextOf('Farm', 'building').r.pp) && /Farm/.test(box(one.id).textContent), 'or an item you pick');
const two = W.add('statistic', null, { stat: yours.id, item: 'u:Kitten helpers' });
W.render();
assert(/Kitten helpers/.test(box(two.id).textContent) && box(two.id).querySelector('.ca-w-stat b').textContent !== '—', 'yours, about an upgrade');
const saved = W.serialize().find((x) => x.id === two.id);
assert(saved.stat === yours.id && saved.item === 'u:Kitten helpers', 'saved: { stat, item }');
W.load(W.serialize());
assert(W.get(two.id).stat === yours.id && W.get(two.id).item === 'u:Kitten helpers', '…and loaded');
ST.remove(yours.id);
W.render();
assert(/gone/.test(box(two.id).textContent), 'its statistic deleted: says so, no crash');
CA.UI.Menu.openPage('widgets');
await sleep(30);
const shelf = doc.querySelector('[data-page="widgets"] [data-w-shelf="game"]');
assert(shelf && /Data/.test(shelf.textContent) && shelf.querySelector('.ca-wtile[data-w-tile="statistic"]') && shelf.querySelector('.ca-wtile[data-w-tile="stats"]'), 'the picker: Statistic on the Data shelf, beside Quick stats');
W.openSettings(one.id);
await sleep(30);
const sel = doc.querySelector('[data-w-editor] select[data-w-opt="stat"]');
const about = doc.querySelector('[data-w-editor] select[data-w-opt="item"]');
assert(sel && about && [...about.options].some((o) => o.value === 'b:Farm') && [...about.options].some((o) => o.value === 'u:Kitten helpers'), 'its settings: the statistic, and what it’s about');
// the catalog's ☆ (the shared star, CA.UI.C.widgetStar)
await goTo('tooltips');
click(w, page().querySelector('[data-st-filter="all"]'));
const star = () => card('share').querySelector('[data-w-star]');
assert(star() && !star().classList.contains('on'), 'a ☆ on each card');
click(w, star());
assert(W.list().some((x) => x.type === 'statistic' && x.stat === 'share' && x.item === undefined), '☆: a Statistic widget, about the best');
assert(star().classList.contains('on'), '★: it’s on the panel');
assert(/On screen\s*2/.test(page().querySelector('[data-st-filter="onscreen"]').textContent), `the On screen count follows (${page().querySelector('[data-st-filter="onscreen"]').textContent})`);
click(w, page().querySelector('[data-st-filter="onscreen"]'));
assert(cards().map((c) => c.dataset.stCard).join() === 'payback,share', `On screen: the starred (${cards().map((c) => c.dataset.stCard)})`);
click(w, star());
assert(!W.list().some((x) => x.type === 'statistic' && x.stat === 'share') && !card('share'), '★ again: taken away, and out of On screen');
click(w, page().querySelector('[data-st-filter="all"]'));

assert(g.errors.length === 0, 'no runtime errors' + (g.errors.length ? `: ${g.errors.slice(0, 3).join(' | ')}` : ''));
done();
process.exit();
