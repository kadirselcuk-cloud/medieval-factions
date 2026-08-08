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
- Rival realms played by the simulation, at **five difficulties** and with **five personalities**
- Save / load / continue with export/import
- Landscape UI: top bar (resources, menu), bottom bar (speed controls), map between

### Out of v1 (deferred, deliberately)
- Tactical battle map — **Phase B**, after the strategic layer is complete. Regiment-level
  units with move/attack/hold orders. Not individually simulated soldiers.
- Characters/generals, random events, diplomacy
- Victory conditions beyond total conquest

Sieges landed in 0.10.0 and fog of war in 0.13.0, both at the owner's request. They are listed
here as deferred no longer.

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
| 24 | Cities have **population**, starting at 1,000. Compounding superseded by 81 | 5 |
| 25 | Every 100 population yields 1 gold/month | 5 |
| 26 | Tile farms yield 10 gold/month, +10 per upgrade, upgrades gated by highest city level | 5 |
| 27 | Git initialisation deferred by the owner until after the first version | 5 |
| 28 | Farms, mines and sawmills are **tile improvements**; the realm's highest city level caps their upgrade | 6 |
| 29 | A city tile is also a tile — settlements carry improvements alongside city buildings | 6 |
| 30 | Buildings 12 months at level 1, +6 per level; settlement upgrades 24 / 36 / 48 months | 6 |
| 31 | Building and unit queues are independent — construction never blocks recruitment | 6 |
| 32 | Commerce line gives +10 gold per upgrade. Hall growth superseded by 65 | 6 |
| 33 | Wealth growth bonus is treasury-wide and diminishing. Percentages superseded by 81 | 6 |
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
| 46 | **Gold may go negative.** The wealth band is symmetric, so debt costs exactly what wealth gains, floored at 100 people per settlement | 9 |
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
| 65 | Housing and hall lines each give growth, accumulating. Percentages superseded by 81 | 11 |
| 66 | The auto-resolve battlefield is **50 tiles across**, so unit ranges (30, 40) are used exactly as written | 11 |
| 67 | At the 48-turn cap a battle is a **stalemate and both armies withdraw** | 11 |
| 68 | A battle is a **pure function** of the two stacks, the ground and the RNG, resolved in one call. The player watches a **replay of the log**; only the last 3 battles are kept | 12 |
| 69 | **Hostile ground is a destination, not a wall.** A march may be aimed at an enemy army or a defended settlement; a route never threads *through* one | 12 |
| 70 | A settlement fields its **defenders, its garrison and any army on the tile**. The garrison fights, and its survivors go back behind the walls if the city holds. **[GEN]** | 12 |
| 71 | **Survivors are reformed into whole units** — a formation below half strength is struck off, and a side that held the field keeps at least one unit. **[GEN]** | 12 |
| 72 | A **captured settlement keeps its people and buildings** and loses its queues, garrison and fleet. The **losing army is destroyed**; there is no retreat | 12 |
| 73 | A realm is **extinguished** when it holds neither settlement nor army, and its remaining ground reverts to no-one rather than to the conqueror | 12 |
| 74 | ~~The defender's advantage is **capped at 90%**, so the ground can never heal an attacker.~~ Still capped, but 0.13.0 halved every bonus under it, so the cap is a guard rail rather than a lever — see 90 | 12 |
| 75 | Ranged units have an **accuracy**: Skirmisher 30%, Archer 50%, Cavalry Archer 40%. A straight multiplier on the volley, not a roll per shot | 12 |
| 76 | **Siege.** An army at the gates invests a settlement. It pays nothing, finishes nothing and starves at 1%/month. Endurance by tier: Village 1, Town 3, City 6, Capitol 12 months | 12 |
| 77 | At the end of a siege the defenders **surrender** if outnumbered more than 3 to 1, and otherwise **sortie into an open-field battle** where nobody has the fortification bonus | 12 |
| 78 | A battle **for a settlement** draws in every army of either realm within a **5 × 5 box** | 12 |
| 79 | The defender's advantage belongs to the **defending formation, not the battle**: troops behind the walls keep the fortification, a relieving army from outside does not | 12 |
| 80 | A settlement is taken by **assault** (walls count, immediate) or by **siege** (walls do not count, but it takes months) | 12 |
| 81 | **Population growth is a flat number of people per month, never a percentage.** Base +2, +3 per tier, buildings +8 to +40 each, treasury ±5/±10/±15. Compounding was unbounded at any rate above zero; the exponential in this game comes from conquest. Supersedes 24, 33 and 65 | 13 |
| 82 | **Recruiting a unit consumes population** equal to its size, paid when the order is placed and never returned. Cancelling an unfinished order gives the people back. Ships draw nobody — crew size was never specified | 14 |
| 83 | **Five AI difficulties** — Recruit, Squire, Knight, Baron, King. One setting for every rival, chosen at the start and kept in the save. **Knight is the honest rung**: no income handicap either way, the player's own economy | 14 |
| 84 | **Five AI personalities** — Ambitious, Defensive, Balanced, Peaceful, Honorable. One per realm, fixed for the campaign, rolled from the seed unless the roster names one. They decide what a realm builds and whom it attacks, and will drive diplomacy when it lands | 14 |
| 85 | **Peaceful never starts a war with another realm** — it settles unclaimed ground and defends what it holds. **Honorable storms rather than starves**, never piles onto a realm already besieged by a third party, and will not attack one worth under 40% of itself | 14 |
| 86 | The AI plays **through the same functions the player's UI calls**. No back door: a rule that binds the player binds the rivals | 14 |
| 87 | The AI decides **once a month, per realm**, and picks **one objective for the whole realm** rather than one per army — no single army it may raise can take a defended city alone | 14 |
| 88 | AI **reach is measured from a realm's own borders**, not from where an army stands, so conquest extends the frontier and opens the next ring of targets | 14 |
| 89 | The AI's estimate of a defender's worth is **measured against the resolver**, not reasoned about: 1.25 attackers per defender on level ground, plus 2.5 per unit of defender's advantage | 14 |
| 90 | **Every defence bonus in the game is halved** — terrain, the city tile, fortification and winter. The scale moves together, so relative ground is unchanged; what changes is that a walled Capitol can now be **stormed** by a large enough army rather than only starved. Supersedes the figures in 74 | 15 |
| 91 | **The five personalities lean off a common centre** rather than being five games. All of them build, settle, expand and make war; Balanced is the centre and the others are a tilt. Supersedes 85 | 15 |
| 92 | **Peaceful is an economy lean, not a pacifist** — housing and commerce first and a smaller army, but it still recruits, expands and fights | 15 |
| 93 | **Honorable plays exactly as Balanced** for now. Honour is about who a realm will deal with, not how it fights, so it becomes a **diplomacy** trait; `dogpiles`, `attacksRealms` and `bullyFloorPermille` stay wired and permissive until then | 15 |
| 94 | A realm **fills in unclaimed ground around its own settlements before campaigning** — nearest to a settlement first, its army's own distance breaking the tie. It holds a country rather than a corridor | 15 |
| 95 | **Only one army consolidates at a time**, the weakest. Every conquest opens a fresh ring to fill, so a realm that consolidated with all of them never fought again — and it inverted the difficulty ladder | 15 |
| 96 | **Fog of war**: 3 tiles of sight from every owned tile and from every army, +1 per settlement tier above Village. **The AI has none and sees everything** | 15 |
| 97 | Fog is a **presentation filter** — derived, never stored, never read by the simulation. It hides ownership, armies and a settlement's allegiance, but not the geography | 15 |
| 98 | **A realm may keep a fifth of its people under arms** — 20%, counting soldiers among its people. Recruiting moves a man from a settlement's population to the men under arms and does not change the total, so **the ceiling never moves when a unit is raised**; it moves when people are born and when land changes hands. Gold no longer decides the size of an army | 16 |
| 99 | The ceiling **gates recruitment and nothing else**. A realm starved or carved down below its own standing army disbands nobody — it simply raises no more. Whether it should is [OPEN] | 16 |
| 100 | Units **still in training count as under arms**, because the men were levied when the order was placed. Otherwise a realm orders twenty units against one unit's worth of room | 16 |
| 101 | **Fog has three states, not two**: seen (clear), known (62% wash), and never known (opaque black). Known means ever seen, or within **10 tiles of one of the realm's settlements** — a king knows his neighbours' country and nothing of a coast a thousand miles away. Supersedes 96 | 16 |
| 102 | **Discovered ground is remembered, and never unlearned.** This is the one part of fog that is stored — history cannot be derived — so `SimState.discovered` is in the save and took it to v7. Current sight stays derived, and no rule in the simulation reads either. Amends 97 | 16 |
| 103 | **Sight is a diamond, measured in walking distance** — `\|dx\| + \|dy\|`, not a Chebyshev square. Armies move orthogonally, so taxicab distance is exactly how far a rider could get; sight and movement now use the same arithmetic. Covers less than half what the square did. Supersedes the range metric in 96 and 101 | 17 |
| 104 | **A defeated player keeps watching, with the fog lifted.** The campaign never paused on defeat; what stopped was vision, because a realm holding nothing sees nothing. There is no advantage left to protect once a realm is gone | 17 |
| 105 | **The AI measures reach as walking distance, not in straight lines.** One breadth-first sweep from a realm's settlements each month; anything with no land route is infinitely far. Straight lines made a city across a strait the nearest thing on the map, so realms pinned themselves on objectives no army could reach and never considered the ones they could. Amends 88 | 17 |
| 106 | **Two campaign speeds, and they are slow.** Everything on foot crosses a tile every **two months**; everything mounted crosses one **a month**. An eightfold cut, owner-specified, which makes a campaign a matter of decades and cavalry strictly twice everything else. Supersedes the strategic speeds in CONTENT.md §3 | 18 |
| 107 | **A rival realm's armies have roles** — field, raid, guard, claim. Difficulty says how many specialists it may run, personality says which it wants and how big. Half the army slots always stay with the field force, or a realm acquires hobbies instead of a war | 18 |
| 108 | **A raiding column rides for the deepest thing it can reach**, not the nearest, and takes the fastest units in the garrison. A border guard holds the frontier settlement closest to an enemy and leaves it only to break a siege | 18 |
| 109 | **No realm has a reach limit. All of them mean to take the whole map.** `reach` produced realms that stopped — most had zero targets in range after sixty years and simply idled. Distance still picks *which* target; it no longer rules any out. Supersedes 88 | 19 |
| 110 | **Personality is a pair of odds, not a distance** — the chance each army raised becomes a raiding column or a border garrison, the rest going to the field. Ambitious 40/10, Defensive 5/50, Peaceful 0/35. What separates realms is what they do with their armies, not how far they will look | 19 |
| 111 | **Whose ground it is changes how fast an army crosses it** — unclaimed +20%, a rival's +40%, owner-authored. Claimed ground is fast ground, so an advance that consolidates behind itself accelerates and a deep corridor does not | 19 |
| 112 | **The Golden Horde is Ambitious**, authored in `data/factions.json` rather than rolled from the seed — the first faction given a personality by hand | 19 |
| 113 | **Winter kills armies that stay in enemy country** — 10% chance per unit per winter month, lost whole rather than as casualties. Unclaimed ground does not do it; only a rival's territory. A besieger suffers it too, which makes starving out a Capitol something only a large army survives | 20 |
| 114 | **No limit on how many armies a realm fields.** `maxArmies` removed. A realm raises what it can pay for and spare the people for; the treasury, the manpower ceiling and the levy floors are the only limits. Role quotas scale per four settlements rather than being absolute | 20 |
| 115 | **The panel reads out anything the player can see** — a rival's army composition and standing orders, a rival settlement's defenders and garrison. Fog decides what is visible; it does not decide what is legible | 20 |
| 116 | **A realm collects half the gold its land produces.** Every gold figure in the data is gross; one multiplier (`GOLD_INCOME_PERMILLE`) applies the tax, before wages and before the difficulty handicap. Wood, iron and stone are untouched. One constant rather than thirty halved data values, because it will be retuned | 21 |
| 117 | **The claim radius binds a field army, not the realm.** A dedicated claiming stack has no limit, and neither does a field army with no objective — the radius exists only to stop one being distracted from a war it actually has. Applying it to all three left a fifth of the map permanently bare, since ground more than three tiles from any settlement was ground nobody ever had a reason to walk to. Amends 21 | 21 |
| 118 | **A claiming stack is one unit, and is handed back to the field force if it grows.** Mustering and merging both silently fed them, so realms ran seventeen-unit "claimers" that were out of the war and still claimed one tile at a time | 21 |
| 119 | **Unclaimed ground on an island no realm holds is meant to stay unclaimed.** There is no route to it at any distance until ships can carry an army, so the AI is right to ignore it and a test that demanded the whole map would be demanding a bug | 21 |
| 120 | **The panel reads out what a rival has built** — every building in a settlement, in the order it was built, and what a tile is worked as. The tile yield already quietly included the improvement, so the panel could price a rival's field without ever naming it. Extends 115 | 21 |
| 121 | **A ship's crew is its `size`, and its HP and damage are per crewman** — the exact shape of a land unit. Naval combat therefore needed no second resolver: fleets muster into the shipped auto-resolve as formations, and manpower, upkeep and the balance panel read them through the helpers they already read armies through. The alternative — a ship as one vessel with total HP — would have bought intuition at the cost of a parallel combat path and made fleets and armies incomparable | 22 |
| 122 | **A fleet is an army that floats.** Same entity, different medium: owner, tile, a bag of ships, a route, banked movement points. `city.fleet` is to `launch()` what `city.garrison` is to `mobilise()`. One fleet per sea tile, twenty ships maximum. Open sea has no terrain cost and no owner, so a sea tile costs exactly one tile's worth; winter is the only modifier that survives | 22 |
| 123 | **One Transport carries two land units**, whatever their size, and only Transports carry. A six-unit invasion needs three hulls before an escort is paid for. Counting units rather than men keeps the panel readable and keeps horses out of an argument about tonnage | 22 |
| 124 | **Board at a Dock, land on any coast.** Embarking needs a harbour the realm owns; disembarking needs only a land tile beside the fleet that no hostile army or settlement holds — not owned, nothing built on it. An amphibious landing is what you do on a beach the enemy does not hold, and a landed army claims the tile by presence like any march | 22 |
| 125 | **A warship intercepts within one tile.** Two hostile fleets ending a tick orthogonally adjacent fight, without either moving onto the other, so a blockade closes a strait instead of watching transports slide past. Only a fleet carrying a warship can force it — two transport convoys pass untouched, having nothing to fight with | 22 |
| 126 | **Cargo is lost with the ship.** Capacity is recomputed from the surviving Transports and cargo above it drowns — in battle and in desertion alike. The harshest rule in the game, on purpose: it makes escorting mandatory, and it means an overseas invasion can be lost in an afternoon after a decade of paying for it | 22 |
| 127 | **Crews count against the manpower ceiling, and fleets desert in debt** at the same 10% armies suffer. Moored, at sea, and still building all count — the men were taken when the order went out, as with units in training. A realm cannot build a navy and an army out of the same fifth of its people. Winter attrition still does not touch fleets: it is a rule about hostile ground, and the sea belongs to nobody. Supersedes the ships-draw-nobody clause of 82 | 22 |
| 128 | **All four ship types are renamed per faction**, not only Light and Heavy, and **a name may be shared by several factions** — a Galleon can serve the Spanish, the French and the British. The data layer carries four name slots; the names themselves are authored in 0.19.0 with the land units | 22 |
| 129 | **An army can be split, but only at a quayside.** A Transport carries **five** units and four of them lift a whole twenty-unit army; where the berths fall short, the part that fits sails and the rest stays ashore as the army it was, keeping its id and its orders. The heaviest formations board first — if only half an army crosses it should be the half that can fight. Amends 123, and answers the general army-splitting question only for this one case | 23 |
| 130 | **What a realm recruits is a roll of three, in equal parts** — the strongest unit it can build (the old argmax, bent by personality), a **missile** unit (Archer or Cavalry Archer), or a **ground** unit. Rerolled until it lands on something the settlement can produce. The pure argmax gave the game one unit: every realm of every personality bought heavy cavalry, and spear infantry was never built by anybody in a century. Supersedes the unit choice in 89 | 23 |
| 131 | **Every hull sails three tiles a month**, so an escort never slows a convoy. Supersedes the per-hull speeds in 121 | 23 |
| 132 | **The navy decides before the army does.** A crew and a spearman come from the same fifth of a realm's people, so a realm that levies first can never lay down a hull. Ships get first claim on manpower — and an army summoned to a quay keeps its orders, because the land AI only re-routes idle stacks | 23 |
| 133 | **A realm sails for ground nobody holds before it sails for a coast somebody does.** A landmass no realm has settled outranks distance outright. Choosing by distance alone sent every fleet at the nearest foreign coastline — somebody else's land war, reached by boat — and left Ireland chosen six times in 120 years against Novgorod's 173 | 23 |
| 134 | **A fleet waits for a landing force worth landing** — six units, or a full hold. An army put ashore alone on a hostile island cannot retreat and cannot be reinforced inside a season | 23 |
