import type { Terrain } from './world';

/**
 * Terrain properties. docs/MECHANICS.md §4.
 *
 * The owner's shorthand for output modifiers, as a multiplier:
 *   `++` +100%   `+` +50%   base   `-` −40%   `--` −80%
 *
 * Note the asymmetry — `-` is −40%, not −50%. It is deliberate, and it is easy to "correct"
 * by accident, so it is named rather than written inline.
 */
export const MODIFIER = {
  plusPlus: 2,
  plus: 1.5,
  base: 1,
  minus: 0.6,
  minusMinus: 0.2,
} as const;

export type ImprovementKind = 'farm' | 'mine' | 'sawmill';

export const IMPROVEMENT_LABEL: Record<ImprovementKind, string> = {
  farm: 'Farm',
  mine: 'Mine',
  sawmill: 'Sawmill',
};

export interface TerrainProfile {
  /** Whether improvements can be built here at all. */
  buildable: boolean;
  /** Defender's advantage, as a fraction: attacker −X%, defender +X%. Halved in 0.13.0. */
  defence: number;
  /** Movement cost multiplier — 1.25 is the owner's "25% movement penalty". */
  moveCost: number;
  /** Output multiplier per improvement kind. */
  output: Record<ImprovementKind, number>;
}

export const TERRAIN_PROFILE: Record<Terrain, TerrainProfile> = {
  water: {
    buildable: false,
    defence: 0,
    moveCost: Number.POSITIVE_INFINITY,
    output: { farm: 0, mine: 0, sawmill: 0 },
  },
  plains: {
    buildable: true,
    defence: 0.05,
    moveCost: 1,
    output: { farm: MODIFIER.plusPlus, mine: MODIFIER.minusMinus, sawmill: MODIFIER.base },
  },
  forest: {
    buildable: true,
    defence: 0.1,
    moveCost: 1.25,
    output: { farm: MODIFIER.base, mine: MODIFIER.minusMinus, sawmill: MODIFIER.plusPlus },
  },
  steppe: {
    buildable: true,
    defence: 0.05,
    moveCost: 1,
    output: { farm: MODIFIER.plus, mine: MODIFIER.minus, sawmill: MODIFIER.base },
  },
  desert: {
    buildable: true,
    defence: 0.1,
    moveCost: 1.5,
    output: { farm: MODIFIER.minusMinus, mine: MODIFIER.minusMinus, sawmill: MODIFIER.minusMinus },
  },
  tundra: {
    buildable: true,
    defence: 0.05,
    moveCost: 1.25,
    output: { farm: MODIFIER.minus, mine: MODIFIER.plus, sawmill: MODIFIER.plusPlus },
  },
  mountain: {
    buildable: true,
    defence: 0.15,
    moveCost: 1.5,
    output: { farm: MODIFIER.minusMinus, mine: MODIFIER.plusPlus, sawmill: MODIFIER.plus },
  },
};

/** A settlement adds this to its tile's terrain defence, before fortification. Halved in 0.13.0. */
export const CITY_TILE_DEFENCE_BONUS = 0.05;
