import { summariseBuildings } from '../data/buildings';
import { CITY_TILE_DEFENCE_BONUS, TERRAIN_PROFILE } from '../data/terrain';
import { cityDefence, unitById, type Unit, type UnitStack } from '../data/units';
import { TERRAINS, type Terrain, type World } from '../data/world';
import { calendarAt } from './calendar';
import {
  MAX_STORED_BATTLES,
  nextRandomInt,
  type BattleAction,
  type BattleAdvantage,
  type BattleEnding,
  type BattleReport,
  type BattleSide,
  type BattleTurn,
  type BattleWinner,
  type CityState,
  type FighterSource,
  type SimState,
} from './types';

/**
 * Auto-resolve — docs/MECHANICS.md §6.
 *
 * A battle is a **pure function of the two stacks, the ground and the RNG**, and it runs to
 * completion in a single call. It draws from the campaign's own seeded stream, so the same save
 * fights the same battle, and it produces a turn-by-turn log rather than just a result — which
 * is what lets the player open a battle and watch something that has, strictly, already
 * happened. In v1 auto-resolve is the only option, so the distinction is invisible; when the
 * tactical layer lands in Phase B it replaces this function and the player chooses first.
 *
 * All arithmetic is integer. The damage formula's fractions live as **per-mille multipliers**,
 * floored at each step, because a battle that resolved differently on two machines would break
 * the one guarantee the whole simulation is built on.
 */

/** Tiles across. The armies start at opposite ends — docs/DESIGN.md decision 66. */
export const FIELD_WIDTH = 50;

/** docs/MECHANICS.md §6 — a battle that has not resolved by here is a stalemate. */
export const MAX_BATTLE_TURNS = 48;

/** The 3× unit-count rout rule only applies once the lines have had time to meet. */
export const ROUT_FROM_TURN = 10;
export const ROUT_RATIO = 3;

/** One battle turn is an in-game hour; six make a tick. Playback pacing, nothing more. */
export const BATTLE_TURNS_PER_TICK = 6;

/**
 * Ceiling on the defender's advantage, per-mille. **[GEN]**
 *
 * A Citadel Capitol on a mountain in winter otherwise reaches 110%, at which point the attacker
 * deals negative damage and heals the defenders. At the cap the attacker still lands a tenth of
 * its damage and the defender nearly double — impregnable without being nonsense.
 */
export const MAX_DEFENDER_ADVANTAGE = 900;

export const ATTACKER: BattleSide = 0;
export const DEFENDER: BattleSide = 1;

/** A fraction from the content files, as an integer per-mille multiplier. */
function permille(value: number): number {
  return Math.round(value * 1000);
}

// ------------------------------------------------------------------- the ground

/**
 * Defender's advantage on this tile, split into the terms that produced it.
 *
 * Terrain, the flat settlement bonus, the fortification line and winter all stack. The
 * attacker's damage is reduced by the total and the defender's raised by it — docs/MECHANICS.md §4.
 */
export function defenderAdvantage(
  state: SimState,
  world: World,
  tileIndex: number,
): BattleAdvantage {
  const terrain = permille(TERRAIN_PROFILE[terrainOf(world, tileIndex)].defence);

  const city = state.cities.find((c) => c.tileIndex === tileIndex);
  const settlement = city ? permille(CITY_TILE_DEFENCE_BONUS) : 0;
  const fortification = city ? summariseBuildings(city.buildings).defenceTenths * 100 : 0;
  const winter = calendarAt(state.tick).season === 'winter' ? 100 : 0;

  const total = Math.min(MAX_DEFENDER_ADVANTAGE, terrain + settlement + fortification + winter);
  return { terrain, settlement, fortification, winter, total };
}

function terrainOf(world: World, index: number): Terrain {
  return TERRAINS[world.terrain[index] ?? 0] ?? 'water';
}

// --------------------------------------------------------------- the battlefield

interface Fighter {
  slot: number;
  side: BattleSide;
  source: FighterSource;
  unitId: string;
  unit: Unit;
  /** Tiles from the attacker's edge. */
  position: number;
  soldiers: number;
  readonly started: number;
  /** The charge modifier fires once, on a formation's first blow in melee. */
  charged: boolean;
}

/** One contribution to a side's line. A settlement fields up to three of these. */
export interface BattleContingent {
  source: FighterSource;
  stack: UnitStack;
}

export interface BattleSetup {
  tileIndex: number;
  /** Index into World.cities when a settlement is being assaulted, else -1. */
  cityIndex: number;
  attackerIndex: number;
  defenderIndex: number;
  attacker: readonly BattleContingent[];
  defender: readonly BattleContingent[];
}

/**
 * Turn each side's stacks into individual formations on the field.
 *
 * Order is fixed — contingents as given, unit ids sorted within each — because slot order
 * decides tie-breaks in the activation order, and a battle has to replay identically from a save.
 */
function muster(contingents: readonly BattleContingent[], side: BattleSide, from: number): Fighter[] {
  const fighters: Fighter[] = [];
  for (const { source, stack } of contingents) {
    for (const unitId of Object.keys(stack).sort()) {
      const unit = unitById(unitId);
      if (!unit) continue;
      for (let i = 0; i < (stack[unitId] ?? 0); i++) {
        fighters.push({
          slot: from + fighters.length,
          side,
          source,
          unitId,
          unit,
          position: side === ATTACKER ? 0 : FIELD_WIDTH,
          soldiers: unit.size,
          started: unit.size,
          charged: false,
        });
      }
    }
  }
  return fighters;
}

/**
 * Activation order — owner-specified: attacker's fastest, defender's fastest, attacker's
 * next-fastest, and so on. Computed once; the dead are skipped rather than removed, so the
 * order never depends on who happens to still be standing.
 */
function activationOrder(fighters: readonly Fighter[]): number[] {
  const bySide = ([ATTACKER, DEFENDER] as const).map((side) =>
    fighters
      .filter((f) => f.side === side)
      .sort((a, b) => b.unit.battleSpeed - a.unit.battleSpeed || a.slot - b.slot),
  );

  const order: number[] = [];
  const longest = Math.max(bySide[0]?.length ?? 0, bySide[1]?.length ?? 0);
  for (let i = 0; i < longest; i++) {
    const attacker = bySide[0]?.[i];
    const defender = bySide[1]?.[i];
    if (attacker) order.push(attacker.slot);
    if (defender) order.push(defender.slot);
  }
  return order;
}

/** How far a formation can hit: its stated range, or one tile for anything that fights in melee. */
function reachOf(unit: Unit): number {
  return unit.range > 0 ? unit.range : 1;
}

/**
 * Casualties one formation inflicts on another — docs/MECHANICS.md §6. **[GEN]** formula.
 *
 * `raw = soldiers × damagePerSoldier`, then a chain of per-mille multipliers: the charge, the
 * spear's matchup against cavalry, shielded infantry's resistance to arrows, and the defender's
 * advantage. Floored at each step, then divided by the target's per-soldier HP.
 */
function casualtiesFrom(
  actor: Fighter,
  target: Fighter,
  advantage: number,
  charging: boolean,
): number {
  const a = actor.unit;
  const t = target.unit;
  const ranged = a.range > 0;

  const raw = actor.soldiers * (a.damage + (charging ? a.chargeBonus : 0));

  let mod = 1000;
  if (charging && a.chargeMultiplier > 1) {
    mod = Math.floor((mod * permille(a.chargeMultiplier)) / 1000);
  }
  if (t.class === 'cavalry' && a.antiCavalry > 1) {
    mod = Math.floor((mod * permille(a.antiCavalry)) / 1000);
  }
  if (ranged && t.rangedResist > 0) {
    mod = Math.floor((mod * (1000 - permille(t.rangedResist))) / 1000);
  }

  // The attacker's blows are blunted by the ground, the defender's sharpened by it.
  mod = Math.floor((mod * (actor.side === DEFENDER ? 1000 + advantage : 1000 - advantage)) / 1000);

  return Math.floor(Math.floor((raw * mod) / 1000) / t.hp);
}

// -------------------------------------------------------------------- the battle

export interface BattleResult {
  report: BattleReport;
  /**
   * Survivors by side and by where they were raised, for the caller to put back.
   *
   * The report carries only totals. This distinguishes a settlement's free defenders (which
   * leave nothing behind) from its garrison (which does) from an army standing on the tile.
   */
  survivors: [Record<FighterSource, UnitStack>, Record<FighterSource, UnitStack>];
}

/**
 * Fight it out.
 *
 * Mutates `state.rng` and `state.nextBattleId` and nothing else — applying the result to the
 * map is `conquest.ts`'s business, which keeps this function testable in isolation.
 */
export function fightBattle(state: SimState, world: World, setup: BattleSetup): BattleResult {
  const attackers = muster(setup.attacker, ATTACKER, 0);
  const defenders = muster(setup.defender, DEFENDER, attackers.length);
  const fighters = [...attackers, ...defenders];

  const advantage = defenderAdvantage(state, world, setup.tileIndex);
  const order = activationOrder(fighters);
  const turns: BattleTurn[] = [];

  const standing = (side: BattleSide) =>
    fighters.reduce((n, f) => n + (f.side === side && f.soldiers > 0 ? 1 : 0), 0);

  let winner: BattleWinner = 'stalemate';
  let ending: BattleEnding = 'cap';
  let decided = false;

  // A side that puts nothing on the field loses without a shot — an empty stack is not a battle.
  if (standing(ATTACKER) === 0 || standing(DEFENDER) === 0) {
    winner = standing(ATTACKER) > 0 ? 'attacker' : standing(DEFENDER) > 0 ? 'defender' : 'stalemate';
    ending = 'destroyed';
    decided = true;
  }

  for (let turn = 1; turn <= MAX_BATTLE_TURNS && !decided; turn++) {
    const actions: BattleAction[] = [];

    for (const slot of order) {
      const actor = fighters[slot];
      if (!actor || actor.soldiers <= 0) continue;

      const enemies = fighters.filter((f) => f.side !== actor.side && f.soldiers > 0);
      if (enemies.length === 0) break;

      const reach = reachOf(actor.unit);
      const inRange = enemies.filter((e) => Math.abs(e.position - actor.position) <= reach);

      if (inRange.length > 0) {
        // Owner-specified: a formation in range attacks a **random** enemy within it.
        const target = inRange[nextRandomInt(state, inRange.length)];
        if (!target) continue;

        const melee = actor.unit.range === 0;
        const charging =
          melee && !actor.charged && (actor.unit.chargeBonus > 0 || actor.unit.chargeMultiplier > 1);
        const casualties = Math.min(
          target.soldiers,
          casualtiesFrom(actor, target, advantage.total, charging),
        );

        target.soldiers -= casualties;
        if (melee) actor.charged = true;
        actions.push(
          melee
            ? { kind: 'strike', slot, target: target.slot, casualties, charge: charging }
            : { kind: 'shoot', slot, target: target.slot, casualties, charge: false },
        );
        continue;
      }

      // Nothing in reach: close on the nearest enemy, stopping the moment it is.
      const nearest = enemies.reduce((best, e) =>
        Math.abs(e.position - actor.position) < Math.abs(best.position - actor.position) ? e : best,
      );
      const gap = nearest.position - actor.position;
      const step = Math.min(actor.unit.battleSpeed, Math.abs(gap) - reach);
      if (step <= 0) continue;

      actor.position += Math.sign(gap) * step;
      actions.push({ kind: 'move', slot, to: actor.position });
    }

    turns.push({ turn, actions });

    const left: [number, number] = [standing(ATTACKER), standing(DEFENDER)];
    if (left[0] === 0 || left[1] === 0) {
      ending = 'destroyed';
      winner = left[0] > 0 ? 'attacker' : left[1] > 0 ? 'defender' : 'stalemate';
      decided = true;
    } else if (turn > ROUT_FROM_TURN && left[0] > left[1] * ROUT_RATIO) {
      ending = 'rout';
      winner = 'attacker';
      decided = true;
    } else if (turn > ROUT_FROM_TURN && left[1] > left[0] * ROUT_RATIO) {
      ending = 'rout';
      winner = 'defender';
      decided = true;
    }
  }

  const held: [boolean, boolean] = [
    winner === 'attacker' || winner === 'stalemate',
    winner === 'defender' || winner === 'stalemate',
  ];

  // Survivors are split by where they were raised first, and the report's totals are the sum of
  // those parts — so what the player is shown can never disagree with what is written back.
  const survivors: [Record<FighterSource, UnitStack>, Record<FighterSource, UnitStack>] = [
    bySource(fighters, ATTACKER, held[0]),
    bySource(fighters, DEFENDER, held[1]),
  ];

  const report: BattleReport = {
    id: state.nextBattleId++,
    tick: state.tick,
    tileIndex: setup.tileIndex,
    cityIndex: setup.cityIndex,
    attackerIndex: setup.attackerIndex,
    defenderIndex: setup.defenderIndex,
    advantage,
    fighters: fighters.map((f) => ({
      slot: f.slot,
      side: f.side,
      source: f.source,
      unitId: f.unitId,
      soldiers: f.started,
      position: f.side === ATTACKER ? 0 : FIELD_WIDTH,
    })),
    turns,
    winner,
    ending,
    losses: [lossesOf(fighters, ATTACKER), lossesOf(fighters, DEFENDER)],
    before: [fieldedUnits(fighters, ATTACKER), fieldedUnits(fighters, DEFENDER)],
    after: [mergeStacks(survivors[0]), mergeStacks(survivors[1])],
    captured: false,
  };

  return { report, survivors };
}

/**
 * A side's survivors, kept apart by where they were raised.
 *
 * `held` is the rule that stops a side that stayed on the field from evaporating on a rounding
 * boundary: if any of its men are still standing, it walks away with at least one unit. Applied
 * across the whole side rather than per contingent, so a settlement whose defenders and garrison
 * were both mauled below half still keeps one formation rather than one of each.
 */
function bySource(
  fighters: readonly Fighter[],
  side: BattleSide,
  held: boolean,
): Record<FighterSource, UnitStack> {
  const split: Record<FighterSource, UnitStack> = {
    army: reformed(fighters, side, 'army'),
    garrison: reformed(fighters, side, 'garrison'),
    defence: reformed(fighters, side, 'defence'),
  };
  if (!held || unitCount(mergeStacks(split)) > 0) return split;

  const strongest = fighters
    .filter((f) => f.side === side && f.soldiers > 0)
    .sort((a, b) => b.soldiers - a.soldiers || a.slot - b.slot)[0];
  if (strongest) split[strongest.source][strongest.unitId] = 1;
  return split;
}

function mergeStacks(split: Record<FighterSource, UnitStack>): UnitStack {
  const stack: UnitStack = {};
  for (const part of Object.values(split)) {
    for (const [id, count] of Object.entries(part)) stack[id] = (stack[id] ?? 0) + count;
  }
  return stack;
}

function lossesOf(fighters: readonly Fighter[], side: BattleSide): number {
  return fighters.reduce((n, f) => (f.side === side ? n + (f.started - f.soldiers) : n), 0);
}

/** The units a side put on the field, before a shot was fired. */
function fieldedUnits(fighters: readonly Fighter[], side: BattleSide): UnitStack {
  const stack: UnitStack = {};
  for (const f of fighters) {
    if (f.side !== side) continue;
    stack[f.unitId] = (stack[f.unitId] ?? 0) + 1;
  }
  return stack;
}

/**
 * Fold one contingent's survivors back into whole units.
 *
 * A campaign army is a count of units, not a soldier ledger, so the men who walk off the field
 * are **reformed**: every 60 surviving archers make an archer unit again, rounded, and a
 * formation that lost more than half its men is struck off. That is a real cost for winning
 * badly, without needing per-unit strength in the save. **[GEN]** — the owner specified that
 * casualties come off the soldier pool, not what becomes of the pool afterwards.
 */
function reformed(
  fighters: readonly Fighter[],
  side: BattleSide,
  source: FighterSource,
): UnitStack {
  const fielded = new Map<string, number>();
  const soldiers = new Map<string, number>();
  for (const f of fighters) {
    if (f.side !== side || f.source !== source) continue;
    fielded.set(f.unitId, (fielded.get(f.unitId) ?? 0) + 1);
    if (f.soldiers > 0) soldiers.set(f.unitId, (soldiers.get(f.unitId) ?? 0) + f.soldiers);
  }

  const stack: UnitStack = {};
  for (const [id, total] of soldiers) {
    const size = unitById(id)?.size ?? 1;
    const units = Math.min(fielded.get(id) ?? 0, Math.round(total / size));
    if (units > 0) stack[id] = units;
  }
  return stack;
}

// -------------------------------------------------------------------- assembling

/** Everything a settlement puts on the field: its free defenders, then its garrison. */
export function settlementContingents(city: CityState): BattleContingent[] {
  const parts: BattleContingent[] = [
    { source: 'defence', stack: cityDefence(city.tier, city.buildings) },
  ];
  if (Object.keys(city.garrison).length > 0) {
    parts.push({ source: 'garrison', stack: { ...city.garrison } });
  }
  return parts;
}

export function recordBattle(state: SimState, report: BattleReport): void {
  state.battles.unshift(report);
  if (state.battles.length > MAX_STORED_BATTLES) state.battles.length = MAX_STORED_BATTLES;
}

export function battleById(state: SimState, id: number): BattleReport | undefined {
  return state.battles.find((report) => report.id === id);
}

/** Units in a stack, for the report summaries and the tests. */
export function unitCount(stack: UnitStack): number {
  return Object.values(stack).reduce((total, count) => total + count, 0);
}
