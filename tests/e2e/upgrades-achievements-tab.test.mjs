// Stats → Upgrades & achievements: every upgrade and achievement in the game, by kind, the ones you have lit up —
// upgrades bought this ascension (the ones in the store ringed), achievements won — each with its info card on hover.
// A chip shows only the ones you don't have yet. Misc keeps its Still to collect card.
import { boot, sleep, makeAssert } from '../harness/game.mjs';

const { assert, done } = makeAssert();
const g = boot();
const { window: w, Game, errors } = g;
const doc = w.document;
const CA = w.CookieMgr;
await sleep(300);
const $ = (s) => doc.querySelector(s);
const $$ = (s) => [...doc.querySelectorAll(s)];

let order = 0;
const up = (name, pool, extra) => Object.assign(new Game.Upgrade(name, 1e3), { pool, icon: [order % 10, 1], order: order++, unlocked: 0 }, extra);
Game.Upgrades = {};
[
  up('Reinforced index finger', '', { bought: 1, unlocked: 1 }),
  up('Carpal tunnel prevention cream', '', { unlocked: 1 }),
  up('Ambidextrous', ''),
  up('Plain cookies', 'cookie', { bought: 1, unlocked: 1 }),
  up('Legacy', 'prestige', { bought: 1, unlocked: 1 }),
  up('Golden switch [off]', 'toggle', { unlocked: 1 }),
].forEach((u) => (Game.Upgrades[u.name] = u));
Game.UpgradesOwned = 3;
const ach = (name, pool, won) => ({ name, dname: name, desc: name, ddesc: name, pool, won, icon: [order % 10, 5], order: order++ });
Game.Achievements = {};
[ach('Wake and bake', 'normal', 1), ach('Making some dough', 'normal', 0), ach('So baked right now', 'normal', 0), ach('Cheated cookies taste awful', 'shadow', 0)].forEach((a) => (Game.Achievements[a.name] = a));
Game.AchievementsOwned = 1;

CA.UI.Menu.openPage('graphs:collection');
assert(CA.Settings.get('graphTab') === 'collection' && $('[data-graph-tab="collection"].on'), "openPage('graphs:collection') → the tab");
const groups = () =>
  Object.fromEntries(
    $$('[data-all-group]').map((gr) => [
      gr.dataset.allGroup,
      { count: gr.querySelector('.ca-all-count').textContent, icons: [...gr.querySelectorAll('[data-all-state]')].map((i) => `${i.dataset.upgrade || i.dataset.achievement}:${i.dataset.allState}`) },
    ])
  );
let gs = groups();
assert(Object.keys(gs).join() === 'Upgrades,Cookies,Heavenly upgrades,Achievements,Shadow achievements', `the groups (${Object.keys(gs)})`);
assert(
  gs.Upgrades.count === '1 of 3' && gs.Upgrades.icons.join() === 'Reinforced index finger:owned,Carpal tunnel prevention cream:store,Ambidextrous:locked',
  `upgrades: bought, in the store, locked, in the game's order; no switches (${JSON.stringify(gs.Upgrades)})`
);
assert(gs['Heavenly upgrades'].count === '1 of 1 ✓' && gs.Cookies.icons.join() === 'Plain cookies:owned', 'cookies and heavenly upgrades');
assert(gs.Achievements.count === '1 of 3' && gs.Achievements.icons[0] === 'Wake and bake:owned' && gs['Shadow achievements'].icons.join() === 'Cheated cookies taste awful:locked', `achievements (${JSON.stringify(gs.Achievements)})`);
assert(/Upgrades 3 of 5 · Achievements 1 of 4/.test($('[data-st-all-bar]').textContent), `the totals (${$('[data-st-all-bar]').textContent})`);
// the info cards: the upgrade one and the achievement one
assert($('[data-all-group="Upgrades"] [data-pop-live="upgrade"][data-upgrade="Ambidextrous"]') && $('[data-all-group="Achievements"] [data-pop-live="achievement"][data-achievement="Making some dough"]'), 'each icon opens its info card on hover');
assert($('.ca-all-ico.off') && $('.ca-all-ico.in-store') && $('.ca-all-ico:not(.off):not(.in-store)'), 'owned lit up, in the store ringed, the rest dimmed');

// the chip: only the ones not unlocked yet
const chip = $('[data-st-all-bar] [data-key="collectionMissing"]');
chip.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
assert(CA.Settings.get('collectionMissing') === true, 'the chip turns the filter on');
gs = groups();
assert(gs.Upgrades.icons.join() === 'Carpal tunnel prevention cream:store,Ambidextrous:locked' && gs.Upgrades.count === '1 of 3', `only what's missing; the count stays (${JSON.stringify(gs.Upgrades)})`);
assert(!gs['Heavenly upgrades'].icons.length && /All of them/.test($('[data-all-group="Heavenly upgrades"]').textContent), 'a group you have all of says so');
assert($('[data-st-all-bar] .ca-chip').classList.contains('on'), 'the chip shows on');

// winning an achievement / buying an upgrade updates it (the page's sync)
Game.Achievements['Making some dough'].won = 1;
Game.AchievementsOwned = 2;
Game.Upgrades.Ambidextrous.bought = 1;
Game.UpgradesOwned = 4;
CA.UI.StatsPage.sync();
gs = groups();
assert(gs.Achievements.icons.join() === 'So baked right now:locked' && gs.Achievements.count === '2 of 3', `won: gone from the filtered list (${JSON.stringify(gs.Achievements)})`);
assert(gs.Upgrades.icons.join() === 'Carpal tunnel prevention cream:store', 'bought: gone too');
chip.isConnected ? chip.dispatchEvent(new w.MouseEvent('click', { bubbles: true })) : $('[data-st-all-bar] .ca-chip').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
assert(groups().Achievements.icons.join() === 'Wake and bake:owned,Making some dough:owned,So baked right now:locked', 'off again: everything');

// Misc keeps Still to collect
CA.UI.Menu.openPage('graphs:misc');
assert($('[data-st-collection]'), 'Misc still has Still to collect');
assert(!errors.length, `no errors (${errors.join(' | ')})`);
done();
process.exit();
