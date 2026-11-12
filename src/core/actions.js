// Registry of **actions**: single things cookieMgr can do in the game, once — click the big
// cookie, pop the golden cookies on screen, trade stocks, cast a spell… Macros (features/macros.js)
// are built by chaining actions; hotkeys trigger macros. The game-facing actions themselves are
// defined in features/gameActions.js.
//
//   CA.Actions.register({
//     id: 'pop.golden',                 // unique, stable (stored in saved macros)
//     name: 'Pop golden cookies',       // shown in the UI
//     icon: 'cookie',                   // ui/icons.js name
//     group: 'Shimmers',                // heading in the macro editor's action picker
//     unit: 'popped',                   // what run()'s return value counts, for status displays
//     params: [{ key, label, type: 'select'|'number'|'bool', options: () => [{ v, label }], default,
//                alias }],                // alias: an old name for the key, still read (saved macros, code)
//     available: () => true,            // false = can't run right now (minigame closed, …)
//     run(params) { return 3; },        // a number = how many things it did (0 = nothing to do)
//   });

CA.Actions = (() => {
  const list = [];
  const byId = {};

  function register(action) {
    if (byId[action.id]) throw new Error(`Action "${action.id}" already registered`);
    const a = { group: 'General', icon: 'bolt', unit: '', params: [], available: () => true, ...action };
    list.push(a);
    byId[a.id] = a;
    return a;
  }

  const get = (id) => byId[id];
  const all = () => list.slice();

  /** Default parameter values for an action, overlaid with `params`. */
  function paramsFor(id, params) {
    const a = byId[id];
    const out = {};
    if (a) a.params.forEach((p) => (out[p.key] = p.default));
    const given = { ...(params || {}) };
    if (a)
      a.params.forEach((p) => {
        if (!p.alias || !(p.alias in given)) return;
        if (!(p.key in given)) given[p.key] = given[p.alias];
        delete given[p.alias];
      });
    return { ...out, ...given };
  }

  /** Runs action `id` once. Returns its count (0 if it couldn't run), throws on errors. */
  function run(id, params) {
    const a = byId[id];
    if (!a || !a.available()) return 0;
    const r = a.run(paramsFor(id, params));
    return typeof r === 'number' ? r : r ? 1 : 0;
  }

  /** "Pop golden cookies" / "Cast Force the Hand of Fate" — the action's name with its params folded in. */
  function describe(step) {
    const a = byId[step.action];
    if (!a) return `Unknown action (${step.action})`;
    return a.describe ? a.describe(paramsFor(step.action, step.params)) : a.name;
  }

  return { register, get, all, run, paramsFor, describe };
})();
