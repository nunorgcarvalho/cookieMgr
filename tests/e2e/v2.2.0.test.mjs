// v2.2.0: Wizard tower — spell macros, auto FtHoF on Click frenzy, combos, Grimoire toolbar, AND conditions.
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { boot, sleep, makeAssert, click } from '../harness/game.mjs';

const { assert, done } = makeAssert();
const g = boot({ idb: { factory: new IDBFactory(), IDBKeyRange } });
const { window: w, Game, G, calls } = g;
const CA = w.CookieMgr;
const doc = w.document;
await sleep(300);

const items = [...doc.querySelectorAll('#CookieMgrTab [data-tab-item]')].map((i) => i.dataset.tabItem);
// v3.6: + Stats, Payback; v3.43: Payback right above Macros
// v3.27: + Tooltips
assert(items.join() === 'events,graphs,payback,garden,stocks,pantheon,wizard,dragon,tooltips,clickers,managers,widgets,settings', `sidebar (${items})`);

// ---- built-in spell macros
const spellMacros = CA.Grimoire.SPELLS.map((s) => CA.Macros.get(s.id));
assert(spellMacros.length === 9 && spellMacros.every((m) => m && m.builtin && m.mode === 'once' && m.section === 'grimoire'), 'a built-in "Cast …" macro per spell');
const auto = CA.Macros.get('fthofOnClickFrenzy');
// v2.30: an algorithmic macro casting on combos (tests/e2e/v2.30.0.test.mjs), no longer a "When…" on Click frenzy
assert(auto && auto.builtin && auto.mode === 'flow', 'built-in auto-FtHoF macro');
assert(!CA.Macros.remove('fthofOnClickFrenzy') && CA.Macros.get('fthofOnClickFrenzy'), 'and it can’t be removed');

// ---- Wizard tower page
CA.UI.Menu.openPage('wizard');
await sleep(50);
const page = () => doc.querySelector('[data-page="wizard"]');
CA.UI.WizardPage.sync();
assert(/80 \/ 100 magic/.test(page().querySelector('[data-wiz-text]').textContent), `magic meter (${page().querySelector('[data-wiz-text]').textContent})`);
assert(page().querySelectorAll('[data-wiz-spell]').length === 9, 'nine spell tiles');
const tile = (key) => [...page().querySelectorAll('[data-wiz-spell]')].find((el) => el.dataset.wizSpell === key);
assert(tile('hand of fate').classList.contains('ready') && /70 magic · 15% backfire/.test(tile('hand of fate').textContent), 'FtHoF affordable: cost + backfire chance');
assert(!tile('summon crafty pixies').classList.contains('ready') && tile('summon crafty pixies').querySelector('[data-wiz-cast-btn]').classList.contains('ca-unaffordable'), 'spells the minigame doesn’t have are dimmed');

// cast from the page
click(w, tile('hand of fate').querySelector('[data-wiz-cast-btn]'));
assert(calls.spells.includes('Force the Hand of Fate') && G.magic === 10, 'Cast button casts it');
const ev = CA.EventLog.list(['spell']);
assert(ev.length === 1 && ev[0].title === 'Cast Force the Hand of Fate' && !ev[0].data.backfired, 'cast logged as a spell event');
CA.UI.WizardPage.sync();
assert(!tile('hand of fate').classList.contains('ready') && /ready in/.test(tile('hand of fate').textContent), 'shows when it will be affordable again');
assert(CA.Grimoire.secondsUntil(70) > 0 && Number.isFinite(CA.Grimoire.secondsUntil(70)), 'refill estimate uses the game formula');

// casting from the Grimoire itself is logged too, and backfires are detected
G.magic = 100;
G.forceFail = true;
G.castSpell(G.spells['conjure baked goods']);
G.forceFail = false;
const ev2 = CA.EventLog.list(['spell']);
assert(ev2.length === 2 && ev2[1].title === 'Conjure Baked Goods backfired' && ev2[1].data.backfired, 'Grimoire’s own casts logged, backfire spotted');

// ---- auto FtHoF (v2.30: on combos — see v2.30.0.test.mjs)
calls.spells.length = 0;
G.magic = 100;
CA.Macros.set('fthofOnClickFrenzy', true);
await sleep(400);
assert(calls.spells.length === 0, 'no combo, no cast');
G.magic = 10; // not enough magic when the combo starts…
Game.buffs.Frenzy = { name: 'Frenzy', time: 300, maxTime: 300, multCpS: 7 };
Game.buffs['Click frenzy'] = { name: 'Click frenzy', time: 300, maxTime: 300, multClick: 777 };
await sleep(400);
assert(calls.spells.length === 0, 'not enough magic: waits');
G.magic = 100; // …and casts as soon as there is, during the same combo
await sleep(400);
assert(calls.spells.join() === 'Force the Hand of Fate', `casts once the magic is there (${calls.spells})`);
delete Game.buffs.Frenzy;
delete Game.buffs['Click frenzy'];
CA.Macros.set('fthofOnClickFrenzy', false);

// conditions
G.magic = 50;
assert(CA.Conditions.test({ cond: 'magicPct', params: { op: '>=', value: 50 } }) && !CA.Conditions.test({ cond: 'magicPct', params: { op: '>=', value: 51 } }), 'magic % condition');
assert(!CA.Conditions.test({ cond: 'spellAffordable', params: { spell: 'hand of fate' } }) && CA.Conditions.test({ cond: 'spellAffordable', params: { spell: 'conjure baked goods' } }), 'spell affordable condition');
assert(CA.Conditions.test({ all: [{ cond: 'magicPct', params: { op: '>=', value: 10 } }, { cond: 'spellAffordable', params: { spell: 'stretch time' } }] }), 'AND of two conditions');
assert(!CA.Conditions.test({ all: [] }), 'an empty AND never holds');

// ---- Grimoire toolbar
await sleep(1100);
const bar = doc.getElementById('cm-grimoire-toolbar');
assert(bar && bar.previousElementSibling.id === 'grimoireInfo', 'toolbar under the Grimoire info line');
click(w, bar.querySelector('[data-cm-gt="auto"]'));
assert(CA.Macros.isOn('fthofOnClickFrenzy') && /on$/.test(doc.querySelector('[data-cm-gt="auto"]').textContent), 'toolbar switch = the auto-cast macro');
click(w, doc.querySelector('[data-cm-gt="auto"]'));
CA.UI.Menu.close();
click(w, doc.querySelector('[data-cm-gt="open"]'));
assert(CA.UI.Menu.isOpen() && CA.Settings.get('tab') === 'wizard', 'toolbar opens the Wizard tower page');

// ---- combos
await sleep(50);
click(w, page().querySelector('[data-wiz-newcombo]'));
const ed = doc.querySelector('[data-macro-editor]');
assert(ed && CA.Settings.get('tab') === 'clickers', 'New combo opens the macro editor');
assert(doc.querySelector('[data-edit="steps.0.params.spell"]').value === 'hand of fate' && doc.querySelector('[data-edit="steps.1.params.spell"]').value === 'stretch time', 'preset with two spell steps');
click(w, doc.querySelector('[data-edit-act="save"]'));
const combo = CA.Macros.list().find((m) => !m.builtin && m.name === 'Spell combo');
assert(combo && combo.mode === 'once' && combo.steps.length === 2, 'combo saved');
calls.spells.length = 0;
G.magic = 100;
CA.Macros.runOnce(combo.id);
assert(calls.spells.join() === 'Force the Hand of Fate,Stretch Time', `combo casts both (${calls.spells})`);
CA.UI.Menu.openPage('wizard');
await sleep(50);
assert(page().querySelector(`[data-macro-row="${combo.id}"]`), 'combo listed on the Wizard tower page');

// AND conditions in the editor
CA.UI.Menu.openPage('clickers');
click(w, doc.querySelector('[data-ca="macro-new"]'));
const set = (sel, val) => {
  const el = doc.querySelector(sel);
  el.value = val;
  el.dispatchEvent(new w.Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
};
set('[data-edit="name"]', 'Two conditions');
click(w, doc.querySelector('[data-edit-act="mode"][data-val="when"]'));
click(w, doc.querySelector('[data-edit-act="cond-add"]'));
set('[data-edit="when.all.1.cond"]', 'magicPct');
assert(doc.querySelector('[data-edit="when.all.1.params.value"]'), 'second condition with its own options');
click(w, doc.querySelector('[data-edit-act="save"]'));
const two = CA.Macros.list().find((m) => m.name === 'Two conditions');
assert(two && two.when.all.length === 2 && two.when.all[1].cond === 'magicPct' && two.when.all[1].params.value === 100, 'saved with both conditions');

// v2.0-style single condition still loads
const old = CA.Macros.save({ name: 'Old style', mode: 'when', when: { cond: 'buff', params: { name: 'Frenzy' }, edge: 'rise' }, steps: [{ action: 'pop.golden' }] });
assert(old.when.all.length === 1 && old.when.all[0].params.name === 'Frenzy', 'v2.0 single-condition macros upgrade');

// favorite a spell → shortcuts widget
CA.UI.Menu.openPage('wizard');
await sleep(50);
click(w, tile('hand of fate').querySelector('[data-wiz-fav]'));
assert(CA.Macros.isFav('castFthof'), 'star a spell');
CA.UI.Widgets.add('shortcuts');
CA.UI.Widgets.tick();
const sc = doc.querySelector('#CookieMgrWidgets [data-w-trigger="castFthof"]');
calls.spells.length = 0;
G.magic = 100;
click(w, sc);
assert(calls.spells.join() === 'Force the Hand of Fate', 'spell button on the Shortcuts widget casts it');

// magic plot
CA.UI.Menu.openPage('wizard');
await sleep(1200);
const mp = CA.UI.Plot.get('magic').last();
assert(mp && mp.data.lines.magic.length > 0 && mp.data.markers.length >= 1, 'magic plot with cast markers');

// Wizard tower settings card
CA.UI.Menu.openPage('settings:all');
assert(doc.querySelector('.ca-index [data-key="grimoireToolbar"]'), 'Grimoire options in the Settings index (v2.15: on the Grimoire page)');

// no Grimoire at all
const g2 = boot({ withGrimoire: false });
await sleep(300);
g2.window.CookieMgr.UI.Menu.openPage('wizard');
assert(/Grimoire minigame opens/.test(g2.window.document.querySelector('[data-page="wizard"]').textContent), 'explains when the Grimoire isn’t unlocked');
assert(g2.window.CookieMgr.Actions.run('spell.cast', { spell: 'hand of fate' }) === 0, 'casting without a Grimoire does nothing');
g2.window.close();

assert(g.errors.length === 0 && g2.errors.length === 0, 'no runtime errors' + (g.errors.length ? `: ${g.errors.slice(0, 3).join(' | ')}` : '') + (g2.errors.length ? `: ${g2.errors[0]}` : ''));
done();
process.exit();
