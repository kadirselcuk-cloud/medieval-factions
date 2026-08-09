import { siegeMonths } from '../data/buildings';
import type { UnitStack } from '../data/units';
import { inBounds, tileIndex, type World } from '../data/world';
import { armyAt, armyById, occupy, removeArmy, stackSize } from './armies';
import {
  defenderAdvantage,
  fightBattle,
  openFieldAdvantage,
  recordBattle,
  ROUT_RATIO,
  settlementContingents,
  unitCount,
  type BattleContingent,
  type SideSurvivors,
} from './battle';
import { pushEvent } from './events';
import type { BattleSetup } from './battle';
import { CITYLESS_MONTHS, type ArmyState, type BattleReport, type CityState, type SimState } from './types';

/**
 * Sieges, and what happens after the fighting — who holds the ground, which city changed hands,
 * and who is left standing.
 *
 * Kept apart from `battle.ts` on purpose: a battle is a pure function of two lines of troops and
 * the ground they stand on, and everything that touches the map lives here. That is the line the
 * tactical layer will cut along in Phase B, where only the first half is replaced.
 */

/**
 * How far from a settlement an army can be and still join the battle for it — owner-specified
 * as a **5 × 5 box**, so two tiles in any direction, diagonals included.
 *
 * It applies to both sides and to settlements only. A meeting engagement between two field
 * armies stays a fight between those two armies; dragging every stack within two tiles into
 * every skirmish would make it impossible to move an army anywhere near a war.
 */
export const RELIEF_RANGE = 2;

export interface EngagementResult {
  report: BattleReport;
  /** True when the attacker took the tile and the leading army should be moved onto it. */
  advance: boolean;
}

// -------------------------------------------------------------------- proximity

function distance(world: World, a: number, b: number): number {
  return Math.max(
    Math.abs((a % world.width) - (b % world.width)),
    Math.abs(Math.floor(a / world.width) - Math.floor(b / world.width)),
  );
}

/** Armies of one realm close enough to a settlement to fight for or against it. */
function nearbyArmies(
  state: SimState,
  world: World,
  factionIndex: number,
  tile: number,
): readonly ArmyState[] {
  return state.armies.filter(
    (army) => army.ownerIndex === factionIndex && distance(world, army.tileIndex, tile) <= RELIEF_RANGE,
  );
}

/** The eight tiles around a settlement — where an army has to stand to invest it. */
function investmentTiles(world: World, tile: number): number[] {
  const x = tile % world.width;
  const y = Math.floor(tile / world.width);
  const tiles: number[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (inBounds(world, x + dx, y + dy)) tiles.push(tileIndex(world, x + dx, y + dy));
    }
  }
  return tiles;
}

// ---------------------------------------------------------------------- sieges

export type SiegeFailure = 'no-such-army' | 'no-settlement' | 'not-hostile' | 'not-adjacent' | 'not-besieging';
export type SiegeResult = { ok: true } | { ok: false; reason: SiegeFailure };

/** The settlement this army is standing beside, if it is hostile to the army. */
export function siegeTarget(
  state: SimState,
  world: World,
  army: ArmyState,
): CityState | undefined {
  return state.cities.find(
    (city) =>
      city.ownerIndex !== army.ownerIndex &&
      investmentTiles(world, city.tileIndex).includes(army.tileIndex),
  );
}

/**
 * Invest a settlement.
 *
 * A siege is the answer to walls that cannot be stormed: rather than throwing an army at a
 * Citadel, sit outside it until its defenders have to come out. The clock is owner-authored —
 * a Village holds a month, a Capitol a year.
 */
export function beginSiege(state: SimState, world: World, armyId: number): SiegeResult {
  const army = armyById(state, armyId);
  if (!army) return { ok: false, reason: 'no-such-army' };

  const city = siegeTarget(state, world, army);
  if (!city) return { ok: false, reason: 'not-adjacent' };
  if (city.siege?.byIndex === army.ownerIndex) return { ok: true };

  city.siege = {
    byIndex: army.ownerIndex,
    monthsRemaining: siegeMonths(city.tier),
    monthsHeld: 0,
  };

  const name = world.cities[city.cityIndex]?.name ?? 'a settlement';
  pushEvent(state, {
    kind: 'siege',
    text: `${name} is invested — ${city.siege.monthsRemaining} months before it must sortie`,
    tileIndex: city.tileIndex,
    factionIndex: army.ownerIndex,
  });
  pushEvent(state, {
    kind: 'siege',
    text: `${name} is under siege`,
    tileIndex: city.tileIndex,
    factionIndex: city.ownerIndex,
  });
  return { ok: true };
}

export function liftSiege(state: SimState, world: World, city: CityState, why: string): void {
  if (!city.siege) return;
  const besieger = city.siege.byIndex;
  city.siege = null;

  const name = world.cities[city.cityIndex]?.name ?? 'a settlement';
  pushEvent(state, {
    kind: 'siege',
    text: `The siege of ${name} was lifted — ${why}`,
    tileIndex: city.tileIndex,
    factionIndex: besieger,
  });
  pushEvent(state, {
    kind: 'siege',
    text: `${name} is relieved — ${why}`,
    tileIndex: city.tileIndex,
    factionIndex: city.ownerIndex,
  });
}

/**
 * Walk every siege on by a month.
 *
 * A siege is held by presence, so the first thing this does is check the besieger is still
 * there. When the clock runs out the defenders must come out: they surrender outright if the
 * odds are hopeless, and otherwise sortie into an open-field battle they fight without their
 * walls behind them.
 */
export function advanceSieges(state: SimState, world: World): void {
  for (const city of state.cities) {
    const siege = city.siege;
    if (!siege) continue;

    if (siege.byIndex === city.ownerIndex) {
      city.siege = null;
      continue;
    }

    // Held by presence: the moment nobody is at the gates, the siege is over.
    const gates = investmentTiles(world, city.tileIndex);
    const invested = state.armies.some(
      (army) => army.ownerIndex === siege.byIndex && gates.includes(army.tileIndex),
    );
    if (!invested) {
      liftSiege(state, world, city, 'the besiegers withdrew');
      continue;
    }

    siege.monthsHeld += 1;
    siege.monthsRemaining -= 1;
    if (siege.monthsRemaining > 0) continue;

    resolveSiege(state, world, city, siege.byIndex);
  }
}

/**
 * The clock has run out.
 *
 * **Surrender or sortie**, as the owner put it. A settlement whose defenders are outnumbered
 * more than three to one opens its gates rather than throwing them away — the same ratio the
 * battlefield uses to decide a rout, reused so there is one rule about hopeless odds and not
 * two. **[GEN]**: the owner named both outcomes but not the line between them.
 */
function resolveSiege(state: SimState, world: World, city: CityState, besieger: number): void {
  const name = world.cities[city.cityIndex]?.name ?? 'a settlement';
  const investing = nearbyArmies(state, world, besieger, city.tileIndex);

  const attackers = investing.reduce((n, army) => n + stackSize(army.units), 0);
  const defenders =
    stackSize(defendersOf(city)) +
    nearbyArmies(state, world, city.ownerIndex, city.tileIndex).reduce(
      (n, army) => n + stackSize(army.units),
      0,
    );

  if (attackers > defenders * ROUT_RATIO) {
    pushEvent(state, {
      kind: 'siege',
      text: `${name} surrendered — starved out and hopelessly outnumbered`,
      tileIndex: city.tileIndex,
      factionIndex: besieger,
    });
    captureCity(state, world, city, besieger);
    updateLiveness(state);
    return;
  }

  // The assault is led from the gates, by the longest-standing army there.
  const gates = investmentTiles(world, city.tileIndex);
  const lead = investing
    .filter((army) => gates.includes(army.tileIndex))
    .sort((a, b) => a.id - b.id)[0];
  if (!lead) return;
  pushEvent(state, {
    kind: 'siege',
    text: `The defenders of ${name} sortied — they fight in the open`,
    tileIndex: city.tileIndex,
    factionIndex: city.ownerIndex,
  });
  // Starved out, the garrison has to come out and fight. That is what a siege buys: the walls
  // it could not be stormed behind are the walls it no longer has.
  const { advance } = resolveEngagement(state, world, lead, city.tileIndex, true);
  if (advance) occupy(state, lead, city.tileIndex);
}

/** A settlement's free defenders plus whatever it has recruited. */
function defendersOf(city: CityState): UnitStack {
  const stack: UnitStack = {};
  for (const part of settlementContingents(city, 0)) {
    for (const [id, count] of Object.entries(part.stack)) stack[id] = (stack[id] ?? 0) + count;
  }
  return stack;
}

// ------------------------------------------------------------------ engagements

/**
 * Fight for a tile — an assault on a settlement, a meeting engagement, or a sortie.
 *
 * At a settlement this is not a duel. Every army of either realm **within a 5 × 5 box** joins
 * in, and the two sides do not fight on the same ground: the settlement's own defenders and
 * garrison, and any army standing inside it, have the walls; every army that marched to the
 * fight from outside has only the terrain and the season. Troops sitting inside a city being
 * stormed fight for it — **[GEN]**, the owner separated garrison from defenders but never said
 * the garrison stands idle while the walls are taken.
 *
 * `sortie` is what a siege is *for*. Starved out, the defenders have to come out from behind
 * their walls, and nobody on the field has them: it is an **open-field battle**, which is the
 * only way a fortified settlement can realistically be taken.
 */
export function resolveEngagement(
  state: SimState,
  world: World,
  army: ArmyState,
  tile: number,
  sortie = false,
): EngagementResult {
  const city = state.cities.find((c) => c.tileIndex === tile && c.ownerIndex !== army.ownerIndex);
  const standing = armyAt(state, tile);
  const enemy = standing && standing.ownerIndex !== army.ownerIndex ? standing : undefined;
  const defenderIndex = city?.ownerIndex ?? enemy?.ownerIndex ?? -1;

  const advantage = defenderAdvantage(state, world, tile);
  const outside = openFieldAdvantage(advantage);
  /** What the settlement's own troops fight under — everything, unless they have come out. */
  const walls = sortie ? outside : advantage.total;

  // --- who turns up. The army that started it leads; the rest fall in behind it by id, so the
  // line-up is the same every time the same campaign reaches this moment.
  const joining = city
    ? nearbyArmies(state, world, army.ownerIndex, tile)
        .filter((a) => a.id !== army.id)
        .sort((a, b) => a.id - b.id)
    : [];
  const attacker: BattleContingent[] = [army, ...joining].map((a) => ({
    source: 'army' as const,
    stack: { ...a.units },
    armyId: a.id,
  }));

  const defender: BattleContingent[] = [];
  if (city) defender.push(...settlementContingents(city, walls));
  for (const relief of city ? nearbyArmies(state, world, defenderIndex, tile) : enemy ? [enemy] : []) {
    defender.push({
      source: 'army',
      stack: { ...relief.units },
      // Standing in the settlement means standing behind its walls. Marching to its relief
      // does not — owner-specified.
      advantage: relief.tileIndex === tile ? walls : outside,
      armyId: relief.id,
    });
  }

  const setup: BattleSetup = {
    tileIndex: tile,
    cityIndex: city?.cityIndex ?? -1,
    attackerIndex: army.ownerIndex,
    defenderIndex,
    attacker,
    defender,
  };

  const { report, survivors } = fightBattle(state, world, setup);
  const attackerWon = report.winner === 'attacker';

  // --- everyone who fought goes home, or does not
  army.path = [];
  army.march = 0;
  writeBack(state, survivors[0], report.winner === 'defender');
  writeBack(state, survivors[1], attackerWon);

  const leadLeft = survivors[0].armies.find((a) => a.armyId === army.id)?.units ?? {};

  // --- the settlement
  if (city) {
    if (attackerWon) {
      captureCity(state, world, city, army.ownerIndex);
      report.captured = true;
    } else {
      // It held. What is left of the garrison goes back behind the walls; the free defenders
      // are derived from the tier and simply reappear at full strength.
      city.garrison = survivors[1].garrison;
      liftSiege(state, world, city, 'the assault was thrown back');
    }
  }

  announce(state, world, report);
  recordBattle(state, report);
  // A realm can end here two ways: its last city taken, or its last army destroyed.
  updateLiveness(state);

  return { report, advance: attackerWon && unitCount(leadLeft) > 0 };
}

/** Return one side's survivors to the armies that sent them, or wipe those armies out. */
function writeBack(state: SimState, survivors: SideSurvivors, lost: boolean): void {
  for (const { armyId, units } of survivors.armies) {
    const army = armyById(state, armyId);
    if (!army) continue;
    if (lost || unitCount(units) === 0) removeArmy(state, armyId);
    else army.units = units;
  }
}

/**
 * A settlement changes hands.
 *
 * Buildings and people stay — sacking and razing are **[OPEN]**. Everything the previous owner
 * had paid for and not yet received does not: queued work, the garrison and any moored fleet
 * are lost with the city. The free defenders need no transfer, because they are derived from
 * the tier and the buildings and so are already the new owner's the instant the gates open.
 */
function captureCity(state: SimState, world: World, city: CityState, newOwner: number): void {
  const previous = city.ownerIndex;
  city.ownerIndex = newOwner;
  city.garrison = {};
  city.fleet = {};
  city.queue = [];
  city.recruitQueue = [];
  city.shipQueue = [];
  city.siege = null;
  // The tile changes hands with the settlement, whether or not an army is left to walk into it.
  state.tileOwner[city.tileIndex] = newOwner;

  const name = world.cities[city.cityIndex]?.name ?? 'a settlement';
  pushEvent(state, {
    kind: 'conquest',
    text: `${name} was taken`,
    tileIndex: city.tileIndex,
    factionIndex: newOwner,
  });
  pushEvent(state, {
    kind: 'conquest',
    text: `${name} has fallen`,
    tileIndex: city.tileIndex,
    factionIndex: previous,
  });
}

/**
 * A faction is finished when it holds neither a settlement nor an army.
 *
 * Its remaining territory reverts to no-one rather than passing to the conqueror: ground is
 * claimed by marching over it (docs/DESIGN.md decision 21), and a realm should not inherit a
 * province it has never seen.
 */
/**
 * A realm that has held no settlement for two years dissolves — owner-specified in 0.18.7.
 *
 * `updateLiveness` only finishes a realm that has lost **both** its cities and its armies, so a
 * realm reduced to one wandering stack stayed on the books indefinitely: holding nothing, building
 * nothing, recruiting nothing, and still counted among the living. Campaign probes routinely showed
 * realms with a city count of zero two centuries in.
 *
 * An army with no country behind it stops being paid and stops being an army. After
 * `CITYLESS_MONTHS` its stacks and its fleets are struck off together, and the realm goes with them.
 *
 * The counter resets the moment it takes a settlement, so a realm driven to its last army and then
 * storming a village back is a comeback rather than a corpse. Called once a month, from the tick.
 */
export function collapseLandlessRealms(state: SimState, world: World): void {
  for (const faction of state.factions) {
    if (!faction.alive) continue;

    if (state.cities.some((city) => city.ownerIndex === faction.index)) {
      faction.cityless = 0;
      continue;
    }

    faction.cityless += 1;
    if (faction.cityless < CITYLESS_MONTHS) continue;

    for (const army of state.armies.filter((a) => a.ownerIndex === faction.index)) {
      removeArmy(state, army.id);
    }
    state.fleets = state.fleets.filter((fleet) => fleet.ownerIndex !== faction.index);

    pushEvent(state, {
      kind: 'conquest',
      text: 'Landless for two years, a realm dissolved — its last soldiers went home',
      tileIndex: 0,
      factionIndex: faction.index,
    });
  }
  // Struck off above, declared dead here, so there is one place a realm can die.
  updateLiveness(state);
  void world;
}

export function updateLiveness(state: SimState): void {
  for (const faction of state.factions) {
    if (!faction.alive) continue;
    const holds =
      state.cities.some((c) => c.ownerIndex === faction.index) ||
      state.armies.some((a) => a.ownerIndex === faction.index);
    if (holds) continue;

    faction.alive = false;
    for (let i = 0; i < state.tileOwner.length; i++) {
      if (state.tileOwner[i] === faction.index) state.tileOwner[i] = -1;
    }
    pushEvent(state, {
      kind: 'conquest',
      text: 'A realm has been extinguished',
      tileIndex: 0,
      factionIndex: faction.index,
    });
  }
}

/**
 * One notification per side, written from that side's point of view, so each realm reads its
 * own war rather than a neutral scoreboard.
 */
function announce(state: SimState, world: World, report: BattleReport): void {
  const where =
    report.cityIndex >= 0
      ? (world.cities[report.cityIndex]?.name ?? 'a settlement')
      : `${report.tileIndex % world.width}, ${Math.floor(report.tileIndex / world.width)}`;

  const outcome = (won: boolean): string => {
    if (report.winner === 'stalemate') {
      return report.ending === 'cap' ? 'ended in stalemate' : 'left no-one standing';
    }
    if (report.ending === 'rout') return won ? 'broke the enemy' : 'was routed';
    return won ? 'carried the field' : 'was destroyed';
  };

  pushEvent(state, {
    kind: 'battle',
    text: `Battle at ${where} — your army ${outcome(report.winner === 'attacker')}, ${report.losses[0]} lost`,
    tileIndex: report.tileIndex,
    factionIndex: report.attackerIndex,
    battleId: report.id,
  });

  if (report.defenderIndex >= 0 && report.defenderIndex !== report.attackerIndex) {
    pushEvent(state, {
      kind: 'battle',
      text: `Battle at ${where} — your defence ${outcome(report.winner === 'defender')}, ${report.losses[1]} lost`,
      tileIndex: report.tileIndex,
      factionIndex: report.defenderIndex,
      battleId: report.id,
    });
  }
}
