import type { World } from '../data/world';
import { armyAt, removeArmy } from './armies';
import { fightBattle, recordBattle, settlementContingents, unitCount, type BattleContingent } from './battle';
import { pushEvent } from './events';
import type { ArmyState, BattleReport, CityState, SimState } from './types';

/**
 * What happens after the fighting — who holds the ground, which city changed hands, and who is
 * left standing.
 *
 * Kept apart from `battle.ts` on purpose: the battle is a pure function of two stacks and the
 * ground, and everything that touches the map lives here. That is the line the tactical layer
 * will cut along in Phase B, where only the first half is replaced.
 */

export interface EngagementResult {
  report: BattleReport;
  /** True when the attacker took the tile and should be moved onto it. */
  advance: boolean;
}

/**
 * Fight for a tile an army has marched into.
 *
 * The defenders are everything standing on it: a settlement's free defenders, the units it has
 * recruited into its garrison, and any hostile army parked there. Troops sitting inside a city
 * being stormed fight for it — **[GEN]**, the owner separated garrison from defenders but never
 * said the garrison stands idle while the walls are taken.
 */
export function resolveEngagement(
  state: SimState,
  world: World,
  army: ArmyState,
  tileIndex: number,
): EngagementResult {
  const city = state.cities.find((c) => c.tileIndex === tileIndex && c.ownerIndex !== army.ownerIndex);
  const standing = armyAt(state, tileIndex);
  const enemy = standing && standing.ownerIndex !== army.ownerIndex ? standing : undefined;

  const defender: BattleContingent[] = [];
  if (city) defender.push(...settlementContingents(city));
  if (enemy) defender.push({ source: 'army', stack: { ...enemy.units } });

  const defenderIndex = city?.ownerIndex ?? enemy?.ownerIndex ?? -1;

  const { report, survivors } = fightBattle(state, world, {
    tileIndex,
    cityIndex: city?.cityIndex ?? -1,
    attackerIndex: army.ownerIndex,
    defenderIndex,
    attacker: [{ source: 'army', stack: { ...army.units } }],
    defender,
  });

  const attackerWon = report.winner === 'attacker';

  // --- the attacker's own stack
  army.path = [];
  army.march = 0;
  const attackerLeft = survivors[0].army;
  if (unitCount(attackerLeft) === 0) {
    removeArmy(state, army.id);
  } else {
    army.units = attackerLeft;
  }

  // --- the defending army, if there was one
  if (enemy) {
    const left = survivors[1].army;
    if (attackerWon || unitCount(left) === 0) removeArmy(state, enemy.id);
    else enemy.units = left;
  }

  // --- the settlement
  if (city) {
    if (attackerWon) {
      captureCity(state, world, city, army.ownerIndex);
      report.captured = true;
    } else {
      // It held. Whatever is left of the garrison goes back behind the walls; the free
      // defenders are derived from the tier and simply reappear at full strength.
      city.garrison = survivors[1].garrison;
    }
  }

  announce(state, world, report);
  recordBattle(state, report);
  // A realm can end here in two ways: its last city taken, or its last army destroyed.
  updateLiveness(state);

  return { report, advance: attackerWon && unitCount(attackerLeft) > 0 };
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

/** Victory is total conquest: the last faction standing, neutrals included. */
export function survivingFactions(state: SimState): readonly number[] {
  return state.factions.filter((f) => f.alive).map((f) => f.index);
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

  const lost = (side: 0 | 1) => report.losses[side];

  pushEvent(state, {
    kind: 'battle',
    text: `Battle at ${where} — your army ${outcome(report.winner === 'attacker')}, ${lost(0)} lost`,
    tileIndex: report.tileIndex,
    factionIndex: report.attackerIndex,
    battleId: report.id,
  });

  if (report.defenderIndex >= 0 && report.defenderIndex !== report.attackerIndex) {
    pushEvent(state, {
      kind: 'battle',
      text: `Battle at ${where} — your defence ${outcome(report.winner === 'defender')}, ${lost(1)} lost`,
      tileIndex: report.tileIndex,
      factionIndex: report.defenderIndex,
      battleId: report.id,
    });
  }
}
