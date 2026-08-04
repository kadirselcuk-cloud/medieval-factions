import { beforeEach, describe, expect, it } from 'vitest';
import { siegeMonths } from '../data/buildings';
import { loadFactions } from '../data/factions';
import { loadEurope1350 } from '../data/maps';
import { unitById, type UnitStack } from '../data/units';
import { inBounds, terrainAt, tileIndex } from '../data/world';
import { armyById } from './armies';
import { ATTACKER, DEFENDER, defenderAdvantage, openFieldAdvantage } from './battle';
import { TICKS_PER_MONTH } from './calendar';
import { beginSiege, RELIEF_RANGE, resolveEngagement, siegeTarget } from './conquest';
import { queueBuilding } from './construction';
import { deserialise, serialise } from './save';
import { createInitialState, recomputeIncome } from './state';
import { advanceBy, SIEGE_STARVATION } from './tick';
import { MILLI, type ArmyState, type CityState, type SimState } from './types';

const world = loadEurope1350();
const roster = loadFactions();
const FRANKS = roster.findIndex((f) => f.id === 'franks');
const NEUTRAL = roster.findIndex((f) => f.neutral);

/** June — a battle in January would carry winter's extra 10% for the defender. */
const SUMMER = TICKS_PER_MONTH * 5;

let state: SimState;

beforeEach(() => {
  state = createInitialState(world, roster, 'franks', 4242);
  state.tick = SUMMER;
});

function place(units: UnitStack, ownerIndex: number, tile: number): ArmyState {
  const army: ArmyState = {
    id: state.nextArmyId++,
    ownerIndex,
    tileIndex: tile,
    units: { ...units },
    path: [],
    march: 0,
      role: 'field',
  };
  state.armies.push(army);
  return army;
}

/** Land tiles within `range` of a settlement that nothing else is standing on. */
function ringAround(city: CityState, range: number): number[] {
  const location = world.cities[city.cityIndex]!;
  const tiles: number[] = [];
  for (let dy = -range; dy <= range; dy++) {
    for (let dx = -range; dx <= range; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== range) continue;
      const x = location.x + dx;
      const y = location.y + dy;
      if (!inBounds(world, x, y) || terrainAt(world, x, y) === 'water') continue;
      const index = tileIndex(world, x, y);
      if (state.cities.some((c) => c.tileIndex === index)) continue;
      tiles.push(index);
    }
  }
  return tiles;
}

/** An Independent settlement with room around it to stage a siege and a relief. */
function target(): CityState {
  for (const city of state.cities) {
    if (city.ownerIndex !== NEUTRAL) continue;
    if (ringAround(city, 1).length >= 2 && ringAround(city, 2).length >= 1) return city;
  }
  throw new Error('no settlement with open ground around it');
}

/** Two adjacent empty plains tiles, so a test battle turns only on the terrain. */
function openGround(): { from: number; to: number } {
  for (let y = 1; y < world.height - 1; y++) {
    for (let x = 1; x < world.width - 2; x++) {
      if (terrainAt(world, x, y) !== 'plains' || terrainAt(world, x + 1, y) !== 'plains') continue;
      const from = tileIndex(world, x, y);
      const to = tileIndex(world, x + 1, y);
      if (state.cities.some((c) => c.tileIndex === from || c.tileIndex === to)) continue;
      return { from, to };
    }
  }
  throw new Error('no open ground on the map');
}

// ------------------------------------------------------------------- accuracy

describe('ranged accuracy', () => {
  it('carries the owner-authored figures', () => {
    expect(unitById('skirmisher')?.accuracy).toBe(0.3);
    expect(unitById('archer')?.accuracy).toBe(0.5);
    expect(unitById('cavalry_archer')?.accuracy).toBe(0.4);
    // Everything that fights hand to hand connects with every man it swings at.
    expect(unitById('light_infantry')?.accuracy).toBe(1);
  });

  /**
   * The volley that used to wipe out a Light Infantry unit unanswered now takes half as many
   * with it. 60 archers × 20 damage = 1,200, halved to 600 by accuracy, ×1.1 for the ground,
   * over 100 HP a man.
   */
  it('halves what an archer takes out of a volley', () => {
    const { from, to } = openGround();
    const attacker = place({ light_infantry: 1 }, FRANKS, from);
    place({ archer: 1 }, NEUTRAL, to);

    const { report } = resolveEngagement(state, world, attacker, to);
    const volley = report.turns.flatMap((t) => t.actions).find((a) => a.kind === 'shoot');
    expect(volley?.casualties).toBe(6);
  });
});

// --------------------------------------------------------------------- sieges

describe('laying siege', () => {
  it('needs an army at the gates of a hostile settlement', () => {
    const city = target();
    const far = place({ light_infantry: 1 }, FRANKS, ringAround(city, 2)[0]!);
    expect(siegeTarget(state, world, far)).toBeUndefined();
    expect(beginSiege(state, world, far.id)).toEqual({ ok: false, reason: 'not-adjacent' });

    const near = place({ light_infantry: 1 }, FRANKS, ringAround(city, 1)[0]!);
    expect(siegeTarget(state, world, near)).toBe(city);
    expect(beginSiege(state, world, near.id).ok).toBe(true);
    expect(city.siege).toMatchObject({ byIndex: FRANKS, monthsRemaining: siegeMonths(city.tier) });
  });

  it('holds out for as long as its tier allows', () => {
    expect(siegeMonths(1)).toBe(1);
    expect(siegeMonths(2)).toBe(3);
    expect(siegeMonths(3)).toBe(6);
    expect(siegeMonths(4)).toBe(12);
  });

  it('cuts the settlement off, stalls its work and starves it', () => {
    const city = target();
    city.tier = 3;
    city.population = 8_000;
    state.factions[NEUTRAL]!.stock.gold = 100_000 * MILLI;
    expect(queueBuilding(state, world, city, 'wooden_houses').ok).toBe(true);
    const queued = city.queue[0]!.monthsRemaining;

    recomputeIncome(state, world);
    const paid = state.factions[NEUTRAL]!.monthlyIncome.gold;

    const besieger = place({ heavy_cavalry: 1 }, FRANKS, ringAround(city, 1)[0]!);
    beginSiege(state, world, besieger.id);
    recomputeIncome(state, world);

    // 8,000 people were worth 80 gold a month; under siege the city pays nothing at all.
    expect(state.factions[NEUTRAL]!.monthlyIncome.gold).toBeLessThan(paid);

    advanceBy(state, world, TICKS_PER_MONTH);
    expect(city.queue[0]!.monthsRemaining).toBe(queued);
    expect(city.population).toBe(8_000 - SIEGE_STARVATION[3]);
  });

  it('is held by presence — walk away and it is over', () => {
    const city = target();
    city.tier = 3;
    const besieger = place({ light_infantry: 1 }, FRANKS, ringAround(city, 1)[0]!);
    beginSiege(state, world, besieger.id);

    besieger.tileIndex = ringAround(city, 2)[0]!;
    advanceBy(state, world, TICKS_PER_MONTH);
    expect(city.siege).toBeNull();
  });

  it('surrenders when the clock runs out against hopeless odds', () => {
    const city = target(); // Village: one month, one free defender
    const besieger = place({ heavy_cavalry: 10 }, FRANKS, ringAround(city, 1)[0]!);
    beginSiege(state, world, besieger.id);

    advanceBy(state, world, TICKS_PER_MONTH);
    expect(city.ownerIndex).toBe(FRANKS);
    expect(city.siege).toBeNull();
    // Surrendered, not stormed — nobody fought.
    expect(state.battles).toHaveLength(0);
  });

  it('sorties into a battle when the odds are not hopeless', () => {
    const city = target();
    city.tier = 2;
    city.garrison = { sword_infantry: 3 };
    const besieger = place({ light_infantry: 2 }, FRANKS, ringAround(city, 1)[0]!);
    beginSiege(state, world, besieger.id);

    advanceBy(state, world, TICKS_PER_MONTH * siegeMonths(2));
    expect(state.battles).toHaveLength(1);
    expect(state.battles[0]!.cityIndex).toBe(city.cityIndex);
  });

  it('survives a save', () => {
    const city = target();
    city.tier = 4;
    const besieger = place({ light_infantry: 1 }, FRANKS, ringAround(city, 1)[0]!);
    beginSiege(state, world, besieger.id);

    const reloaded = deserialise(serialise(state));
    expect(reloaded.cities[state.cities.indexOf(city)]!.siege).toEqual(city.siege);
  });
});

// ---------------------------------------------------- the 5 × 5 battle for a city

describe('fighting for a city', () => {
  it('draws in every army within the 5 × 5 box, on both sides', () => {
    const city = target();
    const lead = place({ light_infantry: 1 }, FRANKS, ringAround(city, 1)[0]!);
    const second = place({ light_infantry: 1 }, FRANKS, ringAround(city, 2)[0]!);
    const relief = place({ sword_infantry: 1 }, NEUTRAL, ringAround(city, 2).at(-1)!);

    const { report } = resolveEngagement(state, world, lead, city.tileIndex);

    const armies = new Set(report.fighters.map((f) => f.source));
    expect(armies.has('army')).toBe(true);
    // Both Frankish armies attacked, and the relief marched to the defence.
    expect(report.fighters.filter((f) => f.side === ATTACKER)).toHaveLength(2);
    expect(report.fighters.some((f) => f.side === DEFENDER && f.unitId === 'sword_infantry')).toBe(true);
    void second;
    void relief;
  });

  it('leaves an army outside the box out of it', () => {
    const city = target();
    const lead = place({ light_infantry: 1 }, FRANKS, ringAround(city, 1)[0]!);
    const distant = ringAround(city, RELIEF_RANGE + 1)[0];
    if (distant === undefined) return; // map edge; nothing to prove here
    place({ light_infantry: 1 }, FRANKS, distant);

    const { report } = resolveEngagement(state, world, lead, city.tileIndex);
    expect(report.fighters.filter((f) => f.side === ATTACKER)).toHaveLength(1);
  });

  /**
   * The owner's rule: the men on the walls keep the citadel, the ones who marched to the relief
   * fight in the open beside them.
   */
  it('gives the walls only to the troops behind them', () => {
    const city = target();
    city.tier = 4;
    city.buildings = ['citadel'];
    city.garrison = { sword_infantry: 1 };
    const lead = place({ light_infantry: 1 }, FRANKS, ringAround(city, 1)[0]!);
    place({ sword_infantry: 1 }, NEUTRAL, ringAround(city, 2).at(-1)!);

    const full = defenderAdvantage(state, world, city.tileIndex);
    const { report } = resolveEngagement(state, world, lead, city.tileIndex);

    const behind = report.fighters.filter((f) => f.side === DEFENDER && f.source !== 'army');
    const outside = report.fighters.filter((f) => f.side === DEFENDER && f.source === 'army');

    expect(behind.every((f) => f.advantage === full.total)).toBe(true);
    expect(outside.every((f) => f.advantage === openFieldAdvantage(full))).toBe(true);
    expect(openFieldAdvantage(full)).toBeLessThan(full.total);
    // The attacker never gets the ground, wherever it is standing.
    expect(report.fighters.filter((f) => f.side === ATTACKER).every((f) => f.advantage === 0)).toBe(true);
  });

  it('sends a relieving army home when the settlement holds', () => {
    const city = target();
    city.tier = 4;
    city.buildings = ['citadel'];
    const lead = place({ light_infantry: 1 }, FRANKS, ringAround(city, 1)[0]!);
    const relief = place({ sword_infantry: 2 }, NEUTRAL, ringAround(city, 2).at(-1)!);

    const held = resolveEngagement(state, world, lead, city.tileIndex);
    expect(held.report.winner).toBe('defender');
    expect(armyById(state, relief.id)).toBeDefined();
    expect(armyById(state, lead.id)).toBeUndefined();
  });

  it('destroys a relieving army when the settlement falls', () => {
    const city = target(); // a Village, stormable
    const relief = place({ light_infantry: 1 }, NEUTRAL, ringAround(city, 2).at(-1)!);
    const storm = place({ heavy_cavalry: 8 }, FRANKS, ringAround(city, 1)[0]!);

    const taken = resolveEngagement(state, world, storm, city.tileIndex);
    expect(taken.report.winner).toBe('attacker');
    expect(city.ownerIndex).toBe(FRANKS);
    // It marched to the relief and was lost with the city — proximity cuts both ways.
    expect(armyById(state, relief.id)).toBeUndefined();
  });

  /**
   * The point of the whole feature: a Citadel cannot be stormed, so it has to be starved out.
   */
  it('takes by siege what cannot be taken by assault', () => {
    const city = target();
    city.tier = 4;
    city.buildings = ['citadel'];

    // Storming the walls: four Heavy Cavalry are thrown back by five free defenders.
    //
    // Four rather than the twelve this used to take. 0.13.0 halved every defence bonus, so the
    // worst ground in the game is now 55% rather than the 90% ceiling and a Citadel Capitol can
    // be stormed outright by a large enough army — the walls buy time now, not immunity.
    const storm = place({ heavy_cavalry: 4 }, FRANKS, ringAround(city, 1)[0]!);
    expect(resolveEngagement(state, world, storm, city.tileIndex).report.winner).toBe('defender');
    expect(city.ownerIndex).toBe(NEUTRAL);

    // Sitting outside it: the walls no longer count.
    //
    // **Twelve rather than four**, because since 0.17.1 a besieger in enemy country loses units to
    // every winter month it spends there — a Capitol's clock runs 48 months, which is twelve
    // winters, and four units expect to be down to one before the gates open. Starving a great
    // city out is now something only a large army can survive doing. See docs/MECHANICS.md §5.
    state.factions[FRANKS]!.stock.gold = 1_000_000 * MILLI; // upkeep, not the point of the test
    const besieger = place({ heavy_cavalry: 12 }, FRANKS, ringAround(city, 1)[0]!);
    expect(beginSiege(state, world, besieger.id).ok).toBe(true);
    advanceBy(state, world, TICKS_PER_MONTH * siegeMonths(4));

    expect(city.ownerIndex).toBe(FRANKS);
    expect(state.battles[0]?.winner).toBe('attacker');
  });
});
