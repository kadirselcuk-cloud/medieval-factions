# Changelog

All notable changes to Medieval Factions are recorded here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning is [Semantic Versioning](https://semver.org/) — `MAJOR.MINOR.PATCH`:

- **MAJOR** — save-format break or fundamental redesign.
- **MINOR** — a new gameplay system or feature.
- **PATCH** — bug fix, balance tweak, refactor, or documentation.

Pre-`1.0.0` the game is not feature-complete. `1.0.0` marks the first public release.

---

## [0.18.4] — 2026-08-09

**There is never a stalemate.** The owner reported armies freezing after 100–150 years, or the
moment one realm took mainland Europe: the ships kept moving and the armies stopped. They were
right, and it was total.

Measured on the same seed, before and after:

| Year | Before | After |
|---|---|---|
| 1500 | 49 of 52 armies idle, 1,213 battles | **9 of 47 idle, 1,529 battles** |
| 1550 | **52 of 52 idle**, 1,336 battles | **14 of 60 idle**, 1,393 battles |
| 1600 | **52 of 52 idle**, 1,363 battles | **23 of 54 idle**, 1,172 battles |

The map used to freeze at [46,7,5,2,0] and stay there for two centuries. It now keeps changing
hands, and a second seed runs its heaviest fighting of the whole campaign in the 1550–1600 window.

### Fixed

Four dead ends fed the freeze. Each was a branch that could fail with **nothing after it**, and
each was locally sensible:

- **Claimers ran out of ground.** `pickClaim` took unclaimed tiles only, and since 0.18.3 the map
  finishes 90–100% claimed — so the job whose entire purpose is taking ground had none to take. A
  rival's open fields are now fair game once free ground is gone. This is also **income**: a tile
  pays its owner monthly whether or not a city stands on it, so a realm that takes cities and leaves
  the fields between them is leaving money on the table.
- **A realm with no winnable target chose no target.** `judge` refuses fights a realm would lose,
  which is right for choosing between wars and wrong as the last word. When everything fails it, the
  realm now presses the **softest thing it can reach** anyway. It often loses — and that is fine,
  because it costs the strong realm men and garrisons, which is what a weaker power is for.
- **A realm that had taken its whole landmass had nowhere to walk.** Objectives, raids and claimable
  ground are all filtered by land reachability, so every branch came back empty while its fleets
  sailed busily about with nothing to carry. An army with nothing to do on its own continent now
  **marches to a harbour and waits to be shipped**, spread across the realm's ports rather than all
  onto one quay.
- **And then the boats would not take them.** `loadUp` boarded `field` armies only, but `order`
  sends **raiders** to the quay just as readily — a raider that cannot reach anything to raid is
  equally stuck. Measured at 1600: Spain had 11 armies waiting on quays, 21 fleets, and **1 of them
  loaded**. It is now 4 of 8 loaded, and land war resumes on coasts nobody had reached in a century.

### Changed

- **An order that cannot be carried out falls through to the next one.** `march` returns whether it
  actually issued a route; a blocked road or an unreachable target no longer leaves an army standing
  in a field for a hundred years. The ladder is now objective → raid → rally → ground → a boat →
  regroup, and each rung is tried only when the one above it failed.
- **A field army with no objective raids.** Not a fallback to standing still: a raid needs no
  favourable odds, rides for the deepest thing it can reach, and either takes a lightly held place
  or forces the strong realm to garrison against it. That is the guerilla answer to being outmatched
  and the one thing a weaker realm can always afford.
- **Loaded fleets are dealt across up to four beaches** rather than all sailing for the same one.
  Harder to defend against, and far more likely to find a coast nobody is watching. The first convoy
  still takes the chosen target, so a realm with one fleet behaves exactly as before.

### Added

- 3 tests pinning the property directly: at 180 years the campaign still has armies with somewhere
  to be, is still fighting, and is still moving ground between realms.

## [0.18.3] — 2026-08-09

The owner played it and reported nine things. All nine, and the measurements after:

| | Before | After |
|---|---|---|
| Sea basins on the map | **4** — the Black Sea could not reach the Mediterranean | **1** |
| Walkable land claimed at 120y | ~88% | **90–100%** |
| Independent cities surviving | 0–2 | **0–1** |
| Fleets, and how many under way | 16–30, mostly idle | **16–25, with 8–18 sailing** |
| The Moors | Spain, and nothing else in Africa | **Fez, Marrakesh, Tunis, Tripoli, Alexandria, Sardinia** |
| The Britons | never left their island | **London, York, Edinburgh, Dublin, Bergen, Oslo, Uppsala** |

### Changed

- **Ships move in eight directions.** Armies still move in four. This is geography rather than a
  change of heart about diagonals: the map's water is a set of basins joined at single tiles and
  several of those joins are diagonal, so with four-way movement the **Black Sea (58 tiles) could
  not reach the Mediterranean (693) at all** — the Bosphorus at Constantinople is a corner. A realm
  on the Black Sea could build any navy it liked and never leave home. Eight-way makes the whole
  thing one sea of 754 tiles.
  - **A diagonal costs √2 of a tile**, so "three tiles a month" stays true in every direction. The
    reason armies have no diagonals is that one would make every stated speed a lie; giving ships
    diagonals does not make that argument wrong, it makes it something to pay for.
  - The sea pathfinder's heuristic moved from Manhattan to **Chebyshev** to stay admissible, and the
    AI's sailing-distance sweep went eight-way with it — otherwise a realm would measure a crossing
    its own fleet can make as impossible.
- **A harbour launches into the nearest of its eight water tiles**, straight neighbour before corner.
- **Realms attack what is cheap, not merely what is near.** A settlement's defenders now count as
  extra distance — 100 soldiers to the tile — so a realm reaches past the walled City on its
  doorstep for the weakly held village behind it. A soft weight rather than a filter: `judge` still
  refuses fights the realm cannot win, and this only orders the ones it can.
- **A long march counts as being across the water.** A realm ships an army it could technically walk
  when the march is more than three times the sail and at least twelve tiles. Foot makes half a tile
  a month against a fleet's three, so the far end of the Mediterranean is six years' marching and
  under a year's sailing — insisting on walking arrives with an army the winters have eaten.
- **A fleet may not unload within six tiles of its own ground.** Replaces "not onto a landmass we
  hold", which was right while the only reason to sail was to reach another landmass, and wrong the
  moment a realm began shipping armies around its own coast.
- **Claiming quotas raised** — 1–2 stacks per four settlements to 2–4. Realms were taking cities and
  leaving the countryside between them bare.

### Added

- **A fleet is never idle.** With no route and nothing aboard it hunts the nearest enemy fleet within
  fifteen tiles if it carries a warship, otherwise sails to whichever friendly harbour has an army
  standing in it, otherwise makes for the nearest harbour rather than sitting in open water. A hull
  at anchor is upkeep and a crew counted against the manpower ceiling, for nothing.
- 9 tests: the Black Sea join, one-step reachability of all eight neighbours, the diagonal cost,
  nearest-water launching, ground claimed, independents remaining, realms spanning landmasses,
  fleets under way — and an explicit assertion that **an army cannot be put ashore onto a hostile
  settlement**, which was a direct question from the owner.

### Answered

- **"Are the armies trying to attack the cities directly from the ships?"** No, and they never
  could: a settlement somebody else holds is not a landing site, so `landingBlockedBy` rejects it
  and it never appears in `landingSites`. Expeditions pick a **beach** on the target's landmass and
  march inland from there. There is now a test pinning it, since the question was worth an answer
  that cannot rot.

## [0.18.2] — 2026-08-08

Three things a large realm was failing to do, all the same shape of bug: rules that were right for a
realm of three settlements and were never scaled for one of thirty.

Measured at 120 years before and after:

| | Before | After |
|---|---|---|
| Field armies | 158, averaging **3.9 units** | ~55, averaging **9–12** |
| Stacks of 4 or fewer | **78%** | **4–9%** |
| Fleets on the whole map | **8** | **19–30** |
| Independent cities surviving | 2 | **0–2** |
| Realms holding more than one landmass | 0–1 | **2–3** |

### Changed

- **Founding a new army costs half a full stack**, not two units. A realm with twenty settlements
  was founding twenty tiny armies — one per garrison that happened to have a spare pair — none of
  which could take anything. The men are not lost by refusing: they stay in the garrison, and
  `regroup` walks an understrength stack round to collect them.
  - **The bar is per role.** A claimer is meant to be one unit and a raiding column three. The first
    version of this held them to a field army's bar and left **8.6% of reachable ground permanently
    bare**, because the claimers a realm needed could no longer be founded.
- **A large realm fights several fronts** — one objective per six settlements, to a maximum of four,
  and each army goes to whichever front is nearest it. Fronts must be 8 tiles apart or they are one
  front with extra steps. A realm under six settlements gets exactly one objective, which is exactly
  the old behaviour, so nothing about the early game moved.
- **Naval ambition scales with the realm.** Hulls wanted and escorts wanted were flat — one escort
  and eight hulls for a village and an empire alike. Both now scale, and a realm with no land war
  left wants more of each still.
- **Ships are built at every port, every month**, rather than at one base once a year. Shipbuilding
  sweeps no map and needs no target, so there was never a reason for it to sit behind the annual
  planning cadence — which capped every realm on the map at one hull a year however large it was.
- **Escorts are built before transports.** A harbour launches when it holds a landing force, so
  whatever is built last gets left behind: with transports first, the convoy sailed the moment it
  had berths and the escort followed months later as a fleet of one. Now the escort waits at the
  quay while the transports gather around it and they sail together.
- **Naval build weights raised** in `data/ai.json` — 35–50 to 70–85 — so coastal settlements
  actually put up Docks, Ports and Shipyards instead of treating them as the last thing worth
  building.

### Added

- **Rally.** A field army below half a full stack marches to the nearest larger friendly field army
  and merges with it. Armies have always merged on contact; what was missing was a reason for two of
  them to be in the same place. Only the smaller moves, and ties break on the higher id, which is
  what guarantees a pair can never walk through each other for ever.
- **A realm that has run out of land targets goes to sea in earnest.** This is the Britons on their
  island and the Moors in North Africa — realms that took everything their continent offered and
  then quietly stopped playing for a century. They now want a bigger navy than a realm still busy
  on land.
- 6 tests: field-army concentration, fleets at sea, realms spanning more than one landmass, armies
  genuinely spread across fronts, and the composition assertions retargeted to a mature campaign.

### Fixed

- The composition test asserted at 60 years, where Light Infantry is two thirds of every army —
  which is the **tier gate**, not the recruiting roll: a Village can build Light Infantry and
  nothing else, so a young realm has one option however it rolls. Measured at 120 years instead,
  where a realm has the buildings to offer a choice and the top unit is 36–46% of nine.

## [0.18.1] — 2026-08-04

The owner's revisions to the naval phase, and the AI work that made them mean something. Naval
conquest went from **1 marooned settlement taken in 120 years to 5–7 of 7**, and on one seed the map
finishes with **no independent city left standing anywhere**.

### Changed

- **A Transport carries five land units**, up from two — owner-specified. Four Transports now lift a
  full twenty-unit army, so a whole stack crosses in one convoy. `BERTHS_WANTED` follows it to
  `MAX_ARMY_UNITS`.
- **Every hull sails three tiles a month** — owner-specified. Previously 3/4/3/2, so an escort
  slowed a convoy; a fleet now sails at one speed whatever is in it.
- **Copenhagen has moved two tiles west**, onto the forest shore, and its old tile is open water.
- **What a rival realm recruits is now a roll of three** — owner-specified, and it is the fix for a
  game that had one unit in it. In equal thirds: the strongest unit it can build (the old argmax,
  still bent by personality), a **missile** unit — Archer or Cavalry Archer — or a **ground** unit.
  Rerolled up to twelve times until it lands on something the settlement can actually produce, so a
  Village with no Archery Range rolls again rather than ordering nothing.
  - Measured over 120 years, the world's muster went from heavy-cavalry monoculture to **archer 24%,
    light infantry 23%, heavy cavalry 22%, light cavalry 10%, sword 8%, spear 4%**. Spear infantry —
    which does double damage to horse and which the pure argmax had **never built once** — is now
    fielded. The counters already in the roster start to matter.
- **The navy decides before the army does.** A crew and a spearman come out of the same fifth of a
  realm's people, and `levy` spent all of it, so `queueShip` was refused for manpower every year for
  ever. Ordering `runNavy` ahead of `levy` and `campaign` gives ships first claim — and also makes
  an army summoned to the quay keep its orders, since `campaign` only re-routes idle stacks.

### Added

- **Splitting a stack at the quayside.** `embark` takes an optional set of units, so a fleet with
  too few berths loads the part that fits and the rest stays ashore as the army it was — same id,
  same tile, still commandable. `fitting` picks the heaviest formations first, on the reasoning that
  if only half an army crosses it should be the half that can fight. This is the only place in the
  game where an army can be divided, and it is deliberately confined to a harbour.
- **A fleet waits for a landing force worth landing** — six units, or a full hold — instead of
  sailing with whatever happened to be on the quay that month. An army put ashore alone on a hostile
  island cannot retreat and cannot be reinforced inside a season.
- A realm will now **pull a committed stack off the line** for an invasion, rather than waiting for
  an idle one that never comes, guarded by a three-army minimum and the annual cadence.
- 8 tests: partial embark and the split order, the one-speed roster, four-transports-to-an-army, the
  recruiting roll's spread and determinism, and an end-to-end assertion that marooned settlements
  actually fall.

### Fixed

- **Loaded fleets unloaded onto their own coast.** `putAshore` landed on any adjacent beach, and the
  quay a fleet loads at is beside one — so every expedition was a round trip of two tiles and no
  fleet was ever observed carrying anything. A fleet now lands only on a landmass its realm holds no
  settlement on.
- **Ireland, and every island nobody happened to be near.** Targets were chosen purely by sea
  distance, so realms always picked the nearest foreign *coastline* — which is usually somebody
  else's land war reached by boat. Measured: Novgorod chosen 173 times in 120 years, Tunis 90,
  Edinburgh 55 — and **Dublin 6**. A landmass **no realm has settled** now outranks distance
  outright, which is what finally sends fleets to Sardinia, Crete, Cyprus and Ireland.
- **The balance panel ignored ships at sea**, so a realm's wage bill appeared to fall the month it
  launched a fleet. The simulation had been fixed in 0.18.0; the panel had not.

---

## [0.18.0] — 2026-08-04

**Naval.** The last structural gap in the map. Until now every acre a realm could *march* to got
claimed and everything else sat out the campaign — 64 tiles bare after 120 years, all of them on
islands, plus a dozen independent cities in Scandinavia, Ireland, Cyprus and North Africa that
survived every century because nobody could reach them, and Iberia and Britain unable to touch each
other. Ships are how the rest of the map joins the game.

**All six blocking questions were answered by the owner before a line was written**, and are
recorded in [DESIGN.md](docs/DESIGN.md) decisions 121–128, [MECHANICS.md](docs/MECHANICS.md) §10 and
[CONTENT.md](docs/CONTENT.md) §4.

### Added

- **A ship is a unit.** Its crew is its `size` and its HP and damage are **per crewman**, exactly
  the shape of a land unit — so naval combat needed **no second resolver**. A fleet musters into the
  shipped auto-resolve as formations, and `stackUpkeep`, `stackSoldiers`, the desertion roll, the
  manpower ceiling and the balance panel all read fleets through the helpers they already read
  armies through. `unitById` is the single seam that made it free; `loadUnits()` stays land-only, so
  nothing that offers the player troops can offer a Flagship.
- **Ship statistics**, owner-approved. Crew 40/60/120/200, HP per crewman 60/80/120/160, damage
  5/15/25/40, sea speed 3/4/3/2 tiles a month. A Heavy Ship lands at roughly Heavy Cavalry's
  strength for five times the gold; a Flagship is four times that again; a Transport is nearly
  defenceless at 120 against a Light Ship's 720, which is what makes an escort a real decision.
- **Fleets** — `FleetState`, deliberately an `ArmyState` in a different medium: an owner, a tile, a
  bag of things by id, a route and banked movement points. `city.fleet` is to `launch()` what
  `city.garrison` is to `mobilise()`. One fleet per sea tile, twenty hulls maximum. A fleet exists
  **only on water**; hulls that are not at sea are a count in the harbour, not a fleet.
- **Sailing.** The same integer march-point arithmetic as a march, with open water carrying no
  terrain cost and no owner — a sea tile always costs exactly one tile's worth. Winter is the one
  modifier that survives, the same −40%. A fleet sails at its slowest hull. Sea pathfinding is A*
  over water, sharing the land pathfinder's heap.
- **Transport capacity** — **two land units per Transport**, whatever their size, and only
  Transports carry. A six-unit invasion needs three hulls before an escort is paid for.
- **Embark and disembark** — **board at a Dock, land on any coast.** Loading an army needs a
  harbour the realm owns; landing needs only a tile beside the fleet that no hostile army or
  settlement holds, owned or not, built on or not. **A landed army claims the tile it steps onto**,
  like any march — which is how a realm gets its first acre on a landmass it has never held, and
  the single line that makes this phase change the map rather than merely add boats.
- **Interception within one tile.** Two hostile fleets that end a tick orthogonally adjacent fight,
  without either moving onto the other, so a Light Ship in a strait actually closes it. Only a fleet
  carrying a **warship** can force it — two unescorted convoys pass untouched, having nothing to
  fight with. Order is fixed for determinism: fleets by id, lower id the attacker. **One of the two
  must have moved this tick**, or a pair that fought to the 48-turn cap and both survived would
  re-fight 120 times a month; a blockade is unaffected, because what it catches is by definition
  sailing.
- **The AI crosses water.** One expedition at a time per realm: it finds the nearest settlement it
  cannot walk to but can sail to, lays down transports and an escort, launches, **calls an idle
  field army to the quay** — the largest that will actually fit the berths — loads it at a Dock,
  sails, and puts it ashore. It goes through the same `queueShip`, `launch`, `embark`, `orderSail`
  and `disembark` the player's UI calls, and it carries its scruples across the water:
  `willAttack` is handed in rather than reimplemented, so a Peaceful realm sails to independent
  cities and not to a rival's.
- **A landed army is its own frontier.** Reach is measured from a realm's settlements, which left an
  expeditionary force with every city on its new island reading as infinitely far — so it stood on
  its beach until the winter took it. An army now counts as a source for the reach sweep **only on
  a landmass where its realm holds no settlement at all**. Drawn exactly around the amphibious case
  and no wider, so nothing on a home continent moved.
- **Fleet UI** — fleets draw as hulls rather than rectangles, with a pip per unit aboard; a fleet
  card mirroring the army card, with Sail, Embark, Land, Heave to and Dock; an Embark button on the
  army card too, because the thought occurs as often looking at the troops as at the boats; **Put
  to sea** in the Navy tab; and the **Navies roster is real** — it had been a placeholder saying
  fleets would put to sea in a later phase, which is this one.
- 40 naval tests, covering the ship-is-a-unit invariant, launching and docking, both halves of the
  embark rule, sea pathfinding, interception and the standoff rule, cargo drowning, crews against
  the ceiling, desertion, the v9 save round trip and v8 migration, and determinism across a save
  mid-voyage.

### Changed

- **Crews count against the manpower ceiling**, and a hull levies its men the month its keel is
  laid. Moored ships, ships at sea, ships still on the slipway and any army aboard all count. A
  Flagship is 200 men — two Light Infantry and change — so a realm cannot build a navy and an army
  out of the same fifth of its people. Supersedes the ships-draw-nobody clause of decision 82.
- **Fleets desert in debt**, at the same 10% per ship per month armies suffer. A ship was capital
  and therefore exempt; a ship with a crew is a payroll.
- **Cargo is lost with the ship.** Capacity is recomputed from the surviving Transports after every
  loss and anything above it drowns — in battle and in desertion alike, in sorted id order so a
  save replays identically. The harshest rule in the game, on purpose.
- `queueShip` now checks population and the manpower ceiling like `queueUnit`, and cancelling a
  hull returns its crew.
- Save format **v8 → v9**. A v8 campaign was fought entirely on land; it opens with empty seas and
  its moored hulls intact, since `city.fleet` has existed since 0.5.0 and was simply inert. Such a
  realm may open **over** its manpower ceiling now those hulls have crews — deliberately not
  corrected, because the ceiling gates recruitment and disbands nobody (decision 99).
- `Unit['class']` gains `naval`, and `recruitableUnits` is typed land-only so the AI's per-class
  unit bias has no naval case it could never reach.

### Fixed

Four of these were found by instrumenting a 120-year campaign and measuring what the rival realms
actually did, rather than by reasoning about the code. Without that the naval AI would have shipped
looking complete and doing nothing.

- **Ships at sea drew no wages.** `totalUpkeep` only counted hulls in the moorings, so a realm's
  wage bill *fell* the month it launched a fleet. Found by a test written for the crew rules.
- **The AI built fleets and never loaded one.** Three compounding causes, all measured: hulls were
  launched a pair at a time from *every* port, so 28 berths sat in eight separate anchorages of
  three; the target was 4 berths, and **an army cannot be split**, so a fleet that could not take a
  whole stack took nothing; and loading was gated behind the annual planning month, which left a
  two-unit army standing on a quay beside eight free berths because it was not that realm's turn to
  think about ships. Now: one harbour of departure chosen for being nearest the target by sea, 8
  berths wanted, and landing, loading and launching all local decisions made every month.
  Before, over 120 years: 8 fleets, 28 berths, **0 men carried**. After: an army crosses and takes
  a city no realm could reach.
- **A summoned army could be too big for the boats it was summoned to.** `callToThePort` marched the
  largest idle stack to the quay regardless of berths, where it stood unable to board and unable to
  be sent anywhere else. It now calls the largest stack that actually fits.
- The naval AI's landing search scanned the whole map once per candidate settlement — forty-odd
  full sweeps per realm per month, which took the century-long consolidation test from 35 seconds
  to 200. Inverted to one pass that files every shore under its landmass, and guarded behind a
  cheap "is there anything across the water at all" check so a one-continent campaign does no
  naval work whatever.
- **The naval plan is now made once a year, staggered by realm**, rather than every month. Picking
  a target sweeps the map twice, and doing that thirteen times a month still doubled the cost of a
  century. An amphibious operation takes years — the transports alone are six months on the
  slipway — so twelve re-decisions a year were twelve copies of one decision. **Landing stays
  monthly**: it costs a look at four tiles, and an army left floating beside its beach is the one
  thing that must never wait on a cadence.
- `advanceFleets` allocated a sorted copy of the fleet list on every one of the 120 ticks in a
  month, including for the many campaigns that have no fleet at all. It now leaves on a length
  check.

---

## [0.17.4] — 2026-08-04

### Fixed

- **Whole regions were never conquered, even standing empty.** The north-west of France, the Danish
  peninsula, the middle of Britain and the Sahara behind the Moors' cities all stayed unclaimed for
  a century. Measured: **318 of 1,692 land tiles bare after 120 years**, 176 of them seven or more
  tiles from the nearest settlement in the world. Three separate causes, all fixed:
  - **The claim radius applied to everyone.** Every realm looked for unclaimed ground only within
    3 walking tiles of its own settlements, so anything further than that from *any* city on the
    map was ground no realm ever had a reason to walk to. The radius now binds only a field army
    that has an objective to be distracted from — a dedicated claiming stack has no limit, and
    neither does a field army with no war to fight. That last one is the Moors, who took Fez and
    Marrakesh and then sat on the coast for a hundred years with bare desert four tiles inland.
  - **Claiming stacks grew into armies and kept the label.** Mustering tops up whatever army stands
    on a settlement and keeps its role, and an army folds any friendly stack it walks into — so a
    realm ran stacks of 8, 11, 14, 16 and **17** units labelled `claim`, taken out of the war for
    the whole campaign and still claiming one tile at a time. Anything over one unit is handed back
    to the field force, and a fresh single unit is raised for the job.
  - **The claim quota did not scale with the realm**, unlike the raid and guard quotas. A century
    in, with 139 armies on the map, there were **two** claiming stacks in the entire world.
  - Result: **318 bare tiles → 64**, and all 64 are on islands no realm holds a settlement on —
    ground with no land route at any distance. Everything a realm can march to is now claimed.
    `ai.test.ts` asserts it against reachable land rather than against the map, because demanding
    the whole map would be demanding a bug until ships exist.

### Added

- **The panel reads out what a rival has built.** Clicking a settlement you can see — which, with
  the fog cheat on, is all of them — now lists every building in it, in the order the realm built
  them, because that order is the answer to "what does this AI care about". Clicking open ground
  names what it is worked as and to what level. The tile yield line always quietly included the
  improvement, so the panel could tell you a rival's field was worth six gold without ever telling
  you it was a field.

### Changed

- A claiming stack is only raised on a landmass that still has unclaimed ground on it. It can never
  leave the one it was founded on, so one raised where the continent is already full is a unit lost
  to the war *and* a filled quota slot the settlement next to bare ground never gets.
- Two claiming stacks of the same realm no longer walk to the same tile.

### Notes

- The personality table in [docs/MECHANICS.md](docs/MECHANICS.md) §8 still carried a **Reach**
  column, removed from the game in 0.17.0. Replaced with the raid and guard odds that took its job.

---

## [0.17.3] — 2026-08-04

### Changed

- **Gold income is halved.** Owner-authored. Every gold figure in the data is what the ground, the
  buildings and the people *produce*; a realm now collects **half** of it. Wood, iron and stone are
  untouched — the problem is gold specifically.
  - One constant, `GOLD_INCOME_PERMILLE` in [src/sim/state.ts](src/sim/state.ts), applied to gross
    income before wages and before the difficulty handicap. **Deliberately not thirty halved
    numbers in the data files**: this is a figure that will be retuned, and one edit beats thirty.
    It also leaves every building card honest about what the building produces, with the tax stated
    once where income is read.
  - The balance panel taxes each term rather than the sum, so its columns still add up to the net
    the simulation uses.
  - **Upkeep is unchanged and is paid in full** out of what the tax leaves, so an army costs twice
    what it used to relative to income. A realm needs 100 gold/month net to sustain heavy cavalry;
    that now takes twice the land.

### Notes

- One test's assertion had to change shape rather than its number: a world of Defensive realms
  posts more border guards than an Ambitious one **as a share of its armies** (13.9% against
  11.4%), not in absolute count. Ambitious realms conquer more, so they have more frontier to
  garrison and more armies to do it with — the head count was measuring how big a world's realms
  got, not what they chose to do.
- Raiding is asserted on the tables rather than behaviourally, for the same reason in reverse: a
  raiding column rides deep by design, where garrisons and the winter kill it. Counting survivors
  measures how many came back, not how many were sent.

## [0.17.2] — 2026-08-04

### Added

- **Realm watch — every realm's economy on screen while the fog is off.** Cities, gold, gross
  income, upkeep, net, armies, units and soldiers, richest first. Appears with the reveal cheat
  (Pause ×5 then 1× ×5) and in observer mode after defeat.
  - **Gross and upkeep are split out**, because `monthlyIncome.gold` is already net of wages and
    the *gap* is the interesting number: a realm whose upkeep eats most of its income has stopped
    building and is only feeding troops. That is the figure to watch while deciding what to do
    about heavy cavalry.
  - The same numbers have been in the balance panel under `B` since 0.8.3, minus the upkeep
    column. This puts them where they can be read while a century runs.
- The balance panel keeps its own table; this is a second view of the same derived data, and
  neither is stored or read by the simulation.

## [0.17.1] — 2026-08-04

### Added

- **Winter kills armies that stay in enemy country.** Each unit standing on a rival's territory
  has a **10% chance of being lost outright** every winter month — owner-authored, and units
  rather than casualties: a formation with no billets and nobody willing to sell it grain does not
  come back weakened, it stops existing. Unclaimed ground does not do this; it costs a march 20%
  and nothing else.
- **The panel reads out anything you can see.** Clicking a rival's army now shows its composition,
  its soldier count, whether it is marching, and what it is — *Field army*, *Raiding column*,
  *Border garrison*, *Settlers*. Clicking a rival's settlement shows its defenders, its garrison,
  the total that would have to be beaten, and who is besieging it. Previously a rival army
  rendered **nothing at all**, and a rival city showed its walls and population but never what was
  behind them.

### Changed

- **There is no limit on how many armies a realm may field.** `maxArmies` is gone. A realm raises
  what it can pay for and spare the people for; the limits that remain are the honest ones — the
  treasury, the manpower ceiling and the levy floors. Whether it spends on walls, economy or
  troops was already a personality lean through the build weights.
  - What a realm *wants* now scales with what it holds rather than with a difficulty cap, and the
    raid and guard quotas scale with it too — per four settlements rather than absolute, so an
    empire of thirty cities no longer runs the same two raiding columns a village does.
  - Half a realm's armies, rounded up, still belong to the field force.

### Notes

- **[OPEN] — a besieging army suffers the winter too**, because a siege is spent standing on the
  enemy's ground. A Capitol's clock is 48 months, which is twelve winters, so a unit outside it
  has a **28%** chance of still being there when the gates open. Starving out a great city went
  from something four Heavy Cavalry could do to something twelve are needed for; Villages and
  Towns are barely affected. Exempting a dug-in besieger is a defensible alternative and is the
  owner's call — logged in [docs/OPEN-QUESTIONS.md](docs/OPEN-QUESTIONS.md).
- With no army cap, a hundred-year campaign now simulates several times as many armies. The test
  suite roughly tripled in wall-clock time, which is worth knowing before the speed multipliers
  are tuned again.
- One test's premise had to change rather than its expectation: a world of Ambitious realms no
  longer takes *more* cities than a Defensive one, because with reach gone both take everything
  they can walk to and tie at 50. It now asserts what actually differs — Ambitious raids, Defensive
  garrisons.

## [0.17.0] — 2026-08-04

**Total war.** Every realm now means to take the whole map, and the map stops freezing.

### Changed

- **The reach limit is gone.** A realm considers every settlement it could walk to, however far,
  and takes the nearest it can. Only having no land route rules a target out.
  - `reach` was the wrong axis, and it was producing realms that simply stopped. Measured after
    sixty years: **most realms had zero targets inside their reach** and idled, and the map settled
    with a dozen independent cities and 1,600 unclaimed tiles nobody would ever walk to.
  - Measured over the same century at Knight, seed 7 — battles per decade used to fall to **zero
    from 1390 and stay there**. They now run `25, 17, 18, 19, 23, 27, 29` through to 1450 and are
    *rising* at the end. Independent cities fall from 45 to **8** rather than freezing at 14, and
    unclaimed ground keeps dropping instead of stalling at 1,604 tiles.
- **Personality is a pair of odds, not a distance.** What separates realms is now what they do
  with the armies they raise, rolled once per army from the campaign's own RNG:

  | Personality | raids | guards | rest to the field |
  |---|---:|---:|---:|
  | Ambitious | 40% | 10% | 50% |
  | Balanced, Honorable | 20% | 25% | 55% |
  | Peaceful | **0%** | 35% | 65% |
  | Defensive | 5% | 50% | 45% |

  Focus on army, defences or economy was already a personality lean, through the build weights.
- **Whose ground it is changes how fast an army crosses it**, owner-authored: **unclaimed +20%**,
  **a rival's +40%**. It multiplies with terrain and stacks with winter, so foot crossing a hostile
  mountain in winter takes **seven months a tile**. It also makes consolidating pay for itself —
  claimed ground is fast ground, so an advance that takes the border tiles as it goes accelerates,
  and one that drives a corridor deep does not.
- **The Golden Horde is Ambitious**, authored in `data/factions.json` rather than left to the seed.
  It had been rolling Defensive, which with one city and a reach of 6 meant it took the ground
  around Caffa and then sat there for a century — its nearest enemy, Kyiv, was seven tiles' walk
  away against a reach of six. It now holds four cities at the end of a century. **This is the
  first faction given a personality by hand**; the other thirteen are still rolled.

### Notes

- **[GEN]** The raid and guard odds themselves, and the two territory multipliers are
  owner-authored. That Peaceful never raids is owner-specified.
- Removing the limit means an army may now march for years to reach a target. With 0.16.0's speeds
  that is deliberate, and it is what makes the cavalry raiding columns worth more than the field
  armies.

## [0.16.0] — 2026-08-04

**Armies march at a medieval pace, and rival realms stop marching as one lump.**

### Changed

- **Every speed on the campaign map was cut eightfold**, owner-specified. Everything on foot
  crosses **one tile every two months**; everything on a horse crosses **one a month**. Two speeds,
  and the whole roster is one or the other — cavalry is now strictly twice everything else rather
  than half again, which is what makes a mounted column worth assembling.
  - Terrain and winter stack on top: **foot in a mountain winter takes five months a tile**.
  - Crossing fifty tiles of Europe went from about a year on foot to eight. **Campaigns are now
    measured in decades.**
  - Speeds are held internally in hundredths of a tile a month (`SPEED_SCALE`), because half a tile
    is now a meaningful quantity and the simulation is integers all the way down. `data/units.json`
    is still authored in plain tiles per month; the loader scales it once, on the way in.
- **Save format is v8.** Banked march points are on a scale a hundred times finer, so a v7 save's
  armies are rescaled and stay exactly as far along their route as they were.
- **The AI develops conquered ground much faster.** It always built farms, mines and sawmills —
  chosen by what the tile actually yields — but was capped at **one digging at a time across the
  whole realm**, so a realm holding forty tiles finished about one improvement a year and its
  conquests stayed bare for a century. `improvementsAtOnce` is now a difficulty lever: 1 at
  Recruit, 2 at Knight, 4 at King. Measured over fifty years, finished improvements across Europe
  roughly doubled.

### Added

- **Armies have roles, and rival realms divide their forces.** One behaviour for every stack meant
  one behaviour for every realm: everything marched at the objective, the border stood naked and
  the fields stayed unclaimed.

  | Role | What it does |
  |---|---|
  | `field` | the main force — joins the realm's one objective |
  | `raid` | a small column, **cavalry for preference**, riding for the **deepest** reachable enemy settlement |
  | `guard` | a border garrison that sits on the frontier settlement nearest an enemy |
  | `claim` | one unit, tidying unclaimed ground near home |

  - **Difficulty decides how many specialists a realm may run** (`raidStacks`, `guardStacks`,
    `claimStacks`); **personality decides which it wants and how big they are** (`raidUnits`,
    `guardUnits`). All of it is in `data/ai.json` and retunes without a code change.
  - Order of preference is the personality: **Ambitious** sends riders out before it posts
    sentries, **Defensive** does the reverse, and **Peaceful** never raids at all.
  - **Half the army slots, rounded up, always belong to the field force** — without that reserve a
    Knight fielding three armies posted a sentry, raised a claimer and had one stack left to fight
    with.
  - Measured over fifty years at Knight: battles rose from 73 to 104, and realms fielded 8 border
    garrisons where before there were none.
- **A defeated player can now inspect any tile or city.** Observer mode lifted the fog off the map
  in 0.15.0 but the selection panel kept its own gate, so half the world was plainly visible and
  still read *"Beyond your sight"*.

### Notes

- **[GEN]** Every new number: the three per-difficulty stack caps, the two per-personality stack
  sizes, `improvementsAtOnce`, and the half-the-slots field reserve. All in `data/ai.json` except
  the reserve.
- Raiding is deliberately rare at Knight — one detachment slot, and only bold personalities spend
  it on a raid. It becomes common at Baron and King.

## [0.15.0] — 2026-08-04

**The AI learns that water is in the way.** Sight becomes a diamond, and a dead realm keeps
watching.

### Fixed

- **The AI measured distance in straight lines, and it froze whole realms.** A settlement one
  diagonal step across a strait read as the nearest thing on the map, so it won the comparison,
  became the realm's objective, and *stayed* the objective every month while no army could ever
  arrive. Worse, the search stops at the first candidate nearer than the best so far — so the
  cities a realm could actually have taken were never even considered.

  ```
    L L L L L L        P is 1 tile from T in a straight line
    L L P W W L        and 8 tiles by land, around the water.
    W W W T L L
  ```

  New `src/sim/geography.ts` answers the two questions honestly: **`sameLandmass`**, a flood fill
  of the map cached per world, and **`walkingDistanceFrom`**, one breadth-first sweep a month per
  realm giving true walking distance to every tile at once. Unreachable is now infinitely far,
  which is the truth. Sixteen cities are unreachable from Paris on foot — Britain, Ireland,
  Scandinavia, the islands and North Africa — and the AI had been treating every one of them as an
  ordinary neighbour.
- **This is a large part of the endgame stalemate.** Measured over the same century at Knight,
  seed 7: battles per five years used to fall to **zero from 1390 and stay there**, with the
  largest realm frozen at 14 cities for sixty years. They now run `1, 7, 0, 5, 1, 12, 3, 3, 0, 3,
  3` through to 1450, and the largest realm moves between **15 and 19** — cities genuinely
  changing hands. It does not fix the stalemate entirely; it removes the cause that was pure bug.
- **Realms no longer leave pockets of unclaimed ground behind them.** `pickClaim` had the same
  flaw: a field across a river mouth measured as two tiles, won on closeness, and the army was
  sent somewhere it could not go — so the ground next door stayed unclaimed for the rest of the
  campaign. The search box still bounds the cost; the *measurement* is now the walk.
- **Armies that cannot arrive no longer count toward the odds.** A realm summing its strength for
  an attack was including stacks on the far side of a sea, which is how it talked itself into
  assaults it could not make.

### Added

- **Observer mode.** Losing no longer ends the campaign for the player — it lifts the fog and lets
  them watch Europe finish the job. Nothing ever paused on defeat; what stopped was **vision**,
  because sight is derived from ground held and a realm holding nothing sees nothing. Every rival
  army, border and allegiance was being hidden, so a Europe still at war looked like a Europe that
  had stopped.

### Changed

- **Sight is measured in walking distance, not in a square.** `|dx| + |dy|` — a diamond that
  reaches its full radius along each axis and tapers to a point at the corners, per the owner's
  drawing. It replaces the Chebyshev square, where the corner tiles were free range: a lookout saw
  3 tiles north and 3 north-east, when north-east is half again as far.
  - It is the right metric rather than merely the rounder one: **armies move orthogonally**, so
    taxicab distance is exactly how far a rider could get. Sight and movement now answer the same
    question with the same arithmetic.
  - A diamond covers **less than half** what the square did — `2r² + 2r + 1` against `(2r + 1)²`.
    Sight of 3 now sees 25 tiles rather than 49, and the known band at radius 10 covers 221 tiles
    rather than 441. Expect noticeably more black at the opening.
  - The **5 × 5 relief box** for sieges is unrelated and unchanged — that one is owner-authored,
    and it is about which armies can reach a siege rather than what anyone can see.

### Notes

- Investigated the report that realms stop fighting late in a campaign. **Three separate things
  were true**, and two of them are fixed above: the player's own vision dropped to zero on defeat,
  and the AI was pinned on unreachable objectives.
- **The manpower ceiling was not a cause.** At the stalemate every surviving realm sat far below
  it — the Russians held 5,080 men under arms against a cap of 172,450, about 3%.
- **Something is still left.** Fighting no longer dies out, but it is sporadic rather than
  sustained, and 14 independent cities survive any campaign because they are genuinely across
  water. That last part is the naval phase, and the rest is the question already logged in
  [docs/OPEN-QUESTIONS.md](docs/OPEN-QUESTIONS.md): whether two large walled realms correctly
  declining to fight each other is the right shape for the endgame.

## [0.14.1] — 2026-08-04

### Added

- **CHEAT — a fog-off toggle, for testing.** Click **Pause five times, then 1× five times** and
  the fog comes off the whole map. A **FOG** button then appears beside the speeds to put it back,
  because the useful thing is flipping between the two rather than seeing the map once. Session
  only, never saved, and it touches nothing but what is drawn. Recorded in
  [docs/OWED.md](docs/OWED.md) beside the max-speed cheat — **neither ships in 1.0.0**.
- A test that marches an army east through the real movement code and asserts new ground is
  revealed. It pins the behaviour that reads as a bug: an army must get **11 tiles clear of a
  settlement** before it uncovers anything, because the settlement already knows 10 tiles in every
  direction and an army only sees 3.

### Notes

- Investigated a report that the black shroud does not lift when armies march east. **The
  simulation is correct** — measured on a real campaign, discovered ground grows from 441 tiles to
  541 as an army marches from x=17 to x=37, and stops only when the army is destroyed. See §2 of
  [docs/NEXT.md](docs/NEXT.md) for what is more likely going on.

## [0.14.0] — 2026-08-03

**Manpower, and a map that remembers.** Gold no longer decides the size of an army, and the far
side of Europe is genuinely dark until somebody rides out and looks at it.

### Added

- **The manpower ceiling.** A realm may keep **a fifth of its people under arms** — 20%,
  owner-authored, counting soldiers among its people.
  - Recruiting **moves** a man rather than removing one: he comes off a settlement's population
    and goes into the men under arms, and the total the fifth is taken of does not change. So the
    ceiling never moves when a unit is raised. It moves when people are born, and when land
    changes hands.
  - Garrisons, field armies **and units still in training** all count — the men were levied when
    the order went out, so leaving the queue out would let a realm order twenty units against one
    unit's worth of room. A settlement's own derived defence does not count, and ships draw
    nobody.
  - **It binds hard, and it is meant to.** The opening realm — one Village of 1,000 people plus
    the Light Infantry it is granted — has a ceiling of 220 men and 100 already standing, so there
    is room for exactly one more unit. The third is eighty-odd months of growth away. **Conquest
    is the only fast way to raise it**, which is where the design already puts victory.
  - The rival realms are held to the same ceiling through the same function the player's recruit
    panel calls. A realm at its limit trains nothing anywhere, however full its treasury.
  - Shown in the top bar as men under arms against the ceiling, and in the recruit panel as the
    room remaining, with its own refusal reason when it is the limit that bites.
- **The map remembers where you have been.** Fog now has **three states** instead of two: ground
  in sight is clear, ground the realm *knows* takes the 62% wash, and ground it has never known is
  **opaque black**.
  - Known means ever seen, or within **10 tiles of one of the realm's settlements** —
    owner-authored. A king knows his neighbours' country without having ridden through it, and
    knows nothing whatever about a coast a thousand miles away.
  - Knowledge is **never unlearned**. An army no longer drags a closing shroud behind it, and
    losing a province does not erase its geography from the map.

### Changed

- **Save format is v7.** Discovered ground is the one part of fog that has to be stored, because
  "has anyone ever stood here" is a fact about the campaign's history and cannot be derived. A v6
  save migrates and opens knowing what it can see and the country around its own settlements; the
  ground it once marched over is not recoverable, because v6 never recorded it.
- Fog is no longer *only* a presentation filter. Current sight is still derived, still recomputed
  from scratch, and **still read by nothing in the simulation** — the new mask is written by the
  tick and read by the renderer, and nothing in between consults it.
- The AI's unit-picking now checks three limits rather than two, and on a small realm the manpower
  ceiling is usually the one that binds.

### Notes

- **[OPEN]** A realm starved or carved down below its own ceiling disbands nobody — the ceiling
  gates recruitment and does not conscript backwards. Whether an army should desert when the
  ceiling drops below it is the owner's call, logged in `docs/OPEN-QUESTIONS.md`.
- **[OPEN]** Whether 20% is the right share. The owner chose to judge it by playing; it is one
  constant in `src/sim/manpower.ts` and no code depends on its value.
- Naval moves to **0.15.0**, still blocked on the six ship questions.

## [0.13.0] — 2026-08-03

**Fog of war, and realms that hold a country instead of a corridor.** Every defence bonus halved
so that attacking is a realistic thing to do, and the five personalities brought close together.

### Added

- **Fog of war.** The player sees **3 tiles beyond every tile the realm holds**, and further from
  a settlement: **+1 per tier above Village**, so a Village sees 3 and a Capitol 6. A field army
  sees 3 of its own, because a march into open country would otherwise be blind.
  - The shroud hides **who owns the ground**, **armies**, and **whose city that is**. Clicking a
    shrouded tile says *"Beyond your sight"* rather than reading out its owner, garrison and
    building queue — darkening the map would be worth nothing if the panel still told you.
  - It does **not** hide the geography. Terrain, coastlines and city dots stay faintly readable
    under the wash: a medieval king knows where the mountains are, and a map that goes black is
    unnavigable rather than mysterious.
  - **The rivals have none of it and see everything**, which is stated in the docs rather than
    hidden.
  - **It is a presentation filter and nothing more** — derived from state, never stored in it, and
    never read by the simulation. A test asserts the point directly: two identical campaigns stay
    byte-identical whatever the player can see. Wiring fog into the simulation would put what each
    realm knows into the save, into every migration and into every determinism guarantee, for a
    feature that only ever needed to change what is drawn.

- **Realms consolidate before they campaign.** Each month one army — the weakest, since claiming
  ground needs feet rather than soldiers — goes to the nearest unclaimed tile within 3 tiles of one
  of its own settlements, its own distance breaking the tie. The rest follow the realm's objective.
  - Without it an army walked a one-tile corridor to the first city it could beat, and a realm
    ended up holding a line across the map rather than a country: no income from the ground beside
    it, no border its armies could be brought back through, nothing worth improving.
  - Measured over a century, the realms now hold roughly **1,000 tiles between them** rather than
    a couple of hundred.

### Changed

- **Every defence bonus in the game is halved** — terrain, the city tile, the fortification line
  and winter, all of them, so that attacking is a realistic thing to do.

  | | Was | Now |
  |---|---:|---:|
  | Plains / Steppe / Tundra | 10% | **5%** |
  | Forest / Desert | 20% | **10%** |
  | Mountain | 30% | **15%** |
  | City tile | 10% | **5%** |
  | Winter | 10% | **5%** |
  | Wooden Palisade | 10% | **5%** |
  | Stone Walls | 30% | **15%** |
  | City Walls | 40% | **20%** |
  | Citadel | 60% | **30%** |

  The scale moved together, so nothing about *relative* ground changed — a mountain is still three
  times a plain, a Citadel still six times a Palisade. What changed is the ceiling: the worst
  ground in the game is now **55%** rather than the 110% it used to reach, so **a fully walled
  Capitol can be stormed** by a large enough army instead of only starved out. Four Heavy Cavalry
  are still thrown back by its free defenders, where twelve used to be. Walls buy time now, not
  immunity.

  Fortification is stored as a **percentage** rather than the tenths it used to be, because half
  of "3 tenths" is not a whole number of tenths.

- **The five personalities now lean off a common centre** rather than being five different games.
  Every one of them builds an economy, keeps an army, settles unclaimed ground, expands its
  settlements and makes war when the odds are good. Balanced *is* the centre; the others are a
  tilt away from it, and the widest gap in aggression is now 0.90× against 1.15× rather than
  0.85× against 2.20×.
  - **Peaceful is an economy lean, not a pacifist.** It builds housing and commerce harder than
    anyone and keeps a smaller army — but it recruits, it expands, and it goes to war. It no
    longer refuses to attack another realm at all.
  - **Honorable plays exactly as Balanced does.** Honour turned out to be the wrong kind of trait
    for a war engine: refusing to starve a city out, or to attack a realm somebody else already
    had by the throat, is a question of **who a realm will deal with** rather than how it fights.
    It besieges like everyone else now. The rules for it — `dogpiles`, `attacksRealms`,
    `bullyFloorPermille` — stay wired, tested and permissive, so **diplomacy** can turn them back
    on for the realms they belong to.

- **A realm gets its first field army as soon as it has two units.** The caution about founding a
  stack now applies to the second one and after. A Defensive realm previously held three units at
  home before it would field anything, needed a fourth before there was a surplus and a seventh
  before that surplus was worth founding a stack with — and spent its first six years holding the
  five tiles it started on, unable to claim an acre or take a village.

### Fixed

- **Consolidation no longer starves the war.** Every conquest opens a fresh ring of unclaimed
  ground around the city just taken, so a realm where *every* idle army consolidated never ran out
  of ground to consolidate and never fought again. It also inverted the difficulty ladder outright
  — a King fielded six armies and had six of them filling in fields while a Recruit's single army
  got on with the war. One army does it; the rest campaign.

### Known limits

- **The AI still cannot cross water.** Scandinavia, Ireland, Cyprus and North Africa survive every
  campaign, and Britain and Iberia are cut off from each other. Naval, now 0.14.0.
- Nothing here has been verified in a browser. There is no browser in this environment, so the
  fog overlay in particular is written from the canvas outwards and unconfirmed by eye.

### Measured

A century at each rung, from the same seed:

| | Recruit | Knight | King |
|---|---:|---:|---:|
| Realms alive at 100 years | 11 | 9 | 8 |
| Independent cities left | 17 | 14 | 12 |
| Tiles held by the realms | 940 | 994 | 1,081 |
| Battles fought | 44 | 136 | **484** |

King no longer settles down at all — cities were still changing hands in the last decade of the
century. Knight and Recruit reach a balance of power after twenty to thirty years, which is what
the ladder should do.

---

## [0.12.0] — 2026-08-03

**Recruiting draws people, and the twelve rival realms play.** Five difficulties, five
personalities, and an economy, a war and a frontier for every one of them.

### Added

- **Recruiting a unit consumes population** equal to its `size`, paid when the order is placed —
  100 people for a Light Infantry, 40 for cavalry. Never returned; the settlement does not get
  them back when the unit dies or disbands. Cancelling an order that has not finished *does*
  return them, the same bargain the treasury already gets. Ships draw nobody: crew size was never
  specified for them, and that stays **[OPEN]**.
  - A settlement can never be recruited below **100 people**, the floor debt and siege stop at.
  - The recruit panel shows what each unit costs in people and how many the settlement can spare,
    and refuses with a reason rather than a greyed-out square.
  - One Light Infantry is **twenty months of a bare Village's entire growth**, permanently. Flat
    growth never earns it back, which is the whole weight of the decision.

- **The AI** — `src/sim/ai.ts`, tuned entirely from `data/ai.json`. It runs once a month per
  realm and plays **through the same functions the player's UI calls**: `queueBuilding`,
  `queueUnit`, `mobilise`, `orderMove`, `beginSiege`. There is no back door, so a rule that binds
  the player binds the rivals.
  - **Builds** by personality weight per building line, and will decline to spend and save up
    instead when the thing it most wants is within its difficulty's patience horizon. Without
    that an AI buys palisades forever and never becomes a Town.
  - **Develops one tile a month**, realm-wide, choosing farm, mine or sawmill by what the ground
    actually yields.
  - **Recruits** within its income and its people, and **musters** garrison surpluses into armies.
  - **Campaigns** on **one objective for the whole realm**, not one per army — no single army it
    may raise can take a defended city alone.
  - **Besieges** what it cannot storm, and **marches to relieve** its own invested settlements.

- **Five difficulties** — Recruit, Squire, Knight, Baron, King. One setting for every rival,
  chosen on the start screen and kept in the save. They vary income, the odds a realm wants
  before committing, how many armies it fields and how big, how often it wastes a month, how far
  ahead it saves, whether it relieves its own sieges and whether it develops its land.
  - **Knight is the honest rung: no handicap and no assistance, the player's own economy
    exactly.** Below it the AI is crippled, above it subsidised, and the subsidy multiplies gross
    income before wages, so a hard opponent is richer rather than immune to its own payroll.

- **Five personalities** — Ambitious, Defensive, Balanced, Peaceful, Honorable. One per realm,
  fixed for the campaign, rolled from the campaign seed so the same seed always meets the same
  Europe. `data/factions.json` accepts an optional `personality` per faction; none is set yet,
  because deciding that the Golden Horde is Ambitious is a design call — **[OPEN]**.
  - **Peaceful** never starts a war with another realm. It settles unclaimed ground and defends
    what it holds, which is what stops "peaceful" meaning "inert".
  - **Honorable** storms walls rather than starving a city out, never piles onto a realm somebody
    else already has a settlement of under siege, and will not attack one worth under 40% of
    itself. It is the only character whose principles cost it something.
  - **Ambitious** ranges twelve tiles beyond its border, expands hardest and finishes off anything
    already bleeding; **Defensive** builds walls, holds three units in every settlement and will
    not campaign more than four tiles from home.

- **Balance panel: an "Every realm" table** — cities, units, soldiers, gold and net income for
  every faction, with its personality and difficulty. Extinguished realms are struck through.

- **Difficulty on the start screen**, with the blurb for the selected rung, and named again under
  Menu → Options.

### Changed

- **Save format v5 → v6.** Factions carry an `ai` profile. A v5 campaign was played against realms
  that did nothing; on load they wake up at **Knight**, so loading never silently makes a campaign
  harder or easier, and their personalities roll from the seed they would have had.
- `MIN_POPULATION` moved from `tick.ts` to `types.ts` — it is now the floor for two separate
  rules, debt and the levy, and belongs with the other simulation constants.

### Fixed

- **The AI's estimate of what a defender is worth is now measured against the resolver rather
  than reasoned about.** Two guesses came first and each broke the campaign in its own direction.
  Reading the ground as a flat "1 + advantage" made it suicidal — a ruined realm recruited one
  Light Infantry, marched it at a village held by one Light Infantry, lost it to the last man, and
  did it again every eight months for a century. Reading it as the damage formula's ratio,
  "(1 + advantage) / (1 − advantage)", made it inert: it priced a walled city at nineteen times
  its garrison, and no realm ever attacked another.

  Measured on real battles across the whole range of defender's advantage, an attacker needs
  **1.25 to 1 on level ground, rising to 3.5 to 1 at the 90% ceiling** — very nearly a straight
  line, and nothing like either guess. `ai.test.ts` re-measures it and fails if the combat rules
  ever drift away from it.
- **Reach is measured from a realm's borders, not from where an army stands.** Measured from the
  army, every frontier on the map set inside fifteen years: armies with nothing in sight walked
  home, and home was never near anything new.
- **Idle armies no longer all pile onto one settlement.** Sending every one of them to the biggest
  garrison put each realm's entire strength on a single tile — and a city with a realm's whole
  army parked on it is a city no neighbour will ever attack. Understrength stacks still go to the
  muster point to fill up; full ones stay where they are.
- **A realm no longer recruits itself into ruin.** It wants the army it can actually field plus
  the garrison it means to keep, and never levies a settlement below **the population that earned
  it its current tier** — a Town was allowed to become a Town at 2,000 people, so it is never
  levied below 2,000. Without that a King-difficulty realm stripped five Towns to seven hundred
  people between them.
- **An honourable realm no longer besieges by accident.** Arriving at a wall it cannot storm, it
  now waits for the rest of the army instead of investing the place.

### Known limits

- **The AI cannot cross water.** Every settlement it can never reach is in Scandinavia, Ireland,
  Cyprus or across Gibraltar, so a dozen independent cities survive any campaign, and Britain and
  Iberia are cut off from each other. That is the naval phase (0.13.0), not an AI limitation.
- **Two large realms correctly decline to attack each other**, so a century-long campaign settles
  into a balance of power that only the player breaks. Whether that is the right shape, or wants
  something to unfreeze it, is logged in `docs/OPEN-QUESTIONS.md`.
- Nothing here has been verified in a browser. There is no browser in this environment.

---

## [0.11.0] — 2026-08-03

**Population growth is a flat number of people a month.** No percentages, no compounding, no
runaway. Owner-approved figures.

### Changed

- **Growth is now whole people per month**, summed from flat terms:

  | Source | People / month |
  |---|---:|
  | Base | +2 |
  | Per tier | +3 each — Village +3 … Capitol +12 |
  | Wooden Houses / Stone Houses / Villas / Manors | +10 / +15 / +25 / +40 |
  | Town Hall / City Hall / Palace | +8 / +12 / +20 |
  | Treasury, by decade of wealth | +5 / +10 / +15 |

  Housing and halls accumulate. Debt costs exactly what wealth gains: −5 / −10 / −15.
- **A siege starves a settlement by tier** — 10 / 25 / 50 / 100 people a month — replacing the
  old 1%. Roughly what a well-built settlement of that size gains, so a siege undoes a
  generation of building.
- **Population is stored as whole people.** `populationMilli` is gone: the fixed-point field
  existed only because a compounding percentage needed sub-person precision.
- Save format **v4 → v5**, with a migration that divides the old thousandths back to people.
- `monthsToNextTier` is now exact division rather than a compounding loop, and the balance
  panel's growth column shows people rather than a rate, still split into its terms.

### Why

Measured on the real simulation, the old model was unbounded at any rate above zero. A
do-nothing village reached **531 trillion people in a century**: the rate flattened at 3.2% a
month, as designed, and then simply kept doubling every 22 months. Tapering `r` cannot fix
`pop × (1 + r)`; only changing the shape can.

Three things came with the change:

- **The numbers are comparable.** "+10 people a month" sits beside "+10 gold a month" and means
  something. A percentage means nothing without knowing the treasury, the tier, and how long you
  intend to sit there.
- **The exponential comes from conquest**, which is where victory already lives. Each city taken
  adds its own trickle; a realm grows by taking more of them, not by waiting.
- **Cities end up historically plausible** — a great capital reaches around 100,000 people over
  a long campaign, against a real Paris of roughly 200,000 in 1350.

### Measured

| | before | after |
|---|---|---|
| A century of doing nothing | 531 trillion people | **12,190 people, 108k gold** |
| Village, nothing built | 0.2%/mo → ~35 years to Town | +5/mo → 16.7 years |
| Village + Wooden Houses | 1.2%/mo → ~5 years | **+15/mo → 5.6 years** |
| Town + housing + hall, 20k banked | — | +46/mo → 5.5 years to City |
| City + housing + hall, 100k banked | — | +91/mo → 4.6 years to Capitol |
| Capitol, fully built, 1M banked | 7.0%/mo, doubling every 11 months | +159/mo — about 1,900 a year |

Wooden Houses is still the single biggest decision in an opening: it triples what a Village
gains, for 120 gold.

### Still open

**Does recruiting consume population?** It matters much more now — 100 soldiers is twenty months
of a Village's entire output, permanently, with no compounding to earn it back.

## [0.10.1] — 2026-08-03

Quality of life, all at the owner's request. No rules changed.

### Added

- **Full screen**, as an icon beside Fit in the bottom bar and as a switch in the menu's
  Options. It follows the document rather than the button, so the icon cannot claim a state the
  browser is not in — leaving with Escape updates it too.
- **The map pans ten tiles past every edge.** The bars and the settlement panel sit over the
  map, so a coastal city at the edge used to be permanently underneath them with no way to shift
  it. Anything on the map can now be dragged into open space.
- **CHEAT, and it must not ship:** a hidden **maximum speed** — a century of campaign in about
  two and a half minutes — unlocked by clicking **Pause three times, then 10× three times**.
  Session-only, never written to a save, every piece commented `CHEAT — remove before release`,
  and logged at the top of `docs/OWED.md`.

### Changed

- **Saves is now Menu**, holding save, load and options, with the version at the foot of it.
  The version chip is gone from the top bar.
- **Neither bar shuffles any more.** Everything whose text changes as the campaign runs — the
  date, the season, the treasury, the tile readout — now has a width of its own. "1 September
  1350" is wider than "1 May 1350", and the difference used to shove every neighbouring control
  sideways once a month, every month.
- **The build grid is three to a row**, with smaller squares and tighter margins.
- **A square carries a picture and a name and nothing else.** Costs and durations are gone from
  it; every number lives in the detail box, which is what makes the squares small enough to fit
  three across.
- **The detail box is a panel of its own, beside the settlement's**, rather than a window over
  it — so the numbers and the city they belong to can be read at the same time. Closing the
  settlement, or clicking anywhere else, closes both. Only one can ever be open.

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
