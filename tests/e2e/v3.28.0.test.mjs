// v3.28.0: the statistic editor (ui/statEditor.js) on the Tooltips page — New, Edit, Customize a
// built-in (Reset), Delete; its code name, what it's about, how it reads, its color, its group; the
// code checked as a statistic, with the knobs and a library of what a statistic can use; what it shows
// about an item you pick, and what each line did (the trace); copy as text, and Paste.
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
const SE = CA.UI.StatEditor;

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
const type = (el, v) => {
  el.value = v;
  el.dispatchEvent(new w.Event('input', { bubbles: true }));
};

// ---- the trace (CA.Script.runStat)
const comp = CA.Script.compile('t = 0\nrepeat 3 times:\n  t = t + 2\nif t > 10:\n  log "big"\nelif t > 1:\n  log t\nreturn t', { mode: 'stat', item: false, vars: [] });
const r = CA.Script.runStat(comp.flow, {}, { trace: true });
assert(r.value === 6 && r.trace.map((x) => x.line).join() === '1,2,3,3,3,4,6,7,8', `the trace: a line per step (${r.trace.map((x) => x.line)})`);
assert(r.trace[1].text === 'repeat 3 times' && r.trace[4].text === 't = 6' && r.trace[5].text === 'if: no' && r.trace[6].text === 'if: yes' && r.trace[7].text === 'log 6' && r.trace[8].text === 'return 6', `what each did (${r.trace.map((x) => x.text).join(' | ')})`);
assert(CA.Script.runStat(comp.flow, {}).trace === null, 'no trace unless asked');

// ---- the libraries: values in their groups; a statistic's has no actions
const groups = new Set(CA.Script.library().map((x) => x.group));
assert(groups.has('Values · Statistics') && groups.has('Values · Text') && groups.has('Values'), `values by group (${[...groups].filter((x) => x.startsWith('Values'))})`);
assert(CA.Script.library().some((x) => x.id === 'stat.payback' && x.group === 'Values · Statistics'), 'the macro library: statistics, as words');

// ---- New
CA.UI.Menu.openPage('tooltips');
await sleep(50);
const page = () => doc.querySelector('[data-page="tooltips"]');
const ed = () => page().querySelector('[data-stat-editor]');
click(w, page().querySelector('[data-st-new]'));
assert(SE.isOpen() && ed() && !page().querySelector('[data-st-body]'), 'New: the editor, in place of the catalog');
assert(ed().querySelector('[data-code-ed="stat"][data-code-mode="stat"][data-code-item]'), 'the code: checked as a statistic about an item');
const lib = ed().querySelector('[data-ed-lib="stat"]');
assert(lib && lib.querySelector('[data-lib-pane="words"] .ca-lib-group:not(.ca-lib-pinned) .ca-lib-ghead').textContent === 'Values · This item' && !lib.querySelector('.ca-lib-action'), 'the library: the item’s words first, no actions');
const ta = () => ed().querySelector('[data-code-ed="stat"] [data-code]');
const best = ST.bestOf('item');
const shown = () => (ed().querySelector('.ca-se-line b') || {}).textContent;
assert(shown() === CA.Format.beautify(best.r.price / Game.cookiesPs), `what it shows: about the best buy (${shown()})`);
assert(/return/.test(ed().querySelector('.ca-se-trace').textContent), 'and what it did');
// the label: the code name follows
type(ed().querySelector('[data-se="label"]'), 'Price in CpS');
assert(ed().querySelector('[data-se-call]').textContent === 'stat.priceInCps(item)', `the call follows the label (${ed().querySelector('[data-se-call]').textContent})`);
change(ed().querySelector('[data-se="format"]'), 'time');
assert(shown() === CA.Format.span(best.r.price / Game.cookiesPs), 'how it reads');
// about another item
change(ed().querySelector('[data-se-item]'), 'b:Cursor');
const cur = ST.contextOf('Cursor', 'building');
assert(shown() === CA.Format.span(cur.r.price / Game.cookiesPs), 'about an item you pick');
// broken code: says so, and won't save
type(ta(), 'return item.price( /');
assert(/problem/.test(ed().querySelector('[data-code-status]').textContent) && /Fix the code first/.test(ed().querySelector('[data-se-result]').textContent), 'broken code: the problem, and no result');
click(w, ed().querySelector('[data-se-act="save"]'));
assert(SE.isOpen() && /Fix the code first/.test(ed().querySelector('[data-se-error]').textContent) && !ST.all().some((s) => !s.builtin), 'Save: refused');
// a statistic word that's an action: not in a statistic
type(ta(), 'pop.golden()\nreturn 1');
assert(/problem/.test(ed().querySelector('[data-code-status]').textContent), 'no actions in a statistic');
// knobs
type(ta(), 'share = 0.5   # of the price\nreturn item.price() * share / cps()');
const knob = ed().querySelector('input[data-knob="share"]');
assert(knob && !ed().querySelector('[data-knob-cfg]'), 'a knob for the top-level variable (no ⚙ here)');
knob.value = '25';
knob.dispatchEvent(new w.Event('input', { bubbles: true }));
assert(/^share = 0\.25 {3}# of the price/.test(ta().value) && SE.draft().source.startsWith('share = 0.25'), `the knob writes the code (${ta().value.split('\n')[0]})`);
assert(shown() === CA.Format.span((cur.r.price * 0.25) / Game.cookiesPs), 'and the result follows');
// the trace: a line to the code
click(w, ed().querySelector('[data-se-goto="2"]'));
assert(ta().selectionStart === ta().value.indexOf('return'), 'a trace line: the cursor to it');
// save
type(ed().querySelector('[data-se="desc"]'), 'a quarter of the price, in CpS');
change(ed().querySelector('[data-se="group"]'), 'Bank');
click(w, ed().querySelector('[data-se-act="save"]'));
const mine = ST.all().filter((s) => !s.builtin);
assert(!SE.isOpen() && mine.length === 1 && mine[0].label === 'Price in CpS' && mine[0].key === 'priceInCps' && mine[0].format === 'time' && mine[0].group === 'Bank' && mine[0].desc === 'a quarter of the price, in CpS', 'Save: yours');
assert(CA.Script.isValue('stat.priceInCps') && page().querySelector(`[data-st-card="${mine[0].id}"]`), 'a word, and a card');

// ---- Edit it
click(w, page().querySelector(`[data-st-edit="${mine[0].id}"]`));
assert(ed().querySelector('[data-se="label"]').value === 'Price in CpS' && ed().querySelector('[data-se="key"]').value === 'priceInCps', 'Edit: as saved');
type(ed().querySelector('[data-se="label"]'), 'Quarter price');
assert(ed().querySelector('[data-se-call]').textContent === 'stat.priceInCps(item)', 'a saved one keeps its code name');
change(ed().querySelector('[data-se="scope"]'), 'game');
assert(!ed().querySelector('[data-se-item]') && ed().querySelector('[data-code-ed="stat"]:not([data-code-item])') && /problem/.test(ed().querySelector('[data-code-status]').textContent), 'about the game: no item, so item.* is a problem');
change(ed().querySelector('[data-se="scope"]'), 'item');
click(w, ed().querySelector('[data-se-act="save"]'));
assert(ST.get(mine[0].id).label === 'Quarter price' && ST.get(mine[0].id).key === 'priceInCps', 'saved');
// Cancel changes nothing
click(w, page().querySelector(`[data-st-edit="${mine[0].id}"]`));
type(ed().querySelector('[data-se="label"]'), 'Nope');
click(w, ed().querySelector('[data-se-act="cancel"]'));
assert(!SE.isOpen() && ST.get(mine[0].id).label === 'Quarter price', 'Cancel: as it was');

// ---- as text, and Paste
click(w, page().querySelector(`[data-st-edit="${mine[0].id}"]`));
click(w, ed().querySelector('[data-se-act="share"]'));
const text = ed().querySelector('[data-se-text]').value;
assert(text.startsWith('# cookieMgr statistic\n# label: Quarter price\n# key: priceInCps') && /# group: Bank/.test(text) && text.endsWith('return item.price() * share / cps()'), `as text (${text.split('\n').slice(0, 3).join(' / ')})`);
const back = ST.fromText(text);
assert(back.label === 'Quarter price' && back.scope === 'item' && back.format === 'time' && back.source === ST.get(mine[0].id).source, 'and back');
assert(ST.fromText('return cps()').source === 'return cps()' && ST.fromText('') === null, 'just code pastes too; nothing does not');
click(w, ed().querySelector('[data-se-act="cancel"]'));
click(w, page().querySelector('[data-st-paste]'));
page().querySelector('[data-st-pastetext]').value = text;
click(w, page().querySelector('[data-st-pasteopen]'));
assert(SE.isOpen() && SE.draft().id === null && SE.draft().label === 'Quarter price', 'Paste: a new one, in the editor');
click(w, ed().querySelector('[data-se-act="save"]'));
const two = ST.all().filter((s) => !s.builtin);
assert(two.length === 2 && two[1].key === 'priceInCps2', `saved beside it, a code name of its own (${two[1].key})`);
click(w, page().querySelector('[data-st-paste]'));
click(w, page().querySelector('[data-st-pasteopen]'));
assert(!SE.isOpen() && /Nothing to add/.test(page().textContent), 'Paste nothing: says so');
click(w, page().querySelector('[data-st-paste]'));

// ---- Delete, from the editor
SI.setLines(['payback', { stat: two[1].id }]);
click(w, page().querySelector(`[data-st-edit="${two[1].id}"]`));
const del = ed().querySelector('[data-se-act="delete"]');
click(w, del);
assert(ST.get(two[1].id), 'Delete: armed first');
click(w, ed().querySelector('[data-se-act="delete"]'));
assert(!SE.isOpen() && !ST.get(two[1].id) && JSON.stringify(SI.lines()) === '["payback"]', 'deleted, and its line');

// ---- Customize a built-in, Reset
click(w, page().querySelector('[data-st-edit="price"]'));
assert(ed().querySelector('[data-se="key"]').disabled && ed().querySelector('[data-se="scope"]').disabled && !ed().querySelector('[data-se-act="delete"]') && !ed().querySelector('[data-se-act="reset"]'), 'a built-in: its name and what it’s about stay; no Delete, nothing to reset yet');
click(w, ed().querySelector('[data-se-act="save"]'));
assert(!ST.get('price').customized, 'saved unchanged: no version of yours');
SI.setLines(['price']);
click(w, page().querySelector('[data-st-edit="price"]'));
type(ed().querySelector('[data-se="label"]'), 'Cost');
type(ta(), 'return item.price() * 2');
click(w, ed().querySelector('[data-se-act="save"]'));
assert(ST.get('price').customized && ST.get('price').label === 'Cost' && /Cost/.test(Game.Objects.Farm.tooltip()), 'customized: in the tooltip');
assert(/changed/.test(page().querySelector('[data-st-card="price"] .ca-st-head').textContent), 'the card says so');
click(w, page().querySelector('[data-st-edit="price"]'));
click(w, ed().querySelector('[data-se-act="reset"]'));
click(w, ed().querySelector('[data-se-act="reset"]'));
assert(!SE.isOpen() && !ST.get('price').customized && ST.get('price').label === 'Price' && ST.get('price').source === ST.BUILTINS.find((b) => b.id === 'price').source, 'Reset: the original');

assert(g.errors.length === 0, 'no runtime errors' + (g.errors.length ? `: ${g.errors.slice(0, 3).join(' | ')}` : ''));
done();
process.exit();
