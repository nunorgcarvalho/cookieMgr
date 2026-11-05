// v4.0.0: managers. A manager plays an ascension in stages; each stage switches macros on and off and
// puts in the Auto buyer, Pantheon, dragon, Grimoire and garden profiles it names, then moves on once its
// "until" (a condition in the macro language) holds. The Manager macro runs the active one; a new
// ascension starts it over. Nunix late game comes seeded. The sidebar is in its new order. A manager is
// code (switch on a, b, c on one line); the Upgrade unlocker switches the upgrade-unlocking macros at once.
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { boot, sleep, makeAssert } from '../harness/game.mjs';

const { assert, done } = makeAssert();
const g = boot({ idb: { factory: new IDBFactory(), IDBKeyRange } });
const { window: w, Game } = g;
const CA = w.CookieMgr;
await sleep(400);
const G = CA.Managers;
const M = CA.Macros;
const value = (id, ...args) => CA.Script.VALUES.find((v) => v.id === id).get(...args);

// ---- the seeded manager ----
const nunix = G.find('nunixLateGame');
assert(nunix && nunix.name === 'Nunix late game', 'Nunix late game is seeded');
assert(G.current() === nunix && value('manager.active') === 'nunixLateGame', 'and active');
assert(nunix.stages.map((s) => s.name).join() === 'Drops,Reindeer,Golden cookie combos', 'three stages: Drops, Reindeer, Golden cookie combos');
// (v4.1: a stage keeps only what it changes — these are what each runs with, the ones before it added up)
const [drops, reindeer, combos] = nunix.stages.map((st, i) => ({ ...G.effective(nunix, i), until: st.until }));
// no Shimmering veil stage: the big cookie clicked from the start, golden and wrath cookies not until the combos
// (Scorn makes them all wrath cookies)
assert(drops.macros.bigCookie === 'on' && drops.macros.reindeer === 'on' && drops.macros.golden === 'off' && drops.macros.wrath === 'off', 'Drops clicks the big cookie and reindeer, not golden cookies');
assert(combos.macros.golden === 'on' && combos.macros.wrath === 'on', 'Golden cookie combos clicks them again');
// the Upgrade unlocker: one switch for Santa, research, the dragon, fortunes and cheap upgrades
const un = M.get('upgradeUnlocker');
assert(un && un.mode === 'group' && un.members.join() === 'santa,research,autoDragon,petDragon,fortune,cheapUpgrades,goldenUpgrades', 'the Upgrade unlocker groups them');
M.set('upgradeUnlocker', true, { silent: true });
assert(un.members.every((id) => M.isOn(id)) && !M.isOn('autoBuyer'), 'switching it on switches them on (not the Auto buyer)');
M.set('upgradeUnlocker', false, { silent: true });
assert(un.members.every((id) => !M.isOn(id)), 'and off');
assert([drops, reindeer, combos].every((st) => st.macros.upgradeUnlocker === 'on' && st.macros.autoBuyer === 'on'), 'every stage: the Upgrade unlocker and the Auto buyer');
assert(drops.inputs.research.stopBefore === 'none', 'all the research (the Elder Pact puts up the Pledge Reindeer buys)');
assert(drops.macros.elderPledge === 'off' && reindeer.macros.elderPledge === 'on' && reindeer.profiles.dragon === 'dropsFlight', 'Reindeer: the elders pledged, dragon drops & flight');
assert(G.untilProblem(reindeer.until) === '' && reindeer.until === 'season.complete(christmas)', 'Reindeer lasts until Christmas is complete');
assert(drops.macros.autoBuyer === 'on' && drops.macros.seasonCompletion === 'on', 'Drops: the Auto buyer and SeasonCompletion');
assert(drops.macros.gardener === 'on' && drops.profiles.garden === 'weedFarm' && drops.macros.stockTrader === 'off' && drops.macros.fthofOnClickFrenzy === 'off', 'Drops: the garden a weed farm; no stocks or FtHoF');
assert(['reindeer', 'wrinklers', 'lumps'].every((id) => drops.macros[id] === 'on') && drops.macros.golden === 'off' && drops.macros.wrath === 'off', 'Drops: reindeer, wrinklers, lumps — not golden cookies (Scorn makes them wrath)');
assert(drops.profiles.pantheon === 'wrinklers' && drops.profiles.dragon === 'drops' && drops.profiles.buyer === 'payback', 'Drops: Pantheon wrinklers, dragon drops, Payback buyer');
assert(combos.macros.gardener === 'on' && combos.macros.fthofOnClickFrenzy === 'on' && combos.macros.autoBuyer === 'on', 'Combos: the garden still on, FtHoF joins the Auto buyer');
assert(combos.profiles.buyer === 'combos', 'Combos: the Golden cookie combos buyer profile');
const bc = CA.AutoBuyer.find('combos');
assert(bc && bc.mode === 'actualIncome' && bc.banks.join() === 'lucky,gardenRounds' && bc.reserve === 0, 'which ranks by actual income and keeps the Lucky! and garden rounds banks');
const bp = CA.AutoBuyer.find('payback');
assert(bp.banks.length === 0 && bp.reserve === 0, 'Drops spends freely (Payback: no reserve, no banks)');
const snapshot = CA.Settings.serialize();
// an older save (without combos) gets it; a save that deleted it keeps it deleted
CA.Settings.load(JSON.stringify({ buyer: { profiles: [{ id: 'payback', name: 'Payback' }], active: 'payback' } }));
assert(CA.AutoBuyer.find('combos'), 'a save from before v4.0 gets the combos profile');
CA.Settings.load(JSON.stringify({ buyer: { profiles: [{ id: 'payback', name: 'Payback' }], active: 'payback', seeded: ['payback', 'buildings', 'upgrades', 'combos'] } }));
assert(!CA.AutoBuyer.find('combos'), 'one you deleted stays deleted');
CA.Settings.load(snapshot);
assert(reindeer.profiles.pantheon === 'golden' && combos.profiles.pantheon === 'golden' && combos.profiles.dragon === 'dragonFlightHarvest' && combos.profiles.garden === 'tulipCombos', 'Reindeer on: golden Pantheon, tulip combos; Combos: Dragonflight & Harvest');
assert(M.get('manager') && M.get('manager').mode === 'flow', 'the Manager macro');
Object.keys(drops.macros).forEach((id) => assert(M.get(id), `the stage’s macro ${id} exists`));
assert(G.untilProblem(drops.until) === '', `Drops' until compiles (${G.untilProblem(drops.until)})`);

// ---- SeasonCompletion, slimmed; Santa ----
const sc = M.get('seasonCompletion');
const src = M.sourceOf(sc);
assert(!/dragon\.|pantheon\.|switch on|buy\.research|grandma\.exit/.test(src), 'SeasonCompletion only does the seasons now');
assert(/season\.keep\(then\)/.test(src) && !M.problemOf('seasonCompletion'), 'and ends on its then input');
assert(M.get('santa') && /santa\.upgrade/.test(M.sourceOf(M.get('santa'))), 'a Santa macro');

// ---- running it ----
const has = Game.Has;
Game.Has = (n) => n === 'Shimmering veil [off]' || has(n); // the veil is up
assert(value('veil') === true, 'veil(): the Shimmering veil is up');
Game.Has = has;
M.set('bigCookie', false, { silent: true });
M.set('golden', true, { silent: true });
assert(G.step() > 0, 'the first pass enters stage 1');
assert(value('manager.stage') === 1 && value('manager.stageName') === 'Drops', 'manager.stage() 1, Drops');
assert(M.isOn('bigCookie') && M.isOn('reindeer') && !M.isOn('golden') && !M.isOn('wrath') && M.isOn('autoBuyer') && M.isOn('seasonCompletion') && M.isOn('santa'), 'it switched the macros (the Upgrade unlocker’s too)');
assert(CA.AutoBuyer.activeProfile() === 'payback', 'and the buyer profile');
assert(M.isOn('gardener') && CA.GardenLayers.picked('profile') === 'weedFarm', 'and the garden a weed farm (not ready for the combos yet)');
assert(M.inputsOf(M.get('research')).stopBefore === 'none' && M.inputsOf(M.get('seasonCompletion')).then === 'fools', 'and the macros’ settings');
// you flip one by hand: it stays flipped (macros switch once, on entering)
M.set('bigCookie', false, { silent: true });
G.step();
assert(!M.isOn('bigCookie'), 'a macro flipped by hand stays flipped');
M.set('bigCookie', true, { silent: true });

// until: a condition of your own moves it on
G.updateStage('nunixLateGame', 0, { until: 'cookies() > 1000' });
Game.cookies = 10;
G.step();
assert(value('manager.stage') === 1, 'until not yet: still stage 1');
Game.cookies = 5000;
G.step();
assert(value('manager.stage') === 2 && M.isOn('elderPledge') && M.isOn('gardener') && M.isOn('golden') && M.isOn('fthofOnClickFrenzy'), 'until holds: stage 2, the elders pledged, golden cookie combos already');
G.goTo(3);
G.step();
assert(value('manager.stage') === 3 && M.isOn('gardener') && M.isOn('fthofOnClickFrenzy') && M.isOn('golden') && M.isOn('wrath'), 'stage 3: garden, FtHoF, golden and wrath cookies on');
assert(CA.AutoBuyer.activeProfile() === 'combos', 'stage 3: the combos buyer profile');
assert(CA.GardenLayers.picked('profile') === 'tulipCombos', 'the garden profile is in');
// a garden not ready for it (a seed it plants still locked): the weed farm meanwhile, the profile once it is
const farm = CA.Util.minigame('Farm');
farm.plants = { goldenClover: { name: 'Golden clover', unlocked: 0 }, nursetulip: { name: 'Nursetulip', unlocked: 1 } };
G.goTo(2);
for (let i = 0; i < 5; i++) G.step();
const gardenWait = (G.where().pending || []).find((x) => x.kind === 'garden');
assert(CA.GardenLayers.picked('profile') === 'weedFarm' && gardenWait && /Golden clover unlocked/.test(gardenWait.waits), `seeds locked: the weed farm, waiting on them (${gardenWait && gardenWait.waits})`);
farm.plants.goldenClover.unlocked = 1;
G.step();
assert(CA.GardenLayers.picked('profile') === 'tulipCombos', 'unlocked: the tulips and clovers go in');
delete farm.plants;
G.goTo(3);
G.step();
G.step();
assert(value('manager.stage') === 3, 'the last stage lasts');
assert(G.untilProblem('cookies( >') !== '', 'a broken until is reported');

// goTo, and a new ascension starts it over
CA.Actions.run('manager.goTo', { stage: 1 });
assert(value('manager.stage') === 1, 'manager.goTo(1)');
G.goTo(3);
Game.cookies = 10;
Game.resets = (Game.resets || 0) + 1;
G.step();
assert(value('manager.stage') === 1, 'a new ascension: back to stage 1');
G.goTo(3);
CA.Events.emit('ascend');
assert(!G.where().started, 'the ascend event resets it too');
G.step();
assert(value('manager.stage') === 1, '…and the next pass is stage 1');

// ---- profiles of managers ----
const copy = G.add(null, 'nunixLateGame');
assert(copy.name === 'Nunix late game (copy)' && copy.stages.length === 3, 'duplicate');
G.addStage(copy.id, 2);
G.setStageMacro(copy.id, 3, 'lumps', 'off');
G.setStageProfile(copy.id, 3, 'grimoire', 'savingUp');
assert(copy.stages.length === 4 && copy.stages[3].macros.lumps === 'off' && copy.stages[3].profiles.grimoire === 'savingUp', 'a fourth stage, edited');
G.moveStage(copy.id, 3, -1);
assert(copy.stages[2].profiles.grimoire === 'savingUp', 'moved up');
CA.Actions.run('manager.use', { manager: copy.id });
assert(value('manager.active') === copy.id, 'manager.use');

// saved with the game
const S = CA.Settings;
const saved = S.serialize();
G.remove(copy.id);
S.load(saved);
assert(G.find(copy.id) && G.find(copy.id).stages.length === 4 && value('manager.active') === copy.id, 'saved and loaded');
G.use('nunixLateGame');
G.revert('nunixLateGame');
assert(G.find('nunixLateGame').stages[0].until.includes('season.complete'), 'Nunix late game reverted to default');

// ---- a manager is code ----
const code = G.codeOf(G.find('nunixLateGame'));
assert(!CA.Script.compile(code).errors.length, 'Nunix late game, as code, reads fine');
// (v4.1: a block for the stage and the ones after it, its first pass manager.arriving(N))
assert(/if manager\.stage\(\) >= 1:\n {2}if manager\.arriving\(1\):\n {4}macro\.setting\(research, stopBefore, none\)/.test(code) && /\n {4}switch off golden, wrath\b/.test(code), 'a block per stage: its first pass sets settings and switches macros');
assert(/\n {4}switch on autoBuyer, upgradeUnlocker, /.test(code) && code.split('\n').length < 70, 'switches on one line, split by commas (the whole manager in under 70 lines)');
assert(/manager\.profile\(buyer, combos\)/.test(code) && /if manager\.stage\(\) == 2:\n {4}if season\.complete\(christmas\):\n {6}manager\.next\(\)/.test(code), 'its profiles, and its until moving it on');
assert(M.sourceOf(M.get('manager')) === code, 'the Manager macro runs that code');
assert(/line \d+/.test(G.setCode('nunixLateGame', 'if manager.stage( == 1:')), 'code with a problem isn’t saved');
const mine = `if manager.stage() == 1:\n  if manager.entering():\n    switch on lumps\n  if cookies() > 100:\n    manager.next()\nif manager.stage() == 2:\n  manager.profile(grimoire, savingUp)\n`;
assert(G.setCode('nunixLateGame', mine) === '' && M.sourceOf(M.get('manager')) === mine, 'your own code: the Manager runs it');
M.set('lumps', false, { silent: true });
Game.cookies = 10;
G.goTo(1);
G.step();
assert(M.isOn('lumps') && value('manager.stage') === 1, 'its first pass: switches');
M.set('lumps', false, { silent: true });
G.step();
assert(!M.isOn('lumps'), 'only on the first pass');
Game.cookies = 1000;
G.step();
G.step();
assert(value('manager.stage') === 2 && CA.CastTiers.activeId() === 'savingUp', 'manager.next(), then manager.profile()');
CA.CastTiers.use('default');
G.step();
assert(CA.CastTiers.activeId() === 'default', 'a profile is put in once a stage: switched by hand, it stays');
G.setCode('nunixLateGame', null);
assert(M.sourceOf(M.get('manager')) === code, 'back to its stages');
// the Manager macro itself, running
G.goTo(1);
M.setEvery('manager', 50);
M.set('manager', true, { silent: true });
await sleep(300);
assert(M.isOn('autoBuyer') && !M.problemOf('manager'), 'the Manager macro runs it (no problems)');
M.set('manager', false, { silent: true });

// ---- hover cards (v3.53.0's shared registry): a manager, a profile of the kind named, a macro's setting ----
const hover = (code, l, word) => {
  const line = code.split('\n')[l - 1];
  return CA.ScriptWords.explain(code, l, line.indexOf(word) + 1);
};
const hsrc = 'manager.use(nunixLateGame)\nmanager.profile(garden, tulipCombos)\nmacro.setting(research, stopBefore, none)\nmanager.profile(dragon, drops)';
assert(hover(hsrc, 1, 'nunixLateGame').kind === 'manager' && hover(hsrc, 1, 'nunixLateGame').title === 'Nunix late game', 'a manager’s id: its card');
assert(hover(hsrc, 2, 'tulipCombos').kind === 'profile.garden' && hover(hsrc, 4, 'drops').kind === 'profile.dragon', 'manager.profile: the profile of the kind it names');
assert(hover(hsrc, 3, 'stopBefore').kind === 'setting' && hover(hsrc, 3, 'stopBefore').title === 'Stop before', 'macro.setting: the macro’s setting');
assert(hover('if not veil():\n  manager.next()', 1, 'veil').kind === 'value', 'veil(): a value');

// ---- the sidebar ----
const pages = CA.UI.Pages.list().slice().sort((a, b) => a.order - b.order);
const byGroup = (gr) => pages.filter((p) => p.group === gr).map((p) => p.label).join(',');
assert(byGroup('data') === 'Events,Stats,Payback', `data: ${byGroup('data')}`);
assert(byGroup('minigames') === 'Garden,Stock market,Pantheon,Grimoire,Dragon', `minigames: ${byGroup('minigames')}`);
assert(byGroup('custom') === 'Statistics,Macros,Managers,Widgets,Settings', `custom: ${byGroup('custom')}`);

// ---- the page ----
const doc = w.document;
const click = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const menu = () => doc.getElementById('CookieMgrMenu');
CA.UI.Menu.openPage('managers');
await sleep(50);
assert(/Nunix late game/.test(menu().textContent), 'the page shows Nunix late game');
assert(menu().querySelectorAll('[data-mgr-act="tab"]').length === 3, 'its three stages (a tab each)');
click(menu().querySelector('[data-mgr-act="tab"][data-i="0"]'));
const rs = menu().querySelector('[data-mgr-input][data-macro="research"][data-key="stopBefore"]') || menu().querySelector('[data-mgr-act="pick"][data-macro="research"].sel');
assert(rs && (rs.value || rs.dataset.v) === 'none', 'Research’s setting, set by the stage');
// (stage tabs: × drops a setting, a chip click flips a macro)
click(rs.closest('.ca-mgr-set').querySelector('[data-mgr-act="uninput"]'));
assert(!G.find('nunixLateGame').stages[0].inputs.research, 'a setting back to left as it is');
assert(menu().querySelector('.ca-mgr-chip.off [data-mgr-act="flip"][data-macro="golden"]'), 'Golden cookies: off in a chip');
click(menu().querySelector('.ca-mgr-chip [data-mgr-act="flip"][data-i="0"][data-macro="lumps"]'));
assert(G.find('nunixLateGame').stages[0].macros.lumps === 'off', 'clicking a chip: on → off');
click(menu().querySelector('[data-mgr-act="goto"][data-i="2"]'));
assert(value('manager.stage') === 3, 'a stage chip goes there');
const ta = menu().querySelector('[data-mgr-code] [data-code]');
assert(ta && ta.value === G.codeOf(G.find('nunixLateGame')), 'the Code card: what the Manager runs');
ta.value = ta.value.replace('switch on elderPledge', 'switch on elderPledge, stockTrader');
ta.dispatchEvent(new w.Event('input', { bubbles: true }));
click(menu().querySelector('[data-mgr-act="saveCode"]'));
assert(typeof G.find('nunixLateGame').code === 'string' && /switch on elderPledge, stockTrader/.test(G.find('nunixLateGame').code), 'Save makes the code yours');
assert(!menu().querySelector('.ca-mgr-lib') && menu().querySelector('[data-mgr-act="uncode"]'), 'the stage editor is off, Back to stages instead');
const back = menu().querySelector('[data-mgr-act="uncode"]');
click(back);
click(menu().querySelector('[data-mgr-act="uncode"]') || back);
assert(G.find('nunixLateGame').code === undefined && menu().querySelector('.ca-mgr-lib'), 'Back to stages');

M.list().forEach((m) => M.isOn(m.id) && M.set(m.id, false, { silent: true }));
assert(g.errors.length === 0, 'no runtime errors' + (g.errors.length ? `: ${g.errors.slice(0, 3).join(' | ')}` : ''));
done();
process.exit();
