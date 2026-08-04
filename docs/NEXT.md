# Next

Where the build is, and what to do next. Rewritten at the end of the 0.14.0 session.

**Delete or rewrite this file when its contents are done.** It is a handoff note, not a record —
the records are [ROADMAP.md](ROADMAP.md), [OWED.md](OWED.md) and [CHANGELOG.md](../CHANGELOG.md).

---

## State of play

**Version `0.14.0`**, on `main`. **203 tests pass**, typecheck clean, production build clean.
Save format is **v7**. Migrations run from v1.

Three phases have now shipped without anyone seeing them render:

- **0.12.0** — recruiting draws population; the twelve rivals play, at five difficulties and with
  five personalities.
- **0.13.0** — fog of war; realms consolidate their borders; every defence bonus halved.
- **0.14.0** — the manpower ceiling, and a map that remembers where you have been.

---

## 1. Play it — still the first thing to do

**Nothing since 0.11.0 has been seen rendered.** There is no browser in this environment (see
[OWED.md](OWED.md) §1). What is new and visible:

| What changed | Watch for |
|---|---|
| **Black shroud** on ground never discovered | Where the black edge falls at the opening. On the 70 × 35 map one settlement lights a 21 × 21 box, so black is mostly east–west. `KNOWN_RANGE` in [src/sim/vision.ts](../src/sim/vision.ts) is the one number to lower if too much starts lit. |
| **Fog no longer closes behind an army** | March out and back; the ground stays dim rather than going black. |
| **Manpower chip** in the top bar | `⚔ 100 / 220`. Turns red when the realm is at its ceiling. |
| Recruit panel | A new refusal — *"The realm is at its limit"* — and a line saying how many more men there is room for. |
| Everything from 0.12.0 / 0.13.0 | The 62% wash, the difficulty row on the start screen, the "Every realm" table in the balance panel (`B`). |

---

## 2. The manpower ceiling wants a verdict, and it is one number

**This is the most consequential balance change the game has had**, and the owner chose to judge
it by playing rather than by projection. The rule is in [MECHANICS.md](MECHANICS.md) §5.

The opening position is now:

| | |
|---|---:|
| One Village of 1,000 people, plus the Light Infantry it is granted | 1,100 people |
| Ceiling at 20% | **220 men** |
| Already under arms | 100 |
| Room | **one more Light Infantry, and nothing else** |

The third unit is eighty-odd months of growth away, so **the first conquest matters enormously**
and a realm that loses its opening army is in real trouble. Whether that is the right shape for
the opening is the question to answer by playing twenty years at Knight.

`MANPOWER_SHARE_PERMILLE` in [src/sim/manpower.ts](../src/sim/manpower.ts) is the only lever, and
no code depends on its value. 200 = 20%, 300 = three units at the opening, 400 = four.

**One rule was deliberately not invented** and is logged in
[OPEN-QUESTIONS.md](OPEN-QUESTIONS.md): a realm starved under siege or carved up by conquest can
end with more men standing than its ceiling allows. Today **nothing happens** — the ceiling gates
recruitment and never disbands anything. Units deserting when the ceiling drops below them is a
real alternative and would be the harshest consequence in the game.

---

## 3. Naval — now 0.15.0, and still blocked on the owner

Unchanged from the last handoff, and it matters more each phase: **every settlement no realm can
reach is across water.** Britain and Iberia cannot touch each other; Scandinavia, Ireland, Cyprus
and North Africa survive every campaign untouched — roughly a dozen independent cities, and the
main reason a century-long campaign settles down.

Six questions, all in [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md) under "Due before naval":

1. **Ship statistics** — HP, damage, crew size, build time, strategic speed for all four types.
2. **Transport capacity** — how many land units does one Transport carry?
3. **Naval combat** — same auto-resolve? Can a fleet intercept a transport? What happens to the
   army aboard when its transport dies?
4. **Embark and disembark** — only at a Dock, or from any coastal tile the realm owns?
5. **Do fleets desert** while the treasury is in debt? Armies do; ships are currently exempt.
6. **Are Transport and Flagship renamed per faction**, or only Light and Heavy ships?

Note that crew size is now load-bearing beyond ships themselves: units draw manpower and ships
draw nobody, so the moment ships have crews they belong under the same ceiling.

---

## 4. Cheap owner wins, available immediately

- **Assign a personality per faction.** `data/factions.json` already accepts an optional
  `personality` field (`ambitious` | `defensive` | `balanced` | `peaceful` | `honorable`). None is
  set, so they are rolled from the campaign seed. **Data-only change**, no code.
- **Retune `data/ai.json`.** Every number in it is Claude's, laid out in
  [MECHANICS.md](MECHANICS.md) §8. Worth revisiting now that the manpower ceiling binds the AI —
  the levy floors and army-size targets were tuned when gold was the only brake.
- **Retune the manpower share**, per §2 above.

---

## If naval is not wanted yet

The **economy gaps** are still the useful parallel work — small decisions, blocking nothing but
themselves, all in [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md):

- Level-4 mine yields (three levels were given, four exist).
- Which tier unlocks the **Sawmill** — referenced in every terrain row, listed in no tier.
- What **improvements cost** to build and upgrade. Only the 12-month base duration is known.
- Whether a **Capitol has a fourth housing tier**, or stays on Villas.

Two design questions worth a decision at some point, both logged:

- **The endgame stalemate.** Two large realms with walls and garrisons correctly decline to attack
  each other, so a campaign at Recruit or Knight settles into a balance of power after 20–30 years
  that only the player breaks. The manpower ceiling may have changed this — large realms now have
  large ceilings, so it may unfreeze on its own. **Worth re-measuring before designing a fix.**
- **Where honour lands in diplomacy.** Honorable currently plays exactly as Balanced. Its three
  traits — `dogpiles`, `attacksRealms`, `bullyFloorPermille` — are wired, tested and permissive,
  waiting for a diplomacy phase to turn them back on.

---

## Standing, do not lose

- **The max-speed cheat must not ship.** `grep -rn "CHEAT" src/`. Top of [OWED.md](OWED.md).
- **Nothing has ever been visually verified.** Do not describe the game's appearance as confirmed.
- The owner makes their own UI styling changes — build features, do not restyle.
