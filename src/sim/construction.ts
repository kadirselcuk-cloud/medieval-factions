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
import { terrainAt, tileIndex, type World } from '../data/world';
import {
  IMPROVEMENT_KINDS,
  MILLI,
  RESOURCES,
  type CityState,
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
  | 'wrong-improvement';

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

export function isCoastal(world: World, x: number, y: number): boolean {
  const neighbours = [
    [x, y - 1],
    [x + 1, y],
    [x, y + 1],
    [x - 1, y],
  ] as const;
  return neighbours.some(([nx, ny]) => {
    if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height) return false;
    return terrainAt(world, nx, ny) === 'water';
  });
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

export function queueSettlementUpgrade(state: SimState, city: CityState): BuildResult {
  const targetTier = (city.tier + 1) as SettlementTier;
  const upgrade = settlementUpgradeTo(targetTier);
  if (!upgrade) return fail('max-level');
  if (city.queue.some((order) => order.kind === 'settlement')) return fail('already-building');
  if (!canAfford(state, city.ownerIndex, upgrade.cost)) return fail('insufficient-resources');

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

// ------------------------------------------------------------------- progress

/** Called once per month rollover. Only the head of each queue makes progress. */
export function advanceConstruction(state: SimState): void {
  for (const city of state.cities) {
    const order = city.queue[0];
    if (!order) continue;

    order.monthsRemaining -= 1;
    if (order.monthsRemaining > 0) continue;

    if (order.kind === 'building') city.buildings.push(order.id);
    else city.tier = order.targetTier;
    city.queue.shift();
  }

  for (let index = 0; index < state.improvementMonths.length; index++) {
    const remaining = state.improvementMonths[index] ?? 0;
    if (remaining === 0) continue;

    const next = remaining - 1;
    state.improvementMonths[index] = next;
    if (next === 0) {
      state.improvementLevel[index] = state.improvementTarget[index] ?? 0;
      state.improvementTarget[index] = 0;
    }
  }
}
