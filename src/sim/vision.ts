import { inBounds, tileIndex, type World } from '../data/world';
import type { SimState } from './types';

/**
 * Fog of war — what the player can see, and what they remember.
 *
 * **Three states, not two** (docs/MECHANICS.md §9):
 *
 * | State | Drawn as | Meaning |
 * |---|---|---|
 * | Sighted | clear | something of the realm's is looking at it right now |
 * | Known | a 62% wash | it has been looked at before, or it is close to home |
 * | Unknown | opaque black | the realm has no idea what is there |
 *
 * Sight is still derived and still recomputed from scratch — nothing about a realm's current line
 * of sight is stored. **Memory is not**, and cannot be: "has anyone ever stood here" is a fact
 * about the campaign's history, and history has to be in the save or it is lost on reload. So
 * `SimState.discovered` exists, one bit per tile for the player's realm alone, and this module
 * owns every write to it.
 *
 * That is a deliberate reversal of how this file used to read. The old note said fog was a
 * presentation filter and would never enter state; remembering ground is the one thing that
 * argument could not accommodate, because a shroud that forgets a province the moment an army
 * marches out of it is not a fog of war, it is a spotlight.
 *
 * What has **not** changed: no rule in the simulation reads any of this. The rivals still see
 * everything, stated openly in docs/MECHANICS.md §9 rather than hidden. `discovered` is written by
 * the tick and read by the renderer, and nothing in between consults it — so it cannot affect an
 * outcome, and a campaign plays out identically whether or not anyone is watching.
 */

/** Every tile a realm holds sees this far. Owner-authored. */
export const BASE_SIGHT = 3;

/**
 * How far a realm knows the lay of the land around its own settlements. **Owner-authored: 10.**
 *
 * A king knows his neighbours' country without having ridden through it — which valley the road
 * comes up, roughly where the next town is — and knows nothing whatever about a coast a thousand
 * miles away. Ten tiles is where the owner drew that line: inside it the map is dim but legible,
 * beyond it there is nothing to read until somebody goes and looks.
 *
 * It radiates from **settlements**, not from every owned tile. Settlements are what a realm takes
 * and what it holds, so "a close land was conquered before" is literally what this measures; and
 * it is a pass over ~20 sources per tick instead of ~300, which is the difference between free and
 * noticeable when a century is being run through at 10×.
 *
 * On the 70 × 35 map this is a wide net — a single settlement lights a 21 × 21 box, well over half
 * the map's height. Black is therefore mostly what lies **east and west**: Iberia from Poland, the
 * Levant from Ireland. If the owner wants more of the map dark at the start, this is the one
 * number to lower.
 */
export const KNOWN_RANGE = 10;

/**
 * And a settlement sees further the larger it is: **+1 per tier above Village**, so a Village
 * sees 3, a Town 4, a City 5 and a Capitol 6. Owner-authored.
 *
 * It makes expanding a settlement worth something beyond its own walls, which is the point.
 */
export function sightOf(tier: number): number {
  return BASE_SIGHT + Math.max(0, tier - 1);
}

/** Mark every tile within `radius` of (x, y). Chebyshev — a square, matching the square tiles. */
function reveal(mask: Uint8Array, world: World, x: number, y: number, radius: number): void {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (inBounds(world, nx, ny)) mask[tileIndex(world, nx, ny)] = 1;
    }
  }
}

const xOf = (index: number, world: World): number => index % world.width;
const yOf = (index: number, world: World): number => Math.floor(index / world.width);

/**
 * A 1-per-tile mask of what this realm can see **right now**.
 *
 * Chebyshev range — a square of sight, matching the square tiles and the 5 × 5 relief box, and
 * cheap enough to recompute whenever the map is redrawn. Cost is proportional to the ground held
 * rather than to the map, so it does not grow with a bigger world.
 */
export function visibleTiles(state: SimState, world: World, factionIndex: number): Uint8Array {
  const seen = new Uint8Array(world.width * world.height);
  if (factionIndex < 0) return seen;

  for (let index = 0; index < state.tileOwner.length; index++) {
    if (state.tileOwner[index] !== factionIndex) continue;
    reveal(seen, world, xOf(index, world), yOf(index, world), BASE_SIGHT);
  }

  // Settlements see further than the ground around them, by tier.
  for (const city of state.cities) {
    if (city.ownerIndex !== factionIndex) continue;
    reveal(seen, world, xOf(city.tileIndex, world), yOf(city.tileIndex, world), sightOf(city.tier));
  }

  // An army in the field sees as far as the ground it stands on would. Without this a march into
  // open country would be blind, and the player could not see what their own army has run into.
  for (const army of state.armies) {
    if (army.ownerIndex !== factionIndex) continue;
    reveal(seen, world, xOf(army.tileIndex, world), yOf(army.tileIndex, world), BASE_SIGHT);
  }

  return seen;
}

/**
 * Fold everything the player's realm can currently see into what it will always remember.
 *
 * Called every tick, and **monotonic** — bits are only ever set. That is what makes it cheap to
 * call this often and safe to call it in any order: there is no state to reconcile, no flicker
 * when an army leaves a tile, and re-running it on a reloaded save can only ever agree with what
 * is already there.
 *
 * Both halves run every tick rather than only on month rollover, because an army marches mid-month
 * and the ground behind it must not blink out until the calendar catches up.
 */
export function rememberGround(state: SimState, world: World): void {
  const factionIndex = state.playerFactionIndex;
  if (factionIndex < 0) return;
  const known = state.discovered;

  for (let index = 0; index < state.tileOwner.length; index++) {
    if (state.tileOwner[index] !== factionIndex) continue;
    reveal(known, world, xOf(index, world), yOf(index, world), BASE_SIGHT);
  }

  for (const city of state.cities) {
    if (city.ownerIndex !== factionIndex) continue;
    const x = xOf(city.tileIndex, world);
    const y = yOf(city.tileIndex, world);
    reveal(known, world, x, y, sightOf(city.tier));
    // And the country around it, which the realm knows without having to look at it.
    reveal(known, world, x, y, KNOWN_RANGE);
  }

  for (const army of state.armies) {
    if (army.ownerIndex !== factionIndex) continue;
    reveal(known, world, xOf(army.tileIndex, world), yOf(army.tileIndex, world), BASE_SIGHT);
  }
}

/**
 * The remembered mask, brought up to date — for a caller that needs it without ticking.
 *
 * Used on load and by the first frame of a fresh campaign, so a save written before any of this
 * existed opens on a sensible map rather than on a black one.
 */
export function knownTiles(state: SimState, world: World): Uint8Array {
  rememberGround(state, world);
  return state.discovered;
}
