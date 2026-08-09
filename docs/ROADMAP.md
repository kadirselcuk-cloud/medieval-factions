# Roadmap

Approved by the owner after the design interviews. Every phase ends with a running localhost
build, a version bump and a `CHANGELOG.md` entry.

Outstanding commitments and slipped work are tracked separately in [OWED.md](OWED.md).

---

## Phases

| Ver | Phase | Deliverable | State |
|---|---|---|---|
| 0.1.0 | Foundation & map | Europe renders from data; pan, zoom, hover | ✅ shipped |
| 0.2.0 | The clock | Deterministic tick engine, speeds, calendar, seasons, auto-pause | ✅ shipped |
| 0.3.0 | World state | 14 factions, territory, ownership, selection panel | ⚠️ shipped without saves |
| 0.4.0 | Cities & production | Settlement upgrades, buildings, tile improvements, **save/load** | ✅ shipped without recruitment |
| 0.5.0 | Economy & realm UI | Fishery line, wood scarcity, tabbed city panel, cities/armies/navies rosters | ✅ shipped |
| 0.6.x | Debt & terrain | Negative treasuries, desertion, per-terrain tile yields, map revisions | ✅ shipped |
| 0.7.x | Armies & movement | Army entities, city defenders, the starting unit, A* over terrain cost, territory claimed by presence, seasonal penalties, visible marching orders | ✅ shipped without the balance debug panel |
| 0.8.0 | Settlement UI & growth gates | Square-tile build grid with detail windows, art manifest, Navy tab, population requirements for expanding a settlement | ✅ shipped |
| 0.9.0 | Combat & conquest | Auto-resolve per the owner's algorithm, watchable battle viewer, city capture, victory | ✅ shipped |
| 0.10.0 | Siege & the fight for a city | Ranged accuracy, sieges, the 5 × 5 relief rule, per-formation ground | ✅ shipped |
| 0.10.1 | Quality of life | Menu, stable bars, map overscroll, full screen, three-across build grid | ✅ shipped |
| 0.11.0 | Flat population | Growth becomes whole people per month; the runaway is gone | ✅ shipped |
| 0.12.0 | Manpower & AI | Recruiting draws people; the 12 rivals play — economy, expansion, war, five difficulties, five personalities | ✅ shipped |
| 0.13.0 | Fog of war & the shape of a realm | Line of sight; rivals consolidate their borders instead of running corridors; every defence bonus halved; personalities brought close together | ✅ shipped |
| 0.14.0 | The manpower ceiling & a map that remembers | A realm may keep a fifth of its people under arms, so gold stops deciding army size; fog gains a third state, and discovered ground is never unlearned | ✅ shipped |
| 0.15.0 | Land distance, sight, and watching the end | The AI measures reach by walking distance instead of straight lines, so it stops chasing cities across water; sight becomes a diamond; a defeated player keeps watching with the fog lifted | ✅ shipped |
| 0.16.0 | A medieval pace, and armies with jobs | Foot crosses a tile every two months and horse one a month; rival realms detach raiders, border guards and claimers; the AI develops conquered ground far faster | ✅ shipped |
| 0.17.0 | Total war | No realm has a reach limit; personality becomes raid/guard odds; territory changes march speed; the Golden Horde is authored Ambitious | ✅ shipped |
| 0.18.0 | Naval | Four ship types, transports, embarkation, blockade and battle at sea; the AI mounts amphibious expeditions — Scandinavia, Ireland, Cyprus and Africa are reachable at last | ✅ shipped |
| 0.19.0 | The treasury as the limit | Income halved; growth reads net monthly income instead of the treasury; no ceiling on an army but what it costs to pay for | ✅ shipped |
| 0.20.0 | Identity & polish | Per-faction unit names, faction bonuses, 10 elite units, the owner's real art, balance pass | |
| 1.0.0 | Release | Capacitor wrap for Android/iOS, ad and premium hooks wired but inert, phone performance pass | |
| 2.0.0 | Phase B | Tactical battle map — regiment-level units, move/attack/hold orders | |

Version numbers ran ahead of the phase plan during the 0.6.x economy work, so the phases were
renumbered rather than the versions rewound. The order is unchanged.

**Identity & polish moved from 0.19.0 to 0.20.0.** The owner called for an economy redesign instead
— income halved, growth measured from net monthly income rather than the treasury, and no ceiling on
an army but what a realm can pay for. It took the version because it is a new gameplay system and
because it changes the pace of every campaign; identity work is untouched and simply follows it.

Recruitment shipped in 0.5.0 but had nowhere to go until armies landed in 0.7.0 — units with
nowhere to stand are inventory, not gameplay.

Fog of war was not planned as a phase either; the owner asked for it, along with halving every
defence bonus so that attacking is a realistic thing to do, and consolidation — realms that hold a
country rather than a corridor across the map.

Naval moved up the priority list without moving in the table. Building the AI showed that
**every settlement no realm can reach is across water** — a century-long campaign settled down
with a dozen independent cities in Scandinavia, Ireland, Cyprus and North Africa that nobody could
touch, and Iberia and Britain each cut off from the other. That was a map problem the naval phase
fixed, not an AI one.

It cost far less than its position in the table suggested, because of one decision: **a ship is a
unit** — crew as `size`, HP and damage per crewman. Naval combat therefore reuses the auto-resolve
built in 0.9.0 outright, and fleets fall out of the manpower, upkeep and desertion rules that were
already written. The phase is a movement system and an AI behaviour, not a second game.

Flat population was not planned either. It became a phase once 0.8.3's balance panel measured
the compounding curve and found it unbounded at any rate above zero — half a trillion people in
a village, in a century, from doing nothing. No amount of tuning fixes a shape.

Sieges were not planned as a phase. They became one the moment 0.9.0 measured a fully walled
Capitol as untakeable by any army the rules allow — a fortified realm could not be conquered,
and total conquest is the only victory condition there is.

Phase B plugs into the battle prompt built in 0.9.0. It is deliberately the last thing built:
it is the largest technical risk in the project and the strategic layer must be finished first.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript, strict | A simulation this size is unmaintainable without it |
| Build | Vite | Instant localhost + HMR |
| Map | Canvas 2D, layered | 2,450 tiles — WebGL is unjustified complexity |
| UI | React | Panels and dialogs are miserable in canvas |
| Simulation | Pure TS module, zero DOM | Testable, serialisable, movable to a worker later |
| Validation | Zod | Balance tables are hand-edited; typos must fail at boot |
| Saves | IndexedDB + JSON export | Offline, and portable to the mobile build |
| Tests | Vitest | Determinism is the thing under test |
| Mobile | Capacitor, at 1.0.0 | Wraps the Vite build; handles the lifecycle pause |

**The rule everything follows from:** the simulation is a pure function over integer state.
Seeded RNG, integer tick counter, fixed-point money. No `Date.now()`, no floats in simulation
state, no React state owning simulation data. This is what makes save/load correct, 10×
speed safe and battles replayable — and it cannot be retrofitted.
