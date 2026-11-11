// cookieMgr build script — zero dependencies, just Node 18+.
//
//   node build.mjs            -> writes dist/CookieMgr.js
//   node build.mjs --watch    -> rebuilds whenever src/ changes
//   node build.mjs --check    -> exits 1 if dist/CookieMgr.js is out of date (used by CI)
//   node build.mjs --serve    -> also serves dist/ on http://localhost:8080 (for local testing)
//
// Source files are plain scripts that attach themselves to a shared `CA` namespace.
// They are concatenated in the order listed in MODULES and wrapped in a single IIFE,
// so nothing leaks into the page except `window.CookieMgr`.

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'dist', 'CookieMgr.js');
const VERSION_OUT = path.join(ROOT, 'dist', 'version.txt'); // tiny file CA.Update polls instead of the whole bundle

// Load order matters: later modules may reference earlier ones at load time.
const MODULES = [
  'core/util.js',
  'core/format.js',
  'core/statInfo.js',
  'core/words.js',
  'core/events.js',
  'core/actions.js',
  'core/conditions.js',
  'core/settings.js',
  'core/store.js',
  'core/states.js',
  'core/recorder.js',
  'core/eventLog.js',
  'core/hotkeys.js',
  'core/ascension.js',
  'core/update.js',
  'features/gameActions.js',
  'features/macros.js',
  'features/grimoire.js',
  'features/castTiers.js',
  'features/pantheon.js',
  'features/gardenLayers.js',
  'features/garden.js',
  'features/gardenHistory.js',
  'features/stocks.js',
  'features/gameStates.js',
  'features/stockTrader.js',
  'features/stockLog.js',
  'features/history.js',
  'features/cookieMonster.js',
  'features/shop.js',
  'features/payback.js',
  'features/goldenMath.js',
  'features/wrinklers.js',
  'features/prestige.js',
  'features/timers.js',
  'features/collection.js',
  'features/whatIf.js',
  'features/mutations.js',
  'features/minigameInfo.js',
  'features/alerts.js',
  'features/autoBuy.js',
  'features/autoBuyer.js',
  'features/seasons.js',
  'features/simpleLook.js',
  'features/dragon.js',
  'features/managers.js',
  'features/script.js',
  'features/scriptWords.js',
  'features/stats.js',
  'features/upgradeInfo.js',
  'features/achievementInfo.js',
  'features/gameEvents.js',
  'features/notifyTips.js',
  'ui/components.js',
  'ui/dom.js',
  'ui/tips.js',
  'ui/upgradeTip.js',
  'ui/achievementTip.js',
  'ui/icons.js',
  'ui/pages.js',
  'ui/chart.js',
  'ui/tab.js',
  'ui/plot.js',
  'ui/graphs.js',
  'ui/eventsPage.js',
  'ui/stockGraph.js',
  'ui/stockLog.js',
  'ui/bankToolbar.js',
  'ui/codeEditor.js',
  'ui/macrosPage.js',
  'ui/widgets.js',
  'ui/widgetTypes.js',
  'ui/castTiersCard.js',
  'ui/wizardPage.js',
  'ui/codeKnobs.js',
  'ui/stockTraderCard.js',
  'ui/gardenPage.js',
  'ui/pantheonPage.js',
  'ui/dragonPage.js',
  'ui/storeBar.js',
  'ui/storeInsight.js',
  'ui/gardenInsight.js',
  'ui/minigameTips.js',
  'ui/ascendTip.js',
  'ui/autoBuyerCard.js',
  'ui/buyerRow.js',
  'ui/paybackPage.js',
  'ui/managersPage.js',
  'ui/statEditor.js',
  'ui/tooltipsPage.js',
  'ui/spawnView.js',
  'ui/timelineWidget.js',
  'ui/effectTimers.js',
  'ui/managerWidget.js',
  'ui/statsPage.js',
  'ui/menu.js',
  'main.js',
];
const STYLES = ['ui/styles.css'];

// Line endings normalized so a Windows checkout (core.autocrlf) builds the same bytes as CI.
const readSrc = (file) => fs.readFileSync(path.join(SRC, file), 'utf8').replace(/\r\n/g, '\n');

function render() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const css = STYLES.map(readSrc).join('\n');

  const parts = [];
  parts.push(`/*! cookieMgr v${pkg.version} */`);
  parts.push('(function () {');
  parts.push("'use strict';");
  parts.push('const CA = {};');
  parts.push(`CA.VERSION = ${JSON.stringify(pkg.version)};`);
  parts.push(`CA.CSS = ${JSON.stringify(css)};`);
  for (const file of MODULES) {
    const code = readSrc(file).trimEnd();
    parts.push(`\n// ---- src/${file} ${'-'.repeat(Math.max(4, 60 - file.length))}\n${code}`);
  }
  parts.push('})();\n');

  return { code: parts.join('\n'), version: pkg.version };
}

function build() {
  const { code, version } = render();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, code);
  fs.writeFileSync(VERSION_OUT, version + '\n');
  const kb = (fs.statSync(OUT).size / 1024).toFixed(1);
  console.log(`[build] dist/CookieMgr.js  v${version}  ${kb} KB`);
}

function safeBuild() {
  try {
    build();
  } catch (err) {
    console.error('[build] failed:', err.message);
  }
}

const args = new Set(process.argv.slice(2));

if (args.has('--check')) {
  const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n') : '');
  const current = read(OUT);
  const currentVersion = read(VERSION_OUT);
  const { code, version } = render();
  if (current === code && currentVersion === version + '\n') {
    console.log('[check] dist/CookieMgr.js is up to date');
    process.exit(0);
  }
  console.error('[check] dist/ is stale — run `npm run build` and commit the result');
  process.exit(1);
}

safeBuild();

if (args.has('--watch') || args.has('--serve')) {
  let pending = null;
  fs.watch(SRC, { recursive: true }, () => {
    clearTimeout(pending);
    pending = setTimeout(safeBuild, 100);
  });
  console.log('[build] watching src/ for changes…');
}

if (args.has('--serve')) {
  const port = 8080;
  http
    .createServer((req, res) => {
      const file = path.join(ROOT, 'dist', path.normalize(decodeURIComponent(req.url.split('?')[0])));
      if (!file.startsWith(path.join(ROOT, 'dist')) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404).end('not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/javascript; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
      });
      fs.createReadStream(file).pipe(res);
    })
    .listen(port, () => {
      console.log(`[serve] http://localhost:${port}/CookieMgr.js`);
      console.log(`[serve] bookmarklet: javascript:(function(){Game.LoadMod('http://localhost:${port}/CookieMgr.js?'+Date.now());}());`);
    });
}
