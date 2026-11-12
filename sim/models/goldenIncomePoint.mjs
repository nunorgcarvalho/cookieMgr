// One point of a save's income curve (models/goldenIncome.mjs incomeCurve runs one of these per
// frequency, in parallel): reads { save, state, f, hours, seed, expected, pops, bank, grimoire } as JSON on
// stdin, writes { game: { state, base }, point } as JSON on stdout. `expected`: computed
// (models/goldenExpected.mjs) rather than played; `grimoire`: a spell plan's spec (models/grimoire.mjs).
import { goldenIncomeGame } from './goldenIncome.mjs';
import { expectedAt } from './goldenExpected.mjs';

let input = '';
for await (const d of process.stdin) input += d;
const { save, state, f, hours, seed, expected, pops, bank, grimoire } = JSON.parse(input);
const g = await goldenIncomeGame({ save, seed, state });
const point = expected ? expectedAt(g, f, { pops, seed, bank: bank == null ? undefined : bank, grimoire }) : g.at(f, { hours, seed, grimoire, bank: grimoire ? (bank == null ? g.Game.cookies : bank) : null });
process.stdout.write(JSON.stringify({ game: { state: g.state, base: g.base }, point }));
