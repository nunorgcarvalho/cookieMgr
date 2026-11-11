---
bump: minor
---

- **Code editor library, possible values:** a call whose choice comes from a fixed list (`spell.cast(spell)`,
  `buff(name)`, `building(name)`, `season.keep(season)`…) shows how many there are under its row ("▸ 9 spells");
  click it to list every one with what it is (a spell's effect…), and click one to write the call with it
  (`spell.cast("hand of fate")`; a steps macro gets the step with it picked). Searching a value ("hand of fate")
  finds the calls that take it, their lists open on the matching values.
- **Fixed:** ★ on a library row no longer redraws the library and throws it back to the top: the row stays under
  the mouse and its copy waits in Pinned.
- **Fixed:** clicks that redraw the page you're on (switching a macro, editing one, a settings choice…) no longer
  blink the whole panel to black: the page fades in only when you open it.
