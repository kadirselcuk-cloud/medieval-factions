# Next

Where the build is, and what to do next. Rewritten at the end of the 0.19.0 session.

**Delete or rewrite this file when its contents are done.** It is a handoff note, not a record —
the records are [ROADMAP.md](ROADMAP.md), [OWED.md](OWED.md) and [CHANGELOG.md](../CHANGELOG.md).

---

## State of play

**Version `0.20.2`**, on `main`. **338 tests pass**, typecheck clean, production build clean.
Save format is **v10** and unchanged — growth, income and manpower are all derived, none stored.

**The economy was redesigned in 0.19.0**, owner-specified: income halved again, growth moved from
the treasury balance to net monthly income on a four-band marginal schedule, and the manpower ceiling
deleted in favour of what a realm can pay for. Decisions 163–165, MECHANICS §5.

> ### Read this before tuning anything
>
> The three changes compose, and the composition is larger than any one of them. **Halving income
> stretches a campaign by 60 to 100 years** — every AI test horizon in the suite had to move, and not
> one assertion was relaxed to do it. Three consequences are worth a decision from the owner:
>
> 1. **The naval game now starts a century later.** On the naval test seed the first fleet puts to
>    sea in 1450 and the first marooned settlement falls in **1510**, against roughly 1410 before.
>    All seven fall by 1570. The structural work from 0.18.0–0.18.10 is intact; it is simply priced
>    out until a realm is large and developed.
> 2. **The cheapest unit is 80% of the world's army until about 1530.** Not the roll of three
>    (decision 130) — `buildableHere` refuses any unit a realm cannot cover two wages for, and at a
>    quarter income that is Light Infantry and nothing else for the first century and a half. This is
>    the 0.18.1 monoculture returning from the opposite direction.
> 3. **The upper three growth bands are never reached.** The largest net income measured over 250
>    years was **998 gold a month**, which is inside the first band. The prosperity term therefore
>    contributes 0–5 people a month for essentially the whole game, against flat building terms of
>    5–135. The schedule works; the game does not produce incomes large enough to exercise it.
>
> **0.19.1 clawed some of (1) back.** The owner-s naval brief — convoys that route round enemy
> warships, three escorts apiece, war fleets that hunt without a range limit, and landings that scale
> with the realm — pulled all seven marooned settlements forward from 1590 to 1550 on one seed and
> roughly doubled the share of convoys that sail escorted. The naval game still starts late; it now
> finishes faster once it does.
>
> None of these is a bug and none needs fixing to ship. They are the shape the halved economy has,
> and the levers are `GOLD_INCOME_PERMILLE` in [state.ts](../src/sim/state.ts), the first band's 1%
> in [tick.ts](../src/sim/tick.ts), and the `purse >= unit.upkeep * 2` test in
> [ai.ts](../src/sim/ai.ts).

**Naval shipped.** The last structural gap in the map is closed: ships, fleets, transports,
embarkation, blockade, battle at sea, and rival realms that mount amphibious expeditions of their
own. All six blocking questions were answered by the owner before a line was written — DESIGN
decisions 121–128 — and 0.18.1 carries the owner's revisions to it, decisions 129–134. See
MECHANICS §10 and CONTENT §4.

The decision that made it cheap: **a ship is a unit.** Crew is its `size`, HP and damage are per
crewman, so the auto-resolve built in 0.9.0 fights fleets unchanged and the manpower, upkeep and
desertion rules that already existed simply started applying to hulls.

---

## 1. What the last four sessions changed, all measured

**Nothing has been seen rendering** (see [OWED.md](OWED.md) §1). Everything below was *measured*, by
instrumenting 120-year campaigns and reading what the rivals actually did — which is how every bug
listed here was found, and none of them would have failed a unit test.

| | Before naval | Now |
|---|---|---|
| Sea basins on the map | 4 — the Black Sea was landlocked | **1** |
| Independent cities surviving 120 years | 7–8 | **0–1** |
| Walkable land claimed | ~88% | **90–100%** |
| Field armies | 158, averaging 3.9 units | **28–38, averaging 9.7–14.8** |
| Fleets, and how many under way | none, then 8 idle | **16–25, with 8–18 sailing** |
| Realms holding more than one landmass | 0 | **2–3** |

And the late game, which 0.18.4 was entirely about — same seed, before and after:

| Year | Before | After |
|---|---|---|
| 1500 | 49 of 52 armies idle, 1,213 battles | **9 of 47 idle, 1,529 battles** |
| 1550 | **52 of 52 idle**, 1,336 | **14 of 60 idle**, 1,393 |
| 1600 | **52 of 52 idle**, 1,363 | **11 of 67 idle**, 1,647 |

And 0.18.5 removed the runaway with it: the map now finishes **[25,21,7,5,2]** rather than one realm
of 46, with two great powers still fighting at full tilt two and a half centuries in.

> **Corrected in 0.18.10.** That figure did not survive 0.18.6–0.18.9. Measured fresh on three seeds
> before this session touched anything, two of them finished 1600 at **[54,6]** and the third at
> [45,7,6,1,1] — the runaway was back, and nothing between 0.18.5 and 0.18.9 had re-measured it.
> 0.18.10 pulls two of the three back to four living realms; see §2. **Re-measure this figure rather
> than trusting it**: it has now been quietly wrong once.

The map used to freeze at [46,7,5,2,0] and stay there for two hundred years. It now keeps changing
hands, and on a second seed the heaviest fighting of the whole campaign happens after 1550.

The two the owner named by hand:

- **The Moors** held Spain and nothing else in Africa. They now hold **Fez, Marrakesh, Tunis,
  Tripoli, Alexandria and Sardinia**.
- **The Britons** never left their island. They now hold **London, York, Edinburgh, Dublin, Bergen,
  Oslo and Uppsala**.

### The bugs behind those numbers, so nobody re-finds them

Every one was a rule that was correct for a small realm on one continent and had never been scaled
or generalised:

1. Loaded fleets **unloaded onto their own coast** — the quay a fleet loads at is beside a beach.
2. Targets were chosen **purely by sea distance**, so realms sailed for the nearest foreign
   coastline, which is usually somebody else's land war. Dublin was chosen 6 times in 120 years
   against Novgorod's 173.
3. The navy was **levied after the army** and so could never afford a crew. One realm ended a
   campaign with 81 armies, 8 harbours and a target four sea tiles away it had never built a
   transport for.
4. **Founding an army cost two units**, so a realm of twenty cities founded twenty tiny ones.
5. **One objective for the whole realm**, so an empire pointed 74 armies at a single town.
6. **Hulls and escorts wanted were flat numbers** for a village and an empire alike.
7. **Ships moved in four directions**, which left the Black Sea unable to reach the Mediterranean.
8. **Shipping required no land route at all**, so a realm walked six years rather than sail one.
9. The first fix for (4) held **claimers and raiders to a field army's bar**, which left 8.6% of the
   map permanently bare. They are deliberately one and three units.
10. **Claimers ran out of ground** once the map filled, because a rival's open fields were invisible
    to them — so the job whose whole purpose is taking ground had none to take.
11. A realm whose every target failed `judge` **chose no objective and stopped**.
12. A realm that had taken its whole landmass had **nothing it could walk to**, so objectives, raids
    and ground all came back empty while its fleets sailed about with nothing to carry.
13. And when those armies finally queued at the quays, **`loadUp` boarded field armies only** — most
    of the ones waiting were raiders. 11 armies on quays, 21 fleets, 1 loaded.

### What is worth watching while playing

- **Are ships too fast, or too dominant?** Three tiles a month against foot's half is a sixfold
  advantage, and a realm will now ship an army rather than march it whenever the walk is 3× the
  sail. That is a big lever on how the map feels; `SEA_SHORTCUT` in
  [navalAi.ts](../src/sim/navalAi.ts) is the dial.
- **Is "cheapest target" too timid?** Defenders now count as distance at 100 soldiers a tile
  (`DEFENDERS_PER_TILE` in [ai.ts](../src/sim/ai.ts)). Too high and realms would circle forever
  looking for a soft target instead of pressing a war.
- **Does the manpower ceiling bite too hard?** A Flagship is 200 men, the navy takes its crews before
  the army takes its soldiers, and realms now want far more hulls than they did.
- **Do fleets die usefully?** Interception, cargo drowning and blockade are implemented and tested,
  but no campaign measurement has been taken of how often a convoy is actually caught.
- **Armies queued for boats look identical to armies doing nothing.** New in 0.18.10, and the one
  thing found while measuring it that is not obviously fine. On seed 12345 the winning realm runs
  **54 of 57 armies "idle" from 1540 to 1552** — they are standing on quays waiting for shipping,
  which is decision 147 working, and the map is demonstrably alive around them (165 battles every
  two years, cities changing hands). But it is indistinguishable from a freeze without instrumenting
  it, and the owner watching the map would see stacks that do not move for a decade. Worth deciding
  whether a waiting army should be visibly *waiting* — a marker, or simply fewer of them summoned.

---

## 2. ~~Owed: ship counts want a different formula~~ — paid in 0.18.10

**Done.** Naval appetite is no longer a function of cities held. Demand comes from `spareLift` in
[navalAi.ts](../src/sim/navalAi.ts): the units in stacks with nothing to attack **on their own
landmass**, counted in whole armies' worth. The old city figure survives underneath as a floor, so a
realm still fighting on land gets precisely the navy it had and only a realm with idle men gets more
— which is what made the raise safe where every flat attempt had destroyed overseas conquest.

Measured over three 250-year campaigns. **Independents reach zero by 1450 in every run, before and
after**, so the thing that had to survive did.

| Seed | Before, at 1600 | After |
|---|---|---|
| 4242 | 54 cities and 6 — two realms left | **35, 13, 7, 5 — four realms, still fighting** |
| 777 | 54 and 6 | **46, 7, 4, 3** |
| 12345 | 45, 7, 6, 1, 1 | **60 — the conquest completes** |

Two of three seeds end **less** concentrated than before, which was not the aim: shipping the idle
armies out of a conquered heartland gives the rest of the map something to push back against.

**The dial is `MAX_CONVOYS`** — eight armies' worth of shipping, at most. Six was measured and
changes nothing on two of the three seeds, because no realm on them ever has six armies' worth
spare; on the third it stalls the winner at 57 cities of 60 with sixty idle armies. Eight was kept
because a realm that has won should be allowed to finish.

A second, smaller thing was learned in 0.18.9 and is kept: **the AI's own loading stays port-centric**
even though the boarding *rule* no longer requires a harbour. Widening the AI to match had fleets
scooping up armies that were merely marching past a coastal tile on their way to a siege.

---

## 3. The two balance questions carried over, both still awaiting play

### ~~Why every realm ends up buying heavy cavalry~~ — answered in 0.18.1

The owner replaced the pure argmax with a roll of three (decision 130), and the monoculture is gone
— see the composition figures in §1. **Cost still never enters the scoring**, so the "strongest"
third is still the old argmax; what changed is that it only fires a third of the time.

The naval sibling was **checked in 0.18.10 and closed as a no-op.** `buildFleet` picks its escort by
raw strength, and scoring cost per point of strength instead gives the same answer every time,
because the ship table is monotonic:

| Hull | Strength per crewman | per gold+wood | per build-month |
|---|---|---|---|
| Light Ship | 1,200 | 360 | 9,000 |
| Heavy Ship | 3,000 | 800 | 30,000 |
| Flagship | **6,400** | **1,280** | **71,111** |

A Flagship is the best buy on every ratio there is, so no scoring rule prefers a Light Ship. **If
rival navies should have variety in them, the data table has to change, not the AI** — the cheap
hulls need to be cheap *per man*, and today they are not.

### ~~The manpower share~~ — removed in 0.19.0

Gone, with the question under it. There is no ceiling and nothing to retune; the treasury decides,
and measured over 250 years realms settle at **1.3% of their people under arms** where the old rule
pinned them at 20%. The open question about a realm carved down below its own ceiling is moot — there
is no ceiling to fall below.

What replaced it as the lever is the wage test in [ai.ts](../src/sim/ai.ts): a realm will not order a
unit unless its net income covers twice that unit's upkeep. That single line is now the main control
on how large and how varied rival armies get.

---

## 4. Cheap owner wins, available immediately

- **Assign personalities.** `data/factions.json` accepts an optional `personality` field
  (`ambitious` | `defensive` | `balanced` | `peaceful` | `honorable`). **Only the Golden Horde has
  one**; the other thirteen are rolled from the campaign seed. Data-only, no code.
- **Retune the ship table.** Crew, HP and damage are **[GEN]** in `data/units.json`; berths (5) and
  speed (3) are owner-specified. Laid out in [CONTENT.md](CONTENT.md) §4.
- **Retune [data/ai.json](../data/ai.json).** Every number in it is Claude's, laid out in
  [MECHANICS.md](MECHANICS.md) §8.
- **Retune the gold rate**, `GOLD_INCOME_PERMILLE` in [state.ts](../src/sim/state.ts) — now 250. The
  single biggest lever in the game after 0.19.0; see the warning at the top of this file.
- **Retune the first growth band**, the 1% in `PROSPERITY_BANDS` in [tick.ts](../src/sim/tick.ts).
  The only band a campaign ever reaches.

---

## 5. What 0.20.0 still wants

Identity and polish, per the roadmap — and naval left it one extra job:

- **Per-faction unit names, and now four ship names each.** The owner specified that all four hulls
  are renamed per faction and that **a name may be shared across factions** — one Galleon can serve
  Spain, France and Britain. The data layer carries four slots rather than two; the names are owner
  work.
- Faction strengths and weaknesses, the 10 elite units, the owner's real art, a balance pass.

---

## 6. Smaller decisions still owed

Economy gaps, all in [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md), blocking nothing but themselves:

- Level-4 mine yields (three levels were given, four exist).
- Which tier unlocks the **Sawmill** — referenced in every terrain row, listed in no tier.
- What **improvements cost** to build and upgrade. Only the 12-month base duration is known.
- Whether a **Capitol has a fourth housing tier**, or stays on Villas.

And the design questions:

- **Winter attrition and sieges.** A besieger sits on enemy ground, so a 48-month siege of a
  Capitol costs roughly 28% of the besieging army to winter. **[OPEN]**
- **Where honour lands in diplomacy.** Honorable plays exactly as Balanced. Its three traits are
  wired, tested and permissive, waiting for a diplomacy phase.
- **Naval questions raised by building it, none blocking:** can a **fleet** be split, now that an
  army can be at a quayside? Should a besieged port be blockadable from the sea? Should a landing be
  opposed — an amphibious assault against a defended beach is currently impossible rather than
  costly. Should an army be splittable in the **field**, not only at a harbour?

---

## Standing, do not lose

- **Two cheats must not ship.** `grep -rn "CHEAT" src/`. The max-speed cheat, and the fog reveal
  (pause ×5 then 1× ×5). Top of [OWED.md](OWED.md).
- **Nothing has ever been visually verified.** Do not describe the game's appearance as confirmed.
- The owner makes their own UI styling changes — build features, do not restyle.
- **Start `npm run dev` after every change and leave it running.** Not started, checked and
  stopped — left up, so the owner can open it the moment the turn ends.
