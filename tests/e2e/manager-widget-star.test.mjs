// Manager widget star: the ☆ that puts the Manager widget on the left panel is on the Stages card and
// in each stage's widget watches too (not only on the Manager card), the same star everywhere.
import { boot, sleep, makeAssert } from '../harness/game.mjs';

const { assert, done } = makeAssert();
const g = boot();
const { window: w, Game } = g;
const CA = w.CookieMgr;
await sleep(400);
const Wd = CA.UI.Widgets;
const doc = w.document;
const click = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const page = () => doc.querySelector('[data-page="managers"]');
Game.resets = 1;
CA.UI.Menu.openPage('managers');
if (Game.onMenu !== CA.MENU_ID) Game.ShowMenu(CA.MENU_ID);
CA.UI.Menu.render();
await sleep(50);
const stagesStar = () => [...page().querySelectorAll('.ca-card')].find((c) => /Stages ·/.test(c.querySelector('.ca-card-title').textContent)).querySelector('.ca-card-head .ca-wstar');
assert(stagesStar(), 'the Stages card has the ☆');
const watchStar = () => page().querySelector('[data-mgr-watchbox] .ca-wstar');
assert(watchStar() && /Manager.*widget/.test(watchStar().dataset.tip), 'so do the widget watches, its tip saying what it is');
assert(!Wd.hasPreset(CA.UI.ManagerWidget.PRESET), 'not on the panel yet');
click(watchStar());
assert(Wd.hasPreset(CA.UI.ManagerWidget.PRESET), 'clicked: the Manager widget is on the left panel');
CA.UI.Menu.render();
assert([...page().querySelectorAll('.ca-wstar')].every((s) => s.classList.contains('on')), 'every star shows it');
click(stagesStar());
assert(!Wd.hasPreset(CA.UI.ManagerWidget.PRESET), 'clicked again: taken away');

assert(g.errors.length === 0, 'no runtime errors' + (g.errors.length ? `: ${g.errors.slice(0, 3).join(' | ')}` : ''));
done();
process.exit();
