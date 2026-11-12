// American English: the British names that saves, shared statistics and macro code used still read,
// as their American spelling — the storeColours option, a statistic's colour field (saved, or shared as
// text), alert.flash's colour option (in code, in a saved step, as a built-in alert's row choice).
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { boot, sleep, makeAssert } from '../harness/game.mjs';

const { assert, done } = makeAssert();
const idb = { factory: new IDBFactory(), IDBKeyRange };
const g = boot({ idb });
await sleep(300);
const CA = g.window.CookieMgr;

// ---- a save written with the old names
CA.Settings.set('storeColors', false);
const mine = CA.Stats.add({ label: 'Old one', color: 'blue', source: 'return 1' });
CA.Stats.update('price', { label: 'Cost', color: 'green' });
CA.Macros.setParam('alertWrath', 0, 'color', 'blue');
g.window.Game.WriteSave();
const data = JSON.parse(g.window.Game.modSaveData.CookieMgr);
data.options.storeColours = data.options.storeColors;
delete data.options.storeColors;
data.stats.mine.forEach((s) => ((s.colour = s.color), delete s.color));
data.stats.builtin.price = { label: 'Cost', colour: 'green' };
data.macros.prefs.alertWrath.params = { '0.colour': 'blue' };
data.macros.custom.push({ id: 'oldFlash', name: 'Old flash', mode: 'once', steps: [{ action: 'alert.flash', params: { colour: 'purple' } }] });
g.window.localStorage.clear();
g.window.close();

const g2 = boot({ idb, save: JSON.stringify(data) });
await sleep(300);
const C2 = g2.window.CookieMgr;
assert(C2.Settings.get('storeColors') === false, 'storeColours (off) reads as storeColors');
assert(C2.Stats.get(mine.id).color === 'blue' && !('colour' in C2.Stats.get(mine.id)), 'a statistic saved with colour: its color');
assert(C2.Stats.get('price').color === 'green', 'a built-in changed under colour: its color');
const wrath = C2.Macros.get('alertWrath');
assert(C2.Macros.stepsOf(wrath)[0].params.color === 'blue', 'a built-in alert’s row choice saved as 0.colour');
assert(C2.Actions.paramsFor('alert.flash', { colour: 'purple' }).color === 'purple', 'a saved step’s colour option reads as color');

// ---- shared text and code
const shared = C2.Stats.fromText('# cookieMgr statistic\n# label: Shared\n# colour: orange\nreturn 2');
assert(shared && shared.color === 'orange', 'shared text with # colour: its color');
assert(/# color: orange/.test(C2.Stats.toText(shared)), 'written back as # color');
const r = C2.Script.compile('alert.flash(colour=red)');
assert(!r.errors.length && r.flow[0].params.color === 'red', `alert.flash(colour=red) in code (${JSON.stringify(r.errors)})`);
assert(!C2.Script.library().some((x) => /colour/i.test(JSON.stringify(x))), 'no British spelling in the library');

assert(g2.errors.length === 0, 'no runtime errors' + (g2.errors.length ? `: ${g2.errors.slice(0, 3).join(' | ')}` : ''));
g2.window.close();
done();
process.exit();
