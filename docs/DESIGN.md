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
| 135 | **Armies concentrate.** Founding a new field army costs **half a full stack**, not two units, and a field army below half strength marches to the nearest larger one and merges. Only the smaller moves and ties break on the higher id, so a pair can never walk through each other for ever. The bar is **per role** — a claimer is meant to be one unit and a raiding column three, and holding them to a field army's bar left a twelfth of the map permanently unclaimed. Measured: 158 armies averaging 3.9 units became ~55 averaging 9–12 | 24 |
| 136 | **A realm's war scales with the realm** — one front per six settlements, to a maximum of four, each 8 tiles apart, and every army goes to the front nearest it. One objective for the whole realm is right for a small realm and absurd for an empire: the Turks held 22 cities and pointed 74 armies at a single city. Under six settlements a realm gets exactly one front, which is exactly the old rule. Amends 87 | 24 |
| 137 | **Naval ambition scales too, and a realm with no land war left goes to sea in earnest.** Hulls and escorts wanted were flat figures for a village and an empire alike; the map ran 8 fleets in total. Ships are now built at **every port, every month** rather than at one base once a year, and **escorts before transports** — a harbour launches when it holds a landing force, so whatever is built last is left behind | 24 |
| 138 | **Ships move in eight directions; armies still move in four.** Not a change of heart about diagonals but geography: this map's water is basins joined at single tiles and several joins are diagonal, so with four-way movement the **Black Sea cannot reach the Mediterranean at all**. A diagonal costs **√2** of a tile, so "three tiles a month" stays honest. Applies to every naval adjacency — launching, tying up, landing, intercepting | 25 |
| 139 | **A harbour launches into the nearest of its eight water tiles**, straight neighbour before corner. Amends 122 | 25 |
| 140 | **A realm attacks what is cheap, not merely what is near.** A settlement's defenders count as extra distance — 100 soldiers to the tile — so a realm reaches past the walled City on its doorstep for the weak village behind it. A soft weight, not a filter: `judge` still refuses fights it cannot win, and this only orders the ones it can. Amends 87 | 25 |
| 141 | **A long march counts as being across the water.** Shipping is preferred when the walk is more than **three times** the sail and at least twelve tiles — foot makes half a tile a month against a fleet's three, so the far end of the Mediterranean is six years' marching and under one year's sailing. Supersedes the "no land route at all" test in 122 | 25 |
| 142 | **A fleet is never idle.** With no route and nothing aboard it hunts an enemy fleet within 15 tiles if it has a warship, otherwise sails to whichever friendly harbour has an army waiting, otherwise goes home. A hull at anchor is upkeep and crew for nothing | 25 |
| 143 | **A fleet may not unload within 6 tiles of its own ground.** Replaces "not onto a landmass we hold", which was right while the only reason to sail was to reach another landmass and wrong the moment a realm began shipping armies around its own coast | 25 |
| 144 | **There is never a stalemate.** Every branch of an army's orders now has something after it, and an order that cannot be carried out falls through instead of leaving the army standing: objective → raid → rally → take ground → wait for a boat → regroup. Measured before: 52 of 52 armies idle from 1500 onward, the map frozen for two centuries | 26 |
| 145 | **A realm with nothing it can beat attacks the softest thing it can reach anyway.** `judge` is right for choosing between wars and wrong as the last word. It will often lose, and losing costs the strong realm men and garrisons — which is what a weaker power is for | 26 |
| 146 | **A rival's open fields are claimable ground once free ground runs out.** Taking them was "an act of war belonging to the objective"; that becomes paralysis when the map is 100% claimed. It is also income — a tile pays monthly whether or not a city stands on it. Amends 21 | 26 |
| 147 | **An army with nothing to do on its own continent marches to a harbour and waits to be shipped**, spread across the realm's ports. And **transports board raiders as well as field armies** — a raider that cannot reach anything to raid is equally stuck, and a fast stack landed on an undefended coast is the guerilla move a weaker realm wants | 26 |
| 148 | **Loaded fleets are dealt across up to four beaches** rather than all sailing for the best one. Harder to defend against, and more likely to find a coast nobody is watching. The first convoy still takes the chosen target | 26 |
| 149 | **A landing can be forced.** Where no beach is free, the men aboard fight the army holding the shore **as if they had marched there** — the defender gets the full ground advantage of its tile, with no allowance for the water behind the attacker. Winning puts the survivors ashore and takes the tile. **Troops only**: a settlement is still never a landing site, so 124 survives intact | 27 |
| 150 | **A realm with only overseas enemies builds a third fewer soldiers** and spends the people on crews. A crew and a spearman come from the same fifth of a realm (127), and an extra spearman is worth nothing when every enemy is across water. A third off rather than a halt — garrisons still matter and the boats need stacks to carry | 27 |
| 151 | **Naval ambition scales to the realm, properly.** Hulls to 60 and berths to five whole armies; both were flat ceilings that a large realm hit and then stopped building. A realm with berths for one army has one invasion in it however rich it is. Supersedes the figures in 137 | 27 |
| 152 | **Boarding a ship outranks claiming a field.** Both are what an army does with no war to fight, and they are not equal: a field is worth a few gold a month, a berth is worth a continent. Ordering these the other way round (146 before 147) meant the second was never reached | 27 |
| 153 | **Fleets in contact fight once a month.** Interception used to require that one of the pair had moved that tick, which made a standoff permanent — twelve flagships sat adjacent in open water for ever. The month is the throttle instead; a blockade still catches anything that sails into it on arrival. Amends 125 | 28 |
| 154 | **A border guard whose realm has no land war is released to the field.** A guard assumes there is a border; a realm that has taken its whole landmass has none, and its guards stand watching an empty horizon while transports wait beside them. The settlement keeps its derived defenders, which were always the real garrison | 28 |
| 155 | **Hulls are laid down where the armies are**, not in city-index order. A realm near its ceiling only ever queues at the first few harbours it walks, so an empire built its whole navy at Cyprus while its troops stood in northern Europe | 28 |
| 156 | **Four Transports to a fleet.** Four carry five units each, so a hold is exactly `MAX_ARMY_UNITS` — one convoy lifts one army and never more, and the convoy and the thing it carries are the same size. Warships fill the other sixteen berths and are not capped. A realm moving five armies builds five convoys, which is five things a rival navy must find | 29 |
| 157 | **A realm holding no settlement for two years dissolves**, armies and fleets struck off with it. A realm reduced to one wandering stack used to stay on the books for ever, holding and building nothing. The counter resets the moment it takes a city, so a comeback is a comeback. Save format v10 | 29 |
| 158 | **An army boards and lands wherever the ship can reach the shore.** No harbour, no settlement, no ownership of the ground — only that the fleet is on one of the eight tiles touching it. Docks are still what a settlement needs to *build* a ship. Supersedes the boarding half of 124. **The AI keeps loading at ports**: widening its own behaviour to match measurably cut overseas conquest by four fifths | 30 |
| 159 | **Every faction has two colours** — a fill for its ground and a darker line for its border. A wash at a third opacity flattens every warm hue into the same beige, and three realms were indistinguishable on the map | 30 |
| 160 | **A pure warship fleet with nothing to chase blockades**, taking station off a rival-s coastal settlement, which is where its convoys must appear. A fleet with berths stays home — sending convoys to blockade strands the armies marching to meet them | 30 |
| 161 | **A beachhead on a realm-s own coast is not a land war.** One enemy stack ashore used to make every one of that enemy-s home cities read as walkable, so a realm that had conquered its continent believed it still had land targets and stopped sailing entirely. A settlement counts as a land target only on a landmass this realm actually settles | 30 |
| 162 | **A realm builds shipping for the armies it has spare, not for the cities it owns.** Naval appetite keyed to settlements held could not be raised at all — every flat increase measurably destroyed overseas conquest, because escorts are laid down before transports and a crew and a spearman come out of the same fifth of a realm (127). Demand now comes from `spareLift`: the units in stacks with no war to march to **on their own landmass**, counted in whole armies' worth. The old city figure stays underneath as a **floor**, so a realm still fighting on land gets precisely the navy it had, and only a realm with men standing idle is given more. Supersedes the berth figure in 151 | 31 |
| 163 | **A realm collects a quarter of the gold its land produces**, not half. `GOLD_INCOME_PERMILLE` 500 → 250, owner-specified: "reduce all income by half from all sources", confirmed as the gold line alone — wood, iron and stone stay untaxed. It bites twice now rather than once, because growth reads net income (164): a smaller purse is both less gold and fewer people, and a fixed wage bill is a larger share of it. Supersedes the rate in 116 | 31 |
| 164 | **Population grows from net monthly income, not from the treasury.** Owner-specified. The old rule read the pile a realm was sitting on, which rewarded hoarding — a realm that banked its taxes and built nothing grew as fast as one running a real economy, and one that spent its fortune on an army it needed was punished for it. The bands are **marginal, like tax brackets**: 1% of the first 1,000, 0.5% to 10,000, 0.1% to 100,000, 0.01% above — 10, 55, 145 and 235 people a month per settlement. Read as flat-rate-per-band the schedule runs *backwards* at every boundary, so marginal is the only monotonic reading. Symmetric into the negative, which is what makes 165 self-limiting. Supersedes the treasury term in 82 | 31 |
| 165 | **There is no ceiling on an army or a navy. The treasury decides.** Owner-specified: "I don't want any navy or army limits, I want the limits to be decided by current condition of treasury." `MANPOWER_SHARE_PERMILLE` and the fifth-of-your-people rule are gone. Three costs replace them and together they bind harder: a unit still costs its whole `size` in people, permanently, from the settlement that raises it; wages come off the net income that every settlement grows from (164), so an army too large slows the whole realm and an army far too large shrinks it; and unpaid troops still desert. A cost that rises smoothly rather than a wall that is hit. Measured: realms settle at **1.3% of their people under arms by 1600**, against the 20% the ceiling used to pin them to — the treasury is the tighter master. Supersedes 127's ceiling clause and the whole of the 0.14.0 rule | 31 |
| 166 | **A transport does not sail into a warship's reach.** Owner-specified. A warship intercepts anything ending a tick within one tile of it (125) and cargo drowns with the hull (126), so the eight tiles around an enemy warship are not a risk to a loaded convoy but a certainty. A convoy routes **around** them wherever a way round exists; where none does, a convoy **with warships of its own** may force the passage and an unescorted one waits in port. Waiting costs upkeep; sailing costs the army. An enemy *convoy* menaces nothing, since two holds pass each other untouched | 31 |
| 167 | **Convoys sail in strength, and the escort is built in step with the hold.** Owner-specified: three warships per convoy rather than one, riding in the convoy's own sixteen spare berths where they fit and sailing as a covering fleet where they do not. Raising this target is what destroyed overseas conquest in 0.18.9 — escorts are laid down before transports, so a large target meant decades of warships before the first hull that could carry anything. The fix is not the target but the **order**: `buildFleet` measures the escort against the Transports *already afloat*, so the two come off the slipways together at three to four, and the full escort plan is only finished once the hold is. Supersedes the one-per-convoy floor in 126 | 31 |
| 168 | **A war fleet hunts without a range limit.** Owner-specified: *"a war fleet should always look to find and destroy enemy ships."* The cap was fifteen tiles, then thirty, to keep a navy patrolling its own sea rather than crossing the map after one transport. The owner's answer is the better one — a warship off its own coast is not defending it, because nothing is coming; what threatens a realm's shipping is the enemy's navy, wherever it is. A laden enemy convoy outranks an empty warship as a quarry, and several candidates are tried in turn, because with no cap the nearest enemy by straight line is often in a sea this fleet cannot reach | 31 |
| 169 | **Naval dominance scales with the realm.** Landings go from a flat four beaches to **three for a small realm and seven for an empire**, and a realm will build shipping for **twelve** armies at once rather than eight. Owner-specified: a large faction should be able to make more landings and hold the sea harder than it could. Size alone still buys only five convoys — the rest is demand from idle armies (162), so a realm still fighting on land is untouched. Amends 148 and 162 | 31 |
| 170 | **An escort goes and finds the convoy it is meant to escort.** Owner-reported: convoys of four Transports and nothing else. Every rule that put warships into a convoy worked at the quayside and only there — `oneConvoy` gathers what is moored, `launch` reinforces the fleet alongside — so a warship finished after its convoy had sailed launched alone, went hunting, and the hold crossed bare. A warship fleet with no cargo now seeks the **worst-escorted** friendly convoy, sails to it avoiding menaced water, and merges. Ranked **above hunting**: a warship that leaves an unescorted hold to chase something is doing the enemy's work, since cargo drowns with the ship (126). A harbour also holds a hold back while **its own slipway** has a warship on it — but only its own, because escorts and Transports are routinely laid down in different ports and waiting on a distant one stranded both | 31 |
| 171 | **Merging takes what fits instead of refusing.** Owner-specified. A merge that would breach the twenty-hull or four-Transport cap was refused outright, so a squadron of eight meeting a convoy with room for six gave it none. Partial merging breaks neither cap — what does not fit stays where it was — and fails only when nothing whatever can move. **Warships cross first**, since the case that matters is an escort joining a hold and filling the hold first would take the room the escort needed. **Cargo travels with its hold or not at all**: where a laden fleet's Transports cannot all move, none of them do, because half a hold arriving is half a hold drowning. Amends 122 and 156 | 31 |
| 172 | **Every realm has its own names for its troops and its ships, and each name is a trade.** Owner-specified. Names are period-appropriate to 1300–1500 and **may repeat across factions** — a Carrack served half of Europe — but where a realm had something of its own it is used: the Longbowman, the Gendarme, the Landsknecht, the Huszár, the Genoese crossbowman, the Akıncı, the Mangudai, the Zenete. A renaming carries a matching advantage and disadvantage in `hp` and `damage`, so a Longbowman hits harder and dies faster than the Archer it is. **Only combat and marching stats may vary**: cost, `size`, upkeep and build time are identical in every realm, so identity never becomes an economy. Stored as deltas on the base table, so retuning a unit carries through to all fourteen rosters | 31 |
| 173 | **`unitFor(factionId, unitId)` is the single seam.** Everything that decides a fight reads a `Unit`, so routing `muster`, `armySpeed` and the AI's unit scoring through one resolver is all it took to give thirteen realms their own troops — no second combat path, no per-faction unit table, no `factionIndex` threaded through forty call sites. A faction with no roster gets the base unit, which is what the Independents get and what any pre-0.20.0 save gets | 31 |
| 174 | **Every realm has exactly two small bonuses, one economic and one military.** Owner-specified as small enough not to decide a game: four to six per cent of one resource, or one extra person a month per settlement; and two to six per cent on hit points, damage or march speed. The economic one lands on gross income beside the difficulty handicap, or in the growth sum where it is people; the military one folds into `unitFor` so it reaches every unit the realm fields. Recorded in `data/rosters.json` with the line of text to display, so a faction-selection screen has somewhere to read them from | 31 |
| 175 | **A shared plain name is the default; a distinctive one is the exception.** Amends 172, on the owner's correction that 0.20.0's roster was "very specific to that nation" and that names should be "understandable by everyone". Nine realms field a Man-at-Arms and thirteen a Cog; a name of its own is kept only where a general audience knows the unit — Longbowman, Janissary, Sipahi, Gendarme, Coustillier, Landsknecht, Hussar, Cossack, Mamluk, Cataphract, Varangian Guard, Genoese Crossbowman, Jinete, Mangudai. **Only a distinctive name carries a stat trade**: calling your swordsmen Man-at-Arms has not changed the unit, so it fields the base figures. 127 of 169 entries are plain and unchanged; 42 carry a trade. Diacritics are gone with the rest — a name nobody can type is not one a player recognises | 31 |
| 176 | **Every realm fields exactly one unique unit**, always a land unit, always the largest trade in its roster — the Longbowman, the Janissary, the Gendarme, the Almogavar, the Doppelsoldner, the Genoese Crossbowman, the Hussar, the Varangian Guard, the Mountain Spearman, the Bardiche Axeman, the Mangudai, the Mamluk Horseman, the Berber Lancer. Owner-specified: the signature a player picks the faction to field. Names are English or the English form. Amends 175, which had swung too far the other way — "too many levy footmen and spearmen" — so variety is restored without any slot needing thirteen different words for one job, and every realm fields at least three units of its own | 31 |
| 177 | **The skirmisher line throws things.** Range 30 at accuracy 0.3 is a javelin, a sling or a dart, so the slot may only ever be named for a thrown weapon. The Handgunner and Naphtha Thrower of 0.20.1 were the wrong weapon for the role and are gone | 31 |
