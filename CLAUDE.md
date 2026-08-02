# Medieval Factions

Browser-based single-player grand-strategy game (campaign map + battles), later ported to
Android/iOS as a WebView wrapper. Runs fully offline; no backend.

**Owner:** experienced full-stack software architect. Assume high technical fluency —
propose and justify architecture, don't over-explain basics.

## Authoritative documents

Read these before doing any work. They are the source of truth, not this file.

| File | Contents |
|---|---|
| [docs/DESIGN.md](docs/DESIGN.md) | Locked game-design decisions, and the decision log |
| [docs/MECHANICS.md](docs/MECHANICS.md) | Time, territory, terrain, economy, combat, saves |
| [docs/CONTENT.md](docs/CONTENT.md) | Factions, settlements, buildings, units, ships |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Approved build phases and the stack |
| [docs/OPEN-QUESTIONS.md](docs/OPEN-QUESTIONS.md) | Unresolved decisions — ask the owner, never guess |
| [docs/OWED.md](docs/OWED.md) | Commitments not yet delivered, and every generated value awaiting review |
| [CHANGELOG.md](CHANGELOG.md) | Every change, versioned |

## Running it

Requires **Node 20+** (Node 22.11.0 is installed via `nvm`; run `nvm use 22.11.0` if a shell
falls back to an older version).

```
npm install
npm run dev         # http://localhost:5173, hot reload
npm test            # vitest
npm run typecheck   # app + vite config
npm run build       # typecheck, then production bundle
```

## Architecture

The rule everything else follows from: **the simulation is a pure, DOM-free module over
integer state.** Seeded RNG, integer tick counter, fixed-point money. No `Date.now()`, no
floats in simulation state, no React state owning simulation data. This is what makes
save/load correct, 10x speed safe and battles replayable — and it cannot be retrofitted.

- `data/` — owner-authored content (maps, and later factions/units/buildings). Deliberately
  outside `src/`: it is content, not code.
- `src/data/` — Zod schemas and the loaders that turn content into runtime structures.
- `src/render/` — Canvas 2D campaign map. Owns the camera and all pointer interaction.
- `src/ui/` — React chrome: bars, panels, dialogs. DOM for UI, canvas for the map.
- `src/sim/` — the simulation (from 0.2.0).

## Working agreements

These were set by the owner and apply to every session.

1. **Ask, don't assume.** If a mechanic, value, or rule is not written down in
   `docs/DESIGN.md`, ask. Do not invent game rules. Log the question in
   `docs/OPEN-QUESTIONS.md` if it can't be resolved immediately.
2. **Always runnable.** A dev server must come up on localhost and hot-reload after every
   change. Never leave `main` in a non-booting state.
3. **Versioning.** Semantic `MAJOR.MINOR.PATCH`. Single source of truth is `version` in
   `package.json`; it must match the top entry of `CHANGELOG.md` and the version shown in
   the game's UI.
   - `MAJOR` — save-format breaks, or a fundamental redesign.
   - `MINOR` — new gameplay system or feature.
   - `PATCH` — bug fix, balance tweak, refactor, docs.
   - Pre-1.0.0 the game is not feature-complete; `1.0.0` = first public release.
4. **Changelog.** Every change gets an entry under `## [Unreleased]` as it is made, in
   Keep-a-Changelog format (`Added` / `Changed` / `Fixed` / `Removed`). Cut it to a version
   heading when the version is bumped. No silent changes.
5. **Design docs stay current.** When a rule changes, update `docs/DESIGN.md` in the same
   change that alters the code.
6. **Placeholders now, art later.** Use programmer art and non-commercial placeholder icons.
   All art must be swappable via a data/manifest layer — never hardcode asset paths in logic.

## Constraints that shape the architecture

- **Offline-first.** No server, no accounts, no network calls at runtime.
- **Landscape-locked**, responsive from phone through desktop full-screen.
- **Long campaigns.** Save/continue is a first-class system, not an afterthought.
- **Deterministic simulation.** Seeded RNG, fixed logical tick — required for correct
  save/load and for the speed multipliers to not change outcomes.
- **Data-driven.** Factions, units, buildings, resources and terrain live in data files, not
  code. Faction access will later be gated for monetization (premium unlocks all factions).
