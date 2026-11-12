// v3.53.0: hovering a word of code shows what it is — in every code editor (macros, statistics, the
// gardener) and in the statistics catalog's code. One registry, CA.Words, says what each kind of word is;
// CA.ScriptWords reads the word at a place in the code (a keyword, a call, a choice inside ( ), a variable…).
import { boot, sleep, makeAssert } from '../harness/game.mjs';

const { assert, done } = makeAssert();
const g = boot();
const { window: w, errors } = g;
const doc = w.document;
const CA = w.CookieMgr;
await sleep(300);

// ---- the registry ----
CA.Words.defineKind('test.fruit', { name: 'Fruit', info: (id) => (id === 'apple' ? { title: 'Apple', desc: 'red', rows: [['crunch', 'yes']] } : null) });
let i = CA.Words.lookup('test.fruit', 'apple');
assert(i && i.title === 'Apple' && i.tag === 'Fruit' && i.kind === 'test.fruit' && i.id === 'apple', 'a kind describes its words');
assert(CA.Words.lookup('test.fruit', 'pear') === null, '… and says nothing of one it doesn’t know');
CA.Words.define('test.fruit', 'pear', { title: 'Pear', desc: 'green' });
assert(CA.Words.lookup('test.fruit', 'pear').title === 'Pear', 'one word defined on its own');
CA.Words.define('test.fruit', 'apple', (ctx) => ({ note: `on line ${ctx.line}` }));
i = CA.Words.lookup('test.fruit', 'apple', { line: 3 });
assert(i.title === 'Apple' && i.note === 'on line 3', 'a word’s own info goes on top of its kind’s');
assert(['keyword', 'action', 'condition', 'value', 'variable', 'macro', 'profile.buyer', 'profile.dragon', 'profile.pantheon', 'profile.grimoire', 'spell', 'season'].every((k) => CA.Words.kinds().includes(k)), `the kinds (${CA.Words.kinds()})`);

// ---- reading code ----
const src = [
  '# a demo', // 1
  'switch off bigCookie', // 2
  'target = cookies() * 0.1', // 3
  'if buff(Frenzy) and cookies() > 2.5M:', // 4
  '  dragon.profile(drops)', // 5
  '  pantheon.profile(golden)', // 6
  '  buyer.profile(payback)', // 7
  '  grimoire.profile(default)', // 8
  '  season.keep(season=christmas)', // 9
  '  spell.cast("hand of fate")', // 10
  'for s in [easter, halloween]:', // 11
  '  log target', // 12
  'wait 30 seconds', // 13
].join('\n');
const ex = (line, word, nth = 0) => {
  const text = src.split('\n')[line - 1];
  let col = -1;
  for (let k = 0; k <= nth; k++) col = text.indexOf(word, col + 1);
  return CA.ScriptWords.explain(src, line, col + 1);
};
i = ex(2, 'switch');
assert(i && i.kind === 'keyword' && /another macro/.test(i.desc), 'switch: a keyword');
i = ex(2, 'bigCookie');
assert(i && i.kind === 'macro' && i.title === 'Big cookie' && i.rows.some(([k, v]) => k === 'now' && v === 'off'), `switch off bigCookie: the macro, on or off (${JSON.stringify(i)})`);
i = ex(3, 'target');
assert(i && i.kind === 'variable' && /cookies\(\) \* 0\.1/.test(i.desc), 'a variable: what it’s set to');
i = ex(12, 'target');
assert(i && i.kind === 'variable' && i.rows[0][1] === 'line 3', '… where it’s used too: set on line 3');
i = ex(3, 'cookies');
assert(i && i.kind === 'value' && i.rows.some(([k]) => k === 'now'), 'cookies(): a value, and what it is now');
i = ex(4, 'buff');
assert(i && i.kind === 'condition' && /Frenzy is active/.test(i.desc) && i.rows[0][1].startsWith('Frenzy'), `buff(Frenzy): what it holds for, here (${i && i.desc})`);
i = ex(4, 'Frenzy');
assert(i && i.kind === 'effect', 'Frenzy: an effect');
i = ex(4, '2.5M');
assert(i && i.kind === 'number' && /2,500,000/.test(i.desc), '2.5M: the number in full');
i = ex(5, 'dragon.profile');
assert(i && i.kind === 'action' && /Drops/.test(i.desc), `dragon.profile(drops): an action, what it does here (${i && i.desc})`);
i = ex(5, 'drops');
assert(i && i.kind === 'profile.dragon' && i.title === 'Drops' && /Mind Over Matter/.test(i.desc), 'drops: the dragon aura profile');
i = ex(6, 'golden');
assert(i && i.kind === 'profile.pantheon' && i.title === 'Golden', 'golden in pantheon.profile(): the Pantheon profile (not the macro)');
i = ex(7, 'payback');
assert(i && i.kind === 'profile.buyer' && i.title === 'Payback' && i.rows.some(([k]) => k === 'front now'), 'payback: the Auto buyer profile and its queue’s front');
i = ex(8, 'default');
assert(i && i.kind === 'profile.grimoire' && i.title === 'Default', 'default: the Grimoire profile');
i = ex(9, 'season', 1);
assert(i && i.kind === 'param', 'season= : the option, by name');
i = ex(9, 'christmas');
assert(i && i.kind === 'season' && i.title === 'Christmas', 'christmas: the season');
i = ex(10, 'hand');
assert(i && i.kind === 'spell' && i.title === 'Force the Hand of Fate', 'a spell, by its key in quotes');
i = ex(11, 'easter');
assert(i && /Season/.test(i.tag) && i.title === 'Easter', 'easter in a list: a name from the Lookup');
assert(CA.ScriptWords.explain(src, 1, 3) === null && CA.ScriptWords.explain(src, 13, 5) === null, 'a comment, a plain number: nothing');
assert(CA.ScriptWords.explain('buyer.queue(payback)', 1, 14).kind === 'profile.buyer', 'a value’s profile param: by the call’s prefix');
assert(CA.ScriptWords.explain('x = ', 1, 0) !== undefined, 'a half-written line doesn’t throw');

// a param can say what kind of word it names (the hook other modules use)
CA.Actions.register({ id: 'test.eat', name: 'Eat a fruit', params: [{ key: 'fruit', label: 'Fruit', type: 'select', default: 'apple', word: 'test.fruit', options: () => [{ v: 'apple', label: 'Apple' }] }], run: () => 1 });
i = CA.ScriptWords.explain('test.eat(apple)', 1, 10);
assert(i && i.kind === 'test.fruit' && i.title === 'Apple', 'param word: → its kind');
i = CA.ScriptWords.explain('test.eat(fig)', 1, 10);
assert(i && i.kind === 'choice' && /Not one of the choices/.test(i.desc), 'a name its kind doesn’t know: what its list says');

// ---- the editor: hovering ----
CA.UI.Menu.openPage('clickers');
CA.UI.MacrosPage.edit(null, { name: 'Demo', mode: 'flow', source: src });
await sleep(50);
const hl = doc.querySelector('[data-code-ed] [data-code-hl]');
assert(hl, 'the editor is open');
const lineEl = hl.querySelectorAll('.ca-hl-line')[6];
const span = [...lineEl.querySelectorAll('span')].find((s) => s.textContent === 'payback');
const at = CA.UI.CodeEditor.placeOf(span);
assert(at.line === 7 && at.col === 16 && at.source === src, `a colored word’s place in the code (${at.line}:${at.col})`);
CA.UI.CodeEditor.showCard(span);
const card = doc.querySelector('#CookieMgrLayer .ca-word-tip');
assert(card && card.style.display === 'block' && /Payback/.test(card.textContent) && /Auto buyer profile/.test(card.textContent), 'its card shows in the floating layer');
doc.dispatchEvent(new w.KeyboardEvent('keydown', { bubbles: true }));
assert(card.style.display === 'none', 'typing hides it');
const html = CA.UI.CodeEditor.cardHtml({ title: 'X', tag: 'T', sig: 'x(a)', desc: 'd', rows: [['k', 'v']], note: 'n' });
assert(/ca-tip-head/.test(html) && /ca-word-sig/.test(html) && /class="ha"|class="hi"/.test(html) && /ca-tip-note/.test(html), 'a card: head, colored signature, rows, note');

// ---- the card's link: to where the word is edited, asking about unsaved code first, and Back ----
const fire = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const wordSpan = (line, word) => [...doc.querySelectorAll('[data-code-ed] [data-code-hl] .ca-hl-line')[line - 1].querySelectorAll('span')].find((s) => s.textContent === word);
const ta = doc.querySelector('[data-code-ed] [data-code]');
ta.value += '\nlog "changed"';
ta.dispatchEvent(new w.Event('input', { bubbles: true }));
CA.UI.CodeEditor.showCard(wordSpan(5, 'drops'));
let link = card.querySelector('[data-word-open]');
assert(link && /Dragon page/.test(link.textContent), `a profile's card links to its page (${link && link.textContent})`);
fire(link);
assert(card.style.display === 'block' && /Unsaved changes to/.test(card.textContent) && card.querySelector('[data-word-leave="save"]'), 'unsaved code: it asks first');
fire(card.querySelector('[data-word-leave="stay"]'));
assert(CA.Settings.get('tab') === 'clickers' && card.style.display === 'none', 'Stay: nowhere');
CA.UI.CodeEditor.showCard(wordSpan(5, 'drops'));
fire(card.querySelector('[data-word-open]'));
fire(card.querySelector('[data-word-leave="save"]'));
await sleep(100);
assert(CA.Settings.get('tab') === 'dragon', 'Save and go: on the Dragon page');
assert(CA.Macros.list().some((m) => m.name === 'Demo' && /changed/.test(CA.Macros.sourceOf(m))), '… the macro saved, with the change');
const chipEl = doc.querySelector('#CookieMgrLayer .ca-word-back');
assert(chipEl && chipEl.style.display === 'block' && /Back to Demo/.test(chipEl.textContent), 'a Back chip, named after the code it left');
fire(chipEl.querySelector('[data-word-back]'));
await sleep(50);
assert(CA.Settings.get('tab') === 'clickers' && doc.querySelector('[data-code-ed] [data-code]') && /changed/.test(doc.querySelector('[data-code-ed] [data-code]').value), 'Back: the macro’s editor again');
assert(chipEl.style.display === 'none', '… and the chip is gone');
// nothing unsaved: straight there; a macro's card opens its editor
CA.UI.CodeEditor.showCard(wordSpan(2, 'bigCookie'));
link = card.querySelector('[data-word-open]');
assert(link, 'a macro’s card links to its editor');
fire(link);
await sleep(50);
assert(!/Unsaved/.test(card.textContent) && CA.UI.MacrosPage.draft() && CA.UI.MacrosPage.draft().id === 'bigCookie', 'no changes: no question; the Big cookie macro is open');
assert(CA.UI.CodeEditor.trail().length === 1, 'Back remembers the demo');
CA.UI.CodeEditor.goBack();
await sleep(50);
assert(CA.UI.MacrosPage.draft() && CA.UI.MacrosPage.draft().name === 'Demo', '… and goes back to it');
// a variable's card: to the line it's set on, in the same code
const vs2 = wordSpan(12, 'target');
CA.UI.CodeEditor.showCard(vs2);
link = card.querySelector('[data-word-open]');
assert(link && /line 3/.test(link.textContent), 'a variable: Go to line 3');
fire(link);
assert(doc.querySelector('[data-code-ed] [data-code]').selectionStart === src.split('\n').slice(0, 2).join('\n').length + 1, '… the caret on line 3');
CA.UI.MacrosPage.edit(null);

// ---- the statistics catalog: its code is hoverable too ----
CA.UI.Menu.openPage('tooltips');
await sleep(50);
const view = doc.querySelector('[data-code-view]');
assert(view && view.dataset.codeView.length > 0, 'a statistic’s code in the catalog is a code view');
const vs = view.querySelector('span.hv, span.ha, span.hq');
assert(vs && CA.UI.CodeEditor.placeOf(vs).line >= 1, '… whose words have a place');

assert(errors.length === 0, `no errors (${errors.join(' | ')})`);
done();
process.exit();
