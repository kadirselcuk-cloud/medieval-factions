import { describe, expect, it } from 'vitest';
import { factionIdAt, loadFactions } from './factions';
import {
  bonusesOf,
  rosterOf,
  rosteredFactions,
  shipsFor,
  unitFor,
  unitNameFor,
  unitsFor,
} from './rosters';
import { loadShips, loadUnits, unitById } from './units';

/**
 * Per-faction rosters — docs/CONTENT.md §5, owner-specified in 0.20.0.
 *
 * The rule these tests exist to hold is not that any particular Frank is called a Gendarme. It is
 * that **identity never becomes advantage**: every realm pays the same gold, the same people and the
 * same months for the same unit, and what it gets for them differs only in ways that cost it
 * something else.
 */

const roster = loadFactions();
const playable = roster.filter((f) => !f.neutral);

describe('every faction has a roster', () => {
  it('names one for every faction but the Independents', () => {
    expect(rosteredFactions()).toEqual([...playable.map((f) => f.id)].sort());
    // The Independents are unclaimed ground with a garrison, not a realm with a character.
    expect(rosterOf('independents')).toBeUndefined();
  });

  it('names every land unit and every hull, for every faction', () => {
    const units = loadUnits().map((u) => u.id);
    const ships = loadShips().map((s) => s.id);

    for (const faction of playable) {
      const entry = rosterOf(faction.id)!;
      expect(Object.keys(entry.units).sort(), faction.id).toEqual([...units].sort());
      expect(Object.keys(entry.ships).sort(), faction.id).toEqual([...ships].sort());
    }
  });

  it('gives every faction exactly two bonuses, one economic and one military', () => {
    for (const faction of playable) {
      const bonus = bonusesOf(faction.id)!;
      expect(bonus.economy.text.length, faction.id).toBeGreaterThan(0);
      expect(bonus.military.text.length, faction.id).toBeGreaterThan(0);
      expect(['gold', 'wood', 'iron', 'stone', 'growth']).toContain(bonus.economy.kind);
      expect(['hp', 'damage', 'march']).toContain(bonus.military.kind);
    }
  });

  it('keeps the bonuses small enough to be flavour rather than strategy', () => {
    // The owner asked for "small bonuses that don't affect the gameplay". Six per cent of one
    // resource, or one extra person a month, is a thumb on the scale.
    for (const faction of playable) {
      const bonus = bonusesOf(faction.id)!;
      if (bonus.economy.kind === 'growth') {
        expect(Math.abs(bonus.economy.people), faction.id).toBeLessThanOrEqual(2);
      } else {
        expect(Math.abs(bonus.economy.permille), faction.id).toBeLessThanOrEqual(60);
      }
      expect(Math.abs(bonus.military.permille), faction.id).toBeLessThanOrEqual(60);
    }
  });
});

describe('a name is a trade, never a free upgrade', () => {
  it('never lets a faction pay less for a unit than anybody else', () => {
    // **The load-bearing test.** Cost, people and time are what make a unit a decision; if a roster
    // could touch them, identity would be an economy and the whole thing would need balancing
    // against the map rather than against itself.
    for (const faction of playable) {
      for (const base of [...loadUnits(), ...loadShips()]) {
        const mine = unitFor(faction.id, base.id)!;
        expect(mine.cost, `${faction.id} ${base.id}`).toEqual(base.cost);
        expect(mine.size, `${faction.id} ${base.id}`).toBe(base.size);
        expect(mine.upkeep, `${faction.id} ${base.id}`).toBe(base.upkeep);
        expect(mine.months, `${faction.id} ${base.id}`).toBe(base.months);
        expect(mine.minTier, `${faction.id} ${base.id}`).toBe(base.minTier);
        expect(mine.requires, `${faction.id} ${base.id}`).toEqual(base.requires);
      }
    }
  });

  it('keeps every renamed unit within a short reach of its base', () => {
    // A roster bends a unit; it does not replace it. Anything further than this is a new unit and
    // should be authored as one.
    //
    // The hit-point bound allows 30 rather than the 25 the deltas themselves stay inside, because
    // the military bonus is a **percentage applied after the delta**: a Gendarme is +20 on a base
    // of 200 and then +3% of the 220, which is 26. The compounding is small but it is real, and it
    // is largest exactly where the base is largest.
    for (const faction of playable) {
      for (const base of [...loadUnits(), ...loadShips()]) {
        const mine = unitFor(faction.id, base.id)!;
        expect(Math.abs(mine.hp - base.hp), `${faction.id} ${base.id} hp`).toBeLessThanOrEqual(30);
        expect(
          Math.abs(mine.damage - base.damage),
          `${faction.id} ${base.id} damage`,
        ).toBeLessThanOrEqual(6);
      }
    }
  });

  it('never produces a unit that cannot exist', () => {
    for (const faction of playable) {
      for (const base of [...loadUnits(), ...loadShips()]) {
        const mine = unitFor(faction.id, base.id)!;
        expect(mine.hp).toBeGreaterThan(0);
        expect(mine.damage).toBeGreaterThanOrEqual(0);
        expect(mine.strategicSpeed).toBeGreaterThan(0);
        expect(Number.isInteger(mine.hp)).toBe(true);
        expect(Number.isInteger(mine.damage)).toBe(true);
        expect(Number.isInteger(mine.strategicSpeed)).toBe(true);
      }
    }
  });

  it('pays for hit points with damage, and the other way about, across the roster', () => {
    /**
     * Checked in aggregate rather than per unit, because a few units are deliberately a small net
     * gain or loss where the history asks for it — a Landsknecht is simply good. What must not
     * happen is a faction whose whole roster is better than the table.
     *
     * Scored on the same `hp × damage` the AI uses to compare units, summed over the roster, and
     * required to stay within a tenth of the base. `unitFor` includes the military bonus, so this
     * also catches a bonus large enough to tip a whole army.
     */
    for (const faction of playable) {
      const mine = loadUnits().reduce((n, base) => {
        const unit = unitFor(faction.id, base.id)!;
        return n + unit.hp * unit.damage;
      }, 0);
      const table = loadUnits().reduce((n, base) => n + base.hp * base.damage, 0);
      expect(mine / table, `${faction.id} roster strength`).toBeGreaterThan(0.9);
      expect(mine / table, `${faction.id} roster strength`).toBeLessThan(1.1);
    }
  });
});

describe('resolving a faction s version of a unit', () => {
  it('renames what the faction renames and leaves the rest alone', () => {
    expect(unitNameFor('britons', 'archer')).toBe('Longbowman');
    expect(unitNameFor('franks', 'heavy_cavalry')).toBe('Gendarme');
    expect(unitNameFor('turks', 'light_cavalry')).toBe('Akıncı');
    expect(unitNameFor('moors', 'light_cavalry')).toBe('Zenete');
    expect(unitNameFor('holy_romans', 'shock_infantry')).toBe('Landsknecht');
    expect(unitNameFor('turks', 'flagship')).toBe('Baştarda');
  });

  it('lets factions share a name, which the owner asked for', () => {
    // A Carrack served half of Europe and a Baştarda served both Muslim powers on this map.
    expect(unitNameFor('golden_horde', 'flagship')).toBe(unitNameFor('turks', 'flagship'));
    expect(unitNameFor('britons', 'light_ship')).toBe(unitNameFor('franks', 'light_ship'));
  });

  it('falls back to the base roster for a faction that has none', () => {
    const base = unitById('archer')!;
    expect(unitNameFor('independents', 'archer')).toBe(base.name);
    expect(unitFor('independents', 'archer')).toEqual(base);
    // And for a faction id that does not exist at all, which is what a pre-0.20.0 save would give.
    expect(unitFor('', 'archer')).toEqual(base);
  });

  it('returns undefined for an id that names nothing', () => {
    expect(unitFor('britons', 'trebuchet')).toBeUndefined();
    expect(unitNameFor('britons', 'trebuchet')).toBe('trebuchet');
  });

  it('applies the military bonus on top of the named trade', () => {
    // The Britons trade 10 hit points for 5 damage on the Longbowman, and their bonus is +3%
    // damage on everything. Base archer: 80 hp, 20 damage.
    const base = unitById('archer')!;
    const longbow = unitFor('britons', 'archer')!;
    expect(base.hp).toBe(80);
    expect(base.damage).toBe(20);
    expect(longbow.hp).toBe(70);
    // 20 + 5 = 25, then +3% floored = 25.
    expect(longbow.damage).toBe(25);
  });

  it('gives a march bonus to the realms whose bonus is march', () => {
    for (const faction of playable) {
      const bonus = bonusesOf(faction.id)!.military;
      const mine = unitFor(faction.id, 'heavy_cavalry')!;
      const base = unitById('heavy_cavalry')!;
      if (bonus.kind === 'march') {
        expect(mine.strategicSpeed, faction.id).toBeGreaterThan(base.strategicSpeed);
      } else {
        expect(mine.strategicSpeed, faction.id).toBe(base.strategicSpeed);
      }
    }
  });

  it('lists a whole roster for the panels to read', () => {
    expect(unitsFor('britons')).toHaveLength(loadUnits().length);
    expect(shipsFor('britons')).toHaveLength(loadShips().length);
    expect(unitsFor('britons').map((u) => u.name)).toContain('Longbowman');
  });

  it('matches faction index to faction id, which is what battle relies on', () => {
    roster.forEach((faction, index) => expect(factionIdAt(index)).toBe(faction.id));
    expect(factionIdAt(999)).toBe('');
  });
});
