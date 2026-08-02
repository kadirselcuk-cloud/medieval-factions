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
| 0.7.0 | Armies & movement | Army entities, city defenders, the starting unit, A* over terrain cost, territory claimed by presence, seasonal penalties | ✅ shipped without the balance debug panel |
| 0.8.0 | Combat & conquest | Auto-resolve per the owner's algorithm, watchable battle viewer, city capture, victory | next |
| 0.9.0 | AI | The 12 rival factions actually play — economy, expansion, army composition, war | |
| 0.10.0 | Naval | Four ship types, transports, embarkation; unblocks Britons and Moors | |
| 0.11.0 | Identity & polish | Per-faction unit names, faction bonuses, 10 elite units, asset manifest, balance pass | |
| 1.0.0 | Release | Capacitor wrap for Android/iOS, ad and premium hooks wired but inert, phone performance pass | |
| 2.0.0 | Phase B | Tactical battle map — regiment-level units, move/attack/hold orders | |

Version numbers ran ahead of the phase plan during the 0.6.x economy work, so the phases were
renumbered rather than the versions rewound. The order is unchanged.

Recruitment shipped in 0.5.0 but had nowhere to go until armies landed in 0.7.0 — units with
nowhere to stand are inventory, not gameplay.

Phase B plugs into the battle prompt built in 0.8.0. It is deliberately the last thing built:
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
