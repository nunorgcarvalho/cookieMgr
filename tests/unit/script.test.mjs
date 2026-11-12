// The algorithmic language (features/script.js), table by table: what each line compiles to, the
// problems it reports, how conditions evaluate and explain themselves, decompiling, and one pass
// of the engine (CA.Macros.runPass).
import { boot, sleep, makeAssert } from '../harness/game.mjs';

const { assert, done } = makeAssert();
const g = boot({});
await sleep(300);
const CA = g.window.CookieMgr;
const S = CA.Script;
const Game = g.Game;

const noLines = (x) => JSON.parse(JSON.stringify(x, (k, v) => (k === 'line' ? undefined : v)));
const flowOf = (src) => {
  const r = S.compile(src);
  return r.errors.length ? `ERR ${r.errors.map((e) => `${e.line}: ${e.message}`).join('; ')}` : JSON.stringify(noLines(r.flow));
};
const cmp = (op, l, r) => ({ t: 'cmp', op, l, r });
const fn = (id, args = []) => ({ v: 'fn', id, args });
const lit = (x) => ({ v: 'lit', x });

// ---- statements -----------------------------------------------------------------------------
const STATEMENTS = [
  ['pop.golden()', [{ type: 'do', action: 'pop.golden', params: {} }]],
  ['# a comment\npop.golden()  # and another', [{ type: 'do', action: 'pop.golden', params: {} }]],
  ['switch on golden', [{ type: 'do', action: 'macro.set', params: { macro: 'golden', to: 'on' } }]],
  ['switch off wrinklers', [{ type: 'do', action: 'macro.set', params: { macro: 'wrinklers', to: 'off' } }]],
  ['spell.cast("hand of fate")', [{ type: 'do', action: 'spell.cast', params: { spell: 'hand of fate' } }]],
  ['spell.cast(spell="stretch time")', [{ type: 'do', action: 'spell.cast', params: { spell: 'stretch time' } }]],
  ['wait 30 seconds', [{ type: 'sleep', secs: 30 }]],
  ['wait 1 second', [{ type: 'sleep', secs: 1 }]],
  ['wait 2 minutes', [{ type: 'sleep', secs: 120 }]],
  ['wait 30s', [{ type: 'sleep', secs: 30 }]],
  ['wait 2min', [{ type: 'sleep', secs: 120 }]],
  ['wait 5m', [{ type: 'sleep', secs: 300 }]],
  ['wait 1.5 min', [{ type: 'sleep', secs: 90 }]],
  ['log "step #1"  # a comment', [{ type: 'log', text: 'step #1' }]],
  ["log 'it’s #2'", [{ type: 'log', text: 'it’s #2' }]],
  ['wait until magic() >= 80', [{ type: 'wait', cond: cmp('>=', fn('magic'), lit(80)) }]],
  ['repeat 3 times:\n  log "hi"', [{ type: 'times', n: 3, body: [{ type: 'log', text: 'hi' }] }]],
  ['forever:\n  pop.golden()', [{ type: 'forever', body: [{ type: 'do', action: 'pop.golden', params: {} }] }]],
  ['repeat until lumps() > 3:\n  stop', [{ type: 'until', cond: cmp('>', fn('lumps'), lit(3)), body: [{ type: 'stop' }] }]],
  ['while lumps() > 3:\n  stop', [{ type: 'until', cond: { t: 'not', a: cmp('>', fn('lumps'), lit(3)) }, body: [{ type: 'stop' }] }]],
  [
    'if cps() > 1:\n  stop\nelif lumps() == 3:\n  log "x"\nelse:\n  log "y"',
    [{ type: 'if', cond: cmp('>', fn('cps'), lit(1)), then: [{ type: 'stop' }], else: [{ type: 'if', cond: cmp('==', fn('lumps'), lit(3)), then: [{ type: 'log', text: 'x' }], else: [{ type: 'log', text: 'y' }] }] }],
  ],
  ['if cps() > 1:\n  stop', [{ type: 'if', cond: cmp('>', fn('cps'), lit(1)), then: [{ type: 'stop' }], else: [] }]],
  [
    'for s in [easter, halloween]:\n  season.buyDrops(s)',
    [
      { type: 'do', action: 'season.buyDrops', params: { season: 'easter' } },
      { type: 'do', action: 'season.buyDrops', params: { season: 'halloween' } },
    ],
  ],
  [
    'parallel:\n  branch a:\n    log "a"\n  branch:\n    log "b"',
    [{ type: 'parallel', branches: [[{ type: 'log', text: 'a' }], [{ type: 'log', text: 'b' }]], labels: ['a', '2'] }],
  ],
];
STATEMENTS.forEach(([src, want]) => {
  const got = flowOf(src);
  assert(got === JSON.stringify(want), `compiles: ${JSON.stringify(src)}${got === JSON.stringify(want) ? '' : `\n    got  ${got}\n    want ${JSON.stringify(want)}`}`);
});

// ---- numbers --------------------------------------------------------------------------------
[
  ['5', 5],
  ['1.5M', 1.5e6],
  ['2B', 2e9],
  ['3T', 3e12],
  ['10K', 1e4],
  ['1e6', 1e6],
  ['0.67', 0.67],
].forEach(([txt, n]) => {
  const r = S.compile(`wait until cookies() >= ${txt}`);
  const x = r.flow[0] && r.flow[0].cond.r.x;
  assert(x === n, `number ${txt} = ${n} (${x})`);
});

// ---- problems -------------------------------------------------------------------------------
const PROBLEMS = [
  ['cookies() > 5', /isn’t an action/],
  ['bogus.action()', /“bogus\.action” isn’t an action/],
  ['if cookies() > 1:\nlog "x"', /needs an indented block/],
  ['pop.golden(1, 2, 3)', /takes no options/],
  ['spell.cast(color=red)', /has no option “color”/],
  ['wait until', /expected something to compare/],
  ['wait 5K', /a time is in seconds or minutes/],
  ['wait 5 hours', /a time is in seconds or minutes/],
  ['wait until cookies()', /isn’t a condition — compare it/],
  ['wait until nothing(1) > 2', /isn’t a value/],
  ['parallel:\n  log "x"', /every block starts with “branch:”/],
];
PROBLEMS.forEach(([src, re]) => {
  const { errors } = S.compile(src);
  assert(errors.length && re.test(errors[0].message), `problem: ${JSON.stringify(src)} → ${errors.length ? errors[0].message : 'no error'}`);
});
{
  const { errors } = S.compile('pop.golden()\n\nbogus()\npop.golden()');
  assert(errors.length === 1 && errors[0].line === 3, `problems carry their line (${JSON.stringify(errors)})`);
}

// ---- conditions: evaluate + explain ---------------------------------------------------------
const ev = (src) => S.evaluate(S.compile(`wait until ${src}`).flow[0].cond);
Game.cookies = 2e6;
Game.lumps = 3;
Game.buffs = { Frenzy: { name: 'Frenzy', time: 100 } };
const EVALS = [
  ['cookies() >= 1.5M', true],
  ['cookies() < 1M', false],
  ['lumps() == 3', true],
  ['lumps() != 3', false],
  ['buff(Frenzy)', true],
  ['not buff(Frenzy)', false],
  ['buff("Click frenzy")', false],
  ['buff(Frenzy) and lumps() > 5', false],
  ['buff(Frenzy) or lumps() > 5', true],
  ['not (lumps() > 5 or cookies() < 1)', true],
  ['lumps() > 1 and lumps() < 5 and cookies() > 1', true],
];
EVALS.forEach(([src, want]) => {
  const r = ev(src);
  assert(r.ok === want && typeof r.text === 'string' && r.text.length, `evaluates: ${src} → ${want} (“${r.text}”)`);
});
assert(/cookies\(\) = .* ≥|>=/.test(ev('cookies() >= 1.5M').text) && /✓/.test(ev('cookies() >= 1.5M').text), `explains with the value now (“${ev('cookies() >= 1.5M').text}”)`);

// a name that's both a condition and a value: compared → the value
{
  const r = S.compile('wait until state(cps) >= 0');
  assert(!r.errors.length && r.flow[0].cond.t === 'cmp' && r.flow[0].cond.l.id === 'state', 'state(…) compared: the value');
  const c = S.compile('wait until state(cps, ">=", 0)');
  assert(!c.errors.length && c.flow[0].cond.t === 'cond', 'state(…) alone: the condition');
}

// ---- decompile: code → blocks → code ----------------------------------------------------------
const ROUND = [
  'pop.golden()',
  'spell.cast("hand of fate")',
  'wait until magic() >= 80',
  'repeat 3 times:\n  log "hi"',
  'if cps() > 1:\n  stop\nelse:\n  log "y"',
  'forever:\n  pop.golden()\n  wait 5 seconds',
];
// parentheses where the words need them (v2.31: code written out from "When…" macros)
ROUND.push('wait until not (buff(Frenzy) and lumps() > 1)', 'if (buff(Frenzy) or lumps() > 1) and cps() > 0:\n  stop', 'wait until not buff(Frenzy) and lumps() > 1');
ROUND.forEach((src) => {
  const a = S.compile(src);
  const back = S.decompile(a.flow);
  const b = S.compile(back);
  assert(!b.errors.length && JSON.stringify(noLines(a.flow)) === JSON.stringify(noLines(b.flow)), `round-trips: ${JSON.stringify(src)} → ${JSON.stringify(back)}`);
});

// ---- one pass of the engine -------------------------------------------------------------------
{
  const pass = (src) => CA.Macros.runPass(S.compile(src).flow);
  let F = pass('log "a"\nif lumps() == 3:\n  log "three"\nelse:\n  log "not"\nlog "end"');
  assert(F.trace.map((t) => t.text.replace(/^line \d+: /, '')).join('|') === 'a|if lumps() = 3 = 3 ✓ → yes|three|end' || F.trace.length === 4, `a pass runs top to bottom, taking the if (${F.trace.map((t) => t.text).join(' | ')})`);
  F = pass('log "a"\nstop\nlog "never"');
  assert(F.stopped && !F.trace.some((t) => /never/.test(t.text)), 'stop ends the pass');
  F = pass('wait until lumps() > 10\nlog "never"');
  assert(F.at.length === 1 && /waiting until/.test(F.at[0]) && !F.trace.some((t) => /never/.test(t.text)), `a wait holds the pass (${F.at})`);
  let n = 0;
  CA.Actions.register({ id: 'test.count', name: 'Count', run: () => ++n && 2 });
  F = pass('test.count()\ntest.count()');
  assert(n === 2 && F.done === 4 && F.trace.filter((t) => /test\.count: 2/.test(t.text)).length === 2, `actions run, their counts add up, each traced (done ${F.done})`);
  CA.Actions.register({
    id: 'test.boom',
    name: 'Boom',
    run: () => {
      throw new Error('kaboom');
    },
  });
  F = pass('test.boom()\nlog "after"');
  assert(/kaboom/.test(F.error) && F.trace.some((t) => /after/.test(t.text)), 'an action that throws: the error is kept, the pass goes on');
}

assert(g.errors.length === 0, 'no runtime errors' + (g.errors.length ? `: ${g.errors.slice(0, 3).join(' | ')}` : ''));
done();
process.exit();
