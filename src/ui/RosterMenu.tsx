import type { JSX } from 'react';
import { describeTile, type TileInfo, type World } from '../data/world';
import { TIER_NAME, MILLI, type SimState } from '../sim/types';
import { num } from './format';

export type RosterKind = 'cities' | 'armies' | 'navies';

export const ROSTER_LABEL: Record<RosterKind, string> = {
  cities: 'Cities',
  armies: 'Armies',
  navies: 'Navies',
};

export const ROSTER_ICON: Record<RosterKind, string> = {
  cities: '⌂',
  armies: '⚔',
  navies: '⛵',
};

interface RosterMenuProps {
  kind: RosterKind;
  state: SimState;
  world: World;
  onSelect: (tile: TileInfo) => void;
  onClose: () => void;
}

export function RosterMenu({
  kind,
  state,
  world,
  onSelect,
  onClose,
}: RosterMenuProps): JSX.Element {
  const owned = state.cities.filter((city) => city.ownerIndex === state.playerFactionIndex);

  return (
    <div className="overlay" role="dialog" aria-label={ROSTER_LABEL[kind]}>
      <div className="overlay__panel">
        <header className="overlay__header">
          <h2>
            {ROSTER_ICON[kind]} {ROSTER_LABEL[kind]}
            {kind === 'cities' && <span className="panel__muted"> · {owned.length}</span>}
          </h2>
          <button type="button" className="panel__close" onClick={onClose} title="Close">
            ✕
          </button>
        </header>

        <div className="overlay__list">
          {kind !== 'cities' && (
            <p className="panel__note">
              {ROSTER_LABEL[kind]} arrive in 0.6.0, together with recruitment and your starting
              unit. Nothing to list yet.
            </p>
          )}

          {kind === 'cities' && owned.length === 0 && (
            <p className="panel__note">You hold no settlements.</p>
          )}

          {kind === 'cities' &&
            owned.map((city) => {
              const location = world.cities[city.cityIndex];
              if (!location) return null;
              const busy = city.queue[0];
              return (
                <button
                  type="button"
                  className="save-row save-row--button"
                  key={city.cityIndex}
                  onClick={() => {
                    onSelect(describeTile(world, location.x, location.y));
                    onClose();
                  }}
                >
                  <span className="save-row__main">
                    <span className="save-row__name">{location.name}</span>
                    <span className="panel__muted">
                      {TIER_NAME[city.tier]} · {num(city.populationMilli / MILLI)} people
                      {busy ? ` · building, ${busy.monthsRemaining} mo` : ''}
                    </span>
                  </span>
                  <span className="panel__muted">
                    {location.x}, {location.y}
                  </span>
                </button>
              );
            })}
        </div>
      </div>
    </div>
  );
}
