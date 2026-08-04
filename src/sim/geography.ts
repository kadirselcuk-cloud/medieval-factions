import { inBounds, tileIndex, type World } from '../data/world';
import { terrainOf } from './movement';

/**
 * Land geography — what an army could actually walk to, and how far it really is.
 *
 * The AI used to measure everything in straight lines. A settlement one diagonal step across a
 * strait read as *adjacent*, so a realm would pick it as the nearest thing worth taking, order
 * every army toward it, and discover each month that there was no route. The objective never
 * changed, because nothing about being unable to arrive made it look further away — and a realm
 * pinned on a target it can never reach has stopped playing.
 *
 * ```
 *   L L L L L L        P is 1 tile from T in a straight line
 *   L L P W W L        and 8 tiles by land, around the water.
 *   W W W T L L
 * ```
 *
 * Two answers live here, and they are deliberately different shapes:
 *
 * - **Can I get there at all?** `landmassOf` — a flood fill of the map into connected land
 *   masses, computed once per world and cached, because terrain never changes. Comparing two
 *   labels is the whole test.
 * - **How far is it, really?** `walkingDistanceFrom` — a breadth-first sweep out from a realm's
 *   own settlements, giving true walking distance to every tile on the map at once, and
 *   `UNREACHABLE` for everywhere it cannot get.
 *
 * Both walk **orthogonally**, matching how armies actually move (docs/MECHANICS.md §3). Neither
 * knows anything about terrain cost, hostile armies or walls: this is about what is *possible*,
 * not what is quick or safe. Those belong to `findPath`, which runs later, on one route rather
 * than on the whole map.
 *
 * Nothing here is stored in the save. It is a pure function of the map plus the realm's current
 * settlements, so it is recomputed rather than migrated.
 */

/** No route exists — the tile is water, or on a landmass the sources cannot reach. */
export const UNREACHABLE = -1;

/** Water is the only thing that makes ground impassable. Everything else is merely slow. */
function walkable(world: World, index: number): boolean {
  return terrainOf(world, index) !== 'water';
}

/** The four orthogonal neighbours of a tile, in a fixed order. Determinism depends on it. */
function neighbours(world: World, index: number, into: number[]): number[] {
  into.length = 0;
  const x = index % world.width;
  const y = Math.floor(index / world.width);
  if (inBounds(world, x, y - 1)) into.push(tileIndex(world, x, y - 1));
  if (inBounds(world, x - 1, y)) into.push(tileIndex(world, x - 1, y));
  if (inBounds(world, x + 1, y)) into.push(tileIndex(world, x + 1, y));
  if (inBounds(world, x, y + 1)) into.push(tileIndex(world, x, y + 1));
  return into;
}

/**
 * Every tile's landmass, labelled from 1. Water is 0.
 *
 * Cached against the world object: terrain is immutable for a campaign, so this is computed once
 * and then answers "could an army ever walk from here to there" in a single comparison.
 */
const landmassCache = new WeakMap<World, Uint16Array>();

export function landmasses(world: World): Uint16Array {
  const cached = landmassCache.get(world);
  if (cached) return cached;

  const labels = new Uint16Array(world.width * world.height);
  const queue: number[] = [];
  const around: number[] = [];
  let label = 0;

  for (let start = 0; start < labels.length; start++) {
    if (labels[start] !== 0 || !walkable(world, start)) continue;
    label += 1;
    labels[start] = label;
    queue.length = 0;
    queue.push(start);

    for (let head = 0; head < queue.length; head++) {
      for (const next of neighbours(world, queue[head]!, around)) {
        if (labels[next] !== 0 || !walkable(world, next)) continue;
        labels[next] = label;
        queue.push(next);
      }
    }
  }

  landmassCache.set(world, labels);
  return labels;
}

/** Which landmass a tile belongs to, or 0 for water. */
export function landmassOf(world: World, index: number): number {
  return landmasses(world)[index] ?? 0;
}

/**
 * Could an army walk from one tile to the other, given unlimited time and no opposition?
 *
 * The cheap gate that belongs in front of every "is this worth attacking" question. Water is not
 * on any landmass, so a tile in the sea is never connected to anything, including itself.
 */
export function sameLandmass(world: World, a: number, b: number): boolean {
  const labels = landmasses(world);
  const one = labels[a] ?? 0;
  return one !== 0 && one === (labels[b] ?? 0);
}

/**
 * True walking distance from the nearest of `sources` to every tile on the map.
 *
 * One breadth-first sweep answers the question for the whole map, which is why the AI can afford
 * to ask it about every settlement in Europe once a month: the cost is one pass over 2,450 tiles
 * per realm, not a pathfind per candidate.
 *
 * Distance is in **tiles walked**, not in months or movement points. Reach is a question about
 * geography; how long the march takes is a question about terrain and season, and mixing the two
 * would make a realm's ambition depend on the weather.
 */
export function walkingDistanceFrom(world: World, sources: readonly number[]): Int32Array {
  const distance = new Int32Array(world.width * world.height).fill(UNREACHABLE);
  const queue: number[] = [];
  const around: number[] = [];

  for (const source of sources) {
    if (source < 0 || source >= distance.length) continue;
    if (distance[source] !== UNREACHABLE || !walkable(world, source)) continue;
    distance[source] = 0;
    queue.push(source);
  }

  for (let head = 0; head < queue.length; head++) {
    const index = queue[head]!;
    const step = distance[index]! + 1;
    for (const next of neighbours(world, index, around)) {
      if (distance[next] !== UNREACHABLE || !walkable(world, next)) continue;
      distance[next] = step;
      queue.push(next);
    }
  }

  return distance;
}

/** Reading helper: `UNREACHABLE` compares as -1, which would otherwise look like "very near". */
export function reachedIn(distance: Int32Array, index: number): number {
  const steps = distance[index] ?? UNREACHABLE;
  return steps === UNREACHABLE ? Number.POSITIVE_INFINITY : steps;
}
