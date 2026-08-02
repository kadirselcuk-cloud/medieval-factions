# Owed

Commitments made to the owner that are not yet delivered. Distinct from
[OPEN-QUESTIONS.md](OPEN-QUESTIONS.md), which tracks what Claude needs *from* the owner.

Delete an entry when it ships, and say so in `CHANGELOG.md`.

---

## Debts — promised for a phase that has already shipped

### 1. Balance debug panel — promised for 0.4.0, not built
A panel showing projected income, upkeep and time-to-afford, so the owner tunes the economy
from real numbers rather than from Claude's guesses. Committed to when flagging that a
10 gold/month farm against a 10 gold/month unit upkeep makes for a very slow opening.

### 2. Nothing has been visually verified
There is no browser automation in this environment, so **Claude has never seen the game
render.** Everything shipped so far is verified by typecheck, unit tests and a production
build only. Layout, colour and readability are unconfirmed.

Owed: either the owner confirms each build visually, or a screenshot-capable check gets set up.
Do not describe the game's appearance as confirmed until one of those happens.

---

## Delivered

- **Save / load** — shipped in 0.4.0. IndexedDB, named slots, 5 monthly + 3 yearly autosaves,
  JSON export/import, schema versioning with a migration seam, and tests proving both an exact
  round trip and that a reloaded campaign advances identically.
- **Settlement upgrades** — shipped in 0.4.0, no longer inert.
- **Recruitment** — shipped in 0.5.0, and given somewhere to go in 0.7.0.
- **The starting unit** — shipped in 0.7.0. Every playable faction opens with one Light
  Infantry in its capital's garrison, deferred four times before it had an army to join.

---

## Generated values awaiting the owner's review

Everything below was invented by Claude because the game could not be built without it. All of
it is tagged **[GEN]** at its definition. None of it is owner-authored truth.

| Value | Where | Status |
|---|---|---|
| Faction colours (14) | `data/factions.json` | placeholder art |
| Skipping water when claiming a capital's 4 tiles | `src/sim/state.ts` | implemented |
| Strategic speeds (tiles/month) | `docs/CONTENT.md` §3 | **live** — infantry crosses 4 tiles a month |
| Orthogonal-only army movement | `src/sim/movement.ts` | implemented |
| Which unit each building adds to a settlement's defence | `data/units.json` | implemented |
| Battle speeds (tiles/battle turn) | `docs/CONTENT.md` §3 | not yet implemented |
| Fortification bonuses per settlement tier | `docs/CONTENT.md` §2 | not yet implemented |
| Damage formula and its modifiers | `docs/MECHANICS.md` §6 | not yet implemented |
| Range ÷ 10 = tiles | `docs/MECHANICS.md` §6 | not yet implemented |
| Advanced Farms / Irrigation yields | `docs/OPEN-QUESTIONS.md` | not yet implemented |
| Season boundaries and modifiers | `docs/MECHANICS.md` §5 | **approved by owner** |

---

## Committed for later phases

Tracked in [ROADMAP.md](ROADMAP.md); listed here so nothing quietly disappears.

- Per-faction unit names and the 10 elite units — 0.11.0, to be designed with the owner
- Faction strengths and weaknesses — 0.11.0
- Asset manifest so the owner's 2D art replaces placeholders without touching logic — 0.11.0
- AI opponents — 0.9.0. Currently the 12 rivals do nothing at all: they never muster, never
  march, and never take ground
- Naval — 0.10.0. Britons and Moors cannot leave their landmass until this exists
- Capacitor mobile wrap, ad and premium-unlock hooks — 1.0.0
- Tactical battle map — 2.0.0

---

## Environment changes made

- **Node upgraded from 14.17.1 to 22.11.0** via `nvm`, with the owner's approval. `nvm4w`
  switches a global symlink, so this changed the default Node for every project on the
  machine. Reversible with `nvm use 14.17.1`.
- **Git:** initialised and pushed to `github.com/kadirselcuk-cloud/medieval-factions`, with a
  GitHub Actions workflow publishing to GitHub Pages.
