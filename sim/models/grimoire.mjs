// Spell plans for the computed golden cookie model (models/goldenExpected.mjs expectedIncome `plan`):
// when to cast what, as cookieMgr's cast tiers decide it (src/features/castTiers.js) and a few more
// ways to use the Grimoire, so the fast model can weigh them — with any garden, through its income
// curve (models/gardenScore.mjs).
//
// A plan is a spec (plain JSON, so the GUI and the command line can pass it around):
//   tiers     Force the Hand of Fate's cast tiers, as the add-on has them: [{ name, pct, combos }].
//             A combo is a list of effects (frenzy, click frenzy, dragonflight, building special,
//             elder frenzy, dragon harvest) that must all be on, each with `minLeft` seconds or more
//             left; a tier casts once magic is `pct` of the way from the spell's cost (0) to a full
//             bar (100). The lowest tier with a combo on decides (castTiers.js decide()).
//   any       cast Force the Hand of Fate at this bar, whatever's on (0: as soon as it's affordable).
//   adept     Diminish Ineptitude first (backfires 10× less for 5 minutes) when there's magic for both
//             and none is on; never Force the Hand of Fate while Magic inept (its backfire) is on.
//   stretch   Stretch Time right after a Force the Hand of Fate, with magic left, when one of these
//             combos is on: { combos } (every buff +10% of its time, up to 5 minutes).
//   conjure   Conjure Baked Goods (30 minutes of the CpS then, capped at 15% of the bank) once the bar
//             is `pct` of the way from its cost to full: { pct, combos } (combos: only with one on).
// Only what's on counts (no seed, no guessing what a spell will do): every outcome at its odds.
import { SLOTS } from './goldenExpected.mjs';

export const EFFECTS = ['frenzy', 'click frenzy', 'dragonflight', 'building special', 'elder frenzy', 'dragon harvest'];
const ABBR = { frenzy: 'F', 'click frenzy': 'CF', dragonflight: 'DF', 'building special': 'BS', 'elder frenzy': 'EF', 'dragon harvest': 'DH' };
export const comboName = (c) => c.map((k) => ABBR[k] || k).join('+');

// the add-on's seeded tiers (castTiers.js SEEDS)
export const STRONGEST = [
  ['frenzy', 'click frenzy'],
  ['frenzy', 'dragonflight'],
  ['building special', 'click frenzy'],
  ['building special', 'dragonflight'],
];
export const REGULAR = [['frenzy', 'building special'], ['building special', 'building special'], ['elder frenzy']];
const SINGLES = [['frenzy'], ['building special'], ['dragon harvest']];
// combos by how many effects stack: 3x (Nuno's: Frenzy with two of Click frenzy, Dragonflight, a building
// special, Dragon Harvest), 2x click (a pair with Click frenzy or Dragonflight: the Strongest combos) and
// 2x (the other pairs: the Regular combos)
export const TRIPLES = [
  ['frenzy', 'click frenzy', 'building special'],
  ['frenzy', 'dragonflight', 'building special'],
  ['frenzy', 'building special', 'dragon harvest'],
  ['frenzy', 'click frenzy', 'dragon harvest'],
  ['frenzy', 'dragonflight', 'dragon harvest'],
];
// any three of Frenzy, Click frenzy, Dragonflight, building specials (each counts) and Dragon Harvest
export const TRIPLES_ANY = [
  ...TRIPLES,
  ['frenzy', 'building special', 'building special'],
  ['building special', 'building special', 'click frenzy'],
  ['building special', 'building special', 'dragonflight'],
  ['building special', 'building special', 'dragon harvest'],
  ['building special', 'click frenzy', 'dragon harvest'],
  ['building special', 'dragonflight', 'dragon harvest'],
];
const tier3 = (pct) => ({ name: '3x combos', pct, combos: TRIPLES });
const tier2c = (pct) => ({ name: '2x click combos', pct, combos: STRONGEST });
const tier2 = (pct) => ({ name: '2x combos', pct, combos: REGULAR });
const DEFAULT_TIERS = [
  { name: 'Strongest combos', pct: 0, combos: STRONGEST },
  { name: 'Regular combos', pct: 100, combos: REGULAR },
];

/** The plans the Grimoire page and the grimoire-plans experiment compare: [{ id, name, desc, group, spec }]. */
export const PLANS = [
  { id: 'none', group: 'Baseline', name: 'No spells', desc: 'The Grimoire left alone.', spec: null },
  { id: 'atCost', group: 'Force the Hand of Fate', name: 'Whenever affordable', desc: 'Force the Hand of Fate as soon as there is magic for it, whatever is on.', spec: { any: 0 } },
  { id: 'atFull', group: 'Force the Hand of Fate', name: 'At a full bar', desc: 'Force the Hand of Fate each time the bar is full, whatever is on.', spec: { any: 100 } },
  { id: 'default', group: 'Cast tiers', name: "cookieMgr's Default", desc: 'Strongest combos at 0%, Regular combos (F+BS, BS+BS, EF) at 100%: the add-on as it ships.', spec: { tiers: DEFAULT_TIERS } },
  { id: 'savingUp', group: 'Cast tiers', name: 'Saving up', desc: 'Strongest combos only (Frenzy or a building special, with Click frenzy or Dragonflight), at 0%.', spec: { tiers: [DEFAULT_TIERS[0]] } },
  { id: 'regular50', group: 'Cast tiers', name: 'Regular at 50%', desc: 'Default, with Regular combos at half a bar.', spec: { tiers: [DEFAULT_TIERS[0], { ...DEFAULT_TIERS[1], pct: 50 }] } },
  { id: 'regular0', group: 'Cast tiers', name: 'Regular at 0%', desc: 'Default, with Regular combos as soon as affordable.', spec: { tiers: [DEFAULT_TIERS[0], { ...DEFAULT_TIERS[1], pct: 0 }] } },
  { id: 'singles', group: 'Cast tiers', name: 'Default + singles at full', desc: 'Default, plus Frenzy, a building special or Dragon Harvest alone at a full bar.', spec: { tiers: [...DEFAULT_TIERS, { name: 'Singles', pct: 100, combos: SINGLES }] } },
  { id: 'defaultFull', group: 'Cast tiers', name: 'Default + anything at full', desc: "Default, and Force the Hand of Fate at a full bar whatever's on (no refill wasted).", spec: { tiers: DEFAULT_TIERS, any: 100 } },
  { id: 'stretch', group: 'Other spells', name: 'Default + Stretch Time', desc: 'Default, then Stretch Time right after when a Strongest or Regular combo is on.', spec: { tiers: DEFAULT_TIERS, stretch: { combos: [...STRONGEST, ...REGULAR] } } },
  { id: 'adept', group: 'Other spells', name: 'Default + Diminish Ineptitude', desc: 'Default, with Diminish Ineptitude first when there is magic for both (backfires 1.5% instead of 15%).', spec: { tiers: DEFAULT_TIERS, adept: true } },
  { id: 'conjure', group: 'Other spells', name: 'Conjure Baked Goods', desc: 'Conjure Baked Goods whenever affordable (no Force the Hand of Fate).', spec: { conjure: { pct: 0 } } },
  { id: 'conjureCombos', group: 'Other spells', name: 'Conjure on combos', desc: 'Conjure Baked Goods only on a Strongest or Regular combo, as soon as affordable.', spec: { conjure: { pct: 0, combos: [...STRONGEST, ...REGULAR] } } },
  { id: 'defaultConjure', group: 'Other spells', name: 'Default + Conjure at full', desc: 'Default, and Conjure Baked Goods when the bar is full with no combo on.', spec: { tiers: DEFAULT_TIERS, conjure: { pct: 100 } } },
  ...[
    // combo tiers by size: [3x, 2x click, 2x] thresholds (null: not cast on). A combo counts when at least its
    // effects are on, so a 3x combo is also a 2x one: the lowest threshold of the tiers it matches decides.
    [100, null, null],
    [0, null, null],
    [100, 100, null],
    [0, 100, null],
    [0, 50, null],
    [0, 0, null],
    [100, 100, 100],
    [0, 100, 100],
    [0, 50, 100],
    [0, 0, 100],
  ].map(([a, b, c]) => {
    const parts = [`3x ${a}%`, b == null ? null : `2x click ${b}%`, c == null ? null : `2x ${c}%`].filter(Boolean);
    const id = `x3_${a}${b == null ? '' : `_c${b}`}${c == null ? '' : `_r${c}`}`;
    const tiers = [tier3(a), ...(b == null ? [] : [tier2c(b)]), ...(c == null ? [] : [tier2(c)])];
    const desc = `3x combos (F+CF+BS, F+DF+BS, F+BS+DH, F+CF+DH, F+DF+DH) at ${a}%` + (b == null ? '' : `, 2x click combos (F+CF, F+DF, BS+CF, BS+DF) at ${b}%`) + (c == null ? '' : `, 2x combos (F+BS, BS+BS, EF) at ${c}%`) + '.';
    return { id, group: 'Combo tiers', name: parts.join(' · '), desc, spec: { tiers } };
  }),
  ...[0, 100].map((a) => ({
    id: `x3any_${a}`,
    group: 'Combo tiers',
    name: `Any 3x ${a}%`,
    desc: `Any three of Frenzy, Click frenzy, Dragonflight, building specials (each counts) and Dragon Harvest, at ${a}%: the 3x combos plus F+BS+BS, BS+BS+CF, BS+BS+DF, BS+BS+DH, BS+CF+DH, BS+DF+DH.`,
    spec: { tiers: [{ name: 'Any 3x combos', pct: a, combos: TRIPLES_ANY }] },
  })),
];
export const planById = (id) => PLANS.find((p) => p.id === id) || null;

/**
 * A spec made into what expectedIncome runs, for a game's parameters (goldenParams; P.grimoire):
 * { spec, levels (the magic each rule waits for), cost(spell), decide(state, magic) → { spell, why } | null }.
 */
export function makePlan(spec, P) {
  if (!spec) return null;
  const G = P.grimoire;
  if (!G) throw new Error('no Grimoire in this game: a Wizard tower and its minigame are needed');
  const { F, H, C, D, E, A, I, J, B0 } = SLOTS;
  const SLOT = { frenzy: F, 'click frenzy': C, dragonflight: D, 'elder frenzy': E, 'dragon harvest': H };
  const fps = P.fps;
  const max = G.magicM;
  const costs = G.costs;
  const minLeft = (spec.minLeft == null ? 5 : Number(spec.minLeft)) * fps;
  const at = (cost, pct) => cost + Math.max(0, max - cost) * (Math.max(0, Math.min(100, pct)) / 100);
  const tiers = (spec.tiers || []).map((t) => ({ name: t.name, thr: at(costs.fthof, t.pct), combos: (t.combos || []).filter((c) => c.length) })).sort((a, b) => a.thr - b.thr);
  const anyThr = spec.any == null ? null : at(costs.fthof, spec.any);
  const stretch = spec.stretch ? spec.stretch.combos || [] : null;
  const conjure = spec.conjure ? { thr: at(costs.conjure, spec.conjure.pct || 0), combos: spec.conjure.combos || null } : null;
  const levels = [costs.fthof, ...tiers.map((t) => t.thr), costs.stretch, costs.conjure, max];
  if (anyThr != null) levels.push(anyThr);
  if (spec.adept) levels.push(costs.adept + costs.fthof);
  if (conjure) levels.push(conjure.thr);

  // a combo compiled: the slots that must have minLeft or more left, and how many building specials
  const compile = (c) => {
    const slots = [];
    let bs = 0;
    for (const k of c) {
      if (k === 'building special') bs++;
      else if (SLOT[k] && !slots.includes(SLOT[k])) slots.push(SLOT[k]);
    }
    return { slots, bs, name: comboName(c) };
  };
  const tiersC = tiers.map((t) => ({ ...t, combos: t.combos.map(compile) }));
  const stretchC = stretch && stretch.map(compile);
  const conjureC = conjure && conjure.combos && conjure.combos.map(compile);
  // the first combo on, `u` frames from state s (its times then: s[i] − u)
  const first = (list, s, u, nb) => {
    for (const c of list) {
      if (c.bs > nb) continue;
      let ok = true;
      for (const i of c.slots)
        if (!(s[i] - u >= minLeft && s[i] - u > 0)) {
          ok = false;
          break;
        }
      if (ok) return c;
    }
    return null;
  };
  // what to cast `u` frames on from state s, with magic m then: { spell, why } or null
  const decide = (s, m, u = 0) => {
    let nb = 0;
    for (let i = B0; i < s.length; i++) if (s[i] - u >= minLeft && s[i] - u > 0) nb++;
    const inept = s[I] - u > 0;
    const j = u === 0 ? s[J] : 0;
    // Force the Hand of Fate: the lowest tier with a combo on, or `any`
    let thr = Infinity;
    let why = null;
    for (const t of tiersC) {
      const c = first(t.combos, s, u, nb);
      if (c) {
        thr = t.thr;
        why = c.name;
        break;
      }
    }
    if (anyThr != null && anyThr < thr) {
      thr = anyThr;
      why = why || 'any';
    }
    // right after Diminish Ineptitude worked: the spell it was cast for, whatever the bar
    if (j === 2 && why && !inept && m >= costs.fthof) return { spell: 'fthof', why };
    if (!inept && why && m >= thr && m >= costs.fthof) {
      if (spec.adept && !(s[A] - u > 0) && m >= costs.adept + costs.fthof) return { spell: 'adept', why };
      return { spell: 'fthof', why };
    }
    if (stretchC && j === 1 && m >= costs.stretch) {
      const c = first(stretchC, s, u, nb);
      if (c) return { spell: 'stretch', why: c.name };
    }
    if (conjure && m >= conjure.thr && m >= costs.conjure && !(why && m >= costs.fthof && !inept)) {
      if (!conjureC) return { spell: 'conjure', why: 'any' };
      const c = first(conjureC, s, u, nb);
      if (c) return { spell: 'conjure', why: c.name };
    }
    return null;
  };
  const cost = (spell) => ({ fthof: costs.fthof, stretch: costs.stretch, adept: costs.adept, conjure: costs.conjure })[spell];
  return { spec, levels: [...new Set(levels)].filter((x) => x > 0 && x <= max + 1e-9).sort((a, b) => a - b), cost, decide, magicM: max, costs };
}

/**
 * A grid of cast-tier plans around the add-on's Default, for finding the best one: Strongest combos at
 * 0%, Regular combos at `regular`%, single effects (Frenzy, a building special, Dragon Harvest) at
 * `singles`% (or not at all), with Dragon Harvest pairs among the Regular combos or not, and the bar's
 * refill never wasted (anything at a full bar) or not. [{ id, group, name, desc, spec }]
 */
export function sweepPlans({ regular = [0, 25, 50, 75, 100], singles = [null, 50, 100], harvest = [false, true], full = [false, true] } = {}) {
  const out = [];
  const DH_PAIRS = [['frenzy', 'dragon harvest'], ['building special', 'dragon harvest']];
  for (const r of regular)
    for (const s of singles)
      for (const h of harvest)
        for (const f of full) {
          if (s != null && s < r) continue; // singles never before the pairs
          const tiers = [
            { name: 'Strongest combos', pct: 0, combos: STRONGEST },
            { name: 'Regular combos', pct: r, combos: h ? [...REGULAR, ...DH_PAIRS] : REGULAR },
          ];
          if (s != null) tiers.push({ name: 'Singles', pct: s, combos: SINGLES });
          const id = `t${r}${s == null ? '' : `s${s}`}${h ? 'h' : ''}${f ? 'f' : ''}`;
          const name = `Regular ${r}%${s == null ? '' : `, singles ${s}%`}${h ? ', +DH pairs' : ''}${f ? ', anything at full' : ''}`;
          out.push({ id, group: 'Sweep', name, desc: `Strongest combos at 0%, ${name}.`, spec: { tiers, ...(f ? { any: 100 } : {}) } });
        }
  return out;
}
