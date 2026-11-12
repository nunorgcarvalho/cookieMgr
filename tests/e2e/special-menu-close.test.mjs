// The game's Santa / dragon menu: what cookieMgr opens to do something there (petting the dragon,
// leveling Santa), it closes again, and what you had open stays open. The stubs below act like main.js:
// ToggleSpecialMenu(1) puts the menu up for Game.specialTab (any, even none), ToggleSpecialMenu(0) only
// takes it down while a tab is set; UpgradeSanta redraws the menu whatever is open.
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { boot, sleep, makeAssert } from '../harness/game.mjs';

const { assert, done } = makeAssert();
const g = boot({ idb: { factory: new IDBFactory(), IDBKeyRange } });
const { window: w, Game } = g;
const CA = w.CookieMgr;
await sleep(400);

let shown = ''; // what the menu shows ('' none; 'blank' up with no tab)
Game.specialTab = '';
Game.ToggleSpecialMenu = (on) => {
  if (on) shown = Game.specialTab || 'blank';
  else if (Game.specialTab !== '') (Game.specialTab = ''), (shown = '');
};
const owned = new Set(['A festive hat', 'Pet the dragon', 'A crumbly egg']);
Game.Has = (n) => owned.has(n);
Game.HasUnlocked = () => false;

// ---- Santa
Game.season = 'christmas';
Game.santaLevel = 0;
Game.cookies = 1e9;
Game.UpgradeSanta = () => {
  Game.santaLevel++;
  Game.ToggleSpecialMenu(1);
};
const santa = () => CA.Actions.get('santa.upgrade').run({});
assert(santa() === 1 && Game.santaLevel === 1, 'levels Santa');
assert(shown === '' && Game.specialTab === '', 'no menu was open: none is left up');
Game.specialTab = 'dragon';
Game.ToggleSpecialMenu(1);
santa();
assert(shown === 'dragon' && Game.specialTab === 'dragon', 'the dragon was open: it still is');
Game.ToggleSpecialMenu(0);
Game.specialTab = 'santa';
Game.ToggleSpecialMenu(1);
santa();
assert(shown === 'santa' && Game.specialTab === 'santa', 'Santa was open: still open, redrawn');
Game.ToggleSpecialMenu(0);

// ---- the dragon, petted (needs a drop you're missing, and this quarter-hour not tried yet)
Game.dragonLevel = 8;
Game.ClickSpecialPic = () => {};
CA.Actions.get('dragon.pet').run({});
assert(shown === '' && Game.specialTab === '', 'petting with no menu open: none left up');

// ---- the dragon, trained to the end: never opens the menu, only redraws it when it's open
Game.dragonLevels = Array.from({ length: 28 }, (_, i) => ({ name: `L${i}`, pic: 0, cost: () => true, buy() {}, costStr: () => '' }));
Game.dragonAuras = { 0: { name: 'No aura' }, 1: { name: 'Breath of Milk' } };
let trained = 0;
while (CA.Dragon.train('all')) trained++;
assert(Game.dragonLevel === 27 && trained === 19, `trains to the last level (${trained} levels)`);
assert(shown === '' && Game.specialTab === '', 'no menu was open: none is left up');

assert(g.errors.length === 0, 'no runtime errors' + (g.errors.length ? `: ${g.errors.slice(0, 3).join(' | ')}` : ''));
done();
process.exit();
