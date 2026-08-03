# Next

Where the build is, and what to do next. Written at the end of the 0.13.0 session so a fresh
session can pick up without re-deriving anything.

**Delete or rewrite this file when its contents are done.** It is a handoff note, not a record —
the records are [ROADMAP.md](ROADMAP.md), [OWED.md](OWED.md) and [CHANGELOG.md](../CHANGELOG.md).

---

## State of play

**Version `0.13.0`**, pushed to `origin/main` at commit `da57a2d`. Working tree clean.

- **189 tests pass**, typecheck clean, production build clean.
- Dev server verified serving every changed module. `npm run dev`, `npm test`, `npm run typecheck`.
- Save format is **v6**. Migrations run from v1.

The last two phases shipped together:

- **0.12.0** — recruiting draws population; the twelve rival realms play, at five difficulties
  and with five personalities. See [MECHANICS.md](MECHANICS.md) §8.
- **0.13.0** — fog of war; realms consolidate their borders instead of running corridors; every
  defence bonus halved; the personalities brought close together. See §4 and §9.

---

## 1. Play it — do this before building anything else

**Nothing in 0.12.0 or 0.13.0 has been seen rendered.** There is no browser in this environment
(see [OWED.md](OWED.md) §1), so two versions of visible change have stacked up unverified:

| What changed | Risk |
|---|---|
| **The fog overlay** | A wash at 62% opacity over unseen tiles. Whether the terrain stays readable underneath is a pure guess. **Check this first.** |
| Start screen | Gained a difficulty row above the faction cards |
| Recruit panel | Gained a manpower line, and a refusal reason when a settlement cannot spare the men |
| Balance panel (`B`) | Gained an "Every realm" table with each rival's personality and difficulty |
| Menu → Options | Names the current difficulty |

Playing twenty in-game years at **Knight** is also the only real test of the balance. A large
number of **[GEN]** values went live at once — the whole `data/ai.json` table, the break-even
constants in `src/sim/ai.ts`, the halved defence figures, the consolidation radius. The full list
is in [OWED.md](OWED.md) under "Generated values awaiting the owner's review".

---

## 2. Naval — 0.14.0, and blocked on the owner

Building the AI proved this matters more than the plan assumed: **every settlement no realm can
reach is across water.** Britain and Iberia cannot touch each other; Scandinavia, Ireland, Cyprus
and North Africa survive every campaign untouched. That is roughly a dozen independent cities, and
it is the main reason a century-long campaign settles down.

**Do not start this without answers.** These are rules, and the standing agreement is to ask.

1. **Ship statistics.** Cost, upkeep and building requirement are owner-authored already. Still
   needed for Transport, Light Ship, Heavy Ship and Flagship: **HP, damage, crew size, build time,
   strategic speed**.
2. **Transport capacity.** How many land units does one Transport carry?
3. **Naval combat.** Do fleets fight through the same auto-resolve as armies? Can a fleet
   intercept a transport at sea? What happens to the army aboard when its transport dies?
4. **Embark and disembark.** Only at a Dock, or from any coastal tile the realm owns?
5. **Do fleets desert** while the treasury is in debt? The owner specified that *armies* do;
   ships are currently exempt.
6. **Are Transport and Flagship renamed per faction**, or only Light and Heavy ships?

All six are tracked in [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md) under "Due before naval".

---

## 3. Cheap owner wins, available immediately

- **Assign a personality per faction.** `data/factions.json` already accepts an optional
  `personality` field per faction (`ambitious` | `defensive` | `balanced` | `peaceful` |
  `honorable`). None is set, so they are rolled from the campaign seed — deciding that the Golden
  Horde is Ambitious and Byzantium Defensive is a design call. **Data-only change**, no code.
- **Retune `data/ai.json`.** Every number in it is Claude's. The whole table is laid out in
  [MECHANICS.md](MECHANICS.md) §8 for approval or revision, and `src/sim/ai.ts` holds no tuning
  constants of its own.

---

## If naval is not wanted yet

The useful parallel work is the **economy gaps** — smaller decisions, blocking nothing but
themselves, all in [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md):

- Level-4 mine yields (three levels were given, four exist).
- Which tier unlocks the **Sawmill** — it is referenced in every terrain row and listed in no
  settlement tier.
- What **improvements cost** to build and upgrade. Only the 12-month base duration is known.
- Whether a **Capitol has a fourth housing tier**, or stays on Villas.

Two design questions worth a decision at some point, both logged:

- **The endgame stalemate.** Two large realms with walls and garrisons correctly decline to attack
  each other, so a campaign at Recruit or Knight settles into a balance of power after 20–30 years
  that only the player breaks. At King it never settles. That may be the right shape for a game
  about being the one who breaks it, or it may want something to unfreeze it.
- **Where honour lands in diplomacy.** Honorable currently plays exactly as Balanced. Its three
  traits — `dogpiles`, `attacksRealms`, `bullyFloorPermille` — are wired, tested and permissive,
  waiting for a diplomacy phase to turn them back on.

---

## Standing, do not lose

- **The max-speed cheat must not ship.** `grep -rn "CHEAT" src/`. Top of [OWED.md](OWED.md).
- **Nothing has ever been visually verified.** Do not describe the game's appearance as confirmed.
- The owner makes their own UI styling changes — build features, do not restyle.
