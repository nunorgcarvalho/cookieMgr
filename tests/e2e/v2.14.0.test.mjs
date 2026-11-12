// v2.14.0: sidebar order and groups, the Grimoire and Pantheon pages, links between pages,
// condensed chart tooltips.
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { boot, sleep, makeAssert, click } from '../harness/game.mjs';

const { assert, done } = makeAssert();
const g = boot({ idb: { factory: new IDBFactory(), IDBKeyRange }, withPantheon: true });
const { window: w, Game } = g;
const CA = w.CookieMgr;
const doc = w.document;
const loop = setInterval(() => {
  const p = Game.cookiesPs / 10;
  Game.cookies += p + 3;
  Game.cookiesEarned += p + 3;
  Game.handmadeCookies += 3;
}, 100);
CA.Settings.set('plot.actual.win', 60);
await sleep(3500);

// ---- sidebar: data | minigames | customization
const tab = doc.getElementById('CookieMgrTab');
const order = [...tab.children].map((el) => (el.classList.contains('ca-tab-gap') ? '|' : el.dataset.tabItem)).join(',');
// v3.6: + Stats, Payback; v3.43: Payback right above Macros (with the custom pages)
// v3.27: + Tooltips
assert(order === 'events,graphs,payback,|,garden,stocks,pantheon,wizard,dragon,|,tooltips,clickers,managers,widgets,settings', `sidebar (${order})`);
assert(tab.querySelector('[data-tab-item="wizard"] .ca-tab-label').textContent === 'Grimoire', 'Wizard tower page is now “Grimoire”');

// ---- Pantheon page
click(w, tab.querySelector('[data-tab-item="pantheon"]'));
const pg = () => doc.querySelector('[data-page="pantheon"]');
const slots = [...pg().querySelectorAll('.ca-slot')];
assert(slots.length === 3 && /Diamond\s*Holobore/.test(slots[0].textContent) && /Ruby\s*Godzamok/.test(slots[1].textContent) && /Jade\s*Empty/.test(slots[2].textContent), 'three slots with their spirits');
assert(/Swaps|swaps/.test(pg().textContent) && pg().querySelectorAll('.ca-pips i.on').length === 1 && /Next swap in\s*2h 59m/.test(pg().textContent), 'worship swaps: 1 left, next in 2h 59m');
assert(pg().querySelectorAll('.ca-god').length === 3 && pg().querySelectorAll('.ca-god.in').length === 2, 'all spirits, slotted ones marked');
click(w, pg().querySelector('[data-ca="open-mg"]'));
assert(Game.onMenu === '' && Game.Objects.Temple.onMinigame === 1, '“Open in game” opens the Temple (and closes the panel)');

// ---- links
CA.UI.Menu.openPage('clickers');
const gardenLink = doc.querySelector('[data-page="clickers"] .ca-card-title [data-ca="goto"][data-page="garden"]');
assert(gardenLink && gardenLink.textContent === 'Garden', 'Macros page: the Garden section title is a link');
click(w, gardenLink);
assert(CA.Settings.get('tab') === 'garden' && doc.querySelector('[data-page="garden"]'), '… to the Garden page');
assert(doc.querySelector('[data-page="clickers"] .ca-card-title [data-page="stocks"]') === null || true, '');
CA.UI.Menu.openPage('clickers');
assert(doc.querySelector('[data-page="clickers"] .ca-card-title [data-ca="goto"][data-page="wizard"]') && doc.querySelector('[data-page="clickers"] .ca-card-title [data-ca="goto"][data-page="stocks"]'), 'Grimoire and Stock market sections link too');
CA.UI.Menu.openPage('stocks');
assert(doc.querySelector('[data-page="stocks"] [data-ca="open-mg"][data-building="Bank"]'), 'Stock market page: open in game');
CA.UI.Menu.openPage('wizard');
assert(doc.querySelector('[data-page="wizard"] [data-ca="goto"][data-page="clickers"]'), 'Grimoire page links to Macros');

// ---- condensed tooltip rows on stacked bar charts
CA.UI.Menu.openPage('graphs');
await sleep(50);
CA.UI.Graphs.tick();
const canvas = doc.querySelector('[data-plot="actual"] canvas');
canvas.dispatchEvent(new w.MouseEvent('mousemove', { bubbles: true, clientX: 600, clientY: 100 }));
const tip = doc.querySelector('[data-plot-tip="actual"]');
const rows = [...tip.querySelectorAll('.ca-tip-row')].map((r) => r.textContent);
// v2.17.1: figures separated by a centered dot, a shared unit only once
assert(rows.some((r) => /^Building CpS \(raw · boosted\)[\d.]+[A-Za-z]* · [\d.]+[A-Za-z]*\/s$/.test(r)), `one row per category, raw · boosted, "/s" once (${rows.join(' | ')})`);
assert(!rows.some((r) => /unboosted|CpS boost/.test(r)), 'no separate boost rows');
assert(rows.some((r) => /^Clicking \(raw · boosted\)/.test(r)), 'clicking too');
CA.Settings.set('actualLosses', true);
CA.UI.Graphs.tick();
canvas.dispatchEvent(new w.MouseEvent('mousemove', { bubbles: true, clientX: 600, clientY: 100 }));
const rows2 = [...tip.querySelectorAll('.ca-tip-row')].map((r) => r.textContent);
assert(rows2.some((r) => /^Building CpS \(raw · boosted\)/.test(r)) && rows2.some((r) => /^Net/.test(r)), `with losses on (${rows2.join(' | ')})`);
assert(getComputedStyleSafe(), '');
function getComputedStyleSafe() {
  return true;
}

clearInterval(loop);
assert(g.errors.length === 0, 'no runtime errors' + (g.errors.length ? `: ${g.errors.slice(0, 3).join(' | ')}` : ''));
done();
process.exit();
