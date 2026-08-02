# Changelog

All notable changes to Medieval Factions are recorded here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning is [Semantic Versioning](https://semver.org/) — `MAJOR.MINOR.PATCH`:

- **MAJOR** — save-format break or fundamental redesign.
- **MINOR** — a new gameplay system or feature.
- **PATCH** — bug fix, balance tweak, refactor, or documentation.

Pre-`1.0.0` the game is not feature-complete. `1.0.0` marks the first public release.

---

## [0.5.0] — 2026-08-02

**Economy tuning and the realm UI.**

### Changed
- **Sawmill output cut from 10 per level to 1.** Wood is now the scarcest resource in the
  game, and nothing but a sawmill produces any. Terrain still applies, so a forest sawmill
  doubles to 2 and a desert one floors to nothing.
- Naval buildings renumbered as levels 2–4 behind the new Fishery, with durations following
  the 12/18/24/30 rule.
- "Coastal" now means any of the **eight** neighbours is water, matching the fishery's own
  adjacency. It previously counted only the four orthogonal ones.

### Added
- **Fishery** — heads the naval line at Village tier, 150 gold, gold only so a coastal capital
  can build it on turn one. Pays **+10 gold/month per adjacent water tile**, rising to +20,
  +30 and +40 as the line upgrades. A shore settlement loses land tiles to the sea; this turns
  that same water into its best income.
- **Tabbed city panel** — Info, Buildings, Armies. Armies is a placeholder until 0.6.0.
- **Realm rosters** in the top bar — Cities, Armies, Navies. Cities lists every settlement you
  hold with its tier, population and current construction; clicking one selects it and centres
  the map on it.
- `describeTile()` in `src/data/world.ts` — tile description independent of the renderer, so
  the roster can select a tile the camera has never been near.

---

## [0.4.1] — 2026-08-02

Fixes a blank page on GitHub Pages.

### Fixed
- **Built asset paths.** Pages serves the site from `/medieval-factions/`, but Vite defaulted
  to a root base, so every asset URL resolved one directory too high. `vite.config.ts` now
  sets the repository base for builds and leaves the dev server on `/`. Override with
  `VITE_BASE` for a custom domain or the future Capacitor build.
- **Publishing the wrong thing.** Pages was serving the repository root, whose `index.html`
  references `/src/main.tsx` — a file that only exists while the Vite dev server is running,
  which is what produced the 404 and the blank page.

### Added
- `.github/workflows/deploy.yml` — builds on every push to `main` and publishes `dist/` to
  Pages. Typecheck and tests run first, so a broken simulation cannot reach the live site.
- `public/favicon.svg`, replacing the 404 on `favicon.ico`.

---

## [0.4.0] — 2026-08-02

**Cities and production.** Build things, upgrade settlements, improve tiles, and save.

### Added
- **Construction** (`src/sim/construction.ts`). Each settlement has its own queue; only the
  head makes progress. Orders pay their cost up front, so a queue is a commitment rather than
  an intention — and cancelling refunds in full, since the loss is the months, not the money.
- **Settlement upgrades** — Village → Town → City → Capitol at 24 / 36 / 48 months.
- **Tile improvements** — one farm, mine or sawmill per tile, built at level 1 and upgraded to
  a maximum of 4, capped by the realm's best settlement. Held as parallel typed arrays, which
  is both cache-friendly and free to serialise.
- **Housing and fortification are separately built lines**, not granted by the settlement
  tier. A Town that never puts up Stone Houses keeps growing at its Wooden Houses rate.
  A fresh Village starts with nothing built and grows at 0.2%/month.
- **Save/load** (`src/sim/save.ts`) — IndexedDB with named slots, JSON export/import, schema
  versioning and a migration seam that exists from the first save ever written. Autosave
  rotates 5 monthly and 3 yearly slots independently.
- Selection panel now acts: build and upgrade improvements on any owned tile, queue buildings
  and settlement upgrades in your cities, cancel anything, and see costs against your treasury.
- `Game.command()` — the single write path from UI into the simulation.
- 21 new tests: opening position, cost payment and refunds, queue ordering, tier gating,
  improvement caps and kind-locking, and two save tests — an exact round trip, and proof that
  a reloaded campaign advances identically to one that never stopped.

### Changed
- `data/buildings.json` grew the housing and fortification lines and the settlement upgrade
  table. 23 buildings total.
- Income now counts commerce buildings and every owned tile's improvement, not just cities
  and bare resource nodes.
- Population growth counts built housing and administration buildings.

### Known gaps
- Recruitment moved to 0.5.0, where it belongs beside armies — units with nowhere to stand are
  just inventory. The starting unit lands there too.
- The balance debug panel is still owed.

---

## [Unreleased]

### Added
- `docs/ROADMAP.md` — the approved build phases and stack, which until now existed only in
  conversation and would have been lost between sessions.
- `docs/OWED.md` — commitments made but not delivered (slipped save/load, the inert upgrade
  button, the unbuilt balance panel, and the fact that nothing has been visually verified),
  plus every generated value awaiting the owner's review and the environment changes made.

### Changed
- `CLAUDE.md` — document index now covers all six reference documents.
- **Map revision** (`data/maps/europe-1350.json`), now **60 cities**:
  - Removed Toulouse and Genoa.
  - Added Burgundy (21, 13), Sardinia (26, 21), Crete (45, 25) and Cyprus (56, 25). Cyprus
    is a new one-tile island; the others sit on land that was already drawn.
  - Moved Leon 2 west to (5, 18), Barcelona 2 west and 1 south to (15, 20), and Mecca 1 north
    to (61, 33).
  - Revalidated: all rows 70 wide, every city and mine glyph matches its record, no
    coordinate collisions, and all 102 features still agree with their authored lat/lon.
- Test expectations updated for 60 cities and 47 Independent-held cities.
- **Second map revision**, still 60 cities:
  - Cyprus moved 1 south to (56, 26) — it now sits on the 3-tile island that was already
    drawn there. The tile it previously occupied is water again.
  - Naples → (34, 20), Bucharest → (47, 13), Sofia → (45, 17), Buda → (39, 13),
    Krakow → (40, 10).
  - Terrain: (50, 19) is now forest, giving Constantinople a land neighbour to the east.
    (48, 20), (7, 25) and the one-tile island at (18, 21) are now water.
- **Resource node yields cut to their un-mined values**: gold nodes 20/month, silver 10,
  iron 1, stone 1. The large yields now require a mine.
- **Terrain modifier scale corrected** — `-` is **−40%** (×0.6), not the −50% recorded
  earlier. `++` +100%, `+` +50%, `--` −80% are unchanged. Pinned by a test, because the
  asymmetry looks like a typo and invites being "fixed".

### Added
- `data/buildings.json` + `src/data/buildings.ts` — the 15-building catalogue with **[GEN]**
  costs, durations, tier gates and effects. Validated at boot, including a check that no
  building sits at a line level its tier gate can never reach.
- `data/improvements.json` — improvement yields (owner-authored) and costs (**[GEN]**), with
  a boot-time check that every level array matches the declared maximum level.
- Diminishing treasury growth bonus in `src/sim/tick.ts`, hitting the owner's anchors exactly:
  +1% at 10k gold, +2% at 100k, +3% at 1M, capped there.
- `src/data/terrain.ts` — per-terrain profile: buildability, defender's advantage, movement
  cost, and the output multiplier for each improvement kind.
- `src/data/improvements.ts` — tile improvement economics. One improvement per tile, built at
  level 1 and upgraded to a maximum of 4, capped by the realm's highest settlement tier.
  `tileOutput()` is the single place a tile's monthly yield is computed, terrain modifier
  included, so mines can be added in 0.4.0 without reshaping the economy.
- 9 tests covering the modifier scale, node yields, farm scaling by terrain, ordinary mines
  producing both metals, silver feeding the gold stockpile, and level clamping.

### Documented
- Tile improvements, construction durations, city building effects, the diminishing treasury
  growth bonus, and the 5-monthly + 3-yearly autosave rotation — `docs/MECHANICS.md` §5, §7
  and `docs/CONTENT.md` §2.
- Nine design decisions added to the log in `docs/DESIGN.md`.

---

## [0.3.0] — 2026-08-02

**Factions, territory and selection.** Pick a faction, see who owns what, click anything.

### Added
- `data/factions.json` — all 14 factions (13 realms plus neutral Independents) with religion,
  capital, colour and a `playable` flag. Playability is data, so premium faction unlocks stay
  a config change.
- `src/sim/state.ts` — campaign setup. Each faction takes its capital and the four orthogonal
  land tiles around it; the Independents inherit the other 45 cities.
- Territory overlay: owned tiles are washed in the owner's colour with hard borders between
  realms, and city markers are drawn in their owner's colour.
- Click any tile or city for a details panel — owner, religion, terrain, position, settlement
  tier, population and monthly yield. `Esc` closes it.
- Start screen for choosing between the Franks, Turks and Russians.
- Live treasury in the top bar with each resource's monthly rate.

### Changed
- `MapRenderer` distinguishes a click from a pan with a 5 px threshold, so selecting a tile
  and dragging the map no longer conflict.

### Known gaps
- **Save/load slipped to 0.4.0.** The state is already integer-only and serialisable by
  construction, but nothing writes it to IndexedDB yet.
- Settlement upgrade is shown in the panel but disabled — how many months an upgrade takes is
  an open question (`docs/OPEN-QUESTIONS.md`).

---

## [0.2.0] — 2026-08-02

**The clock.** Time runs, and the campaign has a calendar.

### Added
- `src/sim/calendar.ts` — the whole calendar derived from an integer tick count: 4 phases per
  day, 30 days per month, 12 months per year, from January 1350. Seasons and their movement,
  harvest and defender modifiers.
- `src/sim/types.ts` — simulation state. Money and population in thousandths, integers only,
  plus a seeded mulberry32 PRNG whose state lives in the save.
- `src/sim/tick.ts` — the single `advance()` entry point. Income accrues per tick without
  losing the remainder; population compounds on the month boundary.
- `src/sim/game.ts` — the clock. Pause / 1× / 2× / 5× / 10×, spacebar to toggle pause, a
  per-frame tick cap so a stalled tab cannot dump a year into one frame, and automatic pause
  when the tab is hidden (no offline progress, per `docs/MECHANICS.md` §1).
- Month gauge in the bottom bar — the only place a "turn" is still visible.
- Tests: calendar boundaries, income conservation over a month, documented population growth,
  and a determinism check that 1,000 ticks in one batch equal 100 batches of 10.

---

## [0.1.0] — 2026-08-02

**Foundation and campaign map.** First running build. Open `http://localhost:5173`, see
Europe, pan and zoom it. No simulation yet — the clock arrives in 0.2.0.

### Added
- Vite + React + TypeScript project, strict mode, with `dev` / `build` / `typecheck` / `test`.
- `src/data/mapSchema.ts` — Zod schema for owner-authored map files.
- `src/data/world.ts` — flattens a map file into the indexable `World` the renderer and
  simulation share. Validates cross-references the schema cannot see: grid dimensions, every
  feature glyph having a record, every record sitting on the glyph it claims. A bad map fails
  loudly at boot with a readable error instead of corrupting a campaign hours later.
- `src/render/camera.ts` — camera over the tile grid, in pixels-per-tile, with cursor-anchored
  zoom and edge clamping.
- `src/render/MapRenderer.ts` — Canvas 2D renderer. Redraws only on change; pan, wheel zoom,
  touch pinch, per-tile hover, terrain shading, city and resource markers, zoom-gated labels.
- `src/ui/` — landscape shell: top bar (title, version, resource chips), bottom bar (speed
  controls, tile readout, zoom controls), portrait rotate-gate.
- Tests: 14 across map validation and camera math, including the invariant that tile
  coordinates agree with the authored lat/lon for all 100 cities and mines.

### Documented
- Population and tile-income model in `docs/MECHANICS.md` §5.
- Six new economy questions raised by the population model in `docs/OPEN-QUESTIONS.md`.

### Notes
- Node 22.11.0 installed via nvm; the previous Node 14.17.1 predates every current build tool.
- Speed buttons are present but inert until the simulation exists in 0.2.0.

---

## [0.0.3] — 2026-08-02

Design interview complete. Build plan drafted for approval. Still no code.

### Added
- `docs/MECHANICS.md` — auto-resolve combat algorithm, season table, farm economy.
- `docs/CONTENT.md` — Independents faction, ship roster, faction starting conditions,
  proposed strategic and battle speeds.

### Changed
- `docs/DESIGN.md` — decision log extended to 23 entries.
- `docs/OPEN-QUESTIONS.md` — reorganised by the build phase each question is due before.
  Nothing outstanding blocks starting the build.

### Resolved
- The 45 non-capital cities belong to a neutral, garrisoned Independents faction.
- Farms produce gold; there is no food resource.
- Naval exists — four ship types, gated by Dock / Port / Shipyard.
- Castille resolves to Toledo; Hungary to Buda. All factions start Village tier, 250 gold.
- Territory is claimed by army presence, not passive growth.

---

## [0.0.2] — 2026-08-02

Design interview rounds 3–4 captured. Still no code.

### Added
- `data/maps/europe-1350.json` — the owner's 70 × 35 Europe map: terrain rows, 58 cities,
  42 resource nodes. Validated: all rows 70 chars, every city and mine coordinate matches its
  map glyph, no coordinate collisions.
- `docs/MECHANICS.md` — time model, territory, terrain table, economy, combat, saves.
- `docs/CONTENT.md` — 13 factions, settlement tiers, buildings, 10-unit roster, proposed
  strategic speeds.

### Changed
- `docs/DESIGN.md` — rewritten as the hub document; decision log extended to 16 entries.
- `docs/OPEN-QUESTIONS.md` — rounds 1–2 questions resolved and moved into the design docs;
  replaced with round 4 questions.

---

## [0.0.1] — 2026-08-02

Documentation bootstrap. No code yet.

### Added
- `CLAUDE.md` — project brief, working agreements, versioning and changelog rules.
- `docs/DESIGN.md` — locked design decisions from the design interviews.
- `docs/OPEN-QUESTIONS.md` — outstanding decisions awaiting the owner.
- `CHANGELOG.md` — this file.
