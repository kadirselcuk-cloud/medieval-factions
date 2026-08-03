import { inBounds, tileIndex, type World } from '../data/world';
import type { SimState } from './types';

/**
 * Fog of war — what the player can see.
 *
 * **This is a presentation filter, and deliberately nothing more.** It is derived from state,
 * never stored in it, and no rule in the simulation reads it. The AI is not blinded by it: the
 * rival realms see everything, which is stated openly in docs/MECHANICS.md §9 rather than
 * hidden. Wiring fog into the simulation would make what a realm knows part of the save, part of
 * every migration, and part of every determinism guarantee — for a feature that only ever needed
 * to change what is drawn.
 *
 * There is no "explored" memory layer. Territory only shrinks by losing it, so sight that came
 * with a tile leaves with it, and a shroud that remembered a city you no longer overlook would be
 * a second kind of truth to keep in step. **[GEN]** — the owner asked for line of sight, not for
 * a memory of it.
 */

/** Every tile a realm holds sees this far. Owner-authored. */
export const BASE_SIGHT = 3;

/**
 * And a settlement sees further the larger it is: **+1 per tier above Village**, so a Village
 * sees 3, a Town 4, a City 5 and a Capitol 6. Owner-authored.
 *
 * It makes expanding a settlement worth something beyond its own walls, which is the point.
 */
export function sightOf(tier: number): number {
  return BASE_SIGHT + Math.max(0, tier - 1);
}

/**
 * A 1-per-tile mask of what this realm can see.
 *
 * Chebyshev range — a square of sight, matching the square tiles and the 5 × 5 relief box, and
 * cheap enough to recompute whenever the map is redrawn. Cost is proportional to the ground held
 * rather than to the map, so it does not grow with a bigger world.
 */
export function visibleTiles(state: SimState, world: World, factionIndex: number): Uint8Array {
  const seen = new Uint8Array(world.width * world.height);
  if (factionIndex < 0) return seen;

  const reveal = (x: number, y: number, radius: number): void => {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (inBounds(world, nx, ny)) seen[tileIndex(world, nx, ny)] = 1;
      }
    }
  };

  for (let index = 0; index < state.tileOwner.length; index++) {
    if (state.tileOwner[index] !== factionIndex) continue;
    reveal(index % world.width, Math.floor(index / world.width), BASE_SIGHT);
  }

  // Settlements see further than the ground around them, by tier.
  for (const city of state.cities) {
    if (city.ownerIndex !== factionIndex) continue;
    reveal(
      city.tileIndex % world.width,
      Math.floor(city.tileIndex / world.width),
      sightOf(city.tier),
    );
  }

  // An army in the field sees as far as the ground it stands on would. Without this a march into
  // open country would be blind, and the player could not see what their own army has run into.
  for (const army of state.armies) {
    if (army.ownerIndex !== factionIndex) continue;
    reveal(
      army.tileIndex % world.width,
      Math.floor(army.tileIndex / world.width),
      BASE_SIGHT,
    );
  }

  return seen;
}
