// The simulator: the real game (game/boot.mjs) with cookieMgr loaded into it (mgr/host.mjs), on a
// virtual clock you move. One object to play it with — in cookieMgr's words:
//
//   const sim = await createSim({ seed: 1 });
//   sim.act('click.bigCookie');                  // any cookieMgr action, by its id
//   sim.value('garden.tickIn');                  // any cookieMgr value
//   sim.code('for s in shimmers():\n  shimmer.pop(s)\n');   // algorithmic code, one pass
//   sim.macro('golden');                         // a built-in macro, switched on
//   sim.macro({ name: 'buyer', source: '…', every: 1000 });   // your own, switched on
//   sim.run({ hours: 2 });                       // the game and the macros play on
//   sim.stats(); sim.actions; sim.events();      // what happened
//
// Everything that happens is the game's own code or cookieMgr's own code; the simulator only owns
// the clock, the seed, and the bookkeeping.
import { bootGame } from './game/boot.mjs';

/** The simulator's own version (it moves apart from the add-on's: sim-v* tags). */
export const SIM_VERSION = '0.8.1';
import { loadCookieMgr } from './mgr/host.mjs';
import { ensureMod } from './game/fetch.mjs';

export async function createSim({ seed = 1, fps = 30, start, save = null, mgr = true, mgrSave = '', record = false, logAll = false, sampleEvery = 60, quiet = true, cookieMonster = false } = {}) {
  // recording (cookieMgr's history recorder, for its charts) keeps its frames in IndexedDB, as in the browser
  const game = await bootGame({ seed, fps, start, save, quiet, idb: record });
  const { Game, clock } = game;
  const host = mgr ? loadCookieMgr(game, { save: mgrSave, record, logAll }) : null;
  // the recorder starts once its (empty) history has loaded — asynchronously, as IndexedDB answers
  if (host && record && host.CA.Recorder.whenLoaded()) await host.CA.Recorder.whenLoaded();
  const CA = host && host.CA;
  // Cookie Monster (cookieMgr's Best building / Best upgrade read its payback periods), loaded the way the add-on loads it
  if (cookieMonster) {
    await ensureMod('CookieMonster.js', { quiet });
    if (CA) CA.CookieMonster.load();
    else game.run("Game.LoadMod('CookieMonster.js')", 'sim:cm');
    clock.runUntil(clock.now + 2000);
  }
  const t0 = clock.now;
  const samples = [];
  let nextSample = t0;

  const need = () => {
    if (!CA) throw new Error('cookieMgr is not loaded in this simulation (createSim({ mgr: false }))');
    return CA;
  };

  /** The game in numbers now. */
  function stats() {
    return {
      t: (clock.now - t0) / 1000,
      cookies: Game.cookies,
      cookiesEarned: Game.cookiesEarned,
      cps: Game.cookiesPs,
      unbuffedCps: Game.unbuffedCps,
      clicks: Game.cookieClicks,
      handmade: Game.handmadeCookies,
      goldenClicks: Game.goldenClicks,
      buildings: Object.values(Game.Objects).reduce((a, o) => a + o.amount, 0),
      upgrades: Game.UpgradesOwned,
      achievements: Game.AchievementsOwned,
      buffs: Object.keys(Game.buffs),
      lumps: Game.lumps,
    };
  }
  function sample() {
    if (!sampleEvery || clock.now < nextSample) return;
    samples.push(stats());
    nextSample += sampleEvery * 1000;
  }

  /** One logic frame (1/fps of a second): the page's timers (cookieMgr's macros), then Game.Logic. */
  function frame() {
    game.frame();
    sample();
  }
  const toMs = ({ ms = 0, seconds = 0, minutes = 0, hours = 0, days = 0 } = {}) => ms + 1000 * (seconds + 60 * (minutes + 60 * (hours + 24 * days)));
  /** Plays on for a while: run({ hours: 2 }), run({ seconds: 30 }), run(5) = 5 seconds. */
  // The game moves in whole frames (1/30 s): a span that isn't a whole number of them leaves a part
  // of a frame over, carried to the next run() — so many short runs add up to exactly their total
  // (ten run({ ms: 125 }) are 1.25 s, not 1 s).
  let owed = 0;
  function run(span, { onProgress } = {}) {
    owed += typeof span === 'number' ? span * 1000 : toMs(span);
    const step = 1000 / Game.fps;
    let lastReport = Date.now();
    while (owed >= step - 1e-6) {
      owed -= step;
      frame();
      if (onProgress && Date.now() - lastReport > 1000) {
        lastReport = Date.now();
        onProgress((clock.now - t0) / 1000);
      }
    }
    return stats();
  }
  /** Plays on until fn(sim) is true (checked every frame), at most `max` (a span, as run's); whether it came true. */
  function until(fn, max = { hours: 24 }) {
    const end = clock.now + (typeof max === 'number' ? max * 1000 : toMs(max));
    while (clock.now < end) {
      if (fn(sim)) return true;
      frame();
    }
    return !!fn(sim);
  }

  /** Runs a cookieMgr action once (logged in sim.actions): how many things it did. */
  const act = (id, params) => need().Actions.run(id, params);
  /** A cookieMgr value now: value('garden.tickIn'), value('garden.plantAt', '2,3'). */
  function value(id, ...args) {
    const C = need();
    const v = C.Script.compile(`x = ${id}(${args.map((a) => C.Script.litText(a)).join(', ')})\n`, {}).flow[0];
    return C.Script.value(v.e, {});
  }
  /** Runs algorithmic code (cookieMgr's language) once from the top: { done, trace, error }. */
  function code(source) {
    const C = need();
    const { flow, errors } = C.Script.compile(String(source));
    if (errors.length) throw new Error(`line ${errors[0].line}: ${errors[0].message}`);
    const F = C.Macros.runPass(flow);
    return { done: F.done, trace: F.trace.map((x) => x.text), error: F.error };
  }
  /**
   * Switches on a macro: a built-in by id ('golden', 'bigCookie', 'gardener', 'autoBuyer'…), or
   * your own algorithmic one — { name, source, every (ms), pass (true: from the top each time) }.
   * Returns its id.
   */
  function macro(m, opts = {}) {
    const C = need();
    let id = m;
    if (typeof m === 'object') {
      const saved = C.Macros.save({ name: m.name || 'Simulated strategy', mode: 'flow', source: String(m.source), every: m.every || 1000, pass: m.pass !== false, steps: [] });
      id = saved.id;
    }
    if (!C.Macros.get(id)) throw new Error(`No macro "${id}"`);
    if (opts.every || (typeof m === 'object' && m.every)) C.Macros.setEvery(id, opts.every || m.every);
    if (C.Macros.set(id, true, { silent: true }) === false || !C.Macros.isOn(id)) throw new Error(`Macro "${id}" didn't start: ${C.Macros.problemOf(id) || 'unknown reason'}`);
    return id;
  }
  const stop = (id) => need().Macros.set(id, false, { silent: true });

  const sim = {
    Game,
    CA,
    clock,
    game,
    seed,
    get t() {
      return (clock.now - t0) / 1000;
    },
    frame,
    run,
    until,
    act,
    value,
    code,
    macro,
    stop,
    stats,
    samples,
    actions: host ? host.actions : [],
    /** cookieMgr modules whose init() threw ("Name: message"); empty when all of them started. */
    failed: host ? host.failed : [],
    events: (types) => (CA ? CA.EventLog.list(types) : []),
    /** The game's save (as Options → Export save gives it), cookieMgr's part included. */
    exportSave: () => Game.WriteSave(1),
    /** cookieMgr's own save (the add-on's settings, macros, gardeners…). */
    mgrSave: () => need().Settings.serialize(),
    errors: () => clock.errors.slice(),
  };
  sample();
  return sim;
}
