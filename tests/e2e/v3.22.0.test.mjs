// v3.22.0: "Add a widget" is four shelves of tiles (the game's own icons; round dials vs framed panels);
// click a tile to place it, hover for the full description; defineType takes group/sprite/short/ring.
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { boot, sleep, makeAssert, click } from '../harness/game.mjs';

const { assert, done } = makeAssert();
const g = boot({ idb: { factory: new IDBFactory(), IDBKeyRange }, withPantheon: true });
const { window: w } = g;
const CA = w.CookieMgr;
const doc = w.document;
await sleep(400);
const page = () => doc.querySelector('[data-page="widgets"]');
const eq = (got, want, what) => assert(got === want, `${what}: ${JSON.stringify(got)}${got === want ? '' : ` (wanted ${JSON.stringify(want)})`}`);

CA.UI.Widgets.defineType({ id: 'oddball', name: 'Oddball', icon: 'widget', desc: 'From another thread.', group: 'nowhere', short: 'Registered elsewhere' });
CA.UI.Menu.openPage('widgets');

// ---- shelves
const shelfNames = () => [...page().querySelectorAll('.ca-wshelf-head')].map((e) => e.textContent.trim());
eq(shelfNames().join('|'), 'Golden cookies|Minigames|Macros|Data|More', 'shelves in order, then More'); // v3.27: Your game → Data
const more = page().querySelector('[data-w-shelf="more"]');
assert(more && more.querySelector('[data-w-page-add="oddball"]'), 'a type with an unknown group lands in More');

// ---- every visible type has a tile with sprite/short, and a popup with its desc
CA.UI.Widgets.types()
  .filter((t) => !t.hidden)
  .forEach((t) => {
    const tile = page().querySelector(`.ca-wtile[data-w-tile="${t.id}"]`);
    assert(tile, `${t.id} has a tile`);
    if (!tile) return;
    if (t.sprite) assert(/--bgp:/.test(tile.querySelector('.ca-wcrate > i').getAttribute('style')), `${t.id} wears its sprite`);
    else assert(tile.querySelector('.ca-wcrate-svg svg'), `${t.id} falls back to its icon`);
    if (t.short) eq(tile.querySelector('.ca-wtile-sub').textContent, t.short, `${t.id} short`);
    assert(tile.matches('[data-pop]') && tile.querySelector(':scope > .ca-wpop.ca-wtip').textContent.includes(t.desc), `${t.id} popup carries its description`);
    eq(!!tile.querySelector('.ca-wcrate.round'), !!t.bare, `${t.id} round iff bare`);
  });
assert(!page().querySelector('[data-w-tile="macro"]'), 'the hidden macro type stays out');
assert(page().querySelector('[data-w-shelf="macros"] [data-w-tile="macro-buttons"][data-ca="open-macros"]'), 'Macro buttons tile in Macros, linking to the Macros page');
eq(page().querySelector('[data-w-tile="grimoire"] .ca-wcrate').getAttribute('style'), '--ring:#d9c4ff', 'ring color');
assert(!page().querySelector('.ca-wcard, .ca-wgallery'), 'the old gallery is gone');

// ---- click to place / remove
const tile = (id) => page().querySelector(`.ca-wtile[data-w-tile="${id}"]`);
assert(!tile('pantheon').classList.contains('placed') && !tile('pantheon').querySelector('.ca-wtag'), 'not placed at rest');
click(w, tile('pantheon'));
assert(CA.UI.Widgets.has('pantheon'), 'clicking the tile places the widget');
assert(tile('pantheon').classList.contains('placed'), 'tile shows placed');
eq(tile('pantheon').querySelector('.ca-wtag').textContent, '×1', 'badge counts (v3.52: every kind takes copies)');
eq(tile('pantheon').querySelector('.ca-wadd').textContent, 'Remove', 'pill says Remove');
assert(/click to remove/.test(tile('pantheon').querySelector('.ca-wtip-act').textContent), 'action line says remove');
click(w, tile('pantheon'));
assert(!CA.UI.Widgets.has('pantheon') && !tile('pantheon').classList.contains('placed'), 'clicking a placed tile removes it');

click(w, tile('events'));
click(w, tile('events').querySelector('.ca-wtile-add')); // v3.25: a placed tile removes; its small Add button adds another
eq(CA.UI.Widgets.list().filter((x) => x.type === 'events').length, 2, 'a multi type adds another each click');
eq(tile('events').querySelector('.ca-wtag').textContent, '×2', 'multi badge counts');
eq(tile('events').querySelector('.ca-wadd').textContent, 'Remove', 'multi pill removes (v3.25)');
assert(/2 placed/.test(tile('events').querySelector('.ca-wtip-act').textContent), 'action line counts');

// ---- Macro buttons badge counts starred macros
const m = CA.Macros.list()[0];
CA.Macros.setFav(m.id, true);
CA.UI.Menu.render();
eq(tile('macro-buttons').querySelector('.ca-wtag').textContent, '1', 'Macro buttons badge = starred macros');

// ---- defineGroup
CA.UI.Widgets.defineGroup({ id: 'nowhere', name: 'Nowhere', sprite: [1, 1], order: 5 });
CA.UI.Menu.render();
eq(shelfNames()[0], 'Nowhere', 'a defined group becomes a shelf, sorted by order');

done();
process.exit();
