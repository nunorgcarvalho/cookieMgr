---
bump: minor
---

- **Stock trader profiles:** the Stock market autobuyer runs a trader profile, code you load and unload like the
  garden, Pantheon and Grimoire profiles — on the Stock market page's new **Trader** card (its thresholds as knobs,
  Save, Save as new, Revert, rename, delete), from code (`stocks.profile(p)`, `stocks.profileActive(p)`,
  `stocks.activeProfile()`, `stocks.profiles()`) and from a manager's stage (a **Stock trader** card).
- **Trends and prices**, the new default trader: fast rises bought and held, fast falls sold, every other trend
  bought under its resting value and sold over it, by thresholds a simulator study found — about 60% more profit
  than **Ride the trends** (the strategy until now). A save from before keeps Ride the trends; autobuyer code you
  had edited becomes a profile of yours.
