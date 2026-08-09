# Next

Where the build is, and what to do next. Rewritten at the end of the 0.18.5 session.

**Delete or rewrite this file when its contents are done.** It is a handoff note, not a record —
the records are [ROADMAP.md](ROADMAP.md), [OWED.md](OWED.md) and [CHANGELOG.md](../CHANGELOG.md).

---

## State of play

**Version `0.18.5`**, on `main`. **280 tests pass**, typecheck clean, production build clean.
Save format is **v9**. Migrations run from v1.

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

---

## 2. The two balance questions carried over, both still awaiting play

### ~~Why every realm ends up buying heavy cavalry~~ — answered in 0.18.1

The owner replaced the pure argmax with a roll of three (decision 130), and the monoculture is gone
— see the composition figures in §1. **Cost still never enters the scoring**, so the "strongest"
third is still the old argmax; what changed is that it only fires a third of the time.

The naval sibling is untouched: `buildFleet` in [navalAi.ts](../src/sim/navalAi.ts) still picks its
escort by raw strength, so a realm that can afford a Flagship never buys a Light Ship. Scoring
**cost per point of strength** would still be worth doing, and would now be a refinement rather than
a rescue.

### The manpower share

`MANPOWER_SHARE_PERMILLE` in [src/sim/manpower.ts](../src/sim/manpower.ts), 200 = 20%. Still the
only lever. **It now has crews under it**, which is a genuine change to what 20% means — this is
the first version where the number is worth re-judging rather than merely judging.

One rule still deliberately not invented, logged in [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md): a realm
carved down below its own ceiling **disbands nobody**. The ceiling gates recruitment only. A v8
save loaded into 0.18.0 may open over its ceiling for exactly this reason, and that is left alone
on purpose.

---

## 3. Cheap owner wins, available immediately

- **Assign personalities.** `data/factions.json` accepts an optional `personality` field
  (`ambitious` | `defensive` | `balanced` | `peaceful` | `honorable`). **Only the Golden Horde has
  one**; the other thirteen are rolled from the campaign seed. Data-only, no code.
- **Retune the ship table.** Crew, HP and damage are **[GEN]** in `data/units.json`; berths (5) and
  speed (3) are owner-specified. Laid out in [CONTENT.md](CONTENT.md) §4.
- **Retune [data/ai.json](../data/ai.json).** Every number in it is Claude's, laid out in
  [MECHANICS.md](MECHANICS.md) §8.
- **Retune the gold rate or the manpower share**, per §2.

---

## 4. What 0.19.0 wants

Identity and polish, per the roadmap — and naval left it one extra job:

- **Per-faction unit names, and now four ship names each.** The owner specified that all four hulls
  are renamed per faction and that **a name may be shared across factions** — one Galleon can serve
  Spain, France and Britain. The data layer carries four slots rather than two; the names are owner
  work.
- Faction strengths and weaknesses, the 10 elite units, the owner's real art, a balance pass.

---

## 5. Smaller decisions still owed

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
