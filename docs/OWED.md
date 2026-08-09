# Owed

Commitments made to the owner that are not yet delivered. Distinct from
[OPEN-QUESTIONS.md](OPEN-QUESTIONS.md), which tracks what Claude needs *from* the owner.

Delete an entry when it ships, and say so in `CHANGELOG.md`.

---

## Debts — promised for a phase that has already shipped

### 0. **REMOVE BEFORE RELEASE — two testing cheats**

**Maximum speed.** `MAX_SPEED` in [src/sim/game.ts](../src/sim/game.ts), `CHEAT_SEQUENCE` in
[src/ui/BottomBar.tsx](../src/ui/BottomBar.tsx), and the note in the game menu's Options.
Added in 0.10.1 at the owner's request, for judging balance by eye instead of by projection: it
runs a century in about two and a half minutes. Unlocked by clicking **Pause three times, then
10× three times**, and hidden until then.

**Fog off.** `fogOff` / `fogRevealed` / `toggleFog` in [src/sim/game.ts](../src/sim/game.ts),
`REVEAL_SEQUENCE` and the `FOG` button in [src/ui/BottomBar.tsx](../src/ui/BottomBar.tsx), and the
null-mask branch on `<MapView>` in [src/ui/App.tsx](../src/ui/App.tsx). Added in 0.14.1 at the
owner's request. Unlocked by clicking **Pause five times, then 1× five times**; a **FOG** button
then appears to put the fog back, because the useful thing is flipping between the two rather than
seeing the map once.

Both are **session-only** — deliberately not part of a save — and neither touches the simulation.
Every piece of both is commented `CHEAT — remove before release`, so `grep -rn "CHEAT" src/`
finds the lot. **Neither must ship in 1.0.0.**

### 1. Nothing has been visually verified
There is no browser automation in this environment, so **Claude has never seen the game
render.** Everything shipped so far is verified by typecheck, unit tests and a production
build only. Layout, colour and readability are unconfirmed.

Owed: either the owner confirms each build visually, or a screenshot-capable check gets set up.
Do not describe the game's appearance as confirmed until one of those happens.

There is no browser in this environment at all — no Playwright, no screenshot tool, no headless
Chrome. The only web tool available fetches a public URL and converts it to markdown, which
returns an empty `<div id="root">` for a Vite app and cannot reach localhost regardless. Every
layout change is therefore written from the CSS outwards and confirmed by the owner.

---

## Delivered

- **Save / load** — shipped in 0.4.0. IndexedDB, named slots, 5 monthly + 3 yearly autosaves,
  JSON export/import, schema versioning with a migration seam, and tests proving both an exact
  round trip and that a reloaded campaign advances identically.
- **Settlement upgrades** — shipped in 0.4.0, no longer inert.
- **Balance debug panel** — shipped in 0.8.3, owed since 0.4.0. Income and growth split into
  the terms that produce them, time-to-afford, months-to-next-gate, and projections that run
  the real simulation forward on a copy. Any faction can be inspected, not only the player's.
- **Recruitment** — shipped in 0.5.0, and given somewhere to go in 0.7.0.
- **The starting unit** — shipped in 0.7.0. Every playable faction opens with one Light
  Infantry in its capital's garrison, deferred four times before it had an army to join.
- **AI opponents** — shipped in 0.12.0, owed since the roadmap was written. All twelve rivals
  build, develop their land, recruit, muster, campaign, besiege and relieve, at five difficulties
  and with five personalities. They play through the same functions the player's UI calls.
- **Naval** — shipped in 0.18.0, and with it the promise that the Britons and Moors could
  eventually leave their landmass. Four ship types with owner-approved statistics, transports,
  embarkation at a Dock and landing on any coast, blockade by adjacency, battle at sea through the
  existing resolver, and rival realms that mount amphibious expeditions of their own.

---

## Generated values awaiting the owner's review

Everything below was invented by Claude because the game could not be built without it. All of
it is tagged **[GEN]** at its definition. None of it is owner-authored truth.

| Value | Where | Status |
|---|---|---|
| Faction colours (14) | `data/factions.json` | placeholder art |
| Skipping water when claiming a capital's 4 tiles | `src/sim/state.ts` | implemented |
| Strategic speeds | `data/units.json` | **owner-specified in 0.16.0** — foot a tile every 2 months, horse a tile a month |
| Army role quotas — `raidStacks`, `guardStacks`, `claimStacks`, `improvementsAtOnce` | `data/ai.json` | **live** — how many specialists each difficulty runs |
| Raid and guard stack sizes, and the raid/guard odds per personality | `data/ai.json` | **live** — the odds themselves; that Peaceful never raids is owner-specified |
| Half a realm's army slots reserved for the field force | `src/sim/ai.ts` | **live** — without it a Knight has hobbies instead of a war |
| A raid targets the **deepest** reachable settlement, at any distance | `src/sim/ai.ts` | **live** |
| Orthogonal-only army movement | `src/sim/movement.ts` | implemented |
| Which unit each building adds to a settlement's defence | `data/units.json` | implemented |
| Battle speeds (tiles/battle turn) | `docs/CONTENT.md` §3 | **live** — the lever if infantry spends the battle walking |
| Fortification bonuses per settlement tier | `docs/CONTENT.md` §2 | **live** — a Citadel Capitol cannot be stormed, only starved |
| Damage formula and its modifiers | `docs/MECHANICS.md` §6 | **live** — measured, see OPEN-QUESTIONS |
| Accuracy as a volley multiplier, not a per-shot roll | `src/data/units.ts` | **live** — the figures themselves are owner-authored |
| Siege starvation, 10/25/50/100 people a month by tier | `src/sim/tick.ts` | **live** |
| Base +2 and +3 per tier in the flat growth sum | `src/sim/tick.ts` | **live** — the building figures are owner-approved |
| Surrender at more than 3-to-1, sortie otherwise | `src/sim/conquest.ts` | **live** |
| Investment means any of the 8 tiles around a settlement | `src/sim/conquest.ts` | **live** |
| Relief range is Chebyshev distance 2, settlements only | `src/sim/conquest.ts` | **live** — the 5 × 5 box is owner-authored |
| 90% cap on the defender's advantage | `src/sim/battle.ts` | **live** |
| Survivors reformed into whole units | `src/sim/battle.ts` | **live** |
| The garrison fights alongside a settlement's defenders | `src/sim/conquest.ts` | **live** |
| A defeated army is destroyed, not retreated | `src/sim/conquest.ts` | **live** |
| Range used as written (50-tile field) | `docs/MECHANICS.md` §6 | **live** — owner-approved field width |
| Advanced Farms / Irrigation yields | `docs/OPEN-QUESTIONS.md` | not yet implemented |
| Season boundaries and modifiers | `docs/MECHANICS.md` §5 | **approved by owner** |
| Halving every defence bonus (the halved figures themselves) | `src/data/terrain.ts`, `data/buildings.json` | **live** — the owner asked for half; where the scale lands is [GEN] |
| Consolidation: radius 3 around each settlement, weakest army only | `src/sim/ai.ts` | **live** — decides how blobby the map is and how soon wars start |
| A field army sees for itself | `src/sim/vision.ts` | **live** — the sight figures themselves are owner-authored |
| Every AI tuning number — income, odds, army sizes, build weights, levy floors | `data/ai.json` | **live** — the five difficulties and five personalities are owner-named |
| Counting units **still in training** against the manpower ceiling | `src/sim/manpower.ts` | **live** — the 20% share itself is owner-authored |
| Nothing is disbanded when a realm falls below its own ceiling | `src/sim/manpower.ts` | **live** — see OPEN-QUESTIONS, owner to decide |
| The 10-tile "known" band radiates from **settlements**, not from every owned tile | `src/sim/vision.ts` | **live** — the 10 tiles themselves are owner-authored |
| The exact black of the unexplored shroud | `src/render/palette.ts` | **live** — the owner asked for black; the ink is mine |
| Which realm gets which personality (rolled from the seed) | `src/sim/state.ts` | **live** — `data/factions.json` accepts an owner-authored `personality` instead |
| Knight as the rung with no handicap either way | `data/ai.json` | **live** — the anchor the other four bend around |
| The AI keeps `garrisonKeep` units by sorted id, not by strength | `src/sim/ai.ts` | **live** |
| Tile yield valued as gold + 3× each material | `src/sim/ai.ts` | **live** — decides which improvement it digs |
| Ship crew, HP and damage | `data/units.json` | **owner-approved in 0.18.0** — the figures are Claude's, the approval is the owner's. First place to reach when naval balance is wrong |
| Ship berths (5) and sea speed (3 for every hull) | `data/units.json` | **owner-specified in 0.18.1** — not [GEN] |
| Crew doubling as a ship's `size`, HP and damage per crewman | `src/data/units.ts` | **live** — the shape that let fleets reuse the land resolver. Owner chose it over per-vessel totals |
| A fleet launches onto the lowest-indexed free sea tile beside the harbour | `src/sim/fleets.ts` | **live** — arbitrary, but fixed, which is what determinism needs |
| Cargo shed in sorted unit id when a Transport is lost | `src/sim/fleets.ts` | **live** — the alternative is a rule about which men a captain saves, and nobody wrote one |
| Lower fleet id is the attacker when two escorted fleets meet | `src/sim/sailing.ts` | **live** — a tie broken on strength or initiative would be a rule nobody has written |
| Winter slows a fleet by the same 40% it slows an army | `src/sim/sailing.ts` | **live** — storms and short days, read as the same rule as mud |
| Winter attrition does **not** touch fleets | `src/sim/tick.ts` | **live** — attrition is about hostile ground, and the sea belongs to nobody |
| One amphibious expedition at a time per realm | `src/sim/navalAi.ts` | **live** — three at once splits an army into three that each land and die |
| The naval plan is re-made once a year, staggered by realm | `src/sim/navalAi.ts` | **live** — `PLANNING_MONTHS`. Landing is still checked monthly; only target-picking is annual |
| The AI wants a full army in berths and 1 escort, and stops at 8 hulls | `src/sim/navalAi.ts` | **live** — `BERTHS_WANTED`, `ESCORTS_WANTED`, `MAX_EXPEDITION_SHIPS` |
| A fleet waits for 6 units before it sails, and a realm needs 3 armies to spare one | `src/sim/navalAi.ts` | **live** — `LANDING_FORCE`, `ARMIES_BEFORE_SAILING`. How willing a realm is to gamble an army on a beach |
| An unsettled landmass outranks distance when picking a target | `src/sim/navalAi.ts` | **live** — `VIRGIN_ISLAND_BONUS`. Without it Ireland was chosen 6 times in 120 years against Novgorod's 173 |
| Splitting takes the **heaviest** formations first | `src/sim/fleets.ts` | **live** — the owner specified that a stack may be split, not which men board |
| The recruiting roll is equal thirds, and rerolls 12 times | `src/sim/ai.ts` | **live** — the three categories are owner-specified; the even split and the reroll bound are mine |
| Founding a field army costs half a full stack; a stack below half strength rallies, within 12 tiles | `src/sim/ai.ts` | **live** — `RALLY_BELOW_FRACTION`, `RALLY_RANGE`. Owner asked for concentration; the thresholds are mine |
| One front per 6 settlements, max 4, at least 8 tiles apart | `src/sim/ai.ts` | **live** — `SETTLEMENTS_PER_FRONT`, `MAX_FRONTS`, `FRONTS_APART`. Decides whether an empire feels like one |
| How many hulls and escorts a realm wants, and the bonus for having no land war left | `src/sim/navalAi.ts` | **live** — `hullsWanted`, `escortsWanted`. The lever if the map fills with navies |
| A diagonal at sea costs √2 of a tile | `src/sim/sailing.ts` | **live** — `DIAGONAL_PERMILLE`. Eight-way sailing is owner-specified; charging the true length for it is mine |
| Defenders count as 1 tile of distance per 100 soldiers when picking a target | `src/sim/ai.ts` | **live** — `DEFENDERS_PER_TILE`. Owner asked for easy targets; the exchange rate is mine |
| Ship rather than march when the walk is 3× the sail and ≥12 tiles | `src/sim/navalAi.ts` | **live** — `SEA_SHORTCUT`. The dial for how sea-dominated the map feels |
| A fleet will not unload within 6 tiles of home, and hunts within 15 | `src/sim/navalAi.ts` | **live** — `HOME_SHORE`, `HUNTING_RANGE` |
| A realm with nothing winnable presses the softest reachable target anyway | `src/sim/ai.ts` | **live** — `desperateObjective`. Owner asked for no stalemates; that a hopeless attack is better than none is mine |
| Loaded fleets are dealt across up to 4 beaches | `src/sim/navalAi.ts` | **live** — `MAX_BEACHES` |
| Hulls (60), escorts (14) and berths (5 armies) a realm wants | `src/sim/navalAi.ts` | **live** — `hullsWanted`, `escortsWanted`, `convoysWanted`. The dial for how naval the world feels |
| A realm with only overseas enemies recruits at 66% | `src/sim/ai.ts` | **live** — `OVERSEAS_ARMY_PERMILLE`. Owner asked for fewer soldiers and more ships; the fraction is mine |
| A forced landing gives the defender the full ground advantage and the attacker no penalty | `src/sim/sailing.ts` | **live** — owner specified the mechanic, not the modifiers |
| Fleets in contact re-fight **monthly** rather than per tick | `src/sim/sailing.ts` | **live** — the owner asked that standoffs end; the cadence is mine |
| One harbour of departure, nearest the target by sea | `src/sim/navalAi.ts` | **live** — spread across every port, hulls arrive two at a time and carry nothing |
| A landed army is its own frontier, but only where its realm holds no settlement | `src/sim/ai.ts` | **live** — without it an expedition stands on its beach until the winter takes it |

---

## Committed for later phases

Tracked in [ROADMAP.md](ROADMAP.md); listed here so nothing quietly disappears.

- Per-faction unit names and the 10 elite units — 0.19.0, to be designed with the owner
- Faction strengths and weaknesses — 0.19.0
- The owner’s 2D art, dropped into `data/art.json` as image paths — 0.19.0
- **Diplomacy**, which is where honour goes. `dogpiles`, `attacksRealms` and `bullyFloorPermille`
  are wired, tested and permissive for all five personalities; the Honorable realm gets its
  character back when there is something to be honourable *about*
- Capacitor mobile wrap, ad and premium-unlock hooks — 1.0.0
- Tactical battle map — 2.0.0

---

## Environment changes made

- **Node upgraded from 14.17.1 to 22.11.0** via `nvm`, with the owner's approval. `nvm4w`
  switches a global symlink, so this changed the default Node for every project on the
  machine. Reversible with `nvm use 14.17.1`.
- **Git:** initialised and pushed to `github.com/kadirselcuk-cloud/medieval-factions`, with a
  GitHub Actions workflow publishing to GitHub Pages.
