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
import { canEmbarkFrom, recruitableUnits, unitById, type LandUnit } from '../data/units';
import { featureAt, terrainAt, type World } from '../data/world';
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
import { isCoastal } from './fleets';
import { landmassOf, reachedIn, sameLandmass, walkingDistanceFrom } from './geography';
import { runNavy } from './navalAi';
import { freeManpower } from './manpower';
import { blockedBy, findPath, orderMove } from './movement';
import {
  MAX_ARMY_UNITS,
  type ArmyRole,
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
  /**
   * True walking distance from this realm's nearest settlement to every tile on the map, and
   * `UNREACHABLE` for everywhere its armies could never get to on foot.
   *
   * One breadth-first sweep a month, per realm — see geography.ts. It replaces the straight-line
   * measure this used to campaign on, which counted a city across a strait as a near neighbour and
   * pinned whole realms on objectives they could not reach.
   */
  home: Int32Array;
  /**
   * The landmasses this realm can reach that still have unclaimed ground on them.
   *
   * A claiming stack can only ever claim on the landmass it is standing on, but a stack is founded
   * wherever a garrison happens to spill over — so an empire spanning Iberia and Anatolia founded
   * all of its claimers in Europe and left the Sahara behind Morocco bare for the whole campaign.
   * Consulted when the role is chosen, so a claimer is only raised where there is work for it.
   */
  bare: ReadonlySet<number>;
  /**
   * The realm's own coastal harbours, and whether anything worth taking is across water.
   *
   * Both exist for one behaviour: **an army with nothing to do on this continent goes and waits for
   * a boat** (docs/DESIGN.md decision 147). A realm that has conquered its whole landmass has
   * objectives it cannot walk to, raids it cannot ride to and ground it cannot claim, so every
   * branch of `order` failed and every army stood still — measured at 1600 as **66 of 66 idle**,
   * while the realm's fleets sailed busily about with nothing to carry.
   */
  harbours: readonly CityState[];
  overseasTargets: boolean;
  /**
   * Tiles a settlement stands on, and whose open ground this realm is willing to take.
   *
   * Both exist purely for speed, and the speed is not a nicety. `sweepForGround` walks all 2,450
   * tiles once a month for nearly every army in the world; asking "is there a city here" and "would
   * I attack this owner" inside that loop meant three scans of the city list per tile, which cost a
   * decade at maximum speed six seconds instead of half of one. Computed once per realm per month.
   */
  cityTiles: ReadonlySet<number>;
  /** Indexed by faction. True where this realm would take that realm's fields. */
  takeableFrom: readonly boolean[];
  /**
   * The realm's own settlements, nearest an enemy first. Memoised — see `frontierSettlements`.
   *
   * Filled on first use rather than up front, because a realm with no border guards and no muster
   * this month never asks, and asking costs a breadth-first sweep of the whole map.
   */
  frontier?: CityState[];
  /** Nothing on this continent left to attack. Decides whether a border guard still has a border. */
  noLandWar: boolean;
}

export function runAi(state: SimState, world: World): void {
  const strength = realmStrengths(state);
  // Shared by every realm this month. `sweepForGround` asks about it 2,450 times per army.
  const cityTiles = new Set(state.cities.map((city) => city.tileIndex));

  for (const faction of state.factions) {
    if (!faction.alive || !faction.ai) continue;
    const level = difficultyProfile(faction.ai.difficulty);
    const character = personalityProfile(faction.ai.personality);

    // Rolled unconditionally, before anything can return early, so the random stream depends
    // only on which realms are alive — not on what each of them happened to find to do.
    const wasted = nextRandomInt(state, 1000) < level.ditherPermille;
    if (wasted) continue;

    // Measured from the realm's settlements, so "near" means near to something it holds rather
    // than near to whichever army happens to be standing closest. One sweep serves every
    // question this realm asks this month.
    const mine = state.cities.filter((city) => city.ownerIndex === faction.index);

    /**
     * **A landed army is its own frontier** — since 0.18.0.
     *
     * Reach is measured from a realm's borders and not from where an army happens to stand
     * (decision 88), and that is still right for a campaign on one continent: a stack that wanders
     * must not quietly extend what the realm considers near.
     *
     * An expeditionary force has no border to be measured from. Put six units ashore in Ireland and
     * every Irish city still reads as infinitely far, because the sweep starts from settlements and
     * the realm has none there — so the army that just crossed an ocean is handed no objective and
     * stands on its beach until the winter takes it.
     *
     * So the exception is drawn exactly around that case, and no wider: an army counts as a source
     * **only on a landmass where its realm holds no settlement at all.** On its home continent
     * nothing changes, which is why no existing behaviour moved.
     */
    const settled = new Set(mine.map((city) => landmassOf(world, city.tileIndex)));
    const beachheads = state.armies
      .filter(
        (army) =>
          army.ownerIndex === faction.index && !settled.has(landmassOf(world, army.tileIndex)),
      )
      .map((army) => army.tileIndex);

    const home = walkingDistanceFrom(world, [
      ...mine.map((city) => city.tileIndex),
      ...beachheads,
    ]);

    // One pass over the map, reusing the sweep above: which landmasses still have ground on them
    // that this realm could walk to and nobody owns.
    const bare = new Set<number>();
    for (let index = 0; index < state.tileOwner.length; index++) {
      if ((state.tileOwner[index] ?? -1) !== -1) continue;
      if (!Number.isFinite(reachedIn(home, index))) continue;
      bare.add(landmassOf(world, index));
    }

    const harbours = mine.filter(
      (city) => !city.siege && canEmbarkFrom(city.buildings) && isCoastal(world, city.tileIndex),
    );

    const mind: Mind = {
      faction,
      level,
      character,
      strength,
      home,
      bare,
      harbours,
      cityTiles,
      takeableFrom: [],
      overseasTargets: false,
      noLandWar: false,
    };
    /**
     * Whose fields this realm would take, decided **once per realm** rather than once per tile.
     *
     * `willAttack` is asked about a settlement, so one is picked per owner to stand for the realm —
     * its lowest-indexed city, which is stable. The scruples it applies (dogpiling, the bully floor)
     * are properties of the *realm*, not of the individual settlement, so any of them answers the
     * same. Filled after the Mind exists because `willAttack` needs one.
     */
    const takeable: boolean[] = state.factions.map(() => false);
    for (const other of state.factions) {
      if (other.index === faction.index) continue;
      const theirs = state.cities.find((city) => city.ownerIndex === other.index);
      takeable[other.index] = theirs !== undefined && willAttack(state, theirs, mind);
    }
    mind.takeableFrom = takeable;

    // Filled after the Mind exists because `willAttack` needs one. Anything worth taking that no
    // army of this realm can walk to — which is what makes a port worth marching to.
    mind.overseasTargets =
      harbours.length > 0 &&
      state.cities.some(
        (city) =>
          city.ownerIndex !== faction.index &&
          !Number.isFinite(reachedIn(home, city.tileIndex)) &&
          willAttack(state, city, mind),
      );
    develop(state, world, mind);

    /**
     * **The navy decides before the army does, and that ordering is load-bearing.**
     *
     * A crew and a spearman come out of the same fifth of a realm's people (decision 127), and
     * `levy` will spend every last man of it. Running the navy afterwards meant a realm with a real
     * army could never lay down a hull: `queueShip` refused for manpower, every year, for ever.
     * Measured — the Turks ended a campaign with 81 armies, 8 harbours and a chosen target four sea
     * tiles away that they had never built a single transport for.
     *
     * So ships get first claim. It costs the land war very little, because a realm lays down at most
     * one hull a year and only while it actually has an expedition in mind.
     *
     * Ordering `runNavy` before `campaign` also works in its favour: an army called to the quay is
     * given its route here, and `campaign` only re-orders stacks whose route is empty, so the
     * summons sticks instead of being overwritten the same month it was issued.
     *
     * The scruples cross the water with it. `willAttack` is handed in rather than reimplemented, so
     * a Peaceful realm sails to independent cities and not to a rival's, an Honorable one still
     * declines to pile onto a realm somebody else has by the throat, and none of that had to be
     * written twice.
     */
    // Whether the realm has any land war left at all. This is the Britons on their island and the
    // Moors in North Africa — realms that take everything their continent offers and then stop
    // playing, because nothing they can march to is worth attacking. They should be pouring
    // everything into the sea instead, and `runNavy` gives them a bigger appetite for it.
    const landlocked = !anyLandTarget(state, world, mind);
    mind.noLandWar = landlocked;

    runNavy(state, world, faction.index, home, (city) => willAttack(state, city, mind), landlocked);
    levy(state, world, mind);
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

/**
 * A claiming stack is **one unit** — not a tuning number, the definition of the role.
 *
 * Claiming ground needs feet, not soldiers, and the whole point of detaching one is that it costs
 * the war as little as it possibly can. It is stated once because two places depend on it: `muster`
 * raises exactly this many, and `order` hands anything larger back to the field force.
 */
/**
 * What a realm with only overseas enemies still spends on soldiers, per-mille. **[GEN]**
 *
 * Two thirds. The remaining third of its people goes into crews instead, which is what the ships
 * were short of. Not zero: garrisons still matter, the boats still need stacks to carry, and a realm
 * that stopped recruiting entirely would be helpless the first time somebody landed on it.
 */
const OVERSEAS_ARMY_PERMILLE = 660;

const CLAIM_STACK_UNITS = 1;

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

  // **How many diggings at once is a difficulty lever.** It used to be one, realm-wide, for
  // everybody — so a realm holding forty tiles finished roughly one farm a year and its conquests
  // stayed bare ground for a century. A King now runs four. It is still a small number on purpose:
  // an AI with ten half-dug mines has none.
  let underway = 0;
  for (let i = 0; i < state.improvementMonths.length; i++) {
    if ((state.improvementMonths[i] ?? 0) > 0 && state.tileOwner[i] === mind.faction.index) {
      underway += 1;
      if (underway >= mind.level.improvementsAtOnce) return;
    }
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
function levy(state: SimState, world: World, mind: Mind): void {
  const held = state.cities.filter((city) => city.ownerIndex === mind.faction.index);
  if (held.length === 0) return;

  // **What it wants is the army it can actually field, plus the garrison it means to keep.**
  //
  // Both halves matter, and getting either wrong kills the campaign. Too little and a realm that
  // has conquered nine cities still fields the army of one, cannot break anybody's walls, and
  // every border on the map freezes. Too much and the surplus it can never march has nowhere to
  // go but the garrisons — where it becomes a defence nobody can attack either, which freezes
  // the map from the other direction. The first version of this file did both in turn.
  // **Scaled by what the realm holds, and capped by nothing else.** Since 0.17.1 there is no
  // ceiling on how many armies a realm may field: if it can pay for troops and spare the people,
  // it raises them. A realm of nine cities wants nine settlements' worth of army, and the limits
  // that remain are the honest ones — the treasury, the manpower ceiling and the levy floors.
  /**
   * **A realm that can only fight overseas wants a smaller army and a bigger navy** —
   * owner-specified in 0.18.5: "instead of building so much army, they should also focus on ships".
   *
   * The appetite is otherwise proportional to what the realm holds, which is right while there is a
   * land war. Once every enemy is across water, an extra spearman in Castille is worth nothing and
   * an extra transport is worth an army — and the two compete for the same people, since a crew
   * counts against the manpower ceiling like any other levy (decision 127).
   *
   * A third off, not a halt. The realm still needs garrisons, still needs stacks to load onto the
   * boats, and may yet be landed on itself.
   */
  const overseasOnly = mind.overseasTargets && !anyLandTarget(state, world, mind);
  const appetite = overseasOnly ? OVERSEAS_ARMY_PERMILLE : 1000;
  const wanted = Math.floor(
    ((held.length * mind.level.armyUnits + held.length * mind.character.garrisonKeep) * appetite) /
      1000,
  );
  if (forceOf(state, mind.faction.index) >= wanted) return;
  if (mind.faction.monthlyIncome.gold <= 0) return;

  for (const city of held) {
    if (city.siege || city.recruitQueue.length > 0) continue;
    const unit = rolledUnit(state, city, mind);
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
 * **Three ceilings, and the lowest wins.** The realm's manpower ceiling is checked first and is
 * the only one that is not local: a rival at its limit trains nothing anywhere, however full its
 * settlements are, exactly as the player's recruit panel refuses. It plays the same rule.
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
/**
 * Everything this settlement could actually start today — the three ceilings, applied once.
 *
 * Split out of `bestUnit` when the roster choice stopped being a single argmax: every branch of
 * that roll needs the same filter, and a branch that picked a unit the settlement could not pay
 * for, crew or feed would silently produce nothing.
 */
function buildableHere(state: SimState, city: CityState, mind: Mind): readonly LandUnit[] {
  const purse = mind.faction.monthlyIncome.gold;
  const earned = settlementUpgradeTo(city.tier)?.minPopulation ?? 0;
  const floor = Math.max(mind.character.levyFloor, earned);
  const manpower = Math.min(
    availableManpower(city),
    Math.max(0, city.population - floor),
    freeManpower(state, city.ownerIndex),
  );

  return recruitableUnits(city.tier, city.buildings).filter(
    (unit) =>
      unit.size <= manpower &&
      canAfford(state, city.ownerIndex, unit.cost) &&
      // Net income already has today's wages taken off it, so this leaves room for one more unit
      // beyond the one being ordered — a margin, not a knife edge.
      purse >= unit.upkeep * 2,
  );
}

/** The original argmax: men × hit points × damage, bent by the personality's taste in troops. */
function strongest(options: readonly LandUnit[], mind: Mind): LandUnit | undefined {
  const bias = mind.character.unitBias;
  let best: LandUnit | undefined;
  let bestScore = 0;

  for (const unit of options) {
    const score = Math.floor((unit.size * unit.hp * unit.damage) / 100) * bias[unit.class];
    if (score > bestScore || (score === bestScore && best && unit.id < best.id)) {
      bestScore = score;
      best = unit;
    }
  }
  return best ?? options[0];
}

/**
 * The two units the owner named as the missile arm — docs/DESIGN.md decision 130.
 *
 * Named rather than derived from `range > 0`, because that would sweep in the Skirmisher, and the
 * owner asked for "a random archer or cavalry archer".
 */
const MISSILE_UNITS = ['archer', 'cavalry_archer'] as const;

/**
 * What a realm actually recruits — **owner-specified in 0.18.1**.
 *
 * The old rule was a pure argmax on `size × hp × damage`, and its consequence was a game with one
 * unit in it: heavy_cavalry scores 3200 against sword_infantry's 2250, so **every** realm of every
 * personality bought heavy cavalry the moment it could pay the wages, and spear infantry — which
 * does double damage to horse — was never built by anybody in a hundred and twenty years.
 *
 * So the choice is now a roll of three, in equal thirds:
 *
 * 1. **The strongest it can build**, exactly as before, bent by personality. Realms still reach for
 *    quality, and a Defensive realm still reaches differently from an Ambitious one.
 * 2. **A missile unit** — an Archer or a Cavalry Archer.
 * 3. **A ground unit** — anything that fights hand to hand, horse included.
 *
 * **Rerolled until it lands on something the settlement can actually produce**, which is the clause
 * that makes it safe: a Village with no Archery Range rolls the missile third and simply rolls
 * again, rather than ordering nothing that month. Bounded, and falling back to the strongest
 * buildable unit, because an unbounded reroll against an empty category never returns.
 *
 * The point is an army with a shape. A realm that fields archers behind spears loses to cavalry
 * far less badly than one that fields nothing but cavalry, and the counters the roster already
 * has — `antiCavalry`, `rangedResist`, the charge — start to matter for the first time.
 */
const RECRUIT_ROLL_TRIES = 12;

function rolledUnit(state: SimState, city: CityState, mind: Mind): LandUnit | undefined {
  const affordable = buildableHere(state, city, mind);
  if (affordable.length === 0) return undefined;

  const missile = affordable.filter((unit) => (MISSILE_UNITS as readonly string[]).includes(unit.id));
  const ground = affordable.filter((unit) => unit.range === 0);

  for (let attempt = 0; attempt < RECRUIT_ROLL_TRIES; attempt++) {
    const third = nextRandomInt(state, 3);

    if (third === 0) return strongest(affordable, mind);
    if (third === 1) {
      if (missile.length > 0) return missile[nextRandomInt(state, missile.length)];
      continue;
    }
    if (ground.length > 0) return ground[nextRandomInt(state, ground.length)];
  }

  // Every roll landed on a category this settlement cannot build. Take the best it can.
  return strongest(affordable, mind);
}

// --------------------------------------------------------------------- war

/**
 * Fronts a realm can fight at once — one per this many settlements. **[GEN]**
 *
 * Six, capped at four fronts. A realm of six cities has one war; an empire of twenty-four has four,
 * which is about as many directions as it has borders.
 */
const SETTLEMENTS_PER_FRONT = 6;
const MAX_FRONTS = 4;

/**
 * The realm's war, for one month.
 *
 * **One objective per front, and armies go to the nearest front.** The rule this replaces — one
 * objective for the *whole realm* — exists for a good reason and is still the right rule for a
 * small realm: no single army a realm is allowed to raise beats a built-up City with a garrison in
 * it, so a realm that judges each stack separately concludes there is nothing to do anywhere and
 * every border on the map sets like concrete. Sending everything at one place is what wins a war.
 *
 * But it does not scale. Measured at 120 years, the Turks held 22 cities and 74 armies and were
 * pointing all of them at **one** city — most of them walking across an empire to get there, most
 * of the way, most of the time. A realm that large has several borders and should be pushing on
 * several of them (docs/DESIGN.md decision 136).
 *
 * So the count scales with what the realm holds, one front per six settlements to a maximum of
 * four, and each army is sent to whichever front is nearest **it**. A small realm gets exactly one
 * front and therefore exactly the old behaviour, which is why nothing about the early game moved.
 */
function campaign(state: SimState, world: World, mind: Mind): void {
  muster(state, world, mind);

  const armies = [...armiesOf(state, mind.faction.index)].sort((a, b) => a.id - b.id);
  const held = state.cities.filter((c) => c.ownerIndex === mind.faction.index).length;
  const fronts = Math.max(1, Math.min(MAX_FRONTS, Math.floor(held / SETTLEMENTS_PER_FRONT)));
  let objectives = pickObjectives(state, world, mind, armies, fronts);

  // **The floor.** Nothing the realm can beat is not the same as nothing to do — see
  // `desperateObjective`. Only consulted when the ordinary choice came back empty.
  if (objectives.length === 0 && armies.length > 0) {
    const last = desperateObjective(state, world, mind);
    if (last) objectives = [last];
  }
  const objective = objectives[0];

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
  // Since 0.16.0 a realm raises **dedicated** claiming stacks — one unit, one job — so this only
  // still matters for a realm whose tables give it none, or which has not raised one yet.
  const settler =
    objective && !armies.some((army) => army.role === 'claim')
      ? [...armies]
          .filter((army) => army.path.length === 0 && army.role === 'field')
          .sort((a, b) => stackSize(a.units) - stackSize(b.units) || a.id - b.id)[0]
      : undefined;

  for (const army of armies) {
    // An army already walking somewhere is left to walk. Re-planning every month would produce
    // a realm whose armies oscillate between two targets and never reach either.
    if (army.path.length > 0) continue;
    order(state, world, army, mind, nearestFront(world, army, objectives), !objective || army.id === settler?.id);
  }
}

/**
 * Which of the realm's wars this army belongs to — whichever front is closest to it.
 *
 * Straight-line distance is deliberate and sufficient. This only decides which of two or three
 * objectives a stack is pointed at; `march` does the real pathfinding afterwards and will discover
 * if there is no route. Ties go to the earlier front, which is the higher-priority one, because
 * `pickObjectives` returns them in the order it chose them.
 */
function nearestFront(
  world: World,
  army: ArmyState,
  objectives: readonly CityState[],
): CityState | undefined {
  if (objectives.length <= 1) return objectives[0];

  let best: CityState | undefined;
  let nearest = Number.POSITIVE_INFINITY;
  for (const city of objectives) {
    const distance = chebyshev(world, city.tileIndex, army.tileIndex);
    if (distance >= nearest) continue;
    nearest = distance;
    best = city;
  }
  return best;
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

    // What this stack is for decides how big it is and what goes in it, so it is chosen before
    // anything is picked out of the garrison rather than after.
    let role = standing ? 'field' : nextRole(state, world, mind);

    // **A claimer is only raised where there is ground for it to claim.** It can never leave the
    // landmass it was founded on, so one raised in a settlement whose continent is already full is
    // a unit taken out of the war to walk in circles — and, worse, it fills the realm's claiming
    // quota, so the settlement that *is* next to bare ground never gets one.
    if (role === 'claim' && !mind.bare.has(landmassOf(world, city.tileIndex))) role = 'field';

    const wanted =
      role === 'claim' ? CLAIM_STACK_UNITS : role === 'raid' ? mind.character.raidUnits : spare;

    /**
     * **Founding a new stack costs half a proper army's worth of men — but only a *field* stack.**
     *
     * There is still no cap on how many armies a realm fields; what changed in 0.18.2 is the bar,
     * which was two units for everything and is now half of what this difficulty calls a full army.
     *
     * Two was much too low for a field army. Measured at 120 years, the world ran **158 armies
     * averaging 3.9 units, 78% of them four units or fewer** — the Turks alone fielded 74 stacks of
     * about four across 22 cities. A realm with twenty settlements founded twenty tiny armies, one
     * per garrison that happened to have a spare pair, and none of them could take anything. An army
     * of four is not a smaller version of an army of twelve; it is a rounding error with upkeep.
     *
     * **The bar is per role, and that is not a detail.** A claimer is *meant* to be one unit and a
     * raiding column three; holding them to a field army's bar stopped a realm raising either, and
     * the first version of this change left 8.6% of reachable ground permanently bare because the
     * claimers it needed could never be founded. So the threshold is whatever this role actually
     * wants, and only the field force — where `wanted` is "everything spare" — is held to the half.
     *
     * Raising the bar does not cost the realm those men. They stay in the garrison, and `regroup`
     * walks an understrength stack round to collect them — which is what that function was always
     * for and what these tiny foundlings were quietly bypassing.
     */
    const half = Math.max(2, Math.ceil(Math.min(MAX_ARMY_UNITS, mind.level.armyUnits) / 2));
    const foundAt = role === 'field' ? half : Math.max(1, wanted);
    if (!standing && fielded > 0 && spare < foundAt) continue;

    const room = Math.min(spare, wanted, MAX_ARMY_UNITS);
    if (room <= 0) continue;

    // A raiding column wants horse and nothing else if it can get it — the whole value of a raid
    // is arriving somewhere before the defence does, and foot now takes two months a tile.
    const order =
      role === 'raid'
        ? Object.keys(city.garrison).sort(
            (a, b) =>
              (unitById(b)?.strategicSpeed ?? 0) - (unitById(a)?.strategicSpeed ?? 0) ||
              a.localeCompare(b),
          )
        : Object.keys(city.garrison).sort();

    const picks: Record<string, number> = {};
    let taken = 0;
    let skipped = 0;
    for (const id of order) {
      for (let i = 0; i < (city.garrison[id] ?? 0); i++) {
        if (skipped < mind.character.garrisonKeep) {
          skipped += 1;
          continue;
        }
        if (taken >= room) break;
        picks[id] = (picks[id] ?? 0) + 1;
        taken += 1;
      }
    }
    if (taken > 0) mobilise(state, world, city, picks, role);
  }
}

/**
 * What the next army this realm raises should be for — docs/MECHANICS.md §8.
 *
 * **Difficulty says how many specialists a realm may run; personality says whether it wants them
 * and how big they are.** A Recruit gets one army and it is the war. A Defensive King holds two
 * frontier settlements with three units each and still fields a main force.
 *
 * Filled in a fixed order — guards, then claimers, then raiders, then the field — so the shape a
 * realm ends up with is a property of its tables rather than of which settlement happened to have
 * a spare unit first. The field force is the default and the remainder, which is what keeps a
 * realm capable of taking a city at all.
 */
function nextRole(state: SimState, world: World, mind: Mind): ArmyRole {
  const mine = armiesOf(state, mind.faction.index);
  const count = (role: ArmyRole) => mine.filter((army) => army.role === role).length;

  // Nothing is detached until the realm has a war to detach from. A realm whose first army rides
  // off raiding never takes anything, and its one stack is its entire ability to act.
  if (mine.length === 0) return 'field';

  // **Half the armies, rounded up, always belong to the field force.** Without the reserve a realm
  // posts a guard, raises a claimer and has nothing left to fight the war with — a realm with
  // hobbies rather than a war. Measured against what it actually fields rather than against a cap,
  // because since 0.17.1 there is no cap: a realm of twenty armies may detach ten.
  const detached = mine.length - count('field');
  if (detached >= Math.floor(mine.length / 2)) return 'field';

  // **The quotas scale with the realm.** They are per four settlements rather than absolute: with
  // no cap on armies any more, a fixed "two raiding columns" would mean an empire of thirty cities
  // ran the same two a village does. Difficulty still sets the rate.
  const scale = Math.max(1, Math.ceil(state.cities.filter((c) => c.ownerIndex === mind.faction.index).length / 4));
  const posts = Math.min(
    mind.level.guardStacks * scale,
    frontierSettlements(state, world, mind).length,
  );
  const wantsGuard = count('guard') < posts;
  const wantsRaid = mind.character.raidUnits > 0 && count('raid') < mind.level.raidStacks * scale;

  // **The personality is a pair of odds, not an ordering.** Since 0.17.0 no realm has a distance
  // beyond which it stops looking for something to conquer, so what makes one realm feel different
  // from another is what it does with the armies it raises: Ambitious sends two in five off
  // raiding and posts one in ten to the border, Defensive does very nearly the reverse, and
  // Peaceful never raids at all.
  //
  // Rolled once, from `state.rng`, so the split is a property of the campaign seed rather than of
  // which settlement happened to have a spare unit this month — and so a reloaded save produces
  // the same realm it did before.
  const roll = nextRandomInt(state, 1000);
  if (wantsRaid && roll < mind.character.raidPermille) return 'raid';
  if (wantsGuard && roll < mind.character.raidPermille + mind.character.guardPermille) {
    return 'guard';
  }

  // Claiming is the fallback rather than a competitor, because it is the one job that needs no
  // dedicated stack: `campaign` already hands it to the weakest idle field army when no claimer
  // exists. Spending a scarce detachment slot on a thing the realm gets free is how raiders and
  // border guards failed to appear at all in 0.16.0.
  //
  // **Scaled like the others**, and it was not. A realm of thirty cities ran the same one or two
  // claimers a village did, so with 139 armies on the map a century in there were two claiming
  // stacks in the entire world — and a fifth of the land was still bare.
  if (count('claim') < mind.level.claimStacks * scale) return 'claim';
  return 'field';
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
  // **A claiming stack that has grown is not a claiming stack.** Nothing kept one at one unit
  // once it existed: `mobilise` tops up whatever army is already standing on the settlement and
  // keeps that army's role, and `occupy` folds any friendly stack it walks into. So a realm ended
  // up with seventeen units labelled `claim`, ferrying themselves to one bare field at a time and
  // taken out of the war for the whole campaign — which is why the map stopped filling in around
  // year 1430 while nine "claimers" stood on it.
  //
  // Handing it back to the war costs the realm nothing it was using, and frees the quota so
  // `muster` founds a fresh single unit for the job.
  if (army.role === 'claim' && stackSize(army.units) > CLAIM_STACK_UNITS) army.role = 'field';

  if (relieve(state, world, army, mind)) return;

  /**
   * **A guard with no border to watch is released to the field** — owner-specified in 0.18.6.
   *
   * A border guard holds its settlement and goes nowhere; relieving a siege is the one thing that
   * moves it, and that is handled above. But "border" assumes there is one. A realm that has taken
   * its whole landmass has no frontier an army can walk across, so every guard it posted is watching
   * an empty horizon for ever — and they are raised in numbers, one per frontier settlement per four
   * settlements held. The owner watched twenty units sit in Cyprus beside a twenty-ship fleet with
   * free berths: they were guards, and guards do not board.
   *
   * Handing them back to the field force makes them cargo like anything else. Nothing is left
   * undefended by it: a settlement's derived defenders cannot leave the walls and were always the
   * real garrison, and a guard stack was only ever the extra.
   */
  if (army.role === 'guard' && mind.noLandWar) army.role = 'field';

  // **A border guard holds its settlement and does not go anywhere else.** Relieving a siege is
  // the one thing that moves it, and that is handled above — a garrison that abandons its post
  // to chase an objective is not a garrison, and the border it was watching is why it exists.
  if (army.role === 'guard') {
    const post = frontierSettlements(state, world, mind)[0];
    if (post && army.tileIndex !== post.tileIndex) orderMove(state, world, army.id, post.tileIndex);
    return;
  }

  // A claiming stack only ever tidies ground. It is one unit; sending it at a city would lose it
  // for nothing, and the ring around a realm's settlements is never finished for long.
  //
  // **And it has no radius at all.** This is the stack whose entire job is unclaimed ground, so
  // bounding it was what left whole regions bare — see `pickClaim`.
  if (army.role === 'claim') {
    const ground = pickClaim(state, world, army, mind, Number.POSITIVE_INFINITY);
    if (ground >= 0) orderMove(state, world, army.id, ground);
    else regroup(state, world, army, mind);
    return;
  }

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
  // A *field* army tidying up on the way is bounded by `claimRadius`, and must be: it is the war,
  // and an unbounded search would always find it one more field to walk to.
  //
  // **Unless there is no war.** The radius exists only to stop a field army being distracted from
  // an objective, so a realm that has no objective — nothing on the map it can reach and beat — is
  // not being kept for anything, and the bound does the opposite of its job: it makes the army
  // stand still next to ground it could have taken. This is the Moors, who took Fez and Marrakesh
  // and then sat on the coast for a century with the Sahara bare four tiles inland.
  if (mayClaim) {
    const bound = objective ? mind.character.claimRadius : Number.POSITIVE_INFINITY;
    const ground = pickClaim(state, world, army, mind, bound);
    if (ground >= 0) {
      orderMove(state, world, army.id, ground);
      return;
    }
  }

  // Raiders ignore the realm's objective entirely and ride for the deepest thing they can reach.
  // Falling back to the war rather than to standing still keeps a column useful once it has run
  // out of anywhere to raid.
  if (army.role === 'raid') {
    const prize = pickRaid(state, world, mind, army);
    // A raid that cannot be routed falls through to the war rather than standing still.
    if (prize && march(state, world, army, prize, mind)) return;
  }

  /**
   * **No objective is not a reason to stand still** — owner-specified in 0.18.4.
   *
   * "There should never be a stalemate." Measured at 1500, there always was: **52 of 52 armies
   * idle**, battles down to a trickle, one realm holding 45 cities and four holding 2–7 apiece and
   * doing nothing for two hundred years.
   *
   * Two quite different realms end up here and both were frozen by the same gap. The **weak** one
   * has objectives it cannot win, so `judge` refuses them all and it never fights again. The
   * **dominant** one has taken every city it can walk to, so everything left is across water and
   * `pickObjectives` filters it out — which is why a realm that conquers mainland Europe stops
   * moving its armies while its fleets sail busily around (exactly what the owner saw).
   *
   * So a field army with no war to fight **raids** instead. A raid needs no favourable odds: it
   * rides for the deepest thing it can reach, burns what it finds, and either takes a lightly held
   * place or forces the strong realm to garrison against it. That is the guerilla answer to being
   * outmatched, and it is the one thing a weaker realm can always afford to do.
   */
  if (!objective) {
    const prize = pickRaid(state, world, mind, army);
    if (prize && march(state, world, army, prize, mind)) return;
  }

  // **Too small to be an army? Find one.** Checked after claiming and raiding, which are jobs a
  // single unit is *meant* to do, and before the war, which it is not. A four-unit stack sent at a
  // defended city is four units thrown away; the same four folded into a stack of eight are what
  // takes the place.
  if (rally(state, world, army, mind)) return;

  // **The objective, and then everything else.** Each step returns whether it actually issued an
  // order, so an army whose road is blocked or whose target sits across water tries the next thing
  // instead of standing in a field for a century.
  if (objective && march(state, world, army, objective, mind)) return;

  /**
   * **A boat outranks a field** — owner-specified in 0.18.5, and the order of these two matters far
   * more than it looks.
   *
   * Both are things an army does when it has no war to fight, but they are not equal. Since 0.18.4
   * a rival's open ground is claimable, and a large realm always has some, so this branch always
   * succeeded and the one below it was never reached: measured at 1600, the realm holding all of
   * mainland Europe had forty-odd stacks walking from tile to tile across Iberia — the "moving
   * around aimlessly" the owner saw — while the only war left was across the water and its
   * transports sat empty.
   *
   * Taking a field is worth a few gold a month. Getting on a ship is worth a continent. So when
   * there is anything across the water worth having, the field force queues at the harbours, and
   * tidying the borders is left to the claiming stacks whose actual job it is.
   */
  if (mind.overseasTargets && boardShip(state, world, army, mind)) return;

  // Nowhere to fight it can reach and nowhere to sail: take ground instead. Since 0.18.4 that
  // includes a rival's open fields, so there is essentially always somewhere for an army to be.
  const ground = pickClaim(state, world, army, mind, Number.POSITIVE_INFINITY);
  if (ground >= 0 && orderMove(state, world, army.id, ground).ok) return;

  regroup(state, world, army, mind);
}

/**
 * This realm's settlements that face somebody else, nearest to a rival first.
 *
 * "Frontier" means **walking distance to the nearest hostile settlement**, so an inland capital
 * three provinces behind the line is never garrisoned against an enemy who would have to march
 * through two other cities to reach it. A realm with no neighbours it can walk to has no frontier
 * and posts no guards — which is correct, and is why an island realm does not tie up half its
 * army watching a coast.
 */
/**
 * The realm-s settlements, nearest an enemy first — **computed once a month, then remembered**.
 *
 * It costs a breadth-first sweep of all 2,450 tiles outward from every hostile settlement, and it
 * was being paid **per army**: once for each border guard deciding where to stand, and again inside
 * `nextRole` for every garrison considering a muster. Measured at 176ms of a 788ms `order` phase,
 * the single most expensive thing the AI did per army.
 *
 * The answer cannot change within a month — cities do not move and nothing here reads an army — so
 * the first caller pays for it and the rest read it.
 */
function frontierSettlements(state: SimState, world: World, mind: Mind): CityState[] {
  if (mind.frontier) return mind.frontier;
  mind.frontier = computeFrontier(state, world, mind);
  return mind.frontier;
}

function computeFrontier(state: SimState, world: World, mind: Mind): CityState[] {
  const hostile = state.cities
    .filter((city) => city.ownerIndex !== mind.faction.index)
    .map((city) => city.tileIndex);
  if (hostile.length === 0) return [];

  const fromEnemies = walkingDistanceFrom(world, hostile);
  return state.cities
    .filter((city) => city.ownerIndex === mind.faction.index)
    .map((city) => ({ city, threat: reachedIn(fromEnemies, city.tileIndex) }))
    .filter((entry) => Number.isFinite(entry.threat))
    .sort((a, b) => a.threat - b.threat || a.city.cityIndex - b.city.cityIndex)
    .map((entry) => entry.city);
}

/**
 * Where a raiding column goes: **past the frontier, not at it.**
 *
 * A raid is worth running because a realm's strength is on its border and its wealth is not. The
 * target is therefore the enemy settlement this realm can reach that is *furthest* into hostile
 * ground rather than nearest — within the personality's reach, doubled, because riding deep is
 * the entire point and a raider that stops at the first walls is just a small field army.
 *
 * It takes whatever it finds. A raiding column that meets a real garrison dies, and that is a
 * fair price for a stack of two or three the realm chose to gamble.
 */
function pickRaid(state: SimState, world: World, mind: Mind, army: ArmyState): CityState | undefined {
  let best: CityState | undefined;
  let deepest = -1;

  for (const city of state.cities) {
    if (city.ownerIndex === mind.faction.index) continue;
    if (!willAttack(state, city, mind)) continue;
    if (!sameLandmass(world, army.tileIndex, city.tileIndex)) continue;

    const depth = reachedIn(mind.home, city.tileIndex);
    if (!Number.isFinite(depth)) continue;
    if (depth > deepest || (depth === deepest && best && city.cityIndex < best.cityIndex)) {
      deepest = depth;
      best = city;
    }
  }
  return best;
}

/**
 * The nearest unclaimed tile worth walking onto, or -1.
 *
 * **Nearest to one of our own settlements first, and the army's own distance breaks the tie** —
 * so a realm grows as a blob around each of its cities rather than a thread toward a target, and
 * two armies do not both cross the realm to reach the same field.
 *
 * `bound` is how far from the realm's settlements to look, and the two callers want quite
 * different answers. A **field army** tidying the border on its way to a war is held to
 * `claimRadius`, because an unbounded search would always hand it one more field and it would
 * never arrive anywhere. A **dedicated claiming stack** is given `Infinity`, because unclaimed
 * ground is the entire job and it is not needed for the war.
 *
 * **The bound used to apply to both, and that is why the map was never finished.** Every realm
 * stopped three tiles from its own settlements, so any ground further than that from *any* city on
 * the map — the north-west corner of France, the Danish peninsula, the deep Sahara behind the
 * Moors, the middle of Britain — was ground no realm ever had a reason to walk to. A century in,
 * 318 of 1,692 land tiles were still bare, and 176 of them were seven or more tiles from the
 * nearest settlement in the world: permanently out of reach of a rule that only ever looked three.
 *
 * **Distance is walking distance.** A field on the far bank of a river mouth is as far as the walk
 * around it and not the two tiles it looks, and a tile with no route at all is skipped outright —
 * otherwise it wins on straight-line closeness, the army is ordered somewhere it cannot get to,
 * and the ground next door stays unclaimed for the rest of the campaign.
 */
function pickClaim(
  state: SimState,
  world: World,
  army: ArmyState,
  mind: Mind,
  bound: number,
): number {
  // Ground another of this realm's stacks is already walking to. Without this every claimer picks
  // the same nearest field and a realm running eight of them does one stack's work eight times.
  const spokenFor = new Set<number>();
  for (const other of state.armies) {
    if (other.ownerIndex !== mind.faction.index || other.id === army.id) continue;
    const destination = other.path[other.path.length - 1];
    if (destination !== undefined) spokenFor.add(destination);
  }

  /**
   * **One pass, tracking two answers** — free ground and, failing that, a rival's open fields.
   *
   * The rival's-fields rule (owner-specified in 0.18.4) is what unstuck the late game: taking a
   * rival's tile used to belong to the objective rather than to tidying the border, which was right
   * while there was free ground and became paralysis the moment there was not. Measured at 1500 with
   * the map 100% claimed, **every one of 52 armies was idle**. It is also income — a tile pays its
   * owner monthly whether or not a city stands on it.
   *
   * Free ground still wins where there is any: it is cheaper, nobody fights for it, and it opens no
   * front. Both candidates are tracked in the same sweep rather than by running the sweep twice,
   * because this is the hottest loop in the AI — see `sweepForGround`.
   */
  const free = { best: -1, fromCity: Number.POSITIVE_INFINITY, fromArmy: Number.POSITIVE_INFINITY };
  const enemy = { best: -1, fromCity: Number.POSITIVE_INFINITY, fromArmy: Number.POSITIVE_INFINITY };
  sweepForGround(state, world, army, mind, bound, spokenFor, free, enemy);

  return free.best >= 0 ? free.best : enemy.best;
}

/** The best candidate found so far in a ground sweep. Mutated in place — this loop is hot. */
interface GroundPick {
  best: number;
  fromCity: number;
  fromArmy: number;
}

/**
 * One pass over the tile grid, filling in the best free tile and the best enemy tile at once.
 *
 * **This is the hottest loop in the simulation** and it has been the cause of one performance
 * regression already, so the shape matters. It runs once a month for every army that has run out of
 * better things to do — which since 0.18.4 is most of them, in a world of a hundred armies and
 * thirteen realms — and it walks all 2,450 tiles each time.
 *
 * Everything that can be hoisted has been. The first version of the enemy-ground rule called
 * `state.cities.some`, `state.cities.find` **and** `willAttack` (which scans the cities again)
 * *inside* this loop: three scans of sixty settlements per tile, twice over, per army. That is about
 * half a million operations per army per month, and it made a decade at maximum speed take six
 * seconds where it had taken half of one. The per-tile work is now a set lookup and an array index.
 */
function sweepForGround(
  state: SimState,
  world: World,
  army: ArmyState,
  mind: Mind,
  bound: number,
  spokenFor: ReadonlySet<number>,
  free: GroundPick,
  enemy: GroundPick,
): void {
  const mine = mind.faction.index;
  const owners = state.tileOwner;

  for (let index = 0; index < owners.length; index++) {
    const owner = owners[index] ?? -1;
    if (owner === mine) continue;

    // Precomputed once per realm per month: whose ground this realm would take, and which tiles a
    // settlement stands on. A siege belongs to the objective, not to tidying the border.
    const pick = owner === -1 ? free : mind.takeableFrom[owner] && !mind.cityTiles.has(index) ? enemy : undefined;
    if (!pick) continue;
    // Free ground always wins, so once one is found the enemy branch cannot change the answer.
    if (pick === enemy && free.best >= 0) continue;
    if (spokenFor.has(index)) continue;

    // Infinity is water or another landmass, and `Infinity > Infinity` is false — so unreachable
    // ground has to be excluded by name rather than by the bound, even an infinite one.
    const fromCity = reachedIn(mind.home, index);
    if (!Number.isFinite(fromCity) || fromCity > bound) continue;
    if (fromCity > pick.fromCity) continue;

    const fromArmy = chebyshev(world, index, army.tileIndex);
    if (fromCity === pick.fromCity && fromArmy >= pick.fromArmy) continue;

    // Left to last on purpose: both are linear scans, and only a candidate that has already beaten
    // the best so far is worth paying for them.
    if (!sameLandmass(world, army.tileIndex, index)) continue;
    if (blockedBy(state, world, army, index, true) !== null) continue;

    pick.best = index;
    pick.fromCity = fromCity;
    pick.fromArmy = fromArmy;
  }
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
        sameLandmass(world, city.tileIndex, army.tileIndex),
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
 *
 * **Distance is walking distance, and unreachable is not a distance at all.** Straight lines nearly
 * broke this: a settlement one diagonal step across a strait measured as the nearest thing on the
 * map, so it won the comparison, became the objective, and stayed the objective every month while
 * no army could ever arrive. A realm pinned that way never attacks anything, and the ones it could
 * have taken were never even considered — the loop stops at the first thing nearer than the best so
 * far. Measuring the way an army actually moves makes an unreachable city infinitely far, which is
 * the truth, and lets the realm get on with what it can reach.
 */
function pickObjectives(
  state: SimState,
  world: World,
  mind: Mind,
  armies: readonly ArmyState[],
  wanted: number,
): readonly CityState[] {
  const border = state.cities.filter((city) => city.ownerIndex === mind.faction.index);
  if (border.length === 0 || armies.length === 0) return [];

  // Everything worth taking, nearest to the realm's own border first. The whole list is built and
  // then sliced, rather than the single best being tracked, because a realm with several fronts
  // needs the runners-up — and the cost is one sort over the settlements that passed the filters.
  const candidates: { city: CityState; distance: number; cost: number }[] = [];

  for (const city of state.cities) {
    if (city.ownerIndex === mind.faction.index) continue;

    // **No distance limit.** Every realm is trying to conquer the world; what varies between them
    // is how they go about it, not how far they are willing to look. Infinity still means across
    // water, which is the honest answer and the one thing that genuinely rules a target out.
    const fromHome = reachedIn(mind.home, city.tileIndex);
    if (!Number.isFinite(fromHome)) continue;
    if (!willAttack(state, city, mind)) continue;

    // Every army that could arrive is counted, because they are all about to be sent. Only the sea
    // excludes one now: an army on the wrong side of it contributes nothing to the odds, and
    // counting it is how a realm talks itself into an attack it cannot make.
    const force = armies
      .filter((army) => sameLandmass(world, army.tileIndex, city.tileIndex))
      .reduce((men, army) => men + stackSoldiers(army.units), 0);
    if (force === 0) continue;

    // Storming is always acceptable; starving it out only if this realm has the stomach for it.
    const takeable =
      judge(state, world, city, mind, force, true) ||
      (mind.character.prefersSiege && judge(state, world, city, mind, force, false));
    if (!takeable) continue;

    candidates.push({ city, distance: fromHome, cost: fromHome + effortOf(city) });
  }

  // **Cheapest first, not merely nearest** — owner-specified in 0.18.3. A realm should reach for
  // the weakly held village three tiles further on rather than grind against the walled City on its
  // doorstep, and before this the only thing distance competed with was nothing at all. The city
  // index breaks a tie, so the choice is stable month to month and a realm does not swap objective
  // for an equally good one and march the other way.
  candidates.sort((a, b) => a.cost - b.cost || a.city.cityIndex - b.city.cityIndex);

  /**
   * **Fronts are kept apart.** Taking the top `n` by distance would hand a realm three objectives
   * that are three neighbouring villages in the same province — which is one front with extra
   * steps, and worse than one front, because the armies split three ways to fight it.
   *
   * A candidate is only opened as a *new* front if it is well away from every front already
   * chosen. Where nothing qualifies, the realm simply fights on fewer fronts than its size allows,
   * which is the correct answer: it has only one border worth pushing on.
   */
  const chosen: CityState[] = [];
  for (const { city } of candidates) {
    if (chosen.length >= wanted) break;
    const apart = chosen.every(
      (other) => chebyshev(world, other.tileIndex, city.tileIndex) >= FRONTS_APART,
    );
    if (apart) chosen.push(city);
  }
  return chosen;
}

/**
 * The weakest thing the realm can reach, whatever the odds — the floor under `pickObjectives`.
 *
 * **"There should never be a stalemate"**, owner-specified in 0.18.4. `judge` refuses fights a realm
 * would lose, which is right for choosing *between* wars and wrong as the last word: a realm with
 * nothing it can beat simply stopped, for two hundred years, in every campaign measured.
 *
 * So when every candidate fails `judge`, the realm picks the softest target it can walk to and
 * presses it anyway. It will often lose, and losing is fine — it costs the strong realm men and
 * garrisons, which is precisely what a weaker power is *for*. What it must not do is nothing.
 *
 * Scruples still apply. A Peaceful realm will not open a war with a rival here any more than
 * anywhere else; `willAttack` is checked exactly as it is above.
 */
function desperateObjective(
  state: SimState,
  world: World,
  mind: Mind,
): CityState | undefined {
  let best: CityState | undefined;
  let softest = Number.POSITIVE_INFINITY;

  for (const city of state.cities) {
    if (city.ownerIndex === mind.faction.index) continue;
    if (!Number.isFinite(reachedIn(mind.home, city.tileIndex))) continue;
    if (!willAttack(state, city, mind)) continue;

    // Softest first, distance breaking the tie, then the index so the choice never wanders.
    const effort = effortOf(city) * 4 + reachedIn(mind.home, city.tileIndex);
    if (effort >= softest) continue;
    softest = effort;
    best = city;
  }
  void world;
  return best;
}

/**
 * How far apart two objectives must be to count as separate wars, in tiles. **[GEN]**
 *
 * Eight — comfortably outside the 5 × 5 relief box, so two fronts can never be the same battle
 * seen twice, and roughly a province apart at this map's scale.
 */
const FRONTS_APART = 8;

/**
 * Soldiers of defence that make a settlement feel one tile further away. **[GEN]**
 *
 * A hundred, which is one Light Infantry. So a bare Village costs about a tile of extra distance, a
 * built-up Town four or five, and a walled Capitol with a garrison in it a dozen or more — which is
 * roughly how much further a realm *should* be willing to walk to avoid it.
 *
 * Deliberately a soft weight rather than a filter. `judge` already refuses fights the realm cannot
 * win; this only decides the order among fights it can, so a realm still takes a hard city when
 * that is all there is.
 */
const DEFENDERS_PER_TILE = 100;

/**
 * What a settlement costs to take, expressed in tiles of walking — owner-specified in 0.18.3.
 *
 * Its free defenders and its garrison both count. Walls do not enter directly: they are already in
 * the defender's advantage that `judge` weighs, and counting them twice would make a realm refuse
 * ever to besiege anything.
 */
function effortOf(city: CityState): number {
  const men = stackSoldiers(defenceOf(city)) + stackSoldiers(city.garrison);
  return Math.floor(men / DEFENDERS_PER_TILE);
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
): boolean {
  // Storming is judged on what is at the walls now, not on what is on its way: an army that
  // marches onto the tile fights the moment it arrives, alone if it is the first there.
  const men = atTheWalls(state, world, mind, city.tileIndex, army);
  if (judge(state, world, city, mind, men, true)) {
    // **Returns whether the order stuck.** A march that cannot be routed used to fail silently and
    // leave the army standing there — every month, for ever, because nothing else was tried. The
    // caller now falls through to the next thing (owner-specified in 0.18.4: an army whose
    // destination is unreachable should switch targets).
    return orderMove(state, world, army.id, city.tileIndex).ok;
  }

  const route = findPath(state, world, army, city.tileIndex);
  if (!route || route.length === 0) return false;

  const gate = route[route.length - 2];
  if (gate !== undefined) {
    return orderMove(state, world, army.id, gate).ok;
  }

  // Already at the gates and not strong enough to go in. A realm that will starve a city out
  // invests it; one that will not simply waits there for the rest of the army to arrive and
  // tries the walls again next month. **This is where honour actually costs something** — it
  // has to mass a force big enough to storm, while everyone else only has to outlast the grain.
  if (mind.character.prefersSiege) beginSiege(state, world, army.id);
  // Standing at the gates *is* doing something, whether or not the siege was laid.
  return true;
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
/**
 * Is there anything at all on this continent left to take?
 *
 * Cheap and deliberately loose — it asks only whether a hostile settlement exists that the realm
 * could walk to and would be willing to attack, not whether it could win. A realm that still has
 * somewhere to march has a land war; one that does not is finished on its landmass whatever the
 * odds elsewhere, and its future is across water.
 *
 * The Independents count, because taking an independent city is exactly the kind of expansion a
 * cornered realm should still be doing.
 */
function anyLandTarget(state: SimState, world: World, mind: Mind): boolean {
  const settled = new Set(
    state.cities
      .filter((city) => city.ownerIndex === mind.faction.index)
      .map((city) => landmassOf(world, city.tileIndex)),
  );

  return state.cities.some((city) => {
    if (city.ownerIndex === mind.faction.index) return false;
    if (!Number.isFinite(reachedIn(mind.home, city.tileIndex))) return false;
    /**
     * **A beachhead on our own coast is not a land war** — owner-reported in 0.18.9.
     *
     * `mind.home` is seeded from a realm's settlements **and from its armies on landmasses it has
     * not settled** (decision 88's exception, added for expeditions). So an enemy stack that has
     * landed makes its own home cities read as walkable from here — and one landed rival was enough
     * to convince a realm that had conquered its whole continent that it still had a land war, which
     * shut off its naval appetite and its expeditions. This is the "still do not attack anyone
     * overseas after they conquer most of their mainland" the owner reported.
     *
     * A settlement only counts as a land target if it stands on a landmass this realm actually has a
     * settlement on. Beating the beachhead itself is still ordinary business — it is an army on our
     * ground, and the objective and raid rules deal with armies.
     */
    if (!settled.has(landmassOf(world, city.tileIndex))) return false;
    return willAttack(state, city, mind);
  });
}

/**
 * How small a field army has to be before it goes looking for a bigger one to join. **[GEN]**
 *
 * Half of what the difficulty calls a full stack. Above that a stack is a usable fighting force and
 * should be getting on with the war; below it, it is a detachment that will lose to the first
 * village it meets, and the most valuable thing it can do is become part of something.
 */
const RALLY_BELOW_FRACTION = 2;

/**
 * How far a small army will walk to join a bigger one, in tiles. **[GEN]**
 *
 * Twelve. Far enough to cross a province and find the war, near enough that a stack does not spend
 * a decade walking the length of an empire to merge with something that has since moved on — at
 * 0.16.0's speeds, twelve tiles is two years on foot.
 */
const RALLY_RANGE = 12;

/**
 * Walk a too-small army into a bigger one — docs/DESIGN.md decision 135.
 *
 * Armies merge on contact already (`occupy`), so consolidation needs no new mechanic; what it
 * needed was a *reason* for two stacks to be in the same place. Without one, a realm's armies were
 * founded separately, marched at the objective separately along their own routes, and arrived
 * separately — so they only ever merged by coincidence, and a realm of twenty cities fought its war
 * as twenty detachments none of which could take a city.
 *
 * **Only the smaller moves, and ties break on the higher id.** That asymmetry is what makes this
 * terminate: two armies can never be ordered onto each other, so a pair cannot walk through one
 * another for ever, and a chain of rallies always flows toward one stack.
 *
 * Returns true if the army was given somewhere to be.
 */
function rally(state: SimState, world: World, army: ArmyState, mind: Mind): boolean {
  const full = Math.min(MAX_ARMY_UNITS, mind.level.armyUnits);
  const mine = stackSize(army.units);
  if (mine >= Math.ceil(full / RALLY_BELOW_FRACTION)) return false;

  let best: ArmyState | undefined;
  let nearest = Number.POSITIVE_INFINITY;

  for (const other of state.armies) {
    if (other.ownerIndex !== mind.faction.index || other.id === army.id) continue;
    if (other.role !== 'field') continue;

    // Strictly bigger, or the same size with a lower id. Never both directions of a pair.
    const theirs = stackSize(other.units);
    if (theirs < mine || (theirs === mine && other.id > army.id)) continue;
    // No point joining something that would overflow the tile.
    if (theirs + mine > MAX_ARMY_UNITS) continue;

    const distance = chebyshev(world, other.tileIndex, army.tileIndex);
    if (distance > RALLY_RANGE || distance >= nearest) continue;
    nearest = distance;
    best = other;
  }

  if (!best) return false;
  return orderMove(state, world, army.id, best.tileIndex).ok;
}

/**
 * Send an army to a harbour to be shipped somewhere it can fight.
 *
 * The nearest of the realm's ports that is not already crowded — several armies queueing on one
 * quay is fine and in fact wanted, since it is how a **multi-stack landing** gets assembled, but
 * they must not all pick the same quay when the realm has four, or three fronts' worth of shipping
 * leaves from one harbour and the rest stand empty.
 *
 * An army already standing on a quay stays there. That is not idleness — it is cargo waiting.
 */
function boardShip(state: SimState, world: World, army: ArmyState, mind: Mind): boolean {
  const waiting = (city: CityState) =>
    state.armies.filter(
      (other) => other.ownerIndex === mind.faction.index && other.tileIndex === city.tileIndex,
    ).length;

  if (mind.harbours.some((city) => city.tileIndex === army.tileIndex)) return true;

  const port = [...mind.harbours]
    .filter((city) => Number.isFinite(reachedIn(mind.home, city.tileIndex)))
    .sort(
      (a, b) =>
        waiting(a) - waiting(b) ||
        chebyshev(world, a.tileIndex, army.tileIndex) -
          chebyshev(world, b.tileIndex, army.tileIndex) ||
        a.cityIndex - b.cityIndex,
    )[0];

  return port !== undefined && orderMove(state, world, army.id, port.tileIndex).ok;
}

function regroup(state: SimState, world: World, army: ArmyState, mind: Mind): void {
  // `armyUnits` is what a realm considers a full stack — a target, not a ceiling. The only hard
  // limit is the game's own twenty-per-tile.
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
