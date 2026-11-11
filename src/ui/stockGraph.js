// The Stock market page's charts, both built on the shared plot engine (ui/plot.js):
//
//   Stock market   portfolio value vs. cost basis (the gap is unrealized gain), or each stock's
//                  price ("Per stock"); prices come from the price:<id> states (features/stocks.js)
//   Performance    the portfolio's return as a percentage of the cookies invested, over a rolling
//                  window — above the line it's beating what you put in, below it's losing.
//                  Standardized by the capital at stake, so a small and a huge portfolio compare.

CA.UI = CA.UI || {};

CA.UI.StockGraph = (() => {
  const COLORS = ['#f5c451', '#7fe08b', '#9db4cc', '#ff8a65', '#c77dff', '#4fd6e0', '#e5484d', '#a6e35a'];
  const WINDOWS = [300, 900, 3600, 10800, 43200, 86400, 604800, 0];
  const F = () => CA.UI.Plot.fmt;
  const S = () => CA.Settings;

  function visibleStocks() {
    const all = CA.Stocks.list();
    return S().get('stockGraphSync') ? all.filter((g) => g.owned) : all;
  }

  let plot = null;

  function create() {
    plot = CA.UI.Plot.create({
      id: 'stocks',
      title: 'Stock market',
      icon: 'stocks',
      height: 180,
      log: false,
      windows: WINDOWS,
      window: 900,
      choices: [
        {
          key: 'mode',
          label: '',
          default: 'portfolio',
          options: [
            { v: 'portfolio', label: 'Portfolio value' },
            { v: 'perStock', label: 'Per stock' },
          ],
        },
      ],
      toggles: [{ setting: 'stockGraphSync', label: 'Sync to owned stocks', title: 'Per stock: only plot stocks you currently hold' }],
      zero: false,
      build(v) {
        if (v.opt('mode') === 'perStock') {
          const stocks = visibleStocks();
          const bars = v.bucketize(stocks.map((g) => `price:${g.id}`));
          const series = stocks.map((g, i) => ({ key: `price:${g.id}`, name: g.name, color: COLORS[i % COLORS.length], type: 'line', width: 1.8 }));
          const lines = {};
          series.forEach((s) => (lines[s.key] = CA.UI.Plot.linePoints(bars, (b) => b.v[s.key])));
          return {
            series,
            lines,
            zero: false,
            empty: S().get('stockGraphSync') ? "You don't own any stocks right now." : 'Open the Bank minigame to start tracking prices.',
          };
        }
        const bars = v.bucketize(['portfolioValue', 'portfolioCost', 'portfolioRealized']);
        return {
          series: [
            { key: 'value', name: 'Value', color: '#f5c451', type: 'area', width: 1.8 },
            { key: 'cost', name: 'Cost basis (the gap above it = unrealized gain)', color: '#9db4cc', type: 'line', dash: true },
          ],
          lines: {
            value: CA.UI.Plot.linePoints(bars, (b) => b.v.portfolioValue),
            cost: CA.UI.Plot.linePoints(bars, (b) => b.v.portfolioCost),
          },
          bars0: bars,
          empty: 'Open the Bank minigame to start tracking your portfolio.',
        };
      },
      tip(bar, v, data, x) {
        if (!data.bars0) return '';
        const b = data.bars0.find((r) => x >= r.x0 && x < r.x1);
        if (!b || !Number.isFinite(b.v.portfolioValue)) return '';
        const { row, signed } = F();
        const unreal = b.v.portfolioValue - (b.v.portfolioCost || 0);
        const real = b.v.portfolioRealized || 0;
        return row('transparent', 'Unrealized', signed(unreal), true) + row('transparent', 'Realized', signed(real)) + row('transparent', 'Total gain', signed(unreal + real), true);
      },
      stats(v) {
        if (v.opt('mode') === 'perStock') return '';
        const p = CA.Stocks.portfolioNow();
        const { tile, beautify, signed } = F();
        if (!p) return tile('Value', '—', 'open the Bank minigame');
        return (
          tile('Value', beautify(p.value), 'in $ (stock prices)') +
          tile('Equity', beautify(CA.StockTrader.previewSellAllCookies()), 'cookies if you sold everything now') +
          tile('Unrealized', signed(p.unrealized), 'if you sold everything now') +
          tile('Realized', signed(p.realized), 'from past sales') +
          tile('Total gain', signed(p.gain), 'realized + unrealized')
        );
      },
    });
  }

  function init() {
    create();
  }

  const html = () => plot.html();
  const mount = (root) => plot.mount(root);
  const unmount = () => plot && plot.unmount();
  const tick = () => plot && plot.tick();

  return { init, html, mount, unmount, tick, setPaused: (p) => plot.setPaused(p), isPaused: () => plot.isPaused() };
})();

CA.UI.StockPerf = (() => {
  const F = () => CA.UI.Plot.fmt;
  const SEC = 1000;
  const UP = '#4fd67a';
  const DOWN = '#e5484d';
  let plot = null;

  /** Total gain = what the portfolio is worth over what it cost, plus profit already realized.
   *  Buying or selling leaves it unchanged; only price moves change it. */
  const gainOf = (b) => (Number.isFinite(b.v.portfolioValue) ? b.v.portfolioValue - (b.v.portfolioCost || 0) + (b.v.portfolioRealized || 0) : undefined);

  function create() {
    plot = CA.UI.Plot.create({
      id: 'stockperf',
      title: 'Portfolio performance',
      icon: 'graphs',
      height: 150,
      note: 'Return on the cookies you have invested over a rolling window, as a share of the money at stake.',
      windows: [900, 3600, 10800, 43200, 86400, 604800, 0],
      window: 3600,
      smooth: false, // already a rolling average
      zero: true,
      fmt: (val) => `${Math.round(val * 10) / 10}%`,
      tipFmt: (val) => `${val >= 0 ? '+' : '−'}${Math.abs(val).toFixed(2)}%`,
      choices: [
        {
          key: 'roll',
          label: 'Rolling',
          default: 300,
          options: [
            { v: 60, label: '1m' },
            { v: 300, label: '5m' },
            { v: 900, label: '15m' },
            { v: 3600, label: '1h' },
          ],
        },
      ],
      total: false,
      build(v) {
        const R = v.opt('roll') * SEC;
        const all = v.bucketizeFrom(['portfolioValue', 'portfolioCost', 'portfolioRealized'], v.x0 - R);
        const bars = [];
        let j = 0;
        let sumCost = 0;
        let nCost = 0;
        let up = 0;
        let down = 0;
        all.forEach((b, i) => {
          sumCost += b.v.portfolioCost || 0;
          nCost++;
          // slide the start of the rolling window
          while (j < i && all[j].x1 <= b.x1 - R) {
            sumCost -= all[j].v.portfolioCost || 0;
            nCost--;
            j++;
          }
          if (b.x1 <= v.x0) return;
          const base = all[Math.max(0, j - 1)];
          const g1 = gainOf(b);
          const g0 = base === b ? undefined : gainOf(base);
          const cost = nCost ? sumCost / nCost : 0;
          if (!Number.isFinite(g1) || !Number.isFinite(g0) || !(cost > 0)) return;
          const pct = ((g1 - g0) / cost) * 100;
          if (pct >= 0) up += b.secs;
          else down += b.secs;
          bars.push({ x0: b.x0, x1: b.x1, parts: pct >= 0 ? { up: pct } : { down: pct }, pct, cost });
        });
        return {
          series: [
            { key: 'up', name: 'Gaining', color: UP, type: 'bar' },
            { key: 'down', name: 'Losing', color: DOWN, type: 'bar' },
          ],
          bars,
          up,
          down,
          empty: 'No stocks held in this window.',
        };
      },
      tip(bar) {
        if (!bar) return '';
        return F().row('transparent', 'Invested (avg)', F().beautify(bar.cost));
      },
      stats(v, data) {
        const { tile } = F();
        const last = data.bars[data.bars.length - 1];
        let best = -Infinity;
        let worst = Infinity;
        data.bars.forEach((b) => {
          best = Math.max(best, b.pct);
          worst = Math.min(worst, b.pct);
        });
        const pct = (x) => (Number.isFinite(x) ? `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(2)}%` : '—');
        const t = data.up + data.down;
        return (
          tile('Now', pct(last && last.pct), `over the last ${F().windowLabel(v.opt('roll'))}`) +
          tile('Best', pct(best)) +
          tile('Worst', pct(worst)) +
          tile('Time gaining', t ? Math.round((data.up / t) * 100) + '%' : '—', 'of this window')
        );
      },
    });
  }

  return {
    init: create,
    html: () => plot.html(),
    mount: (root) => plot.mount(root),
    unmount: () => plot && plot.unmount(),
    tick: () => plot && plot.tick(),
  };
})();
