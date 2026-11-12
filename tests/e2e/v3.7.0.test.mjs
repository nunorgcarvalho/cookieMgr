// v3.7.0 — alerts (the in-house Cookie Monster, release D): conditions
// (fortune, lumpRipe), actions (alert.flash / sound / notify — the event log, the game, the desktop),
// the built-in "When…" alerts (once per appearance, not again while it stays), their card choices,
// and the tab's title and icon while a golden cookie is on screen.
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { boot, sleep, waitFor, makeAssert } from '../harness/game.mjs';

const { assert, done } = makeAssert();
const g = boot({ idb: { factory: new IDBFactory(), IDBKeyRange } });
const { window: w, Game, calls } = g;
const CA = w.CookieMgr;
const doc = w.document;
await sleep(400);
const cond = (id, params = {}) => CA.Conditions.get(id).test(params);
const alerts = () => CA.EventLog.list(['alert']);

// ---- conditions
Game.TickerEffect = 0;
assert(!cond('fortune'), 'fortune: not without one in the ticker');
Game.TickerEffect = { type: 'fortune', sub: {} };
assert(cond('fortune'), 'fortune: a fortune cookie in the news');
Game.TickerEffect = 0;
Object.assign(Game, { lumpT: Date.now() - 2000, lumpRipeAge: 1000 });
assert(cond('lumpRipe'), 'lumpRipe: ripe');
Game.lumpRipeAge = 5000;
assert(!cond('lumpRipe'), 'lumpRipe: not yet');

// ---- actions
assert(CA.Actions.run('alert.flash', { color: 'red' }) === 1 && doc.querySelector('.ca-alert-flash'), 'alert.flash: a full-screen flash');
await waitFor(() => !doc.querySelector('.ca-alert-flash'), 2000);
assert(!doc.querySelector('.ca-alert-flash'), '…that goes away');
calls.sounds.length = 0;
CA.Actions.run('alert.sound', { sound: 'fortune' });
assert(calls.sounds.some((s) => /fortune\.mp3/.test(s)), `alert.sound: the game’s sound (${calls.sounds})`);
calls.notify.length = 0;
CA.Actions.run('alert.notify', { text: 'Hello', where: 'log' });
assert(alerts().some((e) => e.title === 'Hello') && !calls.notify.length, 'alert.notify (log): an Alert event, no notification');
const shown = [];
w.Notification = function (title, o) {
  shown.push([title, o.body]);
};
w.Notification.permission = 'granted';
CA.Actions.run('alert.notify', { text: 'Both', where: 'both' });
assert(calls.notify.some((n) => /Both/.test(n.desc)) && shown.some(([, b]) => b === 'Both'), 'alert.notify (both): the game’s notification and a desktop one');
assert(CA.Script.library().some((x) => x.id === 'alert.flash') && !CA.Script.compile('alert.flash(gold)\nalert.sound(chime)\nalert.notify("x", desktop)\nwait until fortune\n').errors.length, 'usable in code');

// ---- the built-in golden cookie alert: once per appearance
const M = CA.Macros;
assert(['alertGolden', 'alertWrath', 'alertReindeer', 'alertFortune', 'alertMagic', 'alertLump'].every((id) => M.get(id) && M.get(id).mode === 'when' && !M.isOn(id)), 'six built-in alerts, off until you switch them on');
M.set('alertGolden', true, { silent: true });
calls.sounds.length = 0;
const before = alerts().length;
Game.shimmers.push({ id: 1, type: 'golden', wrath: 0, popped: false });
await waitFor(() => alerts().length > before, 3000);
assert(alerts().length === before + 1 && calls.sounds.some((s) => /chime/.test(s)), 'a golden cookie appears: a flash, a chime, an Alert event');
await sleep(800);
assert(alerts().length === before + 1, 'not again while it stays on screen');
Game.shimmers.length = 0;
await sleep(600);
Game.shimmers.push({ id: 2, type: 'golden', wrath: 0, popped: false });
await waitFor(() => alerts().length > before + 1, 3000);
assert(alerts().length === before + 2, 'the next one: again');
M.set('alertGolden', false, { silent: true });
// its card: the color, the sound, where to note it
CA.UI.Menu.openPage('clickers');
const card = doc.querySelector('[data-page="clickers"] .ca-mtile[data-macro-row="alertGolden"]');
assert(card && card.querySelector('select[data-key="color"]') && card.querySelector('select[data-key="sound"]') && card.querySelector('select[data-key="where"]'), 'its card: color, sound, where');
assert(/Alerts/.test(doc.querySelector('[data-page="clickers"]').textContent), 'an Alerts section on the Macros page');

// ---- the tab
const link = doc.createElement('link');
link.rel = 'icon';
link.setAttribute('href', 'img/favicon.ico');
doc.head.appendChild(link);
doc.title = '1 cookie - Cookie Clicker';
CA.Alerts.tab();
assert(doc.title.startsWith('✦ ') && /goldCookie/.test(link.getAttribute('href')), `a golden cookie on screen: ✦ in the title, the cookie as the icon (${doc.title})`);
doc.title = '2 cookies - Cookie Clicker'; // the game rewrites it
CA.Alerts.tab();
assert(doc.title === '✦ 2 cookies - Cookie Clicker', 'kept through the game’s rewrites, never doubled');
Game.shimmers[0].wrath = 1;
CA.Alerts.tab();
assert(doc.title.startsWith('⚠ ') && /wrathCookie/.test(link.getAttribute('href')), 'a wrath cookie: ⚠');
Game.shimmers.length = 0;
CA.Alerts.tab();
assert(doc.title === '2 cookies - Cookie Clicker' && link.getAttribute('href') === 'img/favicon.ico', 'gone: title and icon as they were');
CA.Settings.set('alertTab', false);
Game.shimmers.push({ id: 3, type: 'golden', wrath: 0, popped: false });
CA.Alerts.tab();
assert(!doc.title.startsWith('✦'), 'option off: the tab untouched');
CA.UI.Menu.openPage('events');
assert(doc.querySelector('[data-page="events"] [data-key="alertTab"]'), 'the option, on the Events page');

assert(g.errors.length === 0, 'no runtime errors' + (g.errors.length ? `: ${g.errors.slice(0, 3).join(' | ')}` : ''));
done();
process.exit();
