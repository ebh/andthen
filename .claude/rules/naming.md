# Naming rules

These apply when you coin or reuse a word for a concept. `docs/domain.md` lists the words that exist and the words reserved for planned features.

- **Read `docs/domain.md` before naming anything**: a type, table, column, route, error code, constant, UI label or doc term. If the concept is there, use that word.
- **One word, one meaning.** The same word appears in code, schemas, routes, UI copy and docs. When two words name one thing, pick the one in `docs/domain.md` and fix the other where you touch it.
- **A new domain word needs the owner's agreement.** Say what it means in plain words and offer at least three names. Add its entry to `docs/domain.md` in the same PR that first uses it.
- **Check the Reserved section too.** When a reserved word fits something new, stop and ask the owner whether to keep reserving it. Build a reserved feature only when the owner asks for it.
- **Spell domain words in Australian English**: "organisation", "colour" in prose. Names from a library or platform keep their own spelling, such as the CSS prop `color`.
- **An existing name that breaks these rules is a chore issue**, not a fix made in passing. Changing a name that clients use bumps `API_LEVEL`.
