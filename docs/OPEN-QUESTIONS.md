# Open Questions

**Never guess an answer from this list — ask the owner.** When one is resolved, move it into
[DESIGN.md](DESIGN.md), [MECHANICS.md](MECHANICS.md) or [CONTENT.md](CONTENT.md) and delete it here.

`OPEN` — needs the owner. `PROPOSED` — Claude has a default; needs approval.

Nothing here blocks starting the build. Each item is due before the phase that needs it.

---

## The AI — shipped in 0.12.0

The difficulties and personalities are the owner's. Everything under them is **[GEN]** and lives
in [`data/ai.json`](../data/ai.json), so retuning any of it is a data change.

- **Which realm has which personality.** — `OPEN`. Rolled from the campaign seed today, because
  deciding that the Golden Horde is Ambitious and Byzantium Defensive is a design call, not one to
  invent. `data/factions.json` already accepts an optional `personality` field per faction; filling
  it in is a data-only change and would make the roster read like a setting rather than a shuffle.
- **Every AI tuning number.** — `PROPOSED`, **[GEN]**. Income multipliers, odds, army sizes,
  reach, build weights, levy floors, unit preferences. The whole table is in
  [MECHANICS.md](MECHANICS.md) §8 for approval or retuning.
- **Is Knight the right anchor?** — `PROPOSED`. Knight gives the AI **no economic handicap at
  all**, so it is the rung where the game is honest and the four others bend around it. Named
  after the middle of the five titles the owner gave, which put the anchor in the middle by
  accident rather than by decision.
- ~~**Peaceful and Honorable as distinct war behaviours.**~~ — **revised in 0.13.0 by the owner.**
  The five personalities now lean off a common centre rather than being five games: Peaceful is an
  economy lean that still recruits, expands and fights, and Honorable is mechanically identical to
  Balanced because honour belongs to **diplomacy**, not to how a realm fights. The rules for it
  (`dogpiles`, `attacksRealms`, `bullyFloorPermille`) are still wired and permissive.
- **Where honour lands in diplomacy.** — `OPEN`, and due with that phase. The three traits above
  are the seam; what an honourable realm actually refuses to *agree to* was never specified.
- **Consolidation radius.** — `PROPOSED`, **[GEN]**. A realm fills unclaimed ground within **3
  tiles** of each settlement before campaigning, and only its weakest army does it. Both numbers
  decide how blobby the map looks and how soon wars start.
- **Fog of war sight.** — the figures are owner-authored (3 tiles, +1 per tier). **[GEN]**: that a
  field army sees for itself, and that there is no "explored" memory of ground once seen.
- **Should the player be told a rival's personality?** — `OPEN`. It is visible in the balance
  panel, which is a developer tool. Learning it through play — or through diplomacy, later — is
  probably the intent, but nothing says so.
- **Should difficulty be changeable mid-campaign?** — `PROPOSED`: no. It is written into every
  rival at creation and kept in the save, so a campaign is always played against the opponents it
  was begun against.
- ~~**Can the AI reach every settlement?**~~ — **no, and it is not an AI problem.** Scandinavia,
  Ireland, Cyprus and North Africa are unreachable by land, so a dozen independent cities survive
  any campaign and Iberia is cut off from Britain. The naval phase (0.14.0) fixes it.
- **Do rival realms deserve a smarter endgame?** — `OPEN`. Two large realms with walls and
  garrisons correctly decline to attack each other, so a long campaign settles into a balance of
  power that only the player breaks. That may be the right shape for a game about being the one
  who breaks it, or it may want something — attrition, ambition, a claim system — to unfreeze it.

## Combat — shipped in 0.9.0, and now measured

The algorithm is the owner's. The constants under it were never approved, and running them
produces three results that want a decision. All figures are from real battles on plains, in
summer, fought by the shipped resolver.

- **The defender still wins mirror matches.** — `PROPOSED`, and **eased in 0.13.0**: the owner
  took the bluntest of the levers below and halved every defence bonus in the game, so plains are
  worth 5% rather than 10%. An attacker now needs **1.25 to 1 on level ground** rather than 1.5,
  measured across the whole range in `ai.test.ts`. The 1.25 floor is structural and remains:
  damage scales with a formation's *current* soldiers, so falling behind accelerates, and moving
  and striking are separate actions, so whoever closes gives up the first blow. The two levers
  left are basing damage on *starting* strength, or letting a formation that closes into contact
  strike in the same activation (which is what "charge" arguably means).
- ~~**Ranged dominates the 50-tile field.**~~ — **answered in 0.10.0** by owner-authored
  accuracy. An Archer no longer wins for free: one Light Infantry still loses to one Archer but
  now costs it 10 men over 20 turns instead of nothing over 10, **two** Light Infantry beat it
  outright, and two Light Cavalry now break two Skirmishers for 29 casualties against 160.
  Three Archers against three Sword Infantry runs to turn 42 of 48 — genuinely close. Remaining:
  a lone Light Cavalry still dies to a lone Archer without landing a blow, which is 40 tiles of
  open ground under arrows and arguably correct.
- ~~**Fortified settlements cannot be taken.**~~ — **answered in 0.10.0** by siege, and again in
  0.13.0 by halving the walls. A Citadel Capitol used to reach the 90% ceiling and be unstormable
  by any army the rules allow; it now tops out at **55%**, and a large enough army can go over the
  walls — four Heavy Cavalry are still thrown back where twelve used to be. Walls buy time now
  rather than immunity, and siege is the cheap way in rather than the only one.

Two things that work as intended: **spears wreck cavalry** (two Light Cavalry lose 80 men to
two Spear Infantry and kill 8), and the **3× rout rule** fires cleanly in larger battles.

- **Battle speeds.** — `PROPOSED`. See [CONTENT.md](CONTENT.md) §3. Chosen for a 10-tile field
  and used on a 50-tile one. Less urgent now that accuracy has taken the edge off ranged, but
  still the lever if infantry feels like it spends the battle walking.
- **Do defeated armies leave survivors?** — `OPEN`. The losing army is currently destroyed
  outright; routing costs fewer men but still leaves nothing on the map. A retreat to an
  adjacent tile would be a mechanic of its own — which tile, and what if it is blocked? This now
  matters more: an army that marched to the relief of a city is destroyed when the city falls.
- **Does the garrison fight?** — `PROPOSED`. It does, currently. Recruited units standing in a
  city being stormed defend it, and their survivors go back behind the walls if it holds.
- **Siege starvation rate.** — `PROPOSED`, **[GEN]**. Flat, by tier: 10 / 25 / 50 / 100 people
  a month — roughly what a well-built settlement of that size gains, so a siege undoes a
  generation of building. The owner chose starvation but not its rate.
- **Where is the line between surrender and sortie?** — `PROPOSED`, **[GEN]**. Currently the
  same 3-to-1 the battlefield uses for a rout: outnumbered by more than that, a starved-out
  settlement opens its gates rather than throwing its defenders away.
- **Can a besieger be starved in turn?** — `OPEN`. An army sitting outside a city for a year
  pays upkeep and nothing else happens to it. Attrition, foraging or supply were never specified.
- **Should a siege stop reinforcement?** — `OPEN`. A besieged settlement cannot finish
  recruitment, but nothing stops a relieving army marching in and standing on the city tile.

## Manpower — shipped in 0.14.0

- **A realm below its own ceiling.** — `OPEN`, and answered provisionally so 0.14.0 could ship.
  Starvation under siege, debt, or losing half a realm to conquest can all leave more men standing
  than the 20% rule allows. **Today nothing happens**: the ceiling gates recruitment and never
  disbands anything, so a shrunken realm simply raises no more men until it recovers or conquers.
  The alternative — units deserting the month the ceiling drops below them — is a real rule with
  real weight, and losing an army because a city fell would be the harshest consequence in the
  game. Not invented. Owner to decide.
- **Is 20% the right number?** — `PROPOSED`, owner chose to judge it by playing. A 1,000-person
  Village supports **two Light Infantry** and the third is eighty-odd months of growth away, so
  the opening is tight and the first conquest matters enormously. One constant,
  `MANPOWER_SHARE_PERMILLE` in `src/sim/manpower.ts`, and no code depends on its value.

## Due before naval (build phase 0.15.0)

- **Ship statistics.** — `OPEN`. Only cost, upkeep and building requirement were given. Need
  HP, damage, crew size, build time, and strategic speed for all four ship types.
- **Transport capacity.** — `OPEN`. How many land units does one Transport carry?
- **Naval combat.** — `OPEN`. Do fleets fight using the same auto-resolve algorithm? Can a
  fleet intercept a transport? What happens to the cargo army if the transport dies?
- **Embark / disembark.** — `OPEN`. Can an army board only at a Dock, or from any coastal
  tile it owns?
- **Are Transport and Flagship also renamed per faction**, or only Light and Heavy ships?

## Economy — shipped, but these were never answered

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
- ~~**Is population capped, and can it fall?**~~ — **answered in 0.11.0**, by removing the
  compounding rather than capping it. Growth is now a flat number of people a month, so
  population is bounded by time × rate and cannot run away at any setting. It falls under debt
  and under siege. A century of doing nothing now ends at **12,190 people** rather than 531
  trillion. See [MECHANICS.md](MECHANICS.md) §5.
- ~~**Does recruitment consume population?**~~ — **answered in 0.12.0: yes.** A unit costs its
  whole `size` in people, paid when the order is placed and never returned. One Light Infantry is
  twenty months of a bare Village's entire growth. See [MECHANICS.md](MECHANICS.md) §5.
- **"Highest city level" for improvement upgrades.** — `OPEN`. The faction's best settlement
  anywhere, or the level of the city that owns that tile?
- **Do improvements cost resources to build**, and how much? Only durations are specified.
- **Can a settlement be downgraded, damaged or sacked?** — `OPEN`. Relevant once cities change
  hands.
- **Non-military building effects.** — `PROPOSED`, and now concrete. Housing and halls give
  **whole people per month** (10 / 15 / 25 / 40 and 8 / 12 / 20), commerce gives gold. Costs are
  still **[GEN]**. Approve or retune — one number per building, all directly comparable.
- **Skirmisher requirement.** — `OPEN`. Every other Town-tier unit names a military building;
  the Skirmisher lists none. Village-tier, or does it need one?
- **Sawmill.** — `OPEN`. Referenced in every terrain row but not listed in any settlement
  tier. Which tier unlocks it, what does it cost, and how much wood per month?
- **Mines.** — `OPEN`. Terrain rows give mine modifiers, but the map's resource nodes already
  have fixed yields. Are mines a *building* placed on a resource node, and the terrain
  modifier scales that node's yield?
- **Fortification bonuses.** — `PROPOSED`. See [CONTENT.md](CONTENT.md) §2.

## Raised by armies (0.7.0)

- ~~**Can an army besiege or blockade?**~~ — **answered in 0.10.0**. It can do both: a siege
  cuts the settlement's income, stalls its queues and starves it, and ends in a sortie or a
  surrender. See [MECHANICS.md](MECHANICS.md) §6.
- **Can a settlement be recaptured immediately?** — `OPEN`. A city that changes hands has its
  new owner's derived defenders the instant it falls, so the loser cannot walk back in. Whether
  a freshly taken city should be weaker for a while was never specified.
- **Should defenders grow with population**, or is a Village's single unit the same whether it
  holds 1,000 people or 40,000?
- **Can an army be split?** — `OPEN`. It can merge and stand down, but there is no way to
  detach part of a stack in the field.
- **What happens to an army when the settlement behind it falls?** — `OPEN`, and due with
  conquest.
- **Do armies reduce the ground they cross?** — `OPEN`. Foraging, attrition in desert or
  winter, or nothing at all.

## Roads — no phase yet

- **Road tiers on Desert / Tundra / Mountain.** — `OPEN`. Plains and Steppe allow
  path/paved/stone; Forest allows path/paved. The other three just say "Roads".
- **What roads do.** — `OPEN`. A movement bonus presumably, but no numbers. Cost per tile?
- **Strategic speeds.** — `PROPOSED`. See [CONTENT.md](CONTENT.md) §3. Now live, and felt:
  infantry crosses 4 tiles a month, 2.4 in winter.

## Raised by the 0.6.x economy work

- **Do fleets desert too?** — `OPEN`. The owner specified that *armies* have a 10% monthly
  desertion chance while in debt. Ships cost upkeep but are currently immune.
- **Ship statistics.** — `OPEN`, partly. Costs, wood, and upkeep are owner-authored; HP,
  damage, crew size and build times are **[GEN]** (6 / 8 / 12 / 18 months).
- **Is there a floor on debt?** — `OPEN`. A realm can now sink arbitrarily deep. The
  population floor of 100 per settlement caps the bleeding, but nothing stops the number
  itself running away.
- ~~**Do units draw from a settlement's population?**~~ — **answered in 0.12.0: yes**, the same
  question as the one above it. **Ships still draw nobody** — crew size was never specified for
  them, and that half stays `OPEN`.

## Minor, any time

- **Day phase order.** — `PROPOSED`. Owner listed `1 Night, 2 Morning, 3 Noon, 4 Evening`, so
  a day begins at night. Intended, or off by one?
- **Do day phases have mechanical effect** in v1, or are they a clock display only?
- **Autosave rotation depth.** — `PROPOSED`. Default 5.
- **Floor device.** — `OPEN`. Oldest phone that must hold a smooth frame rate. Matters mainly
  for the Phase B tactical battle map.
- **Elite units.** — the owner said these would be designed together, per faction.
