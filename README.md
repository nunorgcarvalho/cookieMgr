# cookieMgr

**A [Cookie Clicker](https://orteil.dashnet.org/cookieclicker/) add-on that provides customizable automation at all
levels of Cookie Clicker gameplay.** Any action that can be performed or statistic that can be calculated can be
expressed programmatically in the add-on's pseudo coding language. Actions, Statistics, Macros and more can quickly be
accessed through Widgets that get added to screen and can be fully customized as well. Managers are high-level
scripts that automatically play out strategies in-game.

Also contains a lot of Quality-of-Life features, many of which are directly inspired or rebuilt from
[Cookie Monster](https://github.com/CookieMonsterTeam/CookieMonster).

![cookieMgr in the game: the sidebar of pages next to the big cookie, a widget on the left panel](docs/readme/game.png)

## Install

cookieMgr runs in the browser version of the game at
[orteil.dashnet.org/cookieclicker](https://orteil.dashnet.org/cookieclicker/). Pick one of these three ways.

### 1. Bookmarklet (recommended)

1. Make a new bookmark in your browser (right-click the bookmarks bar → **Add page…** / **Add bookmark…**).
2. Name it `cookieMgr`, and paste this whole line as its **URL**:

   ```text
   javascript:(function(){Game.LoadMod('https://nunorgcarvalho.github.io/cookieMgr/dist/CookieMgr.js?v='+Date.now());}());
   ```

3. Open the game, wait for it to finish loading, and click the bookmark.

A column of small icons appears next to the big cookie. That's cookieMgr. Click the bookmark again each time you
open the game; it always loads the latest version.

### 2. Userscript (loads by itself every time)

1. Install a userscript manager such as [Tampermonkey](https://www.tampermonkey.net/) or
   [Violentmonkey](https://violentmonkey.github.io/).
2. Open [CookieMgr.user.js](https://github.com/nunorgcarvalho/cookieMgr/raw/main/CookieMgr.user.js) and click
   **Install** when your userscript manager asks.

From then on cookieMgr loads whenever you open the game.

### 3. Console (one time, nothing to save)

Open the game, press **F12** (**Cmd+Option+I** on a Mac) and pick the **Console** tab, then paste this line and press
**Enter**. (Chrome may ask you to type `allow pasting` first.)

```js
Game.LoadMod('https://nunorgcarvalho.github.io/cookieMgr/dist/CookieMgr.js?v=' + Date.now());
```

## What's in it

cookieMgr adds a column of icons next to the big cookie, one per page. Hover an icon for its name and click it to open
the page. [See every page with a screenshot](#pages).

| Page | What it's for |
| --- | --- |
| **Events** | A log of in-game events, like golden cookies, purchases, ascensions, etc. |
| **Stats** | Charts and numbers: cookies per second, actual income, where your cookies come from, golden cookie odds, prestige, upgrades and achievements |
| **Payback** | What each building and upgrade is worth, and the Auto buyer that buys the best one |
| **Garden**, **Stock market**, **Pantheon**, **Grimoire**, **Dragon** | A page per minigame, each with its own automation |
| **Statistics** | What the store's tooltips show, and statistics you write yourself |
| **Macros** | Automations: autoclickers, golden cookie popping, alerts, and your own scripts |
| **Managers** | Strategies that play a whole ascension for you in stages (Nunix late game comes with it) |
| **Widgets** | Small panels you place on the game's left side |
| **Settings** | Options in tabs: number format, hotkeys, updates, store tooltips, and your history's export and import |

## Pages

<table>
<tr>
<td width="50%" valign="top">
<b>Events</b><br>
<img src="docs/readme/events.png" alt="The Events page" width="100%">
<ul><li>A log of golden cookies, wrinklers, sugar lumps, trades and ascensions</li><li>Filter, search and export it as CSV</li></ul>
</td>
<td width="50%" valign="top">
<b>Stats</b><br>
<img src="docs/readme/stats.png" alt="The Stats page" width="100%">
<ul><li>Cookies per second, where every cookie came from, your bank and prestige, charted and kept between sessions</li><li>Zoom and look back, or since your last ascension (ascensions are marked on every chart); Frenzy and other effects shaded behind it</li><li>Your actual income, charted over any window, and your income outside CpS, by source</li><li>Golden cookie odds, Lucky! banks, what-ifs for spirits and auras</li><li>Every upgrade and achievement in one place: what you own, what's in the store and what's still to get</li></ul>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<b>Payback</b><br>
<img src="docs/readme/payback.png" alt="The Payback page" width="100%">
<ul><li>An exact payback period for every building and upgrade</li><li>The Auto buyer: a queue ranked by one 0–100 priority score, profiles with rules, and savings (bank reserve, Lucky! banks) ranked in the same queue</li><li>Payback measured by CpS, clicking, or what you actually took in over a window you set (30 min by default; 15 min, 1 h, 3 h, since your last ascension or any time)</li><li>Buy all upgrades in one click, ranked in the queue by its own payback period</li></ul>
</td>
<td width="50%" valign="top">
<b>Garden</b><br>
<img src="docs/readme/garden.png" alt="The Garden page" width="100%">
<ul><li>An Auto-gardener with layouts and profiles</li><li>Mutation odds on every empty tile</li><li>Growth charts and harvest counts</li></ul>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<b>Stock market</b><br>
<img src="docs/readme/stock-market.png" alt="The Stock market page" width="100%">
<ul><li>A stock autobuyer and Sell all</li><li>Trend badges on every stock in the Bank</li><li>Portfolio charts and your trade history</li></ul>
</td>
<td width="50%" valign="top">
<b>Pantheon</b><br>
<img src="docs/readme/pantheon.png" alt="The Pantheon page" width="100%">
<ul><li>Your slotted spirits and what each does</li><li>Profiles that swap spirits for you</li></ul>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<b>Grimoire</b><br>
<img src="docs/readme/grimoire.png" alt="The Grimoire page" width="100%">
<ul><li>Magic, refill and every spell's cost at a glance</li><li>Cast from a button or a hotkey</li><li>Auto-cast Force the Hand of Fate when the combo is right</li></ul>
</td>
<td width="50%" valign="top">
<b>Dragon</b><br>
<img src="docs/readme/dragon.png" alt="The Dragon page" width="100%">
<ul><li>Auto dragon trains it as you can afford</li><li>Pet the dragon for its drops</li><li>Aura profiles</li></ul>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<b>Statistics</b><br>
<img src="docs/readme/statistics.png" alt="The Statistics page" width="100%">
<ul><li>Choose the lines the store's tooltips show and save them as layouts, with a built-in Default</li><li>Write your own statistics, with a live preview, in code colored by where each word comes from</li><li>Pick how payback is measured</li></ul>
</td>
<td width="50%" valign="top">
<b>Macros</b><br>
<img src="docs/readme/macros.png" alt="The Macros page" width="100%">
<ul><li>Autoclickers for the big cookie, golden and wrath cookies, reindeer, fortunes and wrinklers</li><li>The Upgrade unlocker: one switch for Santa, Research, the dragon, fortunes and cheap upgrades</li><li>Alerts, hotkeys and buttons on the left panel</li><li>Write your own macros in cookieMgr's simple code: colored by where each word comes from, and hover any word to see what it is</li></ul>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<b>Managers</b><br>
<img src="docs/readme/managers.png" alt="The Managers page: the Drops stage's tab with its macros, settings and profiles, and the macro library" width="100%">
<ul><li>A manager plays an ascension in stages: stage 1 sets things up, each later stage changes only what it needs, and moves on when a condition holds</li><li>Nunix late game is built in, in three stages: season drops, reindeer, then golden cookie combos (duplicate it to make your own; Revert to default undoes your edits)</li><li>The Manager widget shows the stage, what moves it on, the numbers it watches, the macros at work, and the Auto buyer's last three buys and next one</li><li>Edit each stage in its own tab, with a library of macros to switch on or off beside it, or edit the code the stages write</li></ul>
<img src="docs/readme/manager-widget.png" alt="The Manager widget" width="50%">
</td>
<td width="50%" valign="top">
<b>Widgets</b><br>
<img src="docs/readme/widgets.png" alt="The Widgets page" width="100%">
<ul><li>Place macro buttons, golden cookie odds, effect timers, charts, actual income, the Manager and more on the left panel</li><li>Place any widget more than once, each copy with its own settings</li><li>Save and switch layouts</li></ul>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<b>Settings</b><br>
<img src="docs/readme/settings.png" alt="The Settings page" width="100%">
<ul><li>Tabs for General, Store &amp; tooltips, Data &amp; integrations and All options</li><li>Number format, hotkeys, update checks and a simple cookie background</li><li>Export and import your history, and load Cookie Monster alongside</li></ul>
</td>
</tr>
</table>

## Additional information

- **Does not use in-game seed.** cookieMgr never reads the game's random seed to predict what comes next. It works
  from expected values and your own history only.
- **Data is stored locally.** Settings are saved inside your Cookie Clicker save (so they survive export and import),
  and the recorded history stays in your browser.
- **Turning it off.** Reload the game page without clicking the bookmark.

## Learn more

- **[The full guide](docs/GUIDE.md)**: every page, option and macro word in detail.
- **[Changelog](CHANGELOG.md)**: what changed in each version.
- **[Developing cookieMgr](docs/DEVELOPMENT.md)**: building, testing, the project layout and how to add things.
- **[The simulator](sim/README.md)**: run Cookie Clicker headless to test strategies over weeks of game time.

## License

[MIT](LICENSE)
