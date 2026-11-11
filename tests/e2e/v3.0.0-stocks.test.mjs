// v3.0.0 (stocks): the market's building blocks; the autobuyer is algorithmic code with inputs —
// checked against the JavaScript trader it replaces on hundreds of random markets (same trades,
// same bank, same brokers); its inputs on its card; old choices carried over; a copy keeps them.
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { boot, sleep, makeAssert, click } from '../harness/game.mjs';

const { assert, done } = makeAssert();
const g = boot({ idb: { factory: new IDBFactory(), IDBKeyRange } });
const { window: w, Game, M: bank, goods } = g;
const CA = w.CookieMgr;
const doc = w.document;
await sleep(400);
const M = CA.Macros;
const S = CA.Script;
const pass1 = (src) => M.runPass(S.compile(src).flow);
const logs = (F) => F.trace.map((t) => t.text.replace(/^line \d+: /, ''));

// ---- building blocks
goods.forEach((s, i) => Object.assign(s, { mode: i, stock: i * 2, val: 10 + i }));
let F = pass1('for good in stocks():\n  log good + " " + stock.mode(good) + " " + stock.held(good)');
assert(logs(F).join('|') === 'CRL 0 0|CHC 1 2|BTR 2 4|SUG 3 6|NUT 4 8', `stocks(), stock.mode, stock.held (${logs(F)})`);
F = pass1('log stock.price(CRL) + stock.price(1) + stock.price("BTR")');
assert(logs(F).join() === String(10 + 11 + 12), 'a stock by its symbol or its number');
Game.cookies = 1e9;
Game.cookiesPsRawHighest = 1000;
bank.brokers = 0;
F = pass1('log stock.cost(CRL)');
assert(Math.abs(Number(logs(F)[0].replace(/,/g, '')) - 10 * 1000 * 1.2) < 1, `stock.cost: a share in cookies with the overhead (${logs(F)})`);
goods[0].stock = 0;
F = pass1('stock.buy(CRL, 5)\nstock.sell(CHC)');
assert(goods[0].stock === 5 && goods[1].stock === 0 && F.done === 2, `stock.buy(CRL, 5), stock.sell(CHC) (${goods[0].stock}, ${goods[1].stock})`);
assert(S.lookups().some((l) => l.name === 'Stock' && l.items.some((i) => i.v === 'SUG')) && S.lookups().some((l) => l.name === 'Stock mode' && l.items.length === 6), 'Lookup: stocks and stock modes');

// ---- the autobuyer is code, with inputs (since trader profiles: Ride the trends' code is this strategy)
CA.StockTrader.use('trends');
const auto = M.get('stockTrader');
assert(auto.mode === 'flow' && M.sourceOf(auto) === CA.StockTrader.SOURCE && auto.inputs.map((i) => i.key).join() === 'buy,brokers', 'the autobuyer: algorithmic, inputs buy and brokers');
assert(!M.compiledOf(auto).errors.length, 'its code compiles (its inputs are variables)');

// ---- side by side with the JavaScript trader
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (n) => Math.floor(rnd() * n);
const grandma = Game.Objects.Grandma;
function randomMarket() {
  goods.forEach((s) => Object.assign(s, { mode: pick(6), stock: rnd() < 0.5 ? 0 : pick(40), val: 1 + rnd() * 100, active: rnd() < 0.9 }));
  Game.cookies = rnd() < 0.2 ? 0 : rnd() * 5e8;
  Game.cookiesPsRawHighest = 100 + rnd() * 5000;
  grandma.highest = pick(80);
  grandma.level = pick(3);
  bank.brokers = pick(5);
}
const snap = () => JSON.stringify({ goods: goods.map((s) => [s.stock, s.mode, s.val, s.active]), cookies: Game.cookies, brokers: bank.brokers, gh: grandma.highest, gl: grandma.level, raw: Game.cookiesPsRawHighest });
function restore(str) {
  const x = JSON.parse(str);
  goods.forEach((s, i) => Object.assign(s, { stock: x.goods[i][0], mode: x.goods[i][1], val: x.goods[i][2], active: x.goods[i][3] }));
  Object.assign(Game, { cookies: x.cookies, cookiesPsRawHighest: x.raw });
  bank.brokers = x.brokers;
  grandma.highest = x.gh;
  grandma.level = x.gl;
}
const outcome = () => JSON.stringify({ stocks: goods.map((s) => s.stock), cookies: Math.round(Game.cookies), brokers: bank.brokers });
let same = 0;
let traded = 0;
const diffs = [];
for (let trial = 0; trial < 400; trial++) {
  randomMarket();
  const buy = rnd() < 0.8;
  const brokers = rnd() < 0.8;
  const start = snap();
  const before = outcome();
  const nJs = CA.StockTrader.trade({ buy, brokers });
  if (outcome() !== before) traded++;
  const js = outcome();
  restore(start);
  M.setInput('stockTrader', 'buy', buy);
  M.setInput('stockTrader', 'brokers', brokers);
  const nCode = M.runOnce('stockTrader');
  const code = outcome();
  if (js === code && nJs === nCode) same++;
  else if (diffs.length < 3) diffs.push(`trial ${trial} (buy ${buy}, brokers ${brokers}): js ${js} ×${nJs} · code ${code} ×${nCode}`);
}
assert(same === 400, `the code trades exactly like the JavaScript trader on 400 random markets (${same} the same${diffs.length ? `; ${diffs.join(' | ')}` : ''})`);
assert(traded > 250, `…markets where it actually traded (${traded} of 400)`);
M.setInput('stockTrader', 'buy', true);
M.setInput('stockTrader', 'brokers', true);

// ---- running: trades every pass; an input changed while it runs applies at once
goods.forEach((s) => Object.assign(s, { mode: 3, stock: 0, val: 10, active: true }));
Game.cookies = 1e9;
Game.cookiesPsRawHighest = 1000;
grandma.highest = 0;
grandma.level = 0;
M.setEvery('stockTrader', 100);
M.set('stockTrader', true, { silent: true });
await sleep(250);
assert(goods.every((s) => s.stock > 0), 'on: buys the risers');
M.setInput('stockTrader', 'buy', false);
goods.forEach((s) => (s.mode = 2));
await sleep(250);
const held = goods.map((s) => s.stock).join();
goods.forEach((s) => (s.mode = 3));
await sleep(250);
M.set('stockTrader', false, { silent: true });
assert(held === '0,0,0,0,0' && goods.every((s) => s.stock === 0), `buy off while running: sells the fallers, buys nothing (${held} → ${goods.map((s) => s.stock)})`);
M.setInput('stockTrader', 'buy', true);

// ---- its inputs on its card; shift-click flips buy
CA.UI.Menu.openPage('stocks');
const row = () => doc.querySelector('[data-page="stocks"] [data-macro-row="stockTrader"]');
const brokersBox = row().querySelector('input[data-macro-input="stockTrader"][data-key="brokers"]');
assert(brokersBox && brokersBox.checked && row().querySelector('input[data-macro-input][data-key="buy"]'), 'its inputs on its row');
brokersBox.checked = false;
brokersBox.dispatchEvent(new w.Event('change', { bubbles: true }));
assert(M.inputsOf(auto).brokers === false, 'changing one there sets it');
M.setInput('stockTrader', 'brokers', true);
assert(M.shiftToggle('stockTrader') === false && M.inputsOf(auto).buy === false && M.shiftValue('stockTrader') === false, 'shift-click flips its buy input');
M.shiftToggle('stockTrader');
// the editor: its code, its inputs known
CA.UI.Menu.openPage('clickers');
CA.UI.MacrosPage.edit('stockTrader');
const ed = doc.querySelector('[data-macro-editor]');
assert(ed.querySelector('[data-code-ed][data-code-vars="buy,brokers"]') && /reads fine/.test(ed.querySelector('[data-code-status]').textContent), 'the editor knows its inputs (no “problems” for buy / brokers)');
click(w, ed.querySelector('[data-edit-act="cancel"]'));

// a copy: your own macro, its code setting the inputs first
const copy = M.duplicate('stockTrader');
assert(/^buy = true\nbrokers = true\n/.test(M.sourceOf(copy)) && !M.compiledOf(copy).errors.length && !copy.inputs, `a copy sets its inputs in its code (${JSON.stringify(M.sourceOf(copy).slice(0, 30))})`);
M.remove(copy.id);

// ---- an old save: its choices carried over
const old = JSON.parse(CA.Settings.serialize());
old.macros.prefs = { stockTrader: { params: { '0.buy': false, '0.brokers': true }, fav: true } };
const g2 = boot({ idb: { factory: new IDBFactory(), IDBKeyRange }, save: JSON.stringify(old) });
await sleep(400);
const M2 = g2.window.CookieMgr.Macros;
assert(M2.inputsOf(M2.get('stockTrader')).buy === false && M2.isFav('stockTrader'), 'a v2 save: “only sell” carried over as its input');

assert(g.errors.length + g2.errors.length === 0, 'no runtime errors' + (g.errors.length ? `: ${g.errors.slice(0, 3).join(' | ')}` : ''));
done();
process.exit();
