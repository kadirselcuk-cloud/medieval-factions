# Medieval Factions — Design Record

The vision and locked decisions. Detail lives in the sibling documents:

- [MECHANICS.md](MECHANICS.md) — time, territory, terrain, economy, combat, saves
- [CONTENT.md](CONTENT.md) — factions, settlements, buildings, units
- [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md) — unresolved; **never guess, ask**

Anything not written down in these files is **not decided**.

---

## 1. Concept

A single-player grand-strategy game blending **Total War** (campaign map, army movement,
faction warfare) with **Age of Empires** (settlement economy, buildings, unit production).
Europe and the Mediterranean, starting in **1350**.

- **Platform:** browser first, fully offline. Later wrapped as a WebView app for Android/iOS.
- **Players:** one, versus 12 AI factions. Everyone is hostile to everyone.
- **Session:** long-form campaigns across many sittings. Save/continue is mandatory.
- **Business:** hobby now; possibly commercial later via ads, an ad-removal purchase, and
  premium unlock of all playable factions.

## 2. The defining idea — continuous time

Time never stops for input. There is **no End Turn**; a "turn" is just a month.
One tick = one day-phase = one real second at 1x; 120 ticks make a month. Armies march,
buildings rise, troops train, gold accrues and the AI schemes on the same clock the player
watches. The player controls only the *rate*: pause, 1x, 2x, 5x, 10x.

This is the single most important architectural constraint. See [MECHANICS.md](MECHANICS.md) §1.

## 3. Scope of version 1

### In
- 70 × 35 tile Europe map, zoomable and draggable — [data/maps/europe-1350.json](../data/maps/europe-1350.json)
- 13 factions across 3 religions; 3 playable (Franks, Turks, Russians)
- Settlement tiers Village → Town → City → Capitol, with buildings
- Recruitment of a 10-unit roster, renamed per faction
- Economy: gold, wood, iron, stone; resource nodes; seasonal effects
- Army movement, one army per tile, up to 20 units
- Battles: **auto-resolve, simulated turn by turn and watchable**
- Save / load / continue with export/import
- Landscape UI: top bar (resources, menu), bottom bar (speed controls), map between

### Out of v1 (deferred, deliberately)
- Tactical battle map — **Phase B**, after the strategic layer is complete. Regiment-level
  units with move/attack/hold orders. Not individually simulated soldiers.
- Sieges, characters/generals, fog of war, random events, diplomacy
- Victory conditions beyond total conquest

## 4. Standing constraints

- **Deterministic simulation.** Seeded RNG, integer tick counter. Speed setting and frame
  rate must never change outcomes.
- **Data-driven.** Maps, factions, units, buildings, terrain are data files. More maps —
  including procedurally generated ones — are planned, so no hardcoded geography or rules.
- **Faction access is a data flag** from day one, for later monetization.
- **Placeholder art now**, owner-supplied 2D assets later, swapped through a manifest.
- **Landscape-locked**, responsive from phone to desktop full-screen.

## 5. Decision log

| # | Decision | Round |
|---|---|---|
| 1 | Fully offline, no backend | 1 |
| 2 | Auto-resolve battles in v1; regiment-level tactical battles in Phase B | 2 |
| 3 | Continuous time — 1 tick = 1 day-phase = 1s at 1x; 120 ticks/month | 2 |
| 4 | "End Turn" removed; a turn is just a month label | 2 |
| 5 | 70 × 35 square-tile Europe map, owner-authored | 2 |
| 6 | No sieges / generals / fog of war / events / diplomacy in v1 | 2 |
| 7 | Landscape-locked, top + bottom UI bars | 2 |
| 8 | Pause exists; sim pauses when the player is not in the game — no offline progress | 3 |
| 9 | One army per tile, max 20 units, moves at its slowest unit's speed | 3 |
| 10 | Auto-resolve is simulated in battle turns of 1 hour, 6 per tick, and is watchable | 3 |
| 11 | Player battles auto-pause the campaign and prompt — the seam for Phase B | 3 |
| 12 | Start January 1350; victory = total conquest | 3 |
| 13 | 13 factions, 3 religions, 3 playable (Franks, Turks, Russians) | 3 |
| 14 | Factions start with one city + the 4 surrounding tiles | 3 |
| 15 | Seasons affect movement and farm income | 3 |
| 16 | Saves: IndexedDB, named slots, month-rollover autosave, JSON export/import | 3 |
| 17 | The other **47** cities belong to a neutral, defended **Independents** faction | 4 |
| 18 | No food resource — **farms produce gold**, 10/month at Basic tier | 4 |
| 19 | Four ship types: Transport, Light, Heavy, Flagship — gated by Dock/Port/Shipyard | 4 |
| 20 | Every faction starts at **Village** tier with **250 gold**; Castille = Toledo, Hungary = Buda | 4 |
| 21 | Territory is claimed by **army presence**; starting tiles are the 4 orthogonal neighbours | 4 |
| 22 | Auto-resolve: alternating speed-ordered activations, one action each, 3× rout rule after turn 10, 48-turn cap. Field width superseded by 66 | 4 |
| 23 | Winter adds +10% defender's advantage on top of movement and harvest penalties | 4 |
| 24 | Cities have **population**, starting at 1,000, compounding monthly from wealth, city level and housing | 5 |
| 25 | Every 100 population yields 1 gold/month | 5 |
| 26 | Tile farms yield 10 gold/month, +10 per upgrade, upgrades gated by highest city level | 5 |
| 27 | Git initialisation deferred by the owner until after the first version | 5 |
| 28 | Farms, mines and sawmills are **tile improvements**; the realm's highest city level caps their upgrade | 6 |
| 29 | A city tile is also a tile — settlements carry improvements alongside city buildings | 6 |
| 30 | Buildings 12 months at level 1, +6 per level; settlement upgrades 24 / 36 / 48 months | 6 |
| 31 | Building and unit queues are independent — construction never blocks recruitment | 6 |
| 32 | Commerce line gives +10 gold per upgrade. Hall growth superseded by 65 | 6 |
| 33 | Wealth growth bonus is treasury-wide and diminishing: +1% at 10k, +2% at 100k, +3% at 1M | 6 |
| 34 | Autosaves: 5 monthly plus 3 yearly | 6 |
| 35 | Map revision: Toulouse and Genoa removed; Burgundy, Sardinia, Crete and Cyprus added; Leon, Barcelona and Mecca moved. 60 cities | 6 |
| 36 | A tile carries exactly **one** improvement — farm, mine, or sawmill | 7 |
| 37 | Improvements are built at level 1 and upgraded 3 more times, to **level 4**; the realm's highest settlement tier caps the level | 7 |
| 38 | Resource nodes pay a token yield unmined; a mine multiplies it up to tenfold | 7 |
| 39 | Terrain modifiers scale farms, mines **and** sawmills | 7 |
| 40 | Modifier scale corrected — `-` is **−40%**, not −50%. `++` +100%, `+` +50%, `--` −80% | 7 |
| 41 | Sawmills yield 1 wood per level, not 10 — wood is the scarcest resource | 8 |
| 42 | **Fishery** heads the naval line at Village tier: +10 gold/month per adjacent water tile, +10 per upgrade, offsetting the coastal-city penalty | 8 |
| 43 | "Adjacent" means all **8** surrounding tiles, and decides both fishery income and whether a settlement is coastal | 8 |
| 44 | City panel has three tabs — Info, Buildings, Armies | 8 |
| 45 | Top bar carries Cities / Armies / Navies rosters that select and centre the map | 8 |
| 46 | **Gold may go negative.** The wealth growth band is symmetric, so debt shrinks population exactly as wealth grows it, floored at 100 people per settlement | 9 |
| 47 | While a treasury is in debt, every land unit has a **10% chance per month of deserting**. Ships are exempt | 9 |
| 48 | Ships cost wood as well as gold — 50 / 100 / 200 / 500 | 9 |
| 49 | Base tile yield is **per terrain**, not flat: plains 10g +1w, forest 5g +1w, steppe 5g, tundra 2g +1w, desert 2g, mountain 1 iron +1 stone. Not scaled by the terrain modifiers — it already is the terrain's contribution | 9 |
| 50 | **Borders do not stop a march.** Only a hostile army, a hostile settlement or water does | 10 |
| 51 | A settlement's **defenders are derived** from its tier and buildings, cost nothing, and can never be mobilised. Every settlement on the map is defended | 10 |
| 52 | Defender composition: Village 1 light inf; Town +1 sword; City +1 archer; Capitol 1 each of light/spear/sword/archer/light cav. Barracks, Archery Range, Stables and Town Hall each add one | 10 |
| 53 | A **garrison** is what the faction recruited, and is the only thing an army musters from. Standing down returns units to it intact; disbanding in the field loses them | 10 |
| 54 | Armies move **orthogonally**, and two friendly armies meeting on a tile merge | 10 |
| 55 | A march order **appends** to the route already given; **Halt** clears the whole route | 10 |
| 56 | Every marching army of the player's shows its route, selected or not, with crawling dashes | 10 |
| 57 | Recruitment lives in the **Armies** tab, beside the garrison it feeds, not in Buildings | 10 |
| 58 | Progress meters creep with the month rather than stepping at the month boundary | 10 |
| 59 | Expanding a settlement is **built like a building**, first card in the City Buildings grid | 11 |
| 60 | Settlement tiers are gated on **population**: Town 2,000, City 5,000, Capitol 10,000 | 11 |
| 61 | A realm may hold **only one Capitol** | 11 |
| 62 | Everything buildable is a **square tile, two per row**, opening a detail window that carries the description, the numbers and the order button | 11 |
| 63 | All icons and flavour text live in `data/art.json`; **no asset path is ever hardcoded** | 11 |
| 64 | Tabs are Info / Buildings / Armies / Navy. The Land tab is gone — improvements are **Fief Buildings** inside Buildings, beside **City Buildings** | 11 |
| 65 | Housing and hall lines give **diminishing growth**: +1.0%, then +0.5%, then +0.2% (then +0.1% for the fourth housing step, **[GEN]**). Replaces the old flat +0.1% per level | 11 |
| 66 | The auto-resolve battlefield is **50 tiles across**, so unit ranges (30, 40) are used exactly as written | 11 |
| 67 | At the 48-turn cap a battle is a **stalemate and both armies withdraw** | 11 |
| 68 | A battle is a **pure function** of the two stacks, the ground and the RNG, resolved in one call. The player watches a **replay of the log**; only the last 3 battles are kept | 12 |
| 69 | **Hostile ground is a destination, not a wall.** A march may be aimed at an enemy army or a defended settlement; a route never threads *through* one | 12 |
| 70 | A settlement fields its **defenders, its garrison and any army on the tile**. The garrison fights, and its survivors go back behind the walls if the city holds. **[GEN]** | 12 |
| 71 | **Survivors are reformed into whole units** — a formation below half strength is struck off, and a side that held the field keeps at least one unit. **[GEN]** | 12 |
| 72 | A **captured settlement keeps its people and buildings** and loses its queues, garrison and fleet. The **losing army is destroyed**; there is no retreat | 12 |
| 73 | A realm is **extinguished** when it holds neither settlement nor army, and its remaining ground reverts to no-one rather than to the conqueror | 12 |
| 74 | The defender's advantage is **capped at 90%**, so the ground can never heal an attacker. **[GEN]** | 12 |
