---
bump: minor
---

- **Fixed:** heavy lag from the Auto buyer, worst right after an ascension. A rule whose condition reads
  `buyer.budget()` (the seeded "Buy all upgrades → buy first when 20 or more" rule) worked the whole queue out again
  inside itself, over and over, every time the buyer looked; inside its own queue `buyer.budget()` is now the bank
  less the reserves placed first.
- **Auto buyer:** while a building's next 100 cost under the profile's Cheap ×100 seconds of CpS, the queue is just
  those (cheapest first, plus Buy all upgrades when a rule puts it first) and nothing else is measured: right after
  an ascension it buys hundreds of them in a row without computing a payback period for each.
- **Faster:** the "to next achievement" count only tries the counts that can win an achievement (the same answers).
