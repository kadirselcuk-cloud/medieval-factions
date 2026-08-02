import { MAX_EVENTS, type EventKind, type SimState } from './types';

/**
 * The notification feed.
 *
 * Events live in the simulation state rather than in React, so the log survives a save and a
 * reload shows the same recent history. It is a feed, not an audit trail — the oldest entries
 * are dropped once it is full.
 */
export function pushEvent(
  state: SimState,
  event: {
    kind: EventKind;
    text: string;
    tileIndex: number;
    factionIndex: number;
    /** Set on battle events, so a notification can be clicked through to the report. */
    battleId?: number | undefined;
  },
): void {
  state.events.push({ tick: state.tick, ...event });
  if (state.events.length > MAX_EVENTS) {
    state.events.splice(0, state.events.length - MAX_EVENTS);
  }
}
