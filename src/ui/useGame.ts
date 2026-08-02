import { useSyncExternalStore } from 'react';
import type { Game } from '../sim/game';
import type { SimState } from '../sim/types';

/**
 * Subscribes React to the simulation.
 *
 * The store's snapshot is a version counter, not the state object — the simulation mutates
 * its state in place for speed, so React is told *that* something changed and reads the
 * current state directly. React never owns simulation data.
 */
export function useGameState(game: Game): SimState {
  useSyncExternalStore(game.subscribe, game.getVersion, game.getVersion);
  return game.state;
}
