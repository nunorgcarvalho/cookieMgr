// v2.19.0: no more "All autoclickers"; settings on every built-in (interval + its actions' choices);
// the stock autobuyer's "buy" setting (shift-click its button); a running strip instead of the
// Running now card, with live step details on the cards.
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { boot, sleep, makeAssert, click } from '../harness/game.mjs';

const { assert, done } = makeAssert();
const browser = { factory: new IDBFactory(), IDBKeyRange };
const g = boot({ idb: browser });
const { window: w, Game, M, goods } = g;
const CA = w.CookieMgr;
const doc = w.document;
await sleep(400);
const page = () => doc.querySelector('[data-page="clickers"]');
const card = (id) => page().querySelector(`.ca-mtile[data-macro-row="${id}"]`);

// ---- All autoclickers: gone
CA.UI.Menu.openPage('clickers');
assert(!/All autoclickers/.test(page().textContent) && !page().querySelector('[data-ca="all-on"]'), 'no All autoclickers row');
assert(!CA.Hotkeys.get('clickers.toggleAll'), 'nor its hotkey');

// ---- the running strip
assert(page().querySelector('.ca-runbar [data-macro-runbar]') && !page().querySelector('[data-macro-statusblock]'), 'a running strip instead of the Running now card');
CA.Macros.set('golden', true, { silent: true });
CA.Macros.set('wrinklers', true, { silent: true });
CA.UI.MacrosPage.sync(page());
const chips = () => [...page().querySelectorAll('[data-macro-runbar] .ca-runchip')].map((c) => c.dataset.id);
assert(chips().join() === 'golden,wrinklers', `a chip per running macro (${chips()})`);
// v3: Golden cookies is code — its card shows what it has done
assert(/things done/.test(card('golden').querySelector('[data-macro-status]').textContent) && /on for/.test(card('golden').querySelector('[data-macro-status]').textContent), 'a running card shows what it did');
click(w, page().querySelector('.ca-runchip[data-id="wrinklers"] .ca-runchip-x'));
assert(!CA.Macros.isOn('wrinklers'), 'the chip’s × stops it');
click(w, page().querySelector('.ca-runchip[data-id="golden"]'));
assert(card('golden').classList.contains('ca-flash'), 'clicking a chip finds its card');
CA.Macros.set('wrath', true, { silent: true });
click(w, page().querySelector('[data-ca="stop-all"]'));
assert(CA.Macros.activeCount() === 0, 'Stop all');
CA.UI.MacrosPage.sync(page());
assert(/nothing/.test(page().querySelector('[data-macro-runbar]').textContent), 'idle strip says so');

// ---- built-in settings
const sum = (id) => card(id).querySelector('.ca-mtile-sum').textContent;
assert(/20× a second · cookie \+ number/.test(sum('bigCookie')), `Big cookie: summary (${sum('bigCookie')})`);
assert(/Shiny wrinklers/.test(card('wrinklers').textContent) && card('wrinklers').querySelector('select[data-key="shiny"]'), 'Wrinklers: its choice');
assert(card('golden').querySelector('input[data-macro-every]'), 'Golden cookies: how often (v2.25: a number box)');
click(w, card('bigCookie').querySelector('[data-ca="macro-settings"]'));
assert(card('bigCookie').querySelector('.ca-mtile-settings.open'), '⚙ summary unfolds the settings');
const every = card('bigCookie').querySelector('input[data-macro-every]');
every.value = '10'; // times a second
every.dispatchEvent(new w.Event('change', { bubbles: true }));
assert(CA.Macros.everyOf(CA.Macros.get('bigCookie')) === 100 && /10× a second/.test(sum('bigCookie')) && /every 0.1s/.test(card('bigCookie').querySelector('.ca-badge').textContent), 'interval changed, summary and badge follow');
// a running macro picks the new interval up
let clicks = 0;
const realClick = Game.ClickCookie;
Game.ClickCookie = () => clicks++;
CA.Macros.set('bigCookie', true, { silent: true });
CA.Macros.setEvery('bigCookie', 200);
await sleep(1050);
CA.Macros.set('bigCookie', false, { silent: true });
Game.ClickCookie = realClick;
assert(clicks >= 4 && clicks <= 6, `restarted at 5 a second (${clicks} clicks in ~1s)`);
assert(!card('sellAll').querySelector('.ca-mtile-settings') && !card('castFthof').querySelector('[data-macro-param]'), 'fixed built-ins (Sell all, spells) have no choices');

// ---- the stock autobuyer: only sell (Ride the trends: sells what isn't rising)
CA.StockTrader.use('trends');
const buy = card('stockTrader').querySelector('input[data-key="buy"]');
assert(buy && buy.checked && /shift-click/.test(card('stockTrader').textContent), 'autobuyer: Buy rising stocks (shift-click its button)');
CA.Macros.setFav('stockTrader', true);
CA.UI.Widgets.tick();
const btn = () => doc.querySelector('#CookieMgrWidgets [data-w-trigger="stockTrader"]');
btn().dispatchEvent(new w.MouseEvent('click', { bubbles: true, shiftKey: true }));
assert(CA.Macros.shiftValue('stockTrader') === false && !CA.Macros.isOn('stockTrader'), 'shift-click flips it, without switching the macro');
assert(/only sells what you hold/.test(btn().parentNode.textContent), 'its button says so');
goods.forEach((s) => ((s.mode = 3), (s.stock = 0)));
goods[0].mode = 0;
goods[0].stock = 5;
Game.cookies = 1e12;
CA.Macros.runOnce('stockTrader');
assert(goods[0].stock === 0 && goods.slice(1).every((s) => s.stock === 0), 'selling only: sells, buys nothing');
btn().dispatchEvent(new w.MouseEvent('click', { bubbles: true, shiftKey: true }));
CA.Macros.runOnce('stockTrader');
assert(goods.slice(1).some((s) => s.stock > 0), 'shift-click again: buys too');

// ---- saved
CA.Macros.shiftToggle('stockTrader');
Game.WriteSave();
const saved = Game.modSaveData.CookieMgr;
const g2 = boot({ idb: { factory: new IDBFactory(), IDBKeyRange }, save: saved });
await sleep(400);
const C2 = g2.window.CookieMgr;
assert(C2.Macros.everyOf(C2.Macros.get('bigCookie')) === 200 && C2.Macros.shiftValue('stockTrader') === false, 'interval and settings restored');

void M;
assert(g.errors.length + g2.errors.length === 0, 'no runtime errors' + (g.errors.length ? `: ${g.errors.slice(0, 3).join(' | ')}` : ''));
done();
process.exit();
