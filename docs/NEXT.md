# Next

Where the build is, and what to do next. Rewritten at the end of the 0.18.1 session.

**Delete or rewrite this file when its contents are done.** It is a handoff note, not a record —
the records are [ROADMAP.md](ROADMAP.md), [OWED.md](OWED.md) and [CHANGELOG.md](../CHANGELOG.md).

---

## State of play

**Version `0.18.1`**, on `main`. **261 tests pass**, typecheck clean, production build clean.
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

## 1. The sea is no longer a wall, and armies have a shape again

**Nothing has been seen rendering** (see [OWED.md](OWED.md) §1). Everything below was *measured*, by
instrumenting 120-year campaigns and reading what the rivals actually did — which is how six
separate bugs were found that no unit test would have caught.

### Overseas conquest, measured over 120 years

Of the 7 settlements on landmasses no realm starts on — Ireland, Sardinia, Crete, Cyprus, the north:

| Seed | Taken | Independents left standing |
|---|---|---|
| 77 | **7 / 7** | **none, anywhere on the map** |
| 1350 | 6 / 7 | 1 (Dublin) |
| 4242 | 5 / 7 | 2 (Dublin, Cyprus) |

Before this session's fixes: **1 of 8**. **Ireland is the stubborn one** and survives some campaigns
— it is the furthest thing on the map from anybody, so it is always the last island anyone sails
for. Whether that is right or wants another nudge is a judgement to make by playing.

### Army composition, measured over 120 years

The world's muster is now **archer 24%, light infantry 23%, heavy cavalry 22%, light cavalry 10%,
sword 8%, spear 4%, skirmisher 3%, shock 3%**. Under the old pure argmax it was heavy cavalry and
little else, and **spear infantry had never been built once** in a century by anybody. The counters
already in the roster — anti-cavalry, ranged resistance, the charge — now have something to counter.

### What is worth watching while playing

- **Are ships too fast?** 3 tiles a month against foot's 0.5 is a **sixfold** advantage. It makes a
  crossing a season rather than a reign, which was the point, but it may make moving by sea strictly
  better than marching anywhere there is a coast.
- **Does the manpower ceiling bite too hard now?** A Flagship is 200 men — two Light Infantry. The
  navy takes its crews before the army takes its soldiers (decision 132), so a realm that builds a
  fleet is visibly a realm with a smaller army. This is the interaction that changes the *land*
  game.
- **Is the recruiting roll too even?** Equal thirds is the owner's specification, but the reroll
  means a settlement that can only build one category effectively builds it three times as often.
  `RECRUIT_ROLL_TRIES` and the split are in [ai.ts](../src/sim/ai.ts).
- **Do fleets die usefully?** Interception, cargo drowning and blockade are all implemented and
  unit-tested, but no campaign measurement has been taken of how often a convoy is actually caught.

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
