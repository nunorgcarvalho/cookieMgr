---
bump: minor
---

- **Garden soil: clay sooner, and it stays.** The clover soil rules (*Grow together, then clay*, *Clovers grow
  together, then clay*, and *Tulips grow, then clay* with `cloversToo`) switch to clay once a quarter of a round is
  mature (`clayAt` 25%, was 75%) and keep clay until the next round. Simulated on a 6×6 plot: golden clover combos
  +104.8% golden cookies against +98.7%, 8 nursetulips (soil by the clovers) +107% against +100%, and fewer rounds
  to buy.
- **Fixed:** Tulip and clover rounds could get stuck on fertilizer. It replanted clovers that died while others in
  the round were still growing, so the round never ended: its clovers drifted to every age and the soil stayed on
  fertilizer (in the real game, 95% of the time and +49% golden cookies instead of about +80%). A clover round is
  now filled only while none of it is mature, in the gardener and in the Auto buyer's garden rows.
