import type { JSX } from 'react';
import { describeTile, type TileInfo, type World } from '../data/world';
import { armiesOf, stackSize, stackSoldiers, stackUpkeep } from '../sim/armies';
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
  const armies = armiesOf(state, state.playerFactionIndex);
  const count = kind === 'cities' ? owned.length : kind === 'armies' ? armies.length : 0;

  return (
    <div className="overlay" role="dialog" aria-label={ROSTER_LABEL[kind]}>
      <div className="overlay__panel">
        <header className="overlay__header">
          <h2>
            {ROSTER_ICON[kind]} {ROSTER_LABEL[kind]}
            {kind !== 'navies' && <span className="panel__muted"> · {count}</span>}
          </h2>
          <button type="button" className="panel__close" onClick={onClose} title="Close">
            ✕
          </button>
        </header>

        <div className="overlay__list">
          {kind === 'navies' && (
            <p className="panel__note">
              Fleets put to sea in a later phase. Ships built so far are moored in their home
              settlement, under its Armies tab.
            </p>
          )}

          {kind === 'cities' && owned.length === 0 && (
            <p className="panel__note">You hold no settlements.</p>
          )}

          {kind === 'armies' && armies.length === 0 && (
            <p className="panel__note">
              No army is in the field. Muster one from a settlement's garrison, in its Armies tab.
            </p>
          )}

          {kind === 'armies' &&
            armies.map((army) => {
              const x = army.tileIndex % world.width;
              const y = Math.floor(army.tileIndex / world.width);
              const here = world.cities.find((c) => c.index === army.tileIndex);
              return (
                <button
                  type="button"
                  className="save-row save-row--button"
                  key={army.id}
                  onClick={() => {
                    onSelect(describeTile(world, x, y));
                    onClose();
                  }}
                >
                  <span className="save-row__main">
                    <span className="save-row__name">
                      {stackSize(army.units)} units{here ? ` at ${here.name}` : ''}
                    </span>
                    <span className="panel__muted">
                      {num(stackSoldiers(army.units))} soldiers · {stackUpkeep(army.units)} g/mo
                      {army.path.length > 0 ? ` · marching, ${army.path.length} tiles` : ' · holding'}
                    </span>
                  </span>
                  <span className="panel__muted">
                    {x}, {y}
                  </span>
                </button>
              );
            })}

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
