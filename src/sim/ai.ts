import {
  difficultyProfile,
  personalityProfile,
  type AiDifficultyProfile,
  type AiPersonalityProfile,
  type BuildWeightKey,
} from '../data/ai';
import { settlementUpgradeTo } from '../data/buildings';
import { improvementCost, MAX_IMPROVEMENT_LEVEL, tileOutput } from '../data/improvements';
import { TERRAIN_PROFILE, type ImprovementKind } from '../data/terrain';
import { recruitableUnits, type Unit } from '../data/units';
import { featureAt, inBounds, terrainAt, tileIndex, type World } from '../data/world';
import { armiesOf, defenceOf, mobilise, stackSize, stackSoldiers } from './armies';
import { defenderAdvantage, openFieldAdvantage } from './battle';
import {
  availableManpower,
  buildOptions,
  canAfford,
  improvementAt,
  improvementCap,
  queueBuilding,
  queueImprovement,
  queueSettlementUpgrade,
  queueUnit,
  settlementUpgradeBlock,
} from './construction';
import { beginSiege, RELIEF_RANGE, siegeTarget } from './conquest';
import { blockedBy, findPath, orderMove } from './movement';
import {
  MAX_ARMY_UNITS,
  nextRandomInt,
  type ArmyState,
  type CityState,
  type FactionState,
  type SimState,
} from './types';

/**
 * The rival realms.
 *
 * Runs once a month, per realm, in faction-index order — decisions in this game are all
 * denominated in months, so there is nothing a per-tick AI could decide that a monthly one
 * cannot. It plays through **exactly the same functions the player's UI calls**: `queueBuilding`,
 * `queueUnit`, `mobilise`, `orderMove`, `beginSiege`. There is no back door, so a rule the player
 * is bound by binds the AI too, and a bug in one is a bug in both.
 *
 * **Determinism is the constraint that shapes this file.** Every loop runs in a fixed order —
 * factions by index, cities by index, armies by id — and every tie breaks on an id rather than on
 * whichever object a sort happened to leave first. The one random draw is the dither roll, taken
 * from `state.rng`, and it is taken for every living AI realm whether or not it goes on to act.
 *
 * Nothing here is a constant. Difficulty and personality are tables in `data/ai.json`, so the
 * whole thing retunes without a code change (docs/DESIGN.md §4).
 */

/** What a difficulty and a personality together say about how one realm plays. */
interface Mind {
  faction: FactionState;
  level: AiDifficultyProfile;
  character: AiPersonalityProfile;
  /** Soldiers each realm has under arms, by faction index. Computed once a month, shared. */
  strength: readonly number[];
}

export function runAi(state: SimState, world: World): void {
  const strength = realmStrengths(state);

  for (const faction of state.factions) {
    if (!faction.alive || !faction.ai) continue;
    const level = difficultyProfile(faction.ai.difficulty);
    const character = personalityProfile(faction.ai.personality);

    // Rolled unconditionally, before anything can return early, so the random stream depends
    // only on which realms are alive — not on what each of them happened to find to do.
    const wasted = nextRandomInt(state, 1000) < level.ditherPermille;
    if (wasted) continue;

    const mind: Mind = { faction, level, character, strength };
    develop(state, world, mind);
    levy(state, mind);
    campaign(state, world, mind);
  }
}

/**
 * Soldiers per realm — everything it could put on a field, including the free defenders that
 * come with its settlements.
 *
 * Used only to judge how big a realm is relative to another, which is why the immobile
 * defenders count: a realm of walled cities is a large realm even with no army in the field.
 */
function realmStrengths(state: SimState): number[] {
  const strength = state.factions.map(() => 0);
  for (const city of state.cities) {
    if (city.ownerIndex < 0) continue;
    strength[city.ownerIndex] =
      (strength[city.ownerIndex] ?? 0) +
      stackSoldiers(defenceOf(city)) +
      stackSoldiers(city.garrison);
  }
  for (const army of state.armies) {
    strength[army.ownerIndex] = (strength[army.ownerIndex] ?? 0) + stackSoldiers(army.units);
  }
  return strength;
}

function chebyshev(world: World, a: number, b: number): number {
  return Math.max(
    Math.abs((a % world.width) - (b % world.width)),
    Math.abs(Math.floor(a / world.width) - Math.floor(b / world.width)),
  );
}

// ------------------------------------------------------------------ building

/**
 * What each settlement puts up next.
 *
 * One order per settlement per month at most, and only when its queue is empty — the same
 * pacing a player gets, since a settlement can only build one thing at a time anyway.
 */
function develop(state: SimState, world: World, mind: Mind): void {
  for (const city of state.cities) {
    if (city.ownerIndex !== mind.faction.index) continue;
    // Nothing finishes in an invested settlement, so nothing should be started in one either.
    if (city.siege || city.queue.length > 0) continue;
    build(state, world, city, mind);
  }
  if (mind.level.improves) improve(state, world, mind);
}

/** A thing a settlement could start, and how much this realm wants it. */
interface Option {
  weight: number;
  /** Sorted on when weights tie, so the choice never depends on iteration order. */
  key: string;
  gold: number;
  start: () => void;
  affordable: boolean;
}

function build(state: SimState, world: World, city: CityState, mind: Mind): void {
  const weights = mind.character.build;
  const options: Option[] = [];

  const upgrade = settlementUpgradeTo(city.tier + 1);
  if (upgrade) {
    const blocked = settlementUpgradeBlock(state, city);
    // Only price is worth waiting for. Too few people, or a Capitol already held, is a reason
    // to build something else this month rather than to sit on the treasury.
    if (blocked === null || blocked === 'insufficient-resources') {
      options.push({
        weight: weights.expand,
        key: `expand:${upgrade.toTier}`,
        gold: upgrade.cost.gold,
        affordable: blocked === null,
        start: () => void queueSettlementUpgrade(state, city),
      });
    }
  }

  for (const building of buildOptions(world, city)) {
    options.push({
      weight: weights[building.line satisfies BuildWeightKey],
      key: `building:${building.id}`,
      gold: building.cost.gold,
      affordable: canAfford(state, city.ownerIndex, building.cost),
      start: () => void queueBuilding(state, world, city, building.id),
    });
  }

  const choice = pick(mind, options);
  choice?.start();
}

/**
 * The best thing this realm can start, or nothing because it is saving up for something better.
 *
 * Without the saving rule an AI buys whatever is cheapest, forever: a Palisade costs 100 gold
 * and a Town costs 1,000, so a realm that always spends never becomes a Town. **Patience is a
 * difficulty lever** — a Recruit looks three months ahead and buys trinkets, a King looks two
 * years ahead and gets the Capitol.
 */
function pick(mind: Mind, options: readonly Option[]): Option | undefined {
  if (options.length === 0) return undefined;
  const ranked = [...options].sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key));

  const best = ranked[0];
  if (best && !best.affordable) {
    const income = mind.faction.monthlyIncome.gold;
    const short = best.gold - Math.floor(mind.faction.stock.gold / 1000);
    if (income > 0 && short <= income * mind.level.patienceMonths) return undefined;
  }
  return ranked.find((option) => option.affordable);
}

/**
 * Develop one tile somewhere in the realm, and only one.
 *
 * Capped at a single improvement a month across the whole realm, which is both what keeps this
 * cheap at high speed and what stops a rich AI paving every tile it owns the month it can
 * afford to. The kind is decided by what the ground actually yields rather than by a rule of
 * thumb, so it reads the same tables the player's panel does.
 */
function improve(state: SimState, world: World, mind: Mind): void {
  const cap = improvementCap(state, mind.faction.index);
  if (cap <= 0) return;
  // Only one piece of work at a time, realm-wide — an AI with ten half-dug mines has none.
  for (let i = 0; i < state.improvementMonths.length; i++) {
    if ((state.improvementMonths[i] ?? 0) > 0 && state.tileOwner[i] === mind.faction.index) return;
  }

  let bestTile = -1;
  let bestKind: ImprovementKind | null = null;
  let bestGain = 0;

  for (let index = 0; index < state.tileOwner.length; index++) {
    if (state.tileOwner[index] !== mind.faction.index) continue;

    const level = (state.improvementLevel[index] ?? 0) + 1;
    if (level > Math.min(cap, MAX_IMPROVEMENT_LEVEL)) continue;

    const x = index % world.width;
    const y = Math.floor(index / world.width);
    const terrain = terrainAt(world, x, y);
    if (!TERRAIN_PROFILE[terrain].buildable) continue;

    const feature = featureAt(world, x, y);
    const node = feature?.kind === 'resource' ? feature.resource : null;
    const now = tileOutput({ terrain, improvement: improvementAt(state, index), level: level - 1, node });

    // A tile already carrying an improvement can only ever upgrade that one.
    const existing = improvementAt(state, index);
    const kinds: readonly ImprovementKind[] = existing ? [existing] : ['farm', 'mine', 'sawmill'];

    for (const kind of kinds) {
      const after = tileOutput({ terrain, improvement: kind, level, node });
      const gain = yieldValue(after) - yieldValue(now);
      // Ties break toward the lower tile index, so the same campaign always digs the same field.
      if (gain > bestGain) {
        bestGain = gain;
        bestTile = index;
        bestKind = kind;
      }
    }
  }

  if (bestTile < 0 || !bestKind) return;
  const level = (state.improvementLevel[bestTile] ?? 0) + 1;
  if (!canAfford(state, mind.faction.index, improvementCost(bestKind, level))) return;

  queueImprovement(
    state,
    world,
    mind.faction.index,
    bestTile % world.width,
    Math.floor(bestTile / world.width),
    bestKind,
  );
}

/**
 * One number for a tile's yield, so improvements of different kinds are comparable.
 *
 * Gold at face value and the three materials at three gold each — wood, iron and stone are what
 * gate buildings and units, and a realm with gold and no stone cannot raise a wall. **[GEN]**
 */
function yieldValue(output: { gold: number; wood: number; iron: number; stone: number }): number {
  return output.gold + (output.wood + output.iron + output.stone) * 3;
}

// --------------------------------------------------------------- recruitment

/**
 * Raise troops, within what the realm can actually pay for and populate.
 *
 * Two hard guards, and both matter more than any of the tuning above them. A realm that
 * recruits past its income runs into debt, deserts its own army and starves its own cities —
 * the AI would destroy itself with no help from anyone. And since 0.12.0 a unit is **people**,
 * so an AI that levied freely would empty its settlements and never reach the population gate
 * for its next tier.
 */
function levy(state: SimState, mind: Mind): void {
  const held = state.cities.filter((city) => city.ownerIndex === mind.faction.index);
  if (held.length === 0) return;

  // **What it wants is the army it can actually field, plus the garrison it means to keep.**
  //
  // Both halves matter, and getting either wrong kills the campaign. Too little and a realm that
  // has conquered nine cities still fields the army of one, cannot break anybody's walls, and
  // every border on the map freezes. Too much and the surplus it can never march has nowhere to
  // go but the garrisons — where it becomes a defence nobody can attack either, which freezes
  // the map from the other direction. The first version of this file did both in turn.
  const wanted =
    Math.min(mind.level.maxArmies, held.length) * mind.level.armyUnits +
    held.length * mind.character.garrisonKeep;
  if (forceOf(state, mind.faction.index) >= wanted) return;
  if (mind.faction.monthlyIncome.gold <= 0) return;

  for (const city of held) {
    if (city.siege || city.recruitQueue.length > 0) continue;
    const unit = bestUnit(state, city, mind);
    if (unit) queueUnit(state, city, unit.id);
  }
}

/** Units this realm has under arms, in the field and in its garrisons. */
function forceOf(state: SimState, factionIndex: number): number {
  let count = 0;
  for (const city of state.cities) {
    if (city.ownerIndex === factionIndex) count += stackSize(city.garrison);
  }
  for (const army of state.armies) {
    if (army.ownerIndex === factionIndex) count += stackSize(army.units);
  }
  return count;
}

/**
 * The best unit this settlement could start today.
 *
 * Scored on what it puts on a battlefield — men × hit points × damage — bent by the
 * personality's taste in troops, so a Defensive realm fills its walls with spearmen and an
 * Ambitious one buys horse. Everything unaffordable in gold, in people, or in wages it could
 * not keep paying is filtered out first, so this can only ever return something safe to order.
 *
 * **It stops well above the survival floor, and it never conscripts a settlement backwards.**
 * `MIN_POPULATION` is where a settlement stops shrinking, not where it is still worth anything:
 * manpower is spent permanently and flat growth never earns it back, so a realm that levies to
 * the last hundred villagers has traded its future for one army. Two floors, and the higher wins
 * — the personality's own nerve, and **the population that earned the settlement its current
 * tier**. A Town was allowed to become a Town at 2,000 people, so it is never levied below 2,000.
 * Without the second floor a King-difficulty realm strips five Towns down to seven hundred people
 * between them and then cannot grow, garrison or feed itself.
 */
function bestUnit(state: SimState, city: CityState, mind: Mind): Unit | undefined {
  const bias = mind.character.unitBias;
  const purse = mind.faction.monthlyIncome.gold;
  const earned = settlementUpgradeTo(city.tier)?.minPopulation ?? 0;
  const floor = Math.max(mind.character.levyFloor, earned);
  const manpower = Math.min(availableManpower(city), Math.max(0, city.population - floor));

  let best: Unit | undefined;
  let bestScore = 0;

  for (const unit of recruitableUnits(city.tier, city.buildings)) {
    if (unit.size > manpower) continue;
    if (!canAfford(state, city.ownerIndex, unit.cost)) continue;
    // Net income already has today's wages taken off it, so this leaves room for one more unit
    // beyond the one being ordered — a margin, not a knife edge.
    if (purse < unit.upkeep * 2) continue;

    const score = Math.floor((unit.size * unit.hp * unit.damage) / 100) * bias[unit.class];
    if (score > bestScore || (score === bestScore && best && unit.id < best.id)) {
      bestScore = score;
      best = unit;
    }
  }
  return best;
}

// --------------------------------------------------------------------- war

/**
 * The realm's war, for one month.
 *
 * **One objective for the whole realm, not one per army.** Armies are chosen for a target
 * together, because a realm that judges each stack on its own can never take a defended city:
 * no single army it is allowed to raise beats a built-up City with a garrison in it, so every
 * army separately concludes there is nothing to do and every border on the map sets like
 * concrete. Sending all of them at the same place is what a realm at war actually does, and the
 * siege rules do the rest — the first to arrive invests the place and the others gather at the
 * walls while the clock runs down.
 */
function campaign(state: SimState, world: World, mind: Mind): void {
  muster(state, world, mind);

  const armies = [...armiesOf(state, mind.faction.index)].sort((a, b) => a.id - b.id);
  const objective = pickObjective(state, world, mind, armies);

  /**
   * **One army tidies the border; the rest go to war.**
   *
   * Every conquest opens a fresh ring of unclaimed ground around the city just taken, so a realm
   * where *every* idle army consolidates never runs out of ground to consolidate and never
   * fights again. It also inverted the difficulty ladder outright: a King fields six armies and
   * so had six of them filling in fields while a Recruit's single army got on with the war.
   *
   * The weakest stack draws the job, which is the right one for it — claiming ground needs feet,
   * not soldiers, and the strongest army is the one the objective needs.
   */
  const settler = objective
    ? [...armies]
        .filter((army) => army.path.length === 0)
        .sort((a, b) => stackSize(a.units) - stackSize(b.units) || a.id - b.id)[0]
    : undefined;

  for (const army of armies) {
    // An army already walking somewhere is left to walk. Re-planning every month would produce
    // a realm whose armies oscillate between two targets and never reach either.
    if (army.path.length > 0) continue;
    order(state, world, army, mind, objective, !objective || army.id === settler?.id);
  }
}

/**
 * Send the surplus of every garrison into the field.
 *
 * `garrisonKeep` is the personality's nerve: a Defensive realm holds three units in every
 * settlement before it will field anything, an Ambitious one holds one. Which units stay is
 * decided by sorted id — **[GEN]**, and deliberately not by strength, because "keep the best at
 * home" and "send the best to the war" are both defensible and neither was specified.
 */
function muster(state: SimState, world: World, mind: Mind): void {
  // **A realm with nothing in the field gets its first army as soon as it has two units.**
  // Otherwise a Defensive realm holds three at home before it will field anything, needs a
  // fourth before there is a surplus and a seventh before that surplus is worth founding a stack
  // with — and spends its first six years holding the five tiles it started on, unable to claim
  // an acre or take a village. An army is what a realm acts *with*; the caution applies to the
  // second one and after.
  const fielded = armiesOf(state, mind.faction.index).length;
  const keep = fielded === 0 ? Math.min(1, mind.character.garrisonKeep) : mind.character.garrisonKeep;

  for (const city of state.cities) {
    if (city.ownerIndex !== mind.faction.index || city.siege) continue;

    const held = stackSize(city.garrison);
    const spare = held - keep;
    if (spare <= 0) continue;

    // The cap is on armies raised, not on troops: reinforcing a stack already standing on the
    // settlement is always allowed, or a realm at its cap could never replace its losses.
    const standing = state.armies.some(
      (army) => army.tileIndex === city.tileIndex && army.ownerIndex === mind.faction.index,
    );
    if (!standing) {
      if (armiesOf(state, mind.faction.index).length >= mind.level.maxArmies) continue;
      // And a *second* stack has to be worth founding. One spare unit marching off on its own is
      // an army in name only: it dies to the first village it meets, and it uses up one of the
      // few army slots the realm has. It does not have to be a full army, though — `regroup`
      // walks understrength stacks round the realm's garrisons until they fill up.
      if (fielded > 0 && spare < Math.max(2, Math.floor(mind.level.armyUnits / 3))) continue;
    }

    const picks: Record<string, number> = {};
    let taken = 0;
    let skipped = 0;
    for (const id of Object.keys(city.garrison).sort()) {
      for (let i = 0; i < (city.garrison[id] ?? 0); i++) {
        if (skipped < mind.character.garrisonKeep) {
          skipped += 1;
          continue;
        }
        if (taken >= spare || taken >= MAX_ARMY_UNITS) break;
        picks[id] = (picks[id] ?? 0) + 1;
        taken += 1;
      }
    }
    if (taken > 0) mobilise(state, world, city, picks);
  }
}

/**
 * What one idle army does this month.
 *
 * In order of what a realm should care about: its own cities before anyone else's, the siege it
 * is already pressing before a new one, the enemy at hand before one over the horizon, and home
 * before nothing at all.
 */
function order(
  state: SimState,
  world: World,
  army: ArmyState,
  mind: Mind,
  objective: CityState | undefined,
  /** Whether this is the army filling in the borders this month. See `campaign`. */
  mayClaim: boolean,
): void {
  if (relieve(state, world, army, mind)) return;

  const gates = siegeTarget(state, world, army);
  if (gates) {
    // Already starving this one out — sitting still *is* the order. A siege is held by presence
    // and lifts the moment the besieger wanders off.
    if (gates.siege?.byIndex === mind.faction.index) return;
    if (assault(state, world, army, gates, mind)) return;
    if (mind.character.prefersSiege) {
      beginSiege(state, world, army.id);
      return;
    }
  }

  // **Fill in the ground around home before marching on anybody.** A realm that goes straight
  // for the nearest takeable city walks a one-tile corridor across the map and holds a line
  // rather than a country — no income from the ground beside it, no border its armies can be
  // brought back through, and nothing worth improving. Consolidating first is slower and worth
  // far more, and it stops of its own accord: once the ring around every settlement is claimed
  // there are no candidates left and the realm goes to war.
  if (mayClaim) {
    const ground = pickClaim(state, world, army, mind);
    if (ground >= 0) {
      orderMove(state, world, army.id, ground);
      return;
    }
  }

  if (objective) {
    march(state, world, army, objective, mind);
    return;
  }
  regroup(state, world, army, mind);
}

/**
 * The nearest unclaimed tile worth walking onto, or -1.
 *
 * **Nearest to one of our own settlements first, and the army's own distance breaks the tie** —
 * so a realm grows as a blob around each of its cities rather than a thread toward a target, and
 * two armies do not both cross the realm to reach the same field.
 *
 * Only tiles within `claimRadius` of a settlement are considered, which is both what bounds the
 * behaviour and what bounds the cost: the scan is a small box around each settlement rather than
 * a sweep of all 2,450 tiles.
 */
function pickClaim(state: SimState, world: World, army: ArmyState, mind: Mind): number {
  const radius = mind.character.claimRadius;
  let best = -1;
  let bestFromCity = Number.POSITIVE_INFINITY;
  let bestFromArmy = Number.POSITIVE_INFINITY;

  for (const city of state.cities) {
    if (city.ownerIndex !== mind.faction.index) continue;
    const cx = city.tileIndex % world.width;
    const cy = Math.floor(city.tileIndex / world.width);

    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (!inBounds(world, x, y)) continue;

        const index = tileIndex(world, x, y);
        // Unclaimed ground only. Taking a rival's tile is an act of war and belongs to the
        // objective, not to tidying up the border.
        if ((state.tileOwner[index] ?? -1) !== -1) continue;
        if (blockedBy(state, world, army, index, true) !== null) continue;

        const fromCity = Math.max(Math.abs(dx), Math.abs(dy));
        const fromArmy = chebyshev(world, index, army.tileIndex);
        if (fromCity > bestFromCity) continue;
        if (fromCity === bestFromCity && fromArmy >= bestFromArmy) continue;

        best = index;
        bestFromCity = fromCity;
        bestFromArmy = fromArmy;
      }
    }
  }
  return best;
}

/**
 * March at whoever is at the gates of one of our own settlements.
 *
 * The target is the **besieging army**, not the settlement: a siege is broken by driving the
 * besieger off, and an army that merely walks into the city changes nothing about who is
 * standing outside it. Whether a realm reacts to its own cities being invested at all is a
 * difficulty lever — the low rungs simply do not notice.
 */
function relieve(state: SimState, world: World, army: ArmyState, mind: Mind): boolean {
  if (!mind.level.reacts) return false;

  const besieged = state.cities
    .filter(
      (city) =>
        city.ownerIndex === mind.faction.index &&
        city.siege !== null &&
        chebyshev(world, city.tileIndex, army.tileIndex) <= mind.character.reach,
    )
    .sort(
      (a, b) =>
        chebyshev(world, a.tileIndex, army.tileIndex) -
          chebyshev(world, b.tileIndex, army.tileIndex) || a.cityIndex - b.cityIndex,
    )[0];
  if (!besieged) return false;

  const besieger = state.armies
    .filter(
      (other) =>
        other.ownerIndex === besieged.siege?.byIndex &&
        chebyshev(world, other.tileIndex, besieged.tileIndex) <= 1,
    )
    .sort((a, b) => a.id - b.id)[0];
  if (!besieger) return false;

  return orderMove(state, world, army.id, besieger.tileIndex).ok;
}

/**
 * Could this realm storm the settlement right now, walls and all?
 *
 * Counts everything either side could bring to a battle for it, because that is what the battle
 * itself counts: a settlement fight draws in every army within a 5 × 5 box (docs/MECHANICS.md
 * §6). Judging it as a duel between two stacks would have the AI walk into a relief force it
 * could already see.
 */
function assault(
  state: SimState,
  world: World,
  army: ArmyState,
  city: CityState,
  mind: Mind,
): boolean {
  const men = atTheWalls(state, world, mind, city.tileIndex, army);
  if (!judge(state, world, city, mind, men, true)) return false;
  return orderMove(state, world, army.id, city.tileIndex).ok;
}

/**
 * Whether `attacking` men are enough to take this settlement, walls or no walls.
 *
 * The only place the AI does combat arithmetic. Who counts as "attacking" is the caller's
 * business, and the two callers mean different things by it: choosing an objective counts every
 * army the realm is about to send, while deciding to storm the place counts only what is
 * actually within the 5 × 5 box the battle itself will draw on.
 */
function judge(
  state: SimState,
  world: World,
  city: CityState,
  mind: Mind,
  attacking: number,
  behindWalls: boolean,
): boolean {
  if (attacking === 0) return false;
  const tile = city.tileIndex;
  const advantage = defenderAdvantage(state, world, tile);
  const ground = behindWalls ? advantage.total : openFieldAdvantage(advantage);

  let defending = stackSoldiers(defenceOf(city)) + stackSoldiers(city.garrison);
  for (const enemy of state.armies) {
    if (enemy.ownerIndex !== city.ownerIndex) continue;
    if (chebyshev(world, enemy.tileIndex, tile) > RELIEF_RANGE) continue;
    defending += stackSoldiers(enemy.units);
  }
  // **What a defender is really worth, measured against the resolver rather than guessed at.**
  //
  // Two guesses came before this and both were wrong in a way that broke the campaign. Reading
  // the ground as a flat `1 + advantage` made the AI far too brave: a ruined realm recruited one
  // Light Infantry, marched it at a village held by one Light Infantry, lost it to the last man,
  // and did it again every eight months for a century. Reading it as the damage formula's ratio,
  // `(1 + advantage) / (1 - advantage)`, made it far too timid: it priced a walled city at
  // nineteen times its garrison, no realm could ever justify attacking another, and every border
  // on the map set like concrete by year twenty.
  //
  // So it is measured. Fighting equal Light Infantry on open ground across the whole range of
  // defender's advantage, the attacker needs **1.25 to 1 with no advantage at all**, rising to
  // about **3.5 to 1 at the 90% ceiling** — very nearly a straight line, and nothing like either
  // guess. `ai.test.ts` re-measures it and fails if the resolver ever drifts away from this.
  //
  // The 1.25 floor is the attacker's structural handicap: moving and striking are separate
  // actions, so whoever closes gives up the first blow.
  const effective = Math.floor((defending * (BREAK_EVEN + Math.floor((ground * GROUND_WORTH) / 1000))) / 1000);
  const needed = Math.floor((mind.level.oddsPermille * mind.character.aggressionPermille) / 1000);

  return attacking * 1000 >= effective * needed;
}

/** Attackers needed per defender on equal ground, per-mille. Measured, not chosen. */
export const BREAK_EVEN = 1250;

/** And how much each point of defender's advantage adds to that. Measured, not chosen. */
export const GROUND_WORTH = 2500;

/**
 * The men this realm would actually have on the field if the battle happened now — everything
 * inside the 5 × 5 box, which is the rule the battle itself uses (docs/MECHANICS.md §6).
 *
 * `also` is the army about to be ordered in. It counts wherever it is standing, and it is never
 * counted twice if it happens to be inside the box already.
 */
function atTheWalls(
  state: SimState,
  world: World,
  mind: Mind,
  tile: number,
  also?: ArmyState,
): number {
  let men = also ? stackSoldiers(also.units) : 0;
  for (const army of state.armies) {
    if (army.ownerIndex !== mind.faction.index || army.id === also?.id) continue;
    if (chebyshev(world, army.tileIndex, tile) > RELIEF_RANGE) continue;
    men += stackSoldiers(army.units);
  }
  return men;
}

/**
 * The one settlement this realm is trying to take this month, if any is worth taking.
 *
 * **Reach is measured from the realm's own borders, not from where an army happens to be
 * standing.** That is the difference between a realm that campaigns and one that stops: armies
 * cross their own territory to reach the frontier, and every settlement taken moves the frontier
 * outward and brings the next ring into view. Measured from the army instead, every border on the
 * map set inside fifteen years — armies with nothing in sight walked home, and home was never
 * near anything new.
 *
 * **And the odds are judged on everything the realm could bring**, not on whichever stack asked
 * first. A realm that judges one army at a time never attacks a real city, because no single army
 * it is permitted to raise is enough on its own.
 *
 * Nearest to the border wins, so a realm eats outward from what it holds instead of walking
 * across Europe to the juiciest target on the map.
 */
function pickObjective(
  state: SimState,
  world: World,
  mind: Mind,
  armies: readonly ArmyState[],
): CityState | undefined {
  const border = state.cities.filter((city) => city.ownerIndex === mind.faction.index);
  if (border.length === 0 || armies.length === 0) return undefined;

  let best: CityState | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const city of state.cities) {
    if (city.ownerIndex === mind.faction.index) continue;

    const fromHome = border.reduce(
      (near, own) => Math.min(near, chebyshev(world, city.tileIndex, own.tileIndex)),
      Number.POSITIVE_INFINITY,
    );
    if (fromHome > mind.character.reach) continue;
    // Cities are scanned in index order, so a strict `<` leaves the lowest index holding a tie.
    if (fromHome >= bestDistance) continue;
    if (!willAttack(state, city, mind)) continue;

    // Every army close enough to march there is counted, because they are all about to be sent.
    const force = armies
      .filter((army) => chebyshev(world, army.tileIndex, city.tileIndex) <= mind.character.reach * 2)
      .reduce((men, army) => men + stackSoldiers(army.units), 0);
    if (force === 0) continue;

    // Storming is always acceptable; starving it out only if this realm has the stomach for it.
    const takeable =
      judge(state, world, city, mind, force, true) ||
      (mind.character.prefersSiege && judge(state, world, city, mind, force, false));
    if (!takeable) continue;

    best = city;
    bestDistance = fromHome;
  }
  return best;
}

/**
 * Whether this realm's character permits an attack on that one — the scruples, in one place.
 *
 * The **Independents are never a realm**: they are the unclaimed ground everyone expands into,
 * so none of this applies to them. A Peaceful realm that would not touch a neighbour will still
 * settle an independent village, which is what stops "peaceful" meaning "inert".
 */
function willAttack(state: SimState, city: CityState, mind: Mind): boolean {
  const owner = state.factions[city.ownerIndex];
  if (!owner || owner.index === mind.faction.index) return false;
  // A realm nobody plays and that never marches is ground, not an enemy.
  if (owner.ai === null && owner.index !== state.playerFactionIndex) return true;

  if (!mind.character.attacksRealms) return false;

  // No kicking a realm somebody else already has by the throat.
  if (!mind.character.dogpiles) {
    const beset = state.cities.some(
      (other) =>
        other.ownerIndex === owner.index &&
        other.siege !== null &&
        other.siege.byIndex !== mind.faction.index,
    );
    if (beset) return false;
  }

  // And no picking on somebody far beneath you. Honour is the only thing that sets this above
  // zero, and it is the one trait here that costs the realm holding it something real.
  const floor = mind.character.bullyFloorPermille;
  if (floor > 0) {
    const theirs = mind.strength[owner.index] ?? 0;
    const ours = mind.strength[mind.faction.index] ?? 0;
    if (theirs * 1000 < ours * floor) return false;
  }
  return true;
}

/**
 * Walk to the target — onto it if it can be stormed, up to its gates if it must be starved.
 *
 * One pathfind, not nine: the route to the settlement passes through a tile adjacent to it, so
 * the second-to-last step of that route **is** the place to sit down and invest it, and it is
 * reachable by construction. A route of length one means the army is already at the gates.
 */
function march(
  state: SimState,
  world: World,
  army: ArmyState,
  city: CityState,
  mind: Mind,
): void {
  // Storming is judged on what is at the walls now, not on what is on its way: an army that
  // marches onto the tile fights the moment it arrives, alone if it is the first there.
  const men = atTheWalls(state, world, mind, city.tileIndex, army);
  if (judge(state, world, city, mind, men, true)) {
    orderMove(state, world, army.id, city.tileIndex);
    return;
  }

  const route = findPath(state, world, army, city.tileIndex);
  if (!route || route.length === 0) return;

  const gate = route[route.length - 2];
  if (gate !== undefined) {
    orderMove(state, world, army.id, gate);
    return;
  }

  // Already at the gates and not strong enough to go in. A realm that will starve a city out
  // invests it; one that will not simply waits there for the rest of the army to arrive and
  // tries the walls again next month. **This is where honour actually costs something** — it
  // has to mass a force big enough to storm, while everyone else only has to outlast the grain.
  if (mind.character.prefersSiege) beginSiege(state, world, army.id);
}

/**
 * Nothing worth attacking. Go and pick up the men waiting in the settlement with the most of
 * them — but only if this army still has room for them.
 *
 * The muster point matters because `mobilise` only works on the tile an army is standing on, and
 * a realm may raise only so many armies: troops finished in a settlement no army ever visits sit
 * on its walls forever. A realm holding eight cities was fielding three stacks of four while
 * twenty-eight units stood around doing nothing, and a realm that cannot concentrate cannot break
 * anybody's wall.
 *
 * **A full army stays where it is**, which is the other half of the same lesson. Sending every
 * idle army to the biggest garrison put every realm's entire strength on one tile, and a city
 * with a realm's whole army parked on it is a city no neighbour will ever attack. Twelve realms
 * did that at once and the map set like concrete for eighty years.
 */
function regroup(state: SimState, world: World, army: ArmyState, mind: Mind): void {
  if (stackSize(army.units) >= Math.min(MAX_ARMY_UNITS, mind.level.armyUnits)) return;

  let muster: CityState | undefined;
  let best = 0;
  let nearest = Number.POSITIVE_INFINITY;

  for (const city of state.cities) {
    if (city.ownerIndex !== mind.faction.index) continue;
    const waiting = stackSize(city.garrison);
    if (waiting === 0) continue;
    const distance = chebyshev(world, city.tileIndex, army.tileIndex);
    // Most men wins; distance breaks the tie, then the city index, so it is stable.
    if (waiting > best || (waiting === best && distance < nearest)) {
      best = waiting;
      nearest = distance;
      muster = city;
    }
  }
  if (!muster || muster.tileIndex === army.tileIndex) return;
  orderMove(state, world, army.id, muster.tileIndex);
}

// ------------------------------------------------------------------ reporting

export interface AiSummary {
  cities: number;
  units: number;
  soldiers: number;
  armies: number;
}

/** What a realm has, for the balance panel. Read-only, and derived like everything else there. */
export function aiSummary(state: SimState, factionIndex: number): AiSummary {
  const cities = state.cities.filter((city) => city.ownerIndex === factionIndex);
  const armies = state.armies.filter((army) => army.ownerIndex === factionIndex);
  return {
    cities: cities.length,
    units: forceOf(state, factionIndex),
    soldiers: realmStrengths(state)[factionIndex] ?? 0,
    armies: armies.length,
  };
}
