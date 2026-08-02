# Open Questions

**Never guess an answer from this list — ask the owner.** When one is resolved, move it into
[DESIGN.md](DESIGN.md), [MECHANICS.md](MECHANICS.md) or [CONTENT.md](CONTENT.md) and delete it here.

`OPEN` — needs the owner. `PROPOSED` — Claude has a default; needs approval.

Nothing here blocks starting the build. Each item is due before the phase that needs it.

---

## Combat — shipped in 0.9.0, and now measured

The algorithm is the owner's. The constants under it were never approved, and running them
produces three results that want a decision. All figures are from real battles on plains, in
summer, fought by the shipped resolver.

- **The defender wins mirror matches decisively.** — `PROPOSED`. One Light Infantry attacking
  one Light Infantry on open plains: the **attacker is wiped out for 38 casualties**. A 10%
  terrain edge becomes a 2.6-to-1 kill ratio, for two compounding reasons: damage scales with
  the attacker's *current* soldiers, so falling behind accelerates; and moving and attacking
  are separate actions, so whoever closes gives up the first blow. Levers, in order of bluntness:
  reduce terrain defence, base damage on *starting* strength, or let a formation that closes
  into contact strike in the same activation (which is what "charge" arguably means).
- **Ranged dominates the 50-tile field.** — `PROPOSED`. One Archer beats one Light Infantry
  **without taking a single casualty**; it takes **three** Light Infantry to win, at a cost of
  183 men. A Light Cavalry unit dies to a lone Archer having never landed a blow. This follows
  from the 50-tile field: an archer gets 13 free volleys while infantry crosses 37 tiles. Lever:
  battle speeds — infantry at 3 tiles/turn was set when the field was 10 wide.
- **Fortified settlements cannot be taken.** — `PROPOSED`, and the sharpest of the three. A
  Capitol with a Citadel has **9 free defenders and an 80% defender's advantage**, which means
  attackers deal a fifth of their damage and defenders nearly double. **Ten Heavy Cavalry —
  2,000 gold and 100 iron — lose 400 men and kill 24.** No army in the game can take it, because
  20 units is the cap. Levers: the fortification bonuses (currently +10 / +30 / +40 / +60%), the
  90% cap, or siege mechanics, which are out of v1 scope.

Two things that work as intended: **spears wreck cavalry** (two Light Cavalry lose 80 men to
two Spear Infantry and kill 8), and the **3× rout rule** fires cleanly in larger battles.

- **Battle speeds.** — `PROPOSED`. See [CONTENT.md](CONTENT.md) §3. Now live, and the main lever
  on the point above: they were chosen for a 10-tile field and the field is 50.
- **Do defeated armies leave survivors?** — `OPEN`. The losing army is currently destroyed
  outright; routing costs fewer men but still leaves nothing on the map. A retreat to an
  adjacent tile would be a mechanic of its own — which tile, and what if it is blocked?
- **Does the garrison fight?** — `PROPOSED`. It does, currently. Recruited units standing in a
  city being stormed defend it, and their survivors go back behind the walls if it holds.

## Due before naval (build phase 0.11.0)

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
- **Is population capped, and can it fall?** — `OPEN`, and now **measured**. Growth compounds
  with no ceiling, and the treasury bonus feeds it. Running a fresh campaign 50 years forward
  with nobody doing anything leaves an untouched rival on **1.7 million gold** with **4.7
  million people in a single Village** — still tier 1, no buildings, no armies. Population
  pays gold, gold raises the growth rate, and nothing anywhere pushes back. This affects the
  player exactly as much as the AI; it is a rule gap, not an AI gap. Needs either a cap per
  settlement tier, or a drag that grows with size.
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

## Raised by armies (0.7.0)

- **Can an army besiege or blockade?** — `OPEN`, and now pressing. Since 0.9.0 a hostile
  settlement can be assaulted, but a fortified one cannot realistically be carried by assault
  (see above). A siege — cutting income, starving the population, wearing the walls down over
  months — is the missing answer, and it is currently out of v1 scope.
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
- **Do units draw from a settlement's population?** — `OPEN`, still, and now visible: a Light
  Infantry unit is 100 soldiers trained out of a 1,000-person village at no demographic cost.

## Minor, any time

- **Day phase order.** — `PROPOSED`. Owner listed `1 Night, 2 Morning, 3 Noon, 4 Evening`, so
  a day begins at night. Intended, or off by one?
- **Do day phases have mechanical effect** in v1, or are they a clock display only?
- **Autosave rotation depth.** — `PROPOSED`. Default 5.
- **Floor device.** — `OPEN`. Oldest phone that must hold a smooth frame rate. Matters mainly
  for the Phase B tactical battle map.
- **Elite units.** — the owner said these would be designed together, per faction.
