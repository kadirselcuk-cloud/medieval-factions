# Open Questions

**Never guess an answer from this list — ask the owner.** When one is resolved, move it into
[DESIGN.md](DESIGN.md), [MECHANICS.md](MECHANICS.md) or [CONTENT.md](CONTENT.md) and delete it here.

`OPEN` — needs the owner. `PROPOSED` — Claude has a default; needs approval.

Nothing here blocks starting the build. Each item is due before the phase that needs it.

---

## Due before combat (build phase 0.6.0)

- **Range → tiles.** — `PROPOSED`. Ranges are 30/40 but the auto-resolve field is 10 tiles
  wide, so the scales must be reconciled or archers always fire from turn 1. Proposal:
  **range ÷ 10 = tiles** (archer 4, skirmisher 3, cavalry archer 3). Confirm or restate.
- **Battle-turn cap outcome.** — `OPEN`. At 48 turns with neither side destroyed and neither
  at a 3× unit advantage, what happens? Draw and both withdraw? Attacker retreats? Higher
  remaining soldier count wins?
- **Damage formula constants.** — `PROPOSED`. See [MECHANICS.md](MECHANICS.md) §6. Approve or tune.
- **Independents garrisons.** — `PROPOSED`. Scaled by tier, e.g. Village 2 units, Town 4,
  City 6, Capitol 8, of tier-appropriate types. Confirm the numbers.
- **Battle speeds.** — `PROPOSED`. See [CONTENT.md](CONTENT.md) §3.

## Due before naval (build phase 0.8.0)

- **Ship statistics.** — `OPEN`. Only cost, upkeep and building requirement were given. Need
  HP, damage, crew size, build time, and strategic speed for all four ship types.
- **Transport capacity.** — `OPEN`. How many land units does one Transport carry?
- **Naval combat.** — `OPEN`. Do fleets fight using the same auto-resolve algorithm? Can a
  fleet intercept a transport? What happens to the cargo army if the transport dies?
- **Embark / disembark.** — `OPEN`. Can an army board only at a Dock, or from any coastal
  tile it owns?
- **Are Transport and Flagship also renamed per faction**, or only Light and Heavy ships?

## Due before economy (build phase 0.4.0)

- **Level 4 mine yields.** — `PROPOSED`. Four improvement levels are confirmed, but only three
  mine levels were given. Proposal continues each pattern: gold 400, silver 200, iron/stone
  node 9, ordinary mine 4 iron + 4 stone. Note a level-4 gold mine in the mountains would pay
  **800 gold/month** from one tile — confirm that is the intended late-game scale.
- **Can an improvement be demolished and replaced?** — `OPEN`. A tile holds one of farm, mine
  or sawmill. Is that choice permanent, or can it be torn down and rebuilt as another type?
- **What do improvements cost to build and upgrade?** — `OPEN`. Only the 12-month base
  duration is known.
- **Capitol housing tier.** — `OPEN`. Housing runs Wooden Houses → Stone Houses → Villas
  (levels 1–3). A Capitol lists Palace and Guildhouse but no housing. Is there a level-4
  housing building, or does a Capitol stay on Villas?
- **Is population capped, and can it fall?** — `OPEN`. Famine, plague, war losses, or sacking
  a captured city. Uncapped compounding growth has no brake.
- **Does recruitment consume population?** — `OPEN`. Light Infantry is 100 soldiers against a
  starting population of 1,000. If units draw from population, that is a real strategic
  constraint; if not, population is purely an income multiplier.
- **"Highest city level" for improvement upgrades.** — `OPEN`. The faction's best settlement
  anywhere, or the level of the city that owns that tile?
- **Do improvements cost resources to build**, and how much? Only durations are specified.
- **Can a settlement be downgraded, damaged or sacked?** — `OPEN`. Relevant once cities change
  hands.
- **Non-military building effects.** — `OPEN`. Wooden/Stone Houses, Villas, Cottage Shops,
  Merchants, Artisans, Guildhouse, Town/City Hall, Palace — costs and what each actually does.
- **Skirmisher requirement.** — `OPEN`. Every other Town-tier unit names a military building;
  the Skirmisher lists none. Village-tier, or does it need one?
- **Sawmill.** — `OPEN`. Referenced in every terrain row but not listed in any settlement
  tier. Which tier unlocks it, what does it cost, and how much wood per month?
- **Mines.** — `OPEN`. Terrain rows give mine modifiers, but the map's resource nodes already
  have fixed yields. Are mines a *building* placed on a resource node, and the terrain
  modifier scales that node's yield?
- **Fortification bonuses.** — `PROPOSED`. See [CONTENT.md](CONTENT.md) §2.

## Due before movement (build phase 0.5.0)

- **Road tiers on Desert / Tundra / Mountain.** — `OPEN`. Plains and Steppe allow
  path/paved/stone; Forest allows path/paved. The other three just say "Roads".
- **What roads do.** — `OPEN`. A movement bonus presumably, but no numbers. Cost per tile?
- **Do enemy armies or borders block movement**, or can armies march through freely?
- **Strategic speeds.** — `PROPOSED`. See [CONTENT.md](CONTENT.md) §3.

## Raised by 0.6.0

- **What happens when a treasury runs dry?** — `OPEN`. Upkeep can exceed income; gold is
  currently clamped at zero and nothing else happens. Should units desert, disband, or should
  settlements grow unruly?
- **Ship statistics.** — `OPEN`, still. Costs and upkeep are owner-authored; HP, damage, crew
  size and build times are **[GEN]** (6 / 8 / 12 / 18 months). Ships also cost no wood at
  present, which sits oddly beside a Dock costing 80.
- **Do units draw from a settlement's population?** — `OPEN`, still, and now visible: a Light
  Infantry unit is 100 soldiers trained out of a 1,000-person village at no demographic cost.
- **Where does a garrison live?** — units currently accumulate in the settlement that trained
  them. Armies in 0.7.0 will need to form from and move between garrisons.
- **The owner's starting unit** — one unit of the lowest type at campaign start. Deferred
  again, to land with armies rather than as an untouchable entry in a garrison.

## Minor, any time

- **Day phase order.** — `PROPOSED`. Owner listed `1 Night, 2 Morning, 3 Noon, 4 Evening`, so
  a day begins at night. Intended, or off by one?
- **Do day phases have mechanical effect** in v1, or are they a clock display only?
- **Autosave rotation depth.** — `PROPOSED`. Default 5.
- **Floor device.** — `OPEN`. Oldest phone that must hold a smooth frame rate. Matters mainly
  for the Phase B tactical battle map.
- **Elite units.** — the owner said these would be designed together, per faction.
