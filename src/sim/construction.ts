import {
  availableBuildings,
  buildingById,
  settlementUpgradeTo,
  type Building,
  type Cost,
} from '../data/buildings';
import { improvementCost, improvementMonths, MAX_IMPROVEMENT_LEVEL } from '../data/improvements';
import type { ImprovementKind } from '../data/terrain';
import { TERRAIN_PROFILE } from '../data/terrain';
import { adjacentWaterCount, terrainAt, tileIndex, type World } from '../data/world';
import {
  buildableShips,
  recruitableUnits,
  shipById,
  unitById,
} from '../data/units';
import { pushEvent } from './events';
import {
  IMPROVEMENT_KINDS,
  MILLI,
  RESOURCES,
  TIER_NAME,
  whole,
  type CityState,
  type EventKind,
  type SettlementTier,
  type SimState,
} from './types';

/**
 * Starting and cancelling work, and advancing it a month at a time.
 *
 * Every order pays its cost up front. That makes a queue a commitment rather than an
 * intention, and it means the simulation never has to check afterwards whether a faction can
 * still afford what it started.
 */

export type BuildFailure =
  | 'not-owner'
  | 'insufficient-resources'
  | 'already-building'
  | 'not-available'
  | 'unbuildable-terrain'
  | 'max-level'
  | 'wrong-improvement'
  | 'too-few-people'
  | 'already-have-one';

export type BuildResult = { ok: true } | { ok: false; reason: BuildFailure };

const OK: BuildResult = { ok: true };
const fail = (reason: BuildFailure): BuildResult => ({ ok: false, reason });

// ------------------------------------------------------------------ resources

export function canAfford(state: SimState, factionIndex: number, cost: Cost): boolean {
  const faction = state.factions[factionIndex];
  if (!faction) return false;
  return RESOURCES.every((resource) => faction.stock[resource] >= (cost[resource] ?? 0) * MILLI);
}

function pay(state: SimState, factionIndex: number, cost: Cost): void {
  const faction = state.factions[factionIndex];
  if (!faction) return;
  for (const resource of RESOURCES) {
    faction.stock[resource] -= (cost[resource] ?? 0) * MILLI;
  }
}

/** Refunds are full — cancelling wastes the months already spent, not the treasury. */
function refund(state: SimState, factionIndex: number, cost: Cost): void {
  const faction = state.factions[factionIndex];
  if (!faction) return;
  for (const resource of RESOURCES) {
    faction.stock[resource] += (cost[resource] ?? 0) * MILLI;
  }
}

// ------------------------------------------------------------------ buildings

/** Coastal means any of the eight neighbours is water — the same adjacency the fishery pays on. */
export function isCoastal(world: World, x: number, y: number): boolean {
  return adjacentWaterCount(world, x, y) > 0;
}

export function buildOptions(world: World, city: CityState): readonly Building[] {
  const location = world.cities[city.cityIndex];
  if (!location) return [];
  return availableBuildings({
    tier: city.tier,
    built: city.buildings,
    queued: city.queue.flatMap((order) => (order.kind === 'building' ? [order.id] : [])),
    coastal: isCoastal(world, location.x, location.y),
  });
}

export function queueBuilding(
  state: SimState,
  world: World,
  city: CityState,
  buildingId: string,
): BuildResult {
  const building = buildingById(buildingId);
  if (!building) return fail('not-available');
  if (!buildOptions(world, city).some((b) => b.id === buildingId)) return fail('not-available');
  if (!canAfford(state, city.ownerIndex, building.cost)) return fail('insufficient-resources');

  pay(state, city.ownerIndex, building.cost);
  city.queue.push({ kind: 'building', id: building.id, monthsRemaining: building.months });
  return OK;
}

/**
 * Why this settlement cannot grow into its next tier right now, or `null` if it can.
 *
 * Exported so the panel can explain the refusal rather than just greying a square out, and so
 * there is only one implementation of the rule for the UI and the simulation to agree on.
 */
export function settlementUpgradeBlock(
  state: SimState,
  city: CityState,
): BuildFailure | null {
  const upgrade = settlementUpgradeTo(city.tier + 1);
  if (!upgrade) return 'max-level';
  if (city.queue.some((order) => order.kind === 'settlement')) return 'already-building';

  // Population is what a settlement grows *by*, so it gates what it can grow *into*. A realm
  // cannot buy its way to a Capitol; it has to have built somewhere people want to live.
  if (whole(city.populationMilli) < upgrade.minPopulation) return 'too-few-people';

  if (upgrade.unique && hasTier(state, city.ownerIndex, upgrade.toTier, city)) {
    return 'already-have-one';
  }
  if (!canAfford(state, city.ownerIndex, upgrade.cost)) return 'insufficient-resources';
  return null;
}

/** Does this faction already hold a settlement at the given tier, or have one on the way? */
function hasTier(
  state: SimState,
  factionIndex: number,
  tier: number,
  except: CityState,
): boolean {
  return state.cities.some(
    (other) =>
      other !== except &&
      other.ownerIndex === factionIndex &&
      (other.tier >= tier ||
        other.queue.some((order) => order.kind === 'settlement' && order.targetTier >= tier)),
  );
}

export function queueSettlementUpgrade(state: SimState, city: CityState): BuildResult {
  const targetTier = (city.tier + 1) as SettlementTier;
  const upgrade = settlementUpgradeTo(targetTier);
  if (!upgrade) return fail('max-level');

  const blocked = settlementUpgradeBlock(state, city);
  if (blocked) return fail(blocked);

  pay(state, city.ownerIndex, upgrade.cost);
  city.queue.push({ kind: 'settlement', targetTier, monthsRemaining: upgrade.months });
  return OK;
}

export function cancelOrder(state: SimState, city: CityState, position: number): BuildResult {
  const order = city.queue[position];
  if (!order) return fail('not-available');

  const cost =
    order.kind === 'building'
      ? buildingById(order.id)?.cost
      : settlementUpgradeTo(order.targetTier)?.cost;
  if (cost) refund(state, city.ownerIndex, cost);

  city.queue.splice(position, 1);
  return OK;
}

// --------------------------------------------------------------- improvements

/** The highest improvement level this faction can reach — its best settlement's tier. */
export function improvementCap(state: SimState, factionIndex: number): number {
  let best = 0;
  for (const city of state.cities) {
    if (city.ownerIndex === factionIndex && city.tier > best) best = city.tier;
  }
  return Math.min(best, MAX_IMPROVEMENT_LEVEL);
}

export function improvementAt(state: SimState, index: number): ImprovementKind | null {
  const kind = state.improvementKind[index] ?? -1;
  return kind < 0 ? null : (IMPROVEMENT_KINDS[kind] ?? null);
}

export function queueImprovement(
  state: SimState,
  world: World,
  factionIndex: number,
  x: number,
  y: number,
  kind: ImprovementKind,
): BuildResult {
  const index = tileIndex(world, x, y);
  if (state.tileOwner[index] !== factionIndex) return fail('not-owner');
  if (!TERRAIN_PROFILE[terrainAt(world, x, y)].buildable) return fail('unbuildable-terrain');
  if ((state.improvementMonths[index] ?? 0) > 0) return fail('already-building');

  const existing = improvementAt(state, index);
  if (existing !== null && existing !== kind) return fail('wrong-improvement');

  const level = (state.improvementLevel[index] ?? 0) + 1;
  if (level > improvementCap(state, factionIndex)) return fail('max-level');

  const cost = improvementCost(kind, level);
  if (!canAfford(state, factionIndex, cost)) return fail('insufficient-resources');

  pay(state, factionIndex, cost);
  state.improvementKind[index] = IMPROVEMENT_KINDS.indexOf(kind);
  state.improvementTarget[index] = level;
  state.improvementMonths[index] = improvementMonths(level);
  return OK;
}

export function cancelImprovement(state: SimState, index: number): BuildResult {
  if ((state.improvementMonths[index] ?? 0) === 0) return fail('not-available');
  const kind = improvementAt(state, index);
  const owner = state.tileOwner[index] ?? -1;
  const target = state.improvementTarget[index] ?? 0;

  if (kind && owner >= 0) refund(state, owner, improvementCost(kind, target));

  state.improvementMonths[index] = 0;
  state.improvementTarget[index] = 0;
  // A cancelled *first* level leaves no improvement behind; an upgrade keeps what it had.
  if ((state.improvementLevel[index] ?? 0) === 0) state.improvementKind[index] = -1;
  return OK;
}

// ------------------------------------------------- recruitment and shipyards

export function queueUnit(state: SimState, city: CityState, unitId: string): BuildResult {
  const unit = unitById(unitId);
  if (!unit) return fail('not-available');
  if (!recruitableUnits(city.tier, city.buildings).some((u) => u.id === unitId)) {
    return fail('not-available');
  }
  if (!canAfford(state, city.ownerIndex, unit.cost)) return fail('insufficient-resources');

  pay(state, city.ownerIndex, unit.cost);
  city.recruitQueue.push({ id: unit.id, monthsRemaining: unit.months });
  return OK;
}

export function queueShip(state: SimState, city: CityState, shipId: string): BuildResult {
  const ship = shipById(shipId);
  if (!ship) return fail('not-available');
  if (!buildableShips(city.buildings).some((s) => s.id === shipId)) return fail('not-available');
  if (!canAfford(state, city.ownerIndex, ship.cost)) return fail('insufficient-resources');

  pay(state, city.ownerIndex, ship.cost);
  city.shipQueue.push({ id: ship.id, monthsRemaining: ship.months });
  return OK;
}

export function cancelProduction(
  state: SimState,
  city: CityState,
  which: 'recruit' | 'ship',
  position: number,
): BuildResult {
  const queue = which === 'recruit' ? city.recruitQueue : city.shipQueue;
  const order = queue[position];
  if (!order) return fail('not-available');

  const cost = which === 'recruit' ? unitById(order.id)?.cost : shipById(order.id)?.cost;
  if (cost) refund(state, city.ownerIndex, cost);
  queue.splice(position, 1);
  return OK;
}

/**
 * Gold per month owed to everything a faction has standing.
 *
 * Garrisons, fleets and field armies all draw pay. A settlement's own defenders do not: they
 * are part of the settlement, not troops the faction raised.
 */
export function totalUpkeep(state: SimState, factionIndex: number): number {
  let upkeep = 0;
  for (const city of state.cities) {
    if (city.ownerIndex !== factionIndex) continue;
    for (const [id, count] of Object.entries(city.garrison)) {
      upkeep += (unitById(id)?.upkeep ?? 0) * count;
    }
    for (const [id, count] of Object.entries(city.fleet)) {
      upkeep += (shipById(id)?.upkeep ?? 0) * count;
    }
  }
  for (const army of state.armies) {
    if (army.ownerIndex !== factionIndex) continue;
    for (const [id, count] of Object.entries(army.units)) {
      upkeep += (unitById(id)?.upkeep ?? 0) * count;
    }
  }
  return upkeep;
}

// ------------------------------------------------------------------- progress

function record(state: SimState, city: CityState, kind: EventKind, text: string): void {
  pushEvent(state, { kind, text, tileIndex: city.tileIndex, factionIndex: city.ownerIndex });
}

/**
 * Called once per month rollover.
 *
 * Only the head of each queue advances, but the three queues advance in parallel — a city can
 * raise walls and train spearmen in the same month.
 */
export function advanceConstruction(state: SimState, world: World): void {
  for (const city of state.cities) {
    const name = world.cities[city.cityIndex]?.name ?? 'a settlement';

    // Nothing is finished inside a settlement that is invested. The queues are not lost — they
    // simply stop, so a long siege costs the defender every month of work it was owed.
    if (city.siege) continue;

    const order = city.queue[0];
    if (order) {
      order.monthsRemaining -= 1;
      if (order.monthsRemaining <= 0) {
        if (order.kind === 'building') {
          city.buildings.push(order.id);
          record(state, city, 'building', `${buildingById(order.id)?.name ?? order.id} completed in ${name}`);
        } else {
          city.tier = order.targetTier;
          record(state, city, 'settlement', `${name} is now a ${TIER_NAME[order.targetTier]}`);
        }
        city.queue.shift();
      }
    }

    const recruit = city.recruitQueue[0];
    if (recruit) {
      recruit.monthsRemaining -= 1;
      if (recruit.monthsRemaining <= 0) {
        city.garrison[recruit.id] = (city.garrison[recruit.id] ?? 0) + 1;
        record(state, city, 'unit', `${unitById(recruit.id)?.name ?? recruit.id} ready in ${name}`);
        city.recruitQueue.shift();
      }
    }

    const ship = city.shipQueue[0];
    if (ship) {
      ship.monthsRemaining -= 1;
      if (ship.monthsRemaining <= 0) {
        city.fleet[ship.id] = (city.fleet[ship.id] ?? 0) + 1;
        record(state, city, 'ship', `${shipById(ship.id)?.name ?? ship.id} launched at ${name}`);
        city.shipQueue.shift();
      }
    }
  }

  for (let index = 0; index < state.improvementMonths.length; index++) {
    const remaining = state.improvementMonths[index] ?? 0;
    if (remaining === 0) continue;

    const next = remaining - 1;
    state.improvementMonths[index] = next;
    if (next === 0) {
      const level = state.improvementTarget[index] ?? 0;
      state.improvementLevel[index] = level;
      state.improvementTarget[index] = 0;

      const owner = state.tileOwner[index] ?? -1;
      const kind = improvementAt(state, index);
      if (owner >= 0 && kind) {
        pushEvent(state, {
          kind: 'improvement',
          text: `${kind[0]?.toUpperCase()}${kind.slice(1)} level ${level} finished at ${index % world.width}, ${Math.floor(index / world.width)}`,
          tileIndex: index,
          factionIndex: owner,
        });
      }
    }
  }
}
