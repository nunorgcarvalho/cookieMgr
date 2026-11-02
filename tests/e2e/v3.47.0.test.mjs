// v3.47.0: the Graphs and Stats pages are one page, named Stats (the Graphs icon, page id 'graphs').
// Its tabs: Cookies and Prestige (the charts; Prestige gains the prestige statistics), then the old Stats
// page's cards — Golden cookies (bank meters, the next golden cookie), What if, Misc (timers, wrinklers,
// still to collect). Saves and links naming the old 'stats' page land on the Golden cookies tab.
import { boot, sleep, makeAssert } from '../harness/game.mjs';

const { assert, done } = makeAssert();
const g = boot();
const { window: w, Game, errors } = g;
const doc = w.document;
const CA = w.CookieMgr;
await sleep(300);
const $ = (s) => doc.querySelector(s);
const $$ = (s) => [...doc.querySelectorAll(s)];

// ---- the sidebar: one Stats entry, in the Graphs slot, with its icon ----
const items = $$('#CookieMgrTab [data-tab-item]');
const labels = items.map((i) => i.querySelector('.ca-tab-label').textContent);
assert(labels.filter((l) => l === 'Stats').length === 1 && !labels.includes('Graphs'), `one Stats entry, no Graphs (${labels})`);
assert(items[1].dataset.tabItem === 'graphs' && labels[1] === 'Stats', 'Stats sits right under Events, where Graphs was');
assert(!CA.UI.Pages.get('stats') && CA.UI.Pages.get('graphs').icon === 'graphs', 'no separate stats page; the Graphs icon');

Game.shimmerTypes.golden = Object.assign(Game.shimmerTypes.golden || {}, { time: 3000, minTime: 9000, maxTime: 27000, spawned: 0, n: 0, spawnConditions: () => true });

// ---- the tabs ----
CA.UI.Menu.openPage('graphs');
const tabs = $$('[data-graph-tab]').map((b) => `${b.dataset.graphTab}:${b.textContent}`);
assert(tabs.join() === 'cookies:Cookies,income:Actual income,prestige:Prestige,golden:Golden cookies,whatif:What if,collection:Upgrades & achievements,misc:Misc', `tabs (${tabs})`);
const page = () => $('#CookieMgrMenu .ca-page[data-page="graphs"]');
const open = (id) => {
  w.document.querySelector(`[data-graph-tab="${id}"]`).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  return page();
};
assert(open('cookies').querySelector('[data-plot="cps"]') && page().querySelector('[data-key="graphEffects"]'), 'Cookies: the charts and their options');
let p = open('prestige');
const kids = [...p.children].map((c) => (c.matches('[data-plot]') ? `plot:${c.dataset.plot}` : c.matches('[data-ptarget]') ? 'target' : c.querySelector('[data-st-prestige]') ? 'prestige' : c.className));
assert(kids.indexOf('prestige') > 0 && kids.indexOf('prestige') < kids.indexOf('target') && kids.indexOf('target') < kids.indexOf('plot:prestige'), `Prestige: the statistics, the target, then the charts (${kids})`);
p = open('golden');
assert(p.querySelectorAll('.ca-meter').length >= 5 && p.querySelector('[data-st-spawn] [data-sp-chart="golden"]'), 'Golden cookies: the bank meters, the next golden cookie');
const spawnFirst = p.querySelector('[data-st-spawn]').compareDocumentPosition(p.querySelector('[data-st-bank]')) & w.Node.DOCUMENT_POSITION_FOLLOWING;
assert(spawnFirst, 'Next golden cookie above Bank');
assert(p.querySelector('[data-w-star]') || /☆|★/.test(p.textContent), 'its ☆ (a Golden cookies widget) is still there');
assert(!p.querySelector('[data-plot]') && !p.querySelector('[data-key="graphEffects"]'), 'no charts, no chart options');
p = open('whatif');
assert(p.querySelector('[data-st-whatif]') && /What if/.test(p.textContent), 'What if');
p = open('misc');
assert(p.querySelector('[data-st-timers]') && p.querySelector('[data-st-wrinklers]') && p.querySelector('[data-st-collection]'), 'Misc: timers, wrinklers, still to collect');
assert(CA.Settings.get('graphTab') === 'misc', 'the tab is remembered');
Game.cookies = 123456789;
await sleep(1200);
assert(errors.length === 0, `no errors while live (${errors.join(' | ')})`);

// ---- the old Stats page's id: links and saves ----
CA.UI.Menu.openPage('stats');
assert(CA.Settings.get('tab') === 'graphs' && CA.Settings.get('graphTab') === 'golden' && page().querySelector('[data-st-bank]'), "openPage('stats') → Stats, Golden cookies");
CA.UI.Menu.openPage('graphs:whatif');
assert(CA.Settings.get('graphTab') === 'whatif' && page().querySelector('[data-st-whatif]'), "openPage('graphs:whatif') → that tab");
CA.UI.Menu.close();

Game.WriteSave();
const saved = JSON.parse(Game.modSaveData.CookieMgr);
saved.options.tab = 'stats';
saved.options.graphTab = 'cookies';
const g2 = boot({ save: JSON.stringify(saved) });
await sleep(300);
const CA2 = g2.window.CookieMgr;
CA2.UI.Menu.open();
assert(CA2.Settings.get('tab') === 'graphs' && CA2.Settings.get('graphTab') === 'golden', 'a save on the old Stats page reopens on Stats → Golden cookies');
assert(g2.window.document.querySelector('#CookieMgrMenu .ca-page[data-page="graphs"] [data-st-bank]'), '… showing its cards');
assert(g2.errors.length === 0, `no errors (${g2.errors.join(' | ')})`);

done();
process.exit();
