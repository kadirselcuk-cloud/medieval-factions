import type { JSX } from 'react';
import type { Faction } from '../data/factions';
import { calendarAt, SEASON_LABEL } from '../sim/calendar';
import { armedSharePermille, manpowerUnderArms } from '../sim/manpower';
import { RESOURCES, whole, type SimState } from '../sim/types';
import { num, signed } from './format';
import { ROSTER_ICON, ROSTER_LABEL, type RosterKind } from './RosterMenu';

const RESOURCE_SYMBOL: Record<string, string> = {
  gold: '◉',
  wood: '❙',
  iron: '⛏',
  stone: '▰',
};

const RESOURCE_LABEL: Record<string, string> = {
  gold: 'Gold',
  wood: 'Wood',
  iron: 'Iron',
  stone: 'Stone',
};

interface TopBarProps {
  state: SimState;
  playerFaction: Faction;
  onOpenMenu: () => void;
  onOpenRoster: (kind: RosterKind) => void;
}

export function TopBar({
  state,
  playerFaction,
  onOpenMenu,
  onOpenRoster,
}: TopBarProps): JSX.Element {
  const player = state.factions[state.playerFactionIndex];
  const date = calendarAt(state.tick);

  // Manpower sits beside the resources but is not one of them: it is never stocked, spent or
  // traded, so it stays out of `Resource` and every cost table that type feeds. Both halves are
  // arithmetic over population and units — see sim/manpower.ts.
  const underArms = manpowerUnderArms(state, state.playerFactionIndex);
  // **No ceiling to show against since 0.19.0** (decision 165). The chip used to read "under arms
  // of a cap"; there is no cap, so it reads what share of the realm is in the field instead — the
  // number the old rule pinned at 20% and now lets float. The warning colour moves to the limit
  // that actually bites: wages larger than income, which costs the realm people every month.
  const share = armedSharePermille(state, state.playerFactionIndex);
  const bleeding = (player?.monthlyIncome.gold ?? 0) < 0;

  return (
    <header className="bar bar--top">
      <div className="bar__group">
        <span className="swatch" style={{ background: playerFaction.color }} aria-hidden="true" />
        <span className="brand">{playerFaction.name}</span>
      </div>

      <div className="bar__group bar__group--resources">
        {RESOURCES.map((resource) => {
          const stock = player ? whole(player.stock[resource]) : 0;
          const income = player ? player.monthlyIncome[resource] : 0;
          return (
            <span
              className="chip"
              key={resource}
              title={`${RESOURCE_LABEL[resource]} — ${signed(income)} per month`}
            >
              <span className="chip__symbol" aria-hidden="true">
                {RESOURCE_SYMBOL[resource]}
              </span>
              <span className={`chip__value${stock < 0 ? ' chip__value--debt' : ''}`}>
                {num(stock)}
              </span>
              <span
                className={`chip__rate${income > 0 ? ' chip__rate--good' : ''}${income < 0 ? ' chip__rate--bad' : ''}`}
              >
                {signed(income)}
              </span>
            </span>
          );
        })}

        <span
          className="chip"
          title={`Manpower — ${num(underArms)} men under arms, ${(share / 10).toFixed(1)}% of the realm. There is no limit but the wage bill: pay is taken off net income, and net income is what your settlements grow from.`}
        >
          <span className="chip__symbol" aria-hidden="true">
            ⚔
          </span>
          <span className={`chip__value${bleeding ? ' chip__value--debt' : ''}`}>
            {num(underArms)}
          </span>
          <span className="chip__rate">{(share / 10).toFixed(1)}%</span>
        </span>
      </div>

      <div className="bar__group" role="group" aria-label="Realm">
        {(['cities', 'armies', 'navies'] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            className="icon-button"
            onClick={() => onOpenRoster(kind)}
            title={ROSTER_LABEL[kind]}
            aria-label={ROSTER_LABEL[kind]}
          >
            {ROSTER_ICON[kind]}
          </button>
        ))}
      </div>

      {/*
        Every part of this block has a width of its own. A calendar reading "1 September 1350"
        is wider than "1 May 1350", and before this the difference shoved everything else in the
        bar sideways once a month, every month.
      */}
      <div className="bar__group bar__group--end">
        <span className="date">
          <span className="date__day">{date.day}</span>
          <span className="date__month">{date.monthName}</span>
          <span className="date__year">{date.year}</span>
        </span>
        <span className="status status--muted">
          {date.phase} · {SEASON_LABEL[date.season]}
        </span>
        <button
          type="button"
          className="icon-button icon-button--wide"
          onClick={onOpenMenu}
          title="Save, load and options"
        >
          Menu
        </button>
      </div>
    </header>
  );
}
