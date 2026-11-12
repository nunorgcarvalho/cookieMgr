// One point of a save's income curve (models/goldenIncome.mjs incomeCurve runs one of these per
// frequency, in parallel): reads { save, state, f, hours, seed, expected, pops, bank } as JSON on
// stdin, writes { game: { state, base }, point } as JSON on stdout. `expected`: computed
// (models/goldenExpected.mjs) rather than played.
import { goldenIncomeGame } from './goldenIncome.mjs';
import { expectedAt } from './goldenExpected.mjs';

let input = '';
for await (const d of process.stdin) input += d;
const { save, state, f, hours, seed, expected, pops, bank } = JSON.parse(input);
const g = await goldenIncomeGame({ save, seed, state });
const point = expected ? expectedAt(g, f, { pops, seed, bank: bank == null ? undefined : bank }) : g.at(f, { hours, seed });
process.stdout.write(JSON.stringify({ game: { state: g.state, base: g.base }, point }));
