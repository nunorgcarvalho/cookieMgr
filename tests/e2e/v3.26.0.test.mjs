// v3.26.0: see-through widgets (Background Faint or None) brighten their muted text — labels, notes, chart axes —
// and outline it like the rest; Solid ones keep the dark beige.
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { boot, sleep, makeAssert } from '../harness/game.mjs';

const { assert, done } = makeAssert();
const g = boot({ idb: { factory: new IDBFactory(), IDBKeyRange } });
const { window: w } = g;
const CA = w.CookieMgr;
const doc = w.document;
await sleep(300);
const css = [...doc.querySelectorAll('style')].map((s) => s.textContent).join('\n');

// ---- the CSS: the muted classes get a bright color only under .ca-w-clear; chart axis text gets a stroke
['.ca-w-stat span', '.ca-tl-nums em', '.ca-w-empty', '.ca-ev-time', '.ca-sp-ticks text', '.ca-graph-mini .ca-legend'].forEach((sel) =>
  assert(css.includes(`#CookieMgrWidgets .ca-w-clear ${sel}`), `${sel} has a see-through override`)
);
assert(/\.ca-w-clear \.ca-sp-chart text \{[^}]*paint-order: stroke/.test(css), 'SVG chart text is outlined in see-through widgets');

// ---- the frame: Faint/None widgets are .ca-w-clear, Solid ones aren't
const frame = (bg) => {
  CA.UI.Widgets.list().forEach((x) => CA.UI.Widgets.remove(x.id));
  CA.UI.Widgets.add('stats', { x: 0, y: 0 }, { bg });
  CA.UI.Widgets.render();
  return doc.querySelector('#CookieMgrWidgets .ca-w');
};
assert(!frame(1).classList.contains('ca-w-clear'), 'Solid: not see-through');
assert(frame(0.4).classList.contains('ca-w-clear'), 'Faint: see-through');
assert(frame(0).classList.contains('ca-w-clear'), 'None: see-through');

done();
process.exit();
