// Entry point: waits for the game, then registers cookieMgr through the official mod API
// (Game.registerMod), which gives us init/save/load hooks tied to the game's save file.

function removeLegacyBookmarklet() {
  // v0.1 was a bookmarklet that stored itself on window.cookieHelper — stop it if it's running.
  const h = window.cookieHelper;
  if (!h) return false;
  try {
    Object.values(h.timers || {}).forEach(clearInterval);
    if (h.key) removeEventListener('keydown', h.key);
  } catch (e) {
    /* ignore */
  }
  delete window.cookieHelper;
  return true;
}

let loaded = false;

const mod = {
  init() {
    const hadLegacy = removeLegacyBookmarklet();

    // data backbone first: the event log and states must exist before the recorder's first tick;
    // actions + conditions before the macros built from them. One module failing to start is
    // logged and the rest still start.
    const failed = [];
    [
      CA.EventLog, CA.GameActions, CA.Macros, CA.Grimoire, CA.CastTiers, CA.Pantheon, CA.Garden, CA.GardenHistory, CA.Shop, CA.Payback, CA.GoldenMath, CA.Wrinklers, CA.Prestige, CA.Timers, CA.Collection, CA.WhatIf, CA.Mutations, CA.MinigameInfo, CA.Alerts, CA.AutoBuy, CA.AutoBuyer, CA.Seasons, CA.Dragon, CA.Managers, CA.Stats, CA.UpgradeInfo,
      CA.Stocks, CA.StockTrader, CA.StockLog, CA.History, CA.GameStates, CA.Recorder, CA.GameEvents, CA.NotifyTips, CA.SimpleLook,
      CA.UI.Graphs, CA.UI.EventsPage, CA.UI.CodeEditor, CA.UI.MacrosPage, CA.UI.Widgets, CA.UI.TimelineWidget, CA.UI.EffectTimers, CA.UI.ManagerWidget, CA.UI.WizardPage, CA.UI.GardenPage,
      CA.UI.PantheonPage, CA.UI.DragonPage, CA.UI.StoreBar, CA.UI.StoreInsight, CA.UI.GardenInsight, CA.UI.MinigameTips, CA.UI.AscendTip, CA.UI.PaybackPage, CA.UI.ManagersPage, CA.UI.TooltipsPage, CA.UI.StockGraph, CA.UI.StockPerf, CA.UI.StockLog, CA.UI.StockTraderCard, CA.UI.BankToolbar,
      CA.Hotkeys, CA.Ascension, CA.UI.Menu, CA.UI.Tab, CA.UI.Tips, CA.UI.UpgradeTip, CA.UI.AchievementTip,
    ].forEach((m, i) => {
      try {
        m.init();
      } catch (e) {
        failed.push(i);
        console.error('[cookieMgr] a module failed to start', e);
      }
    });
    CA.Macros.ready(); // every action is registered now
    setInterval(() => CA.Util.unshift(), 2000); // see CA.Util.unshift
    [CA.Update, CA.CookieMonster].forEach((m) => {
      try {
        m.init();
      } catch (e) {
        failed.push(m);
        console.error('[cookieMgr] a module failed to start', e);
      }
    });
    CA.Settings.startAutoPersist();

    CA.Util.notify(
      `cookieMgr v${CA.VERSION} loaded`,
      hadLegacy
        ? 'Replaced the old v0.1 bookmarklet. Open the tab on the left beam for settings.'
        : 'Open the tab on the left beam for settings.',
      CA.ICON,
      4
    );
    if (failed.length) CA.Util.notify('cookieMgr', `${failed.length} part${failed.length === 1 ? '' : 's'} of cookieMgr couldn’t start (see the browser console) — the rest works.`, CA.ICON, 6);
  },

  save() {
    return CA.Settings.serialize();
  },

  load(str) {
    loaded = true;
    CA.Settings.load(str); // core/settings.js: options, hotkeys, then every registered section
  },
};

function register() {
  Game.registerMod(CA.ID, mod);
  // The game only calls load() when its save already holds data for this mod (main.js:
  // `if (mod.load && Game.modSaveData[id]) mod.load(...)`), and it only autosaves once a minute.
  // Without this, a refresh before that first save skipped our local mirror entirely and started
  // from defaults — and the next change then overwrote the mirror with them.
  if (!loaded) mod.load('');
}

if (window.CookieMgr) {
  if (typeof Game !== 'undefined' && Game.Notify)
    Game.Notify('cookieMgr', 'Already loaded — reload the page to load a new version.', CA.ICON, 3, 1);
} else {
  window.CookieMgr = CA; // handy for debugging from the console (scripts and saves use this name)
  window.cookieMgr = CA;
  const start = () => {
    if (typeof Steam !== 'undefined')
      setTimeout(register, 2000); // same delay Cookie Monster uses on Steam
    else register();
  };
  if (typeof Game !== 'undefined' && Game.ready) start();
  else {
    const wait = setInterval(() => {
      if (typeof Game !== 'undefined' && Game.ready) {
        clearInterval(wait);
        start();
      }
    }, 250);
  }
}
