// The code editor's library, polished: ★ pins a row without redrawing the library (nothing moves),
// a call whose param picks from a fixed list (spell.cast(spell)) lists its possible values under its
// row — each with what it is, click one to write the call with it, found by search — and redrawing
// the page you're on doesn't fade it in from black again.
import { boot, sleep, makeAssert, click } from '../harness/game.mjs';

const { assert, done } = makeAssert();
const g = boot();
const { window: w, errors } = g;
const doc = w.document;
const CA = w.CookieMgr;
await sleep(300);
const S = CA.Script;

// ---- the lists, per call
const lists = S.choiceLists();
const spell = (lists['spell.cast'] || [])[0];
assert(spell && spell.key === 'spell' && spell.items.length === 9 && spell.items.some((o) => o.v === 'hand of fate'), `spell.cast(spell): the 9 spells (${spell && spell.items.length})`);
assert((lists.building || [])[0] && lists.building[0].key === 'name', 'building(name): the buildings (a value’s list)');
// each call's own list, not every list that shares a name ("Profile")
const gp = (lists['grimoire.profile'] || [])[0];
const bp = (lists['buyer.profile'] || [])[0];
assert(gp && bp && gp.items.map((o) => o.v).join() !== bp.items.map((o) => o.v).join(), 'grimoire.profile and buyer.profile list their own profiles');
assert(S.callWith('spell.cast', 'spell', 'hand of fate') === 'spell.cast("hand of fate")', `callWith quotes a name with spaces (${S.callWith('spell.cast', 'spell', 'hand of fate')})`);
assert(S.callWith('building', 'name', 'Farm') === 'building(Farm)', 'callWith: a value');

// ---- in the editor
CA.UI.Menu.openPage('clickers');
const page0 = doc.querySelector('#CookieMgrMenu .ca-page');
assert(page0.classList.contains('ca-page-in'), 'opening a page fades it in');
CA.UI.MacrosPage.edit(null);
const ed = () => doc.querySelector('[data-macro-editor]');
assert(!doc.querySelector('#CookieMgrMenu .ca-page').classList.contains('ca-page-in'), 'redrawing the page you’re on: no fade (no flash of black)');
click(w, ed().querySelector('[data-edit-act="mode"][data-val="flow"]'));
const ta = () => ed().querySelector('[data-code]');
const lib = () => ed().querySelector('[data-ed-lib]');
const rowOf = (sig) => [...lib().querySelectorAll('.ca-lib-group:not(.ca-lib-pinned) .ca-lib-row')].find((r) => r.dataset.libText.startsWith(sig));

// ★: in place
const before = lib();
const row = rowOf('spell.cast(');
click(w, row.querySelector('[data-lib-fav]'));
assert(lib() === before && row.isConnected, '★ doesn’t redraw the library');
assert(lib().querySelector('.ca-lib-pinned [data-lib-fav="action:spell.cast"]') && !lib().querySelector('.ca-lib-pinned .ca-lib-empty'), 'a copy waits in Pinned');
assert(row.querySelector('[data-lib-fav]').classList.contains('on'), 'its ★ lights up where it is');
click(w, row.querySelector('[data-lib-fav]'));
assert(!lib().querySelector('.ca-lib-pinned [data-lib-fav="action:spell.cast"]') && lib().querySelector('.ca-lib-pinned .ca-lib-empty'), 'unpinned: the copy goes');
assert(CA.Settings.get('libFavs') === '', 'pins saved');

// the possible values
const more = row.querySelector('[data-lib-open]');
assert(more && /9 spells/.test(more.textContent), `the row says how many (${more && more.textContent})`);
assert(!rowOf('pop.golden(').querySelector('[data-lib-open]'), 'a call without a list: nothing to open');
click(w, more);
const box = row.nextElementSibling;
assert(box && box.matches('[data-lib-opts]') && !box.hidden && row.classList.contains('open'), 'click: the list opens under the row');
const opts = [...box.querySelectorAll('[data-lib-opt]')];
assert(opts.length === 9 && opts.some((o) => /Force the Hand of Fate/.test(o.textContent)), 'each spell, by name');
click(w, more);
assert(box.hidden && !row.classList.contains('open'), 'click again: closed');
click(w, more);
ta().value = 'forever:\n  ';
ta().setSelectionRange(11, 11);
click(w, opts.find((o) => /hand of fate/.test(o.textContent)));
assert(ta().value === 'forever:\n  spell.cast("hand of fate")', `picking one writes the call with it (${JSON.stringify(ta().value)})`);

// search finds a call by one of its values
click(w, more); // closed again
const search = lib().querySelector('[data-lib-search]');
search.value = 'stretch time';
search.dispatchEvent(new w.Event('input', { bubbles: true }));
assert(!row.classList.contains('hidden') && !box.hidden, 'searching a value shows the call, its list open');
const shown = [...box.querySelectorAll('[data-lib-opt]:not(.hidden)')];
assert(shown.length === 1 && /stretch time/.test(shown[0].textContent), 'only the values that match');
search.value = '';
search.dispatchEvent(new w.Event('input', { bubbles: true }));
assert(box.hidden && box.querySelectorAll('[data-lib-opt].hidden').length === 0, 'search cleared: the list it opened closes again');

assert(!errors.length, `no errors (${errors.slice(0, 2)})`);
done();
process.exit();
