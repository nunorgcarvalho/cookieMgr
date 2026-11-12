// v2.23.0: widget settings scroll into view (themed, presets, place grid); hold a buying button to
// buy fast; wrinklers popped once fed (shift-click); tooltips on notifications; SeasonCompletion
// keeps pledging.
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { boot, sleep, waitFor, makeAssert, click } from '../harness/game.mjs';

const { assert, done } = makeAssert();
const g = boot({ idb: { factory: new IDBFactory(), IDBKeyRange } });
const { window: w, Game } = g;
const CA = w.CookieMgr;
const doc = w.document;
await sleep(400);
const W = () => doc.getElementById('CookieMgrWidgets');

// ---- widget settings: brought into view, livelier
let scrolled = 0;
// v2.24.1: scrolled within the panel only (CA.Util.scrollInPanel), never scrollIntoView
CA.Util.scrollInPanel = (el) => {
  if (el && el.matches && el.matches('[data-w-editor]')) scrolled++;
};
const grim = CA.UI.Widgets.add('grimoire');
CA.UI.Menu.close();
click(w, W().querySelector(`[data-widget="${grim.id}"] [data-w-settings]`));
const ed = () => doc.querySelector('[data-w-editor]');
assert(ed() && scrolled === 1 && ed().classList.contains('ca-reveal'), 'the ⚙ opens its settings and scrolls them into view (with a flash)');
assert(ed().classList.contains('ca-wtheme-grimoire'), 'header in the widget’s own color');
click(w, ed().querySelector('[data-w-preset="font"][data-val="130"]'));
assert(grim.font === 130 && ed().querySelector('[data-w-preset="font"][data-val="130"]').classList.contains('on'), 'text size presets');
click(w, ed().querySelector('[data-w-preset="scale"][data-val="150"]'));
assert(grim.scale === 1.5, 'size presets');
click(w, ed().querySelector('[data-w-snap="1,0"]'));
assert(grim.x === 1 && grim.y === 0 && ed().querySelector('[data-w-snap="1,0"]').classList.contains('on'), 'place grid: snaps to the top-right corner');
scrolled = 0;
click(w, doc.querySelector('.ca-wchip [data-w-page-edit]'));
assert(scrolled === 1, 'opening settings from the page scrolls too');

// ---- wrinklers: once fed, or at once (shift-click)
const wr = (sucked) => ({ phase: 2, hp: 3, type: 0, sucked });
Game.wrinklers = [wr(0), wr(2)];
CA.Macros.runOnce('wrinklers');
assert(Game.wrinklers[0].hp === 3 && Game.wrinklers[1].hp === 0, 'by default: only the one that has eaten (so it can drop something)');
CA.Macros.setFav('wrinklers', true);
CA.UI.Widgets.tick();
const wbtn = () => W().querySelector('[data-w-trigger="wrinklers"]');
wbtn().dispatchEvent(new w.MouseEvent('click', { bubbles: true, shiftKey: true }));
assert(CA.Macros.shiftValue('wrinklers') === false && /pops them at once/.test(wbtn().parentNode.textContent), 'shift-click: pop at once');
CA.Macros.runOnce('wrinklers');
assert(Game.wrinklers[0].hp === 0, 'now pops the hungry one too');

// ---- hold a buying button
let bought = 0;
const cheap = (n) => ({ name: `Cheap ${n}`, dname: `Cheap ${n}`, pool: '', bought: 0, getPrice: () => 1, buy() {
  this.bought = 1;
  bought++;
  Game.UpgradesInStore.splice(Game.UpgradesInStore.indexOf(this), 1);
} });
Game.UpgradesInStore = Array.from({ length: 30 }, (_, i) => cheap(i));
Game.cookiesPsRaw = 1000;
Game.cookies = 1e9;
CA.Macros.setFav('cheapUpgrades', true);
CA.UI.Widgets.tick();
// cheap upgrades buys everything under 1s in one run: make it one per run to see the repeat
// (v3: it's code — your version of it)
CA.Macros.customize('cheapUpgrades', { ...CA.Macros.get('cheapUpgrades'), source: 'for u in upgrades():\n  buy.upgrade(u)\n  stop\n' });
const cbtn = () => W().querySelector('[data-w-trigger="cheapUpgrades"]');
cbtn().dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 5, clientY: 5 }));
await sleep(200);
assert(bought === 0, 'a short press doesn’t buy');
// (repeats come every so often: wait for three of them, not a fixed time — a busy machine is slower)
await waitFor(() => bought >= 3, 4000);
assert(bought >= 3 && cbtn().classList.contains('ca-holding'), `holding: buys again and again (${bought})`);
w.dispatchEvent(new w.MouseEvent('mouseup', { bubbles: true }));
const after = bought;
cbtn().dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
await sleep(200);
assert(bought === after && !CA.Macros.isOn('cheapUpgrades'), 'letting go stops it, and doesn’t switch the macro on');
click(w, cbtn());
assert(CA.Macros.isOn('cheapUpgrades'), 'a normal click still switches it');
CA.Macros.set('cheapUpgrades', false, { silent: true });

// ---- notification tooltips
Game.UpgradesById = { 7: { id: 7, name: 'Wrinkler ambergris', dname: 'Wrinkler ambergris' } };
Game.AchievementsById = { 3: { id: 3, name: 'Hand-picked', dname: 'Hand-picked' } };
Game.noteId = 0;
Game.NotesById = {};
Game.Notify = (title, desc) => {
  Game.NotesById[Game.noteId] = { title, desc };
  Game.noteId++;
};
Game.NotifyTooltip = (t) => (Game.NotesById[Game.noteId - 1].tooltip = t);
Game.crateTooltip = () => '';
CA.NotifyTips.init();
Game.Notify('Wrinkler ambergris', 'You also found <b>Wrinkler ambergris</b>!');
assert(/UpgradesById\[7\]/.test(Game.NotesById[0].tooltip), 'an upgrade notification gets the upgrade’s tooltip');
Game.Notify('Achievement unlocked', '<div class="title">Hand-picked</div>');
assert(/AchievementsById\[3\]/.test(Game.NotesById[1].tooltip), 'an achievement notification gets the achievement’s');
Game.Notify('Exploded a wrinkler', 'Found <b>12 cookies</b>!');
assert(!Game.NotesById[2].tooltip, 'others are left alone');

// ---- SeasonCompletion keeps the elders pledged by default
// (v4.0: the pledging is the Elder Pledge macro's; Nunix late game switches it on once the drops (Halloween's too) are in;
// stages keep only their changes, so read what each runs with)
assert((() => { const n = CA.Managers.find('nunixLateGame'); return n.stages.slice(2).every((st, i) => CA.Managers.effective(n, i + 2).macros.elderPledge === 'on'); })(), 'the elders are kept pledged after Halloween by default');

assert(g.errors.length === 0, 'no runtime errors' + (g.errors.length ? `: ${g.errors.slice(0, 3).join(' | ')}` : ''));
done();
process.exit();
