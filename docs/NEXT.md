# Next

Where the build is, and what to do next. Rewritten at the end of the 0.17.4 session.

**Delete or rewrite this file when its contents are done.** It is a handoff note, not a record —
the records are [ROADMAP.md](ROADMAP.md), [OWED.md](OWED.md) and [CHANGELOG.md](../CHANGELOG.md).

---

## State of play

**Version `0.17.4`**, on `main`. **212 tests pass**, typecheck clean, production build clean.
Save format is **v8**. Migrations run from v1.

Since the last handoff:

- **0.15.0** — the AI measures distance by walking, not in straight lines
  ([geography.ts](../src/sim/geography.ts)). Sight became a diamond. A defeated player keeps
  watching with the fog lifted.
- **0.16.0** — two campaign speeds: foot one tile per **two months**, horse one **a month**. Army
  roles — field, raid, guard, claim. The AI improves the tiles it conquers.
- **0.17.0–0.17.2** — **no reach limit; every realm means to take the whole map.** Personality
  became a pair of odds (raid / guard) rather than a distance. Territory changes march speed.
  Winter attrition. No cap on armies. The panel reads out rivals.
- **0.17.3** — **gold income halved** (`GOLD_INCOME_PERMILLE`).
- **0.17.4** — the map now actually gets finished; rival buildings are legible.

---

## 1. The two open balance questions, both awaiting play

### Gold, and why every realm ends up buying heavy cavalry

`bestUnit` in [src/sim/ai.ts](../src/sim/ai.ts) is a **pure argmax on `size × hp × damage`**, bent
by the personality's `unitBias`. Cost never enters it. heavy_cavalry scores 3200 against
sword_infantry's 2250, so **every personality picks it** once it can pay the wages — Defensive
comes closest to not doing so and would need its cavalry bias below 0.70 against infantry's 1.15.
Spear infantry, which does double damage to cavalry, is never built by anyone.

The gate is `purse < unit.upkeep * 2` — 100 gold a month of net income. Halving gold income in
0.17.3 pushed that much later into a campaign; it did not change the ranking.

Two honest options, and the owner has not chosen:

1. **Leave it.** Heavy cavalry is genuinely the best value per man under the manpower ceiling (80
   HP × damage per man against light infantry's 20), so a realm that has land and no people is
   right to buy the best men it can.
2. **Score against scarcity and composition** — cost per point of strength, a target mix, and some
   awareness of what the enemy fields. This is the real fix and it is a day's work.

Reveal the map (the fog cheat) and watch the **realm watch** table: gross, upkeep, net and
soldiers-per-unit per realm. Upkeep climbing toward gross, and soldiers-per-unit falling toward 40,
is the switchover happening.

### The manpower share

`MANPOWER_SHARE_PERMILLE` in [src/sim/manpower.ts](../src/sim/manpower.ts), 200 = 20%. Still the
only lever, still unjudged by play. It has been cleared of causing the old stalemate — a realm
measured 5,080 men under arms against a ceiling of 172,450.

One rule was deliberately not invented, logged in [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md): a realm
carved down below its own ceiling **disbands nobody** today. The ceiling gates recruitment only.

---

## 2. Naval — 0.18.0, and the only thing still leaving the map unfinished

This has gone from a nice-to-have to **the last structural gap**. As of 0.17.4 every acre a realm
can march to gets claimed; the 64 tiles that stay bare after 120 years are all on islands no realm
holds a settlement on, and there is no route to them at any distance. Scandinavia, Ireland, parts
of Britain and a handful of independent cities sit out every campaign for want of a ship.

Six questions, all in [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md) under "Due before naval":

1. **Ship statistics** — HP, damage, crew size, build time, strategic speed for all four types.
2. **Transport capacity** — how many land units does one Transport carry?
3. **Naval combat** — same auto-resolve? Can a fleet intercept a transport? What happens to the
   army aboard when its transport dies?
4. **Embark and disembark** — only at a Dock, or from any coastal tile the realm owns?
5. **Do fleets desert** while the treasury is in debt? Armies do; ships are currently exempt.
6. **Are Transport and Flagship renamed per faction**, or only Light and Heavy ships?

Crew size is load-bearing beyond ships: units draw manpower and ships draw nobody, so the moment
ships have crews they belong under the same ceiling.

---

## 3. Cheap owner wins, available immediately

- **Assign personalities.** `data/factions.json` accepts an optional `personality` field
  (`ambitious` | `defensive` | `balanced` | `peaceful` | `honorable`). **Only the Golden Horde has
  one** (ambitious, set in 0.17.2); the other thirteen are rolled from the campaign seed.
  Data-only, no code.
- **Retune [data/ai.json](../data/ai.json).** Every number in it is Claude's, laid out in
  [MECHANICS.md](MECHANICS.md) §8.
- **Retune the gold rate or the manpower share**, per §1.

---

## 4. Smaller decisions still owed

Economy gaps, all in [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md), blocking nothing but themselves:

- Level-4 mine yields (three levels were given, four exist).
- Which tier unlocks the **Sawmill** — referenced in every terrain row, listed in no tier.
- What **improvements cost** to build and upgrade. Only the 12-month base duration is known.
- Whether a **Capitol has a fourth housing tier**, or stays on Villas.

And two design questions:

- **Winter attrition and sieges.** A besieger sits on enemy ground, so a 48-month siege of a
  Capitol costs roughly 28% of the besieging army to winter. That may be exactly right, or it may
  make starving out a Capitol impossible for anyone but a huge realm. **[OPEN]**
- **Where honour lands in diplomacy.** Honorable plays exactly as Balanced. Its three traits —
  `dogpiles`, `attacksRealms`, `bullyFloorPermille` — are wired, tested and permissive, waiting for
  a diplomacy phase.

---

## Standing, do not lose

- **Two cheats must not ship.** `grep -rn "CHEAT" src/`. The max-speed cheat, and the fog reveal
  (pause ×5 then 1× ×5). Top of [OWED.md](OWED.md).
- **Nothing has ever been visually verified.** Do not describe the game's appearance as confirmed.
- The owner makes their own UI styling changes — build features, do not restyle.
- **Start `npm run dev` after every change and leave it running.** Not started, checked and
  stopped — left up, so the owner can open it the moment the turn ends.
