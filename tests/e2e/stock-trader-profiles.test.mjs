// Stock trader profiles: the autobuyer runs the trader profile in use (code), loaded and unloaded
// like the other profiles. Trends and prices (the default) trades exactly like the rules the
// simulator study found, on hundreds of random markets; profiles are switched by id or name, from
// code and from a manager; built-ins edited and reverted, yours saved, renamed, deleted; saved with
// the game; an old save keeps Ride the trends, or its edited autobuyer code as a profile of yours;
// the Stock market page's Trader card picks, edits (knobs) and saves.
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { boot, sleep, makeAssert, click } from '../harness/game.mjs';

const { assert, done } = makeAssert();
const g = boot({ idb: { factory: new IDBFactory(), IDBKeyRange } });
const { window: w, Game, M: bank, goods } = g;
const CA = w.CookieMgr;
const doc = w.document;
await sleep(400);
const M = CA.Macros;
const T = CA.StockTrader;
const S = CA.Script;
const pass1 = (src) => M.runPass(S.compile(src).flow);
// like minigameMarket.js: a stock drifts back to 10 + 10 × its number + (Bank level − 1)
bank.getRestingVal = (id) => 10 + 10 * id;

// ---- the default: Trends and prices, as code
const auto = M.get('stockTrader');
assert(T.activeId() === 'trendsAndPrices' && M.sourceOf(auto) === T.PRICES_SOURCE, `a new game runs Trends and prices (${T.activeId()})`);
assert(!M.compiledOf(auto).errors.length, `its code compiles (${JSON.stringify(M.compiledOf(auto).errors.slice(0, 1))})`);
assert(
  T.list()
    .map((p) => p.id)
    .join() === 'trendsAndPrices,trends',
  'two built-ins: Trends and prices, Ride the trends'
);

// ---- side by side with the study's rules (sim/experiments/stock-market.mjs), in JavaScript
const I = Infinity;
const BUY_UNDER = [30, 20, 80, -I, I, 10]; // by mode: buy when resting − price > this (fast rise: always; fast fall: never)
const SELL_OVER = [40, 100, 20, I, -I, 10]; // sell when price − resting > this (fast rise: never; fast fall: always)
function reference({ buy, brokers }) {
  let n = buy && brokers ? T.hireBrokers() : 0;
  const live = goods.filter((x) => x.active !== false);
  live.forEach((x) => {
    if (x.stock > 0 && x.val - bank.getRestingVal(x.id) > SELL_OVER[x.mode] && bank.sellGood(x.id, 10000)) n++;
  });
  if (!buy) return n;
  live.forEach((x) => x.mode === 3 && bank.buyGood(x.id, 10000) && n++);
  live.forEach((x) => x.mode !== 3 && bank.getRestingVal(x.id) - x.val > BUY_UNDER[x.mode] && bank.buyGood(x.id, 10000) && n++);
  return n;
}
let seed = 777;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (n) => Math.floor(rnd() * n);
const grandma = Game.Objects.Grandma;
function randomMarket() {
  goods.forEach((x) => Object.assign(x, { mode: pick(6), stock: rnd() < 0.5 ? 0 : pick(40), val: 1 + rnd() * 160, active: rnd() < 0.9 }));
  Game.cookies = rnd() < 0.2 ? 0 : rnd() * 5e8;
  Game.cookiesPsRawHighest = 100 + rnd() * 5000;
  grandma.highest = pick(80);
  grandma.level = pick(3);
  bank.brokers = pick(5);
}
const snap = () => JSON.stringify({ goods: goods.map((x) => [x.stock, x.mode, x.val, x.active]), cookies: Game.cookies, brokers: bank.brokers, gh: grandma.highest, gl: grandma.level, raw: Game.cookiesPsRawHighest });
function restore(str) {
  const x = JSON.parse(str);
  goods.forEach((s, i) => Object.assign(s, { stock: x.goods[i][0], mode: x.goods[i][1], val: x.goods[i][2], active: x.goods[i][3] }));
  Object.assign(Game, { cookies: x.cookies, cookiesPsRawHighest: x.raw });
  bank.brokers = x.brokers;
  grandma.highest = x.gh;
  grandma.level = x.gl;
}
const outcome = () => JSON.stringify({ stocks: goods.map((x) => x.stock), cookies: Math.round(Game.cookies), brokers: bank.brokers });
let same = 0;
let traded = 0;
const diffs = [];
for (let trial = 0; trial < 400; trial++) {
  randomMarket();
  const buy = rnd() < 0.8;
  const brokers = rnd() < 0.8;
  const start = snap();
  const before = outcome();
  const nJs = reference({ buy, brokers });
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
assert(same === 400, `Trends and prices trades exactly like the study's rules on 400 random markets (${same} the same${diffs.length ? `; ${diffs.join(' | ')}` : ''})`);
assert(traded > 250, `…markets where it actually traded (${traded} of 400)`);
M.setInput('stockTrader', 'buy', true);
M.setInput('stockTrader', 'brokers', true);

// ---- switching: by id or name, from code, from a manager
assert(T.use('Ride the trends') === 1 && T.activeId() === 'trends' && M.sourceOf(auto) === T.SOURCE, 'use() by name: the autobuyer runs Ride the trends');
assert(T.use('trends') === 0, '…already in use: nothing to do');
let F = pass1('stocks.profile(trendsAndPrices)\nlog stocks.activeProfile()\nlog stocks.profileActive("Trends and prices")\nlog stocks.profiles()');
const logs = F.trace.map((t) => t.text.replace(/^line \d+: /, '')).filter((x) => !/^stocks\.profile:/.test(x));
assert(T.activeId() === 'trendsAndPrices' && logs[0] === 'trendsAndPrices' && /true|yes/.test(logs[1]) && /trends/.test(logs[2]), `code: stocks.profile, stocks.activeProfile, stocks.profileActive, stocks.profiles (${logs.join(' | ')})`);
assert(CA.Managers.KINDS.includes('stocks') && CA.Managers.P.stocks.list().length === 2, 'managers: a stock trader profile per stage');
assert(CA.Managers.P.stocks.use('trends') === 1 && CA.Managers.P.stocks.isIn('trends'), '…put in by a manager');
assert((CA.Words.lookup('profile.stocks', 'trends') || {}).title === 'Ride the trends', 'a profile id in code has a hover card');
T.use('trendsAndPrices');

// ---- editing: a built-in's edit kept apart (Revert), yours saved, renamed, deleted
const edited = T.PRICES_SOURCE.replace('stableBuyUnder = 30', 'stableBuyUnder = 45');
T.setProfile('trendsAndPrices', { code: edited, knobs: T.current().knobs });
assert(T.current().edited && M.sourceOf(auto) === edited, 'a built-in edited: the autobuyer runs your version');
T.setProfile('trendsAndPrices', null);
assert(!T.current().edited && M.sourceOf(auto) === T.PRICES_SOURCE, '…reverted: the built-in again');
const mine = T.add('Only fast rises', { code: 'forever:\n  for good in stocks():\n    if stock.mode(good) == 3:\n      stock.buy(good)\n', knobs: {} });
T.use(mine);
assert(T.rename(mine, 'Fast risers') && T.find('fast risers').id === mine && /stock\.mode\(good\) == 3/.test(M.sourceOf(auto)), 'yours: in use, renamed, found by its name');

// ---- saved with the game
const saved = JSON.parse(CA.Settings.serialize());
assert(saved.stockTrader && saved.stockTrader.active === mine && saved.stockTrader.mine.length === 1, 'saved: the profile in use and yours');
const g2 = boot({ idb: { factory: new IDBFactory(), IDBKeyRange }, save: JSON.stringify(saved) });
await sleep(400);
const T2 = g2.window.CookieMgr.StockTrader;
assert(T2.activeId() === mine && T2.find(mine).name === 'Fast risers', 'loaded: the same profile in use, yours kept');
T.remove(mine);
assert(T.activeId() === 'trendsAndPrices' && !T.find(mine), 'deleting the one in use: the default takes over');

// ---- an old save (before profiles): Ride the trends, or its edited code as yours
const old = JSON.parse(CA.Settings.serialize());
delete old.stockTrader;
old.macros.prefs = { stockTrader: { inputs: { buy: true } } };
const g3 = boot({ idb: { factory: new IDBFactory(), IDBKeyRange }, save: JSON.stringify(old) });
await sleep(400);
assert(g3.window.CookieMgr.StockTrader.activeId() === 'trends', 'an old save keeps Ride the trends (what it did before)');
old.macros.prefs = { stockTrader: { custom: { source: 'forever:\n  stocks.sellAll()\n' } } };
const g4 = boot({ idb: { factory: new IDBFactory(), IDBKeyRange }, save: JSON.stringify(old) });
await sleep(400);
const T4 = g4.window.CookieMgr.StockTrader;
assert(T4.current().name === 'My stock trader' && !T4.current().builtin && /stocks\.sellAll/.test(T4.current().code), 'an old save with edited autobuyer code: that code as a profile of yours, in use');

// ---- the Trader card on the Stock market page
CA.UI.Menu.openPage('stocks');
const card = () => doc.querySelector('[data-page="stocks"] [data-st-card]');
assert(card() && card().querySelector('select[data-st-pick]').value === 'trendsAndPrices', 'the Stock market page: a Trader card, the profile in use picked');
assert(card().querySelectorAll('[data-knob]').length >= 8, `…its thresholds as knobs (${card().querySelectorAll('[data-knob]').length})`);
const sel = card().querySelector('select[data-st-pick]');
sel.value = 'trends';
sel.dispatchEvent(new w.Event('change', { bubbles: true }));
assert(T.activeId() === 'trends' && card().querySelector('select[data-st-pick]').value === 'trends', 'picking another profile puts it in use');
T.use('trendsAndPrices');
CA.UI.Menu.render();
const knob = card().querySelector('input[data-knob="stableBuyUnder"]');
knob.value = '50';
knob.dispatchEvent(new w.Event('input', { bubbles: true }));
assert(card().querySelector('.ca-pill-warn') && /stableBuyUnder = 50/.test(card().querySelector('[data-code-ed="stocks"] [data-code]').value), 'a knob moved: the code follows, unsaved');
click(w, card().querySelector('[data-st-act="save"]'));
assert(T.current().edited && /stableBuyUnder = 50/.test(M.sourceOf(auto)), 'Save: the built-in edited, the autobuyer runs it');
click(w, card().querySelector('[data-st-act="new"]'));
assert(!T.current().builtin && T.current().name === 'Trends and prices (copy)' && card().querySelector('[data-st-name]'), 'Save as new: a profile of yours, in use, its name editable');
T.remove(T.activeId());
T.setProfile('trendsAndPrices', null);

const errs = g.errors.concat(g2.errors, g3.errors, g4.errors);
assert(errs.length === 0, 'no runtime errors' + (errs.length ? `: ${errs.slice(0, 3).join(' | ')}` : ''));
done();
process.exit();
