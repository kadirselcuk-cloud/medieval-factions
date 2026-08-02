import rawEurope1350 from '../../data/maps/europe-1350.json';
import { buildWorld, type World } from './world';

/**
 * Map registry. Maps live in `data/maps/` at the repo root — outside `src/` on purpose, so
 * they stay findable and editable as content rather than looking like source code.
 * More maps, including generated ones, are planned; adding one means adding a line here.
 */

let europe: World | undefined;

export function loadEurope1350(): World {
  europe ??= buildWorld(rawEurope1350);
  return europe;
}
