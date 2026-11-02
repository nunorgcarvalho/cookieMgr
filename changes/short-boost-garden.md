---
bump: patch
---

- **Fixed:** a short CpS effect running beside a long one (an Oiled-up's 44 s inside an hour of Frenzy) is waited
  out again: each effect counts on its own, so only the long one stays in seed and other CpS-scaled prices
  (`payback.shortBoost()`: what the short ones add).
- **Auto buyer:** while a short CpS effect runs it buys no seeds and keeps no garden bank (Garden replant, Garden
  rounds): it no longer switches to saving for the garden; the banks come back once the effect is over.
  Buildings are bought as usual meanwhile (an Everything must go's 5% off included).
