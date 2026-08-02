# Changelog

All notable changes to Medieval Factions are recorded here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning is [Semantic Versioning](https://semver.org/) — `MAJOR.MINOR.PATCH`:

- **MAJOR** — save-format break or fundamental redesign.
- **MINOR** — a new gameplay system or feature.
- **PATCH** — bug fix, balance tweak, refactor, or documentation.

Pre-`1.0.0` the game is not feature-complete. `1.0.0` marks the first public release.

---

## [0.10.0] — 2026-08-03

**Siege, and the fight for a city.** A walled capital is no longer untakeable — it is taken by
sitting outside it. Four owner-specified changes, and all three of 0.9.0's measured problems
either close or improve.

### Added

- **Ranged accuracy**, owner-authored: Skirmisher **30%**, Archer **50%**, Cavalry Archer
  **40%**. Applied as a straight multiplier on the volley rather than a roll per shot — a
  hundred men loosing at once average out, and an auto-resolve that swung on a coin flip would
  be worse to watch, not better.
- **Sieges.** An army standing on any of the eight tiles around a hostile settlement can invest
  it. A besieged settlement **pays its owner nothing, finishes nothing** in any of its three
  queues, and **starves at 1% a month**. It holds out for as long as its tier allows —
  owner-authored: **Village 1 month, Town 3, City 6, Capitol 12**.
  - When the clock runs out the defenders **surrender** if outnumbered more than three to one,
    and otherwise **sortie into a forced open-field battle** in which *nobody* has the
    fortification bonus. That is what a siege buys.
  - A siege is **held by presence** — walk away and it is over.
  - **Assault** remains available at any time, from beside the walls or by marching onto them.
    It is immediate, and the walls count in full.
- **Every army within a 5 × 5 box joins a battle for a settlement**, on both sides — two tiles
  in any direction, diagonals included. A relieving army that loses is destroyed with the city.
- **Siege orders and readouts**: Besiege and Assault on the army card, months remaining and what
  the siege is doing to the settlement on the city panel.

### Changed

- **The defender's advantage now belongs to the formation, not to the battle.** Troops behind
  the walls keep the fortification; an army that marched to the relief fights on the terrain and
  the season alone. Both figures apply when that formation strikes *and* when it is struck, and
  the battle viewer shows each formation's own number.
- Survivors are returned to **the exact army that fielded them**, which a multi-army battle
  requires. A formation that stayed on the field keeps at least one unit if any of its men are
  standing — now judged per army rather than per side.
- A captured settlement's tile changes hands with it, whether or not an army is left to walk in.
- Save format **v3 → v4**, with a migration. A v3 save has no settlement invested.
- Roadmap renumbered: AI is 0.11.0, naval 0.12.0, identity and polish 0.13.0.

### Measured

Real battles, on the shipped resolver, against the 0.9.0 figures.

| | 0.9.0 | 0.10.0 |
|---|---|---|
| 1 Light Infantry vs 1 Archer | archer wins, **0** casualties | archer wins, 10 casualties, 20 turns |
| Light Infantry needed to beat 1 Archer | 3, for 183 dead | **2**, for 85 |
| 2 Light Cavalry vs 2 Skirmishers | — | cavalry win, 29 lost against 160 |
| 20 Heavy Cavalry storming a full Capitol | — | **lose 787, kill 148** — still impossible, by design |
| 10 Heavy Cavalry against the same Capitol's sortie | — | **win**, 260 lost against 460 |

The walls are 90% and the open field is 40%. Storming a Citadel is meant to be hopeless; the
siege is the answer, and even twenty Light Infantry beat a full Capitol once it has come out.

## [0.9.0] — 2026-08-03

**Combat and conquest.** Cities can be taken, realms can be extinguished, and every battle can
be watched turn by turn.

### Added

- **`src/sim/battle.ts`** — auto-resolve, to the owner's algorithm. A 50-tile field, armies at
  opposite ends, activation alternating by speed, one action per activation, random targets in
  range, the 3× rout rule from turn 10, and the 48-turn stalemate cap.
  - A battle is a **pure function** of the two stacks, the ground and the RNG. It draws from the
    campaign's seeded stream, so the same save fights the same battle.
  - Every step is **integer arithmetic** — the damage formula's fractions are per-mille
    multipliers, floored at each step.
  - The defender's advantage is split into its terms — terrain, settlement, walls, winter —
    shown on screen, and **capped at 90%** so the ground can never heal an attacker.
- **`src/sim/conquest.ts`** — what happens after the fighting. Cities change hands, losing
  armies are destroyed, survivors are reformed into whole units, and a realm that holds neither
  a settlement nor an army is extinguished, its remaining ground reverting to no-one.
- **`src/ui/BattleView.tsx`** — the battle viewer. Every formation on its own track across the
  50-tile field, strength bars draining, an hour-by-hour ticker of who struck whom for how many.
  Play, pause, scrub, 1×/2×/5×, skip to the end. Playback runs at the stated **6 turns a tick**.
- **A battle involving the player pauses the campaign and opens the viewer** — the seam Phase B
  plugs into. Battle notifications reopen a fight while its report is still held.
- **Victory and defeat.** Total conquest ends the campaign; so does losing your last settlement
  and your last army.
- 19 tests covering the formula, the ground, reproducibility from a seed, capture, the garrison
  going back behind the walls, faction elimination, the save round trip, and a whole campaign
  advancing identically twice with a battle in it.

### Changed

- **A march may be aimed at hostile ground.** Enemy armies and defended settlements are
  destinations now, not walls; a route still never threads *through* one. Before this, ordering
  an attack simply reported "no route".
- **A settlement fields its garrison as well as its defenders.** Recruited units standing in a
  city being stormed fight for it, and their survivors return behind the walls if it holds.
- A captured settlement keeps its people and buildings, and loses its queues, garrison and fleet.
- Save format **v2 → v3**, with a migration. A v2 save has fought no battles.
- `docs/CONTENT.md` corrected: Stone Walls give **+30%**, not +25% — the value is stored in
  tenths and always has been 30%. The documentation was wrong, not the data.

### Known

Three measured results, all recorded with numbers in `docs/OPEN-QUESTIONS.md`. The algorithm is
owner-specified; the constants under it were never approved.

- **Defenders win mirror matches decisively** — one Light Infantry attacking one Light Infantry
  on plains is wiped out for 38 casualties.
- **Ranged dominates the 50-tile field** — a lone Archer beats a lone Light Infantry without
  taking a casualty.
- **A Citadel Capitol cannot be taken** — 9 free defenders and an 80% advantage; ten Heavy
  Cavalry lose 400 men and kill 24.

## [0.8.3] — 2026-08-03

**The balance panel**, owed since 0.4.0. Press **B**.

### Added

- **`src/sim/balance.ts`** — income and growth split into the terms that produce them, rather
  than only the totals the simulation needs.
  - **Income**: population, commerce, fishing, bare land, improvements, upkeep, net — plus
    wood, iron and stone.
  - **Growth**: base, treasury, tier, buildings, and the people that adds next month.
  - **Months to the next population gate**, per settlement.
  - **Months to afford** any cost, at the realm's current net income.
- **Projections** that run the **real simulation** forward 1, 5, 10 and 25 years on a copy of
  the campaign, and report where a faction ends up. The copy comes from the save round trip, so
  it is exact; the live campaign is never touched, and a test asserts that.
- **Any faction can be inspected**, not only the player's. Comparing your realm against an
  untouched rival is the fastest way to see whether a rule is doing what it should.
- Two tests keep the panel honest: the income breakdown must sum to exactly what the simulation
  pays every faction, and the growth breakdown must sum to the rate the simulation uses.

### Changed

- Two combat decisions recorded ahead of 0.9.0: the auto-resolve field is **50 tiles across**,
  so unit ranges are used exactly as written rather than divided by ten; and at the 48-turn cap
  a battle is a **stalemate with both armies withdrawing**.
- Documentation corrected where it had drifted: the Independents hold 47 cities not 45, housing
  and fortification are separately built lines, and the building table now lists the real
  growth figures.

## [0.8.2] — 2026-08-03

### Changed

- **Housing and hall lines now give diminishing growth**: the first building in each is worth
  **+1.0%** a month, the second **+0.5%**, the third **+0.2%**. Cumulative, so the whole
  housing line is +1.8% and the whole hall line +1.7%. The fourth housing step, Manors, is
  **+0.1%** — **[GEN]**, continuing the taper, since three values were given for four
  buildings.
- Replaces the old flat +0.1% per housing level and +0.1% per hall. Housing no longer
  contributes through `housingLevel`; both lines pay through `growthTenths`, so a settlement's
  growth depends on which buildings stand rather than how high a chain has climbed.
- **Wooden Houses is now the decisive opening move**: 120 gold takes a Village from 0.2% a
  month to **1.2%**, six times everything else it has.

### Known limits

- The ceiling rises sharply. A Capitol with every housing and hall building and a million gold
  banked grows **7.0% a month**, doubling its population every 11 months — and population is
  still uncapped. See the open question in `docs/OPEN-QUESTIONS.md`.

## [0.8.1] — 2026-08-03

### Changed

- **Settlement population gates halved**: Town **2,000**, City **5,000**, Capitol **10,000**,
  down from 5,000 / 10,000 / 20,000. The first gate falls from about 76 years to about 35 for
  a settlement with nothing built, and from six years to three for one sitting on a fortune.
  Growing a realm is still the work of decades, but the opening no longer stalls.

## [0.8.0] — 2026-08-03

**Everything is a square.** The settlement panel is rebuilt around a picture grid, and
expanding a settlement becomes a building you put up rather than an abstract upgrade.

### Added

- **Square tile grid, two to a row**, for every building, unit, ship and land improvement.
  Nothing is ordered from the square itself: clicking opens a **detail window** carrying the
  description, the full numbers and the order button — so a refusal has somewhere to explain
  itself instead of being a greyed-out button with no reason.
- **`data/art.json`** — the art and flavour manifest. Every icon and every blurb lives here,
  keyed by id. Nothing in the code names an icon or an asset path, so real art arrives by
  adding `"image": "..."` to this file and changing no code at all. Blurbs are **[GEN]** and
  the owner's to rewrite; every number in a detail window is derived from the content files,
  so flavour can never drift out of step with the rules.
- **Navy tab**, carrying the fleet, the yard queue and the ship grid. Landlocked settlements
  do not show it.
- **Population requirements for expanding a settlement**: Town 5,000, City 10,000, Capitol
  20,000 — and **only one Capitol per realm**, counting one merely under construction.

### Changed

- Expanding a settlement is now **built like any other building**, first card in the grid, and
  described as the settlement growing rather than as an "upgrade".
- **The Land tab is gone.** Tile improvements are now **Fief Buildings**, sitting under **City
  Buildings** inside the Buildings tab. Tabs are Info / Buildings / Armies / Navy.
- The Buildings tab shows a **creeping meter for what is under construction**, matching the
  Info tab, with a cancel button and a full refund.
- The City Buildings grid holds **every building the settlement's tier can reach** — built,
  queued, buildable and unaffordable alike — so a chain reads as a progression rather than a
  menu that changes shape whenever something finishes.
- The Recruit grid likewise shows the **whole roster**, so it is possible to read what a
  Barracks would eventually buy rather than only what is affordable today.
- Ship building moved out of the Buildings tab into Navy.

### Known limits

- The population gates are steep. A Village with nothing built and no treasury grows at
  0.2% a month, which is a long road to the people a Town needs. The wealth bonus is
  what makes expansion possible at all - see 0.8.1, which halved the gates.

## [0.7.1] — 2026-08-02

**Orders you can see.** Follow-up to 0.7.0 from the owner's first play.

### Changed

- **Every marching army shows its route**, not only the selected one. The selected army's line
  is drawn brighter; the rest are dimmed but visible. Only the player's own orders are drawn.
- **Route lines animate** — the dashes crawl towards the destination. Deliberately at a fixed
  rate rather than one tied to game speed: the line says "under orders", not "moving this
  fast". The map only animates while something is actually marching.
- **March continues from the last destination.** A second march order routes from the end of
  the route already given and appends to it, so a journey can be laid out in several clicks.
- **Halt cancels the whole route**, queued legs and all. It is now the only way to throw a
  route away, which is what makes append the right default for March.
- **Recruit moved from the Buildings tab to the Armies tab**, beside the garrison it feeds.
- The Armies tab now shows **In training**: every unit in the recruitment queue, with a meter,
  a months-remaining count, and a cancel button with a full refund.
- **Progress meters creep instead of stepping.** Construction only ticks over on a month
  boundary, so every bar used to sit still for 120 ticks and then jump. Bars now add the
  current month's own progress to whatever is being worked on. Queued items behind it stay
  still, because nothing is happening to them.

## [0.7.0] — 2026-08-02

**Armies.** Units stop being inventory and start being a map presence.

### Added

- **Field armies.** Muster units out of a settlement's garrison into an army standing on its
  tile, up to 20 units. Two friendly armies meeting on a tile merge. An army can stand down
  into a friendly settlement's garrison intact, or disband in the field and lose its units.
- **Movement.** Order a march and the army walks it tile by tile, A* over terrain cost, at the
  speed of its slowest unit. Entering a tile **claims it** — territory grows by presence and
  nothing else. Income is recomputed the moment ground changes hands rather than at the next
  month boundary.
- **Winter bites.** Seasonal movement is live: −40% in December through February, so infantry
  that crosses four tiles a month manages 2.4.
- **Settlement defenders.** Every settlement on the map, including all 47 the Independents
  hold, now defends itself with units derived from its tier and its buildings. They cost
  nothing, draw no upkeep, never desert, and can never be mobilised — Village 1, Town 2,
  City 3, Capitol 5, plus one for each of Barracks, Archery Range, Stables and Town Hall.
  A fully built Capitol fields nine.
- **The starting unit**, owed since the design interview: every playable faction opens with one
  Light Infantry in its capital's garrison. The Independents get none.
- Armies are drawn on the map with a unit-count badge in their faction's colour, and the
  selected army's route is drawn as a dashed line to a ringed destination.
- The **Armies roster** in the top bar lists every army in the field with its strength,
  soldiers, upkeep and orders, and selects it on the map.
- A settlement's **Armies tab** now separates Defenders, Garrison and Fleet, with per-unit and
  whole-garrison muster.

### Changed

- Upkeep now counts units in the field, exactly as it counts units in barracks.
- Desertion reaches field armies too, in a fixed iteration order so a save still replays
  exactly. An army that loses its last unit ceases to exist. Defenders are exempt: they draw
  no pay, so there is no wage for a bankrupt realm to miss.
- Saves are **version 2**. A version 1 save loads with no armies in the field and its cities'
  units left where they were — those were always garrison.
- The map now repaints as the simulation ticks. It previously only redrew on interaction, which
  no one could see until something on it started moving.

### Known limits

- **Nothing can be conquered yet.** Every settlement is defended and combat does not exist, so
  a hostile settlement stops a march dead. Conquest lands with combat in 0.9.0.
- The 12 rival factions still do nothing — they never muster, march or take ground.

## [0.6.4] — 2026-08-02

**Milan out of the Alps.** The Italian capital was walled in by mountain on all four sides,
which under the per-terrain base yields of 0.6.3 left it earning 10 gold a month against
22–55 for everyone else.

### Changed

- **Milan** (26, 15) and the tile south of it (26, 16) change from Mountain to **Plains**; the
  tile east (27, 15) changes to **Forest**.
- Italy's opening income goes from 10 gold to **35 gold, 3 wood, 2 iron, 2 stone** a month —
  mid-pack, and still the most mixed economy on the map.

## [0.6.3] — 2026-08-02

**Terrain pays.** A held tile's base yield now depends on what the ground is.

### Changed

- The flat **10 gold per held tile** is replaced by an owner-authored, per-terrain yield:

  | Terrain | Base yield per month |
  |---|---|
  | Plains | 10 gold, 1 wood |
  | Forest | 5 gold, 1 wood |
  | Steppe | 5 gold |
  | Tundra | 2 gold, 1 wood |
  | Desert | 2 gold |
  | Mountain | 1 iron, 1 stone |

- Wood, iron and stone now trickle in from bare territory, where previously **only** a built
  sawmill or mine produced them.
- The base yield is deliberately **not** scaled by the terrain modifiers. Those numbers already
  are the terrain's contribution; scaling them again would count it twice. Only an
  improvement's own yield is scaled.
- `baseTileGold` in `data/improvements.json` becomes `baseTileYield`, keyed by terrain. Loading
  fails loudly if a terrain is missing or unknown, rather than silently paying nothing.

## [0.6.2] — 2026-08-02

**Map revision.** Owner-directed terrain edits to `data/maps/europe-1350.json`.

### Changed

- Nineteen tiles become **Mountain**: five scattered through the tundra, four through the
  steppe, five through the forest, four across the Libyan desert between Tripoli and
  Alexandria, and one at (65, 27). They are deliberately isolated single peaks rather than
  ranges — none is orthogonally adjacent to a settlement, so no city loses a workable tile.
- **Konya** and the tile west of it (54, 23) change from Mountain to **Plains**, giving the
  city something to farm.
- The three tiles directly south of **Alexandria** — (50, 31), (50, 32), (50, 33) — change
  from Desert to **Plains**.

## [0.6.1] — 2026-08-02

**Debt.** Running out of money is now a slow crisis rather than a hard stop.

### Changed
- **Gold may go negative.** The clamp at zero is gone; a realm can run into debt and pays for
  it in people and troops rather than in a wall.
- **The wealth growth band is now symmetric.** Debt hurts exactly as much as wealth helps —
  10,000 in the red is −1% population a month, a million in the red is −3%. A settlement
  never falls below 100 people however deep it goes. **[GEN]**
- **Ships cost wood**: 50 / 100 / 200 / 500 for Transport, Light Ship, Heavy Ship, Flagship.
- **Improvement buttons left the Info tab.** Info now reports and never acts. A settlement
  gets a fourth tab, **Land**, holding the improvement actions for its own tile.

### Added
- **Desertion.** Every month a faction's treasury is in the red, each unit in every garrison
  has a **10% chance** of walking away, with a notification naming the settlement and the
  count. Drawn from the seeded RNG over a fixed iteration order, so it stays reproducible
  from a save. Ships are exempt — the owner specified armies.
- **Improvement progress bars.** Tile improvements now show a filling meter, both in the Info
  tab of whatever tile is selected and on the tile itself. Previously they were text only,
  which is why they never appeared as bars.
- **Armies tab shows the garrison** — units and ships stationed here with their monthly
  upkeep, rather than a placeholder.
- Debt is coloured in the top bar: a negative treasury and a negative monthly rate both read
  red, and desertion notifications are marked as bad news.

---

## [0.6.0] — 2026-08-02

**Recruitment, shipyards, notifications.** Three production queues, and the game finally
tells you when something finishes.

### Added
- `data/units.json` — the nine-unit land roster with owner-authored costs, upkeep, per-soldier
  HP and damage, sizes and build times, plus the four ships. Combat modifiers are carried now
  even though nothing reads them until 0.7.0, so the battle model will not need a migration.
- **Recruitment.** Units train in their own queue, gated by settlement tier and standing
  buildings, and land in the settlement's garrison.
- **Shipyard.** Ships build in a third queue, unlocked by the naval line — Dock gives
  Transport and Light Ship, Port adds Heavy Ship, Shipyard adds Flagship.
- **Three queues run in parallel.** A city can raise walls, train spearmen and lay a keel in
  the same month; only the head of each queue advances.
- **Upkeep**, netted off monthly income so the top bar shows what a faction actually banks. A
  treasury cannot go negative — it runs dry, which is a visible failure rather than a hidden
  one. **[GEN]**
- **Progress bars** in the city Info tab for Building, Recruiting and Shipyard, with the head
  of each queue filling and the rest marked as waiting.
- **Notifications** in the middle of the bottom bar when a building, unit, ship, improvement
  or settlement upgrade completes. They live in simulation state, so they survive a save, and
  they expire on the tick counter rather than wall-clock — one in-game week, the same duration
  at 1× and at 10×. Clicking one selects and centres the map on where it happened.
- **Growth per month** in the city Info tab, as a percentage and a headcount, read from the
  same function the simulation uses rather than a second implementation that would drift.

### Changed
- **Every held land tile now yields 10 gold per month**, improved or not. Territory pays for
  itself from the month it is taken rather than only after twelve months of construction.
  Flat, and not scaled by terrain — this is the spoils of holding ground, not what it grows.
  **[GEN]**

### Fixed
- **Dialog backdrop.** At 72% opacity the top-bar icons read through an open menu and looked
  like they were floating on top of it. The backdrop is now 94% with a blur, and the four
  layers — map panel, bars, overlay, rotate gate — have explicit z-indexes declared in one
  place so a new floating element cannot land on the wrong side of a dialog.

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
