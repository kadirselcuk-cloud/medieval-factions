import { useState, type JSX } from 'react';
import { settlementUpgradeTo, summariseBuildings, type Cost } from '../data/buildings';
import { RELIGION_LABEL, type Faction } from '../data/factions';
import { improvementCost, improvementMonths, tileOutput } from '../data/improvements';
import { TERRAIN_PROFILE, type ImprovementKind } from '../data/terrain';
import { adjacentWaterCount, TERRAIN_LABEL, type TileInfo, type World } from '../data/world';
import {
  buildOptions,
  cancelImprovement,
  cancelOrder,
  canAfford,
  improvementAt,
  improvementCap,
  queueBuilding,
  queueImprovement,
  queueSettlementUpgrade,
} from '../sim/construction';
import type { Game } from '../sim/game';
import { MILLI, TIER_NAME, whole, type CityState, type SimState } from '../sim/types';
import { num } from './format';

interface SelectionPanelProps {
  tile: TileInfo;
  game: Game;
  state: SimState;
  world: World;
  roster: readonly Faction[];
  onClose: () => void;
}

type Tab = 'info' | 'buildings' | 'armies';

const IMPROVEMENT_KINDS: readonly ImprovementKind[] = ['farm', 'mine', 'sawmill'];
const IMPROVEMENT_NAME: Record<ImprovementKind, string> = {
  farm: 'Farm',
  mine: 'Mine',
  sawmill: 'Sawmill',
};

function costText(cost: Cost): string {
  const parts = (['gold', 'wood', 'iron', 'stone'] as const)
    .filter((resource) => (cost[resource] ?? 0) > 0)
    .map((resource) => `${num(cost[resource] ?? 0)} ${resource}`);
  return parts.length > 0 ? parts.join(' · ') : 'free';
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="panel__row">
      <span className="panel__label">{label}</span>
      <span className="panel__value">{value}</span>
    </div>
  );
}

export function SelectionPanel(props: SelectionPanelProps): JSX.Element {
  const { tile, game, state, world, roster, onClose } = props;
  const [tab, setTab] = useState<Tab>('info');

  const ownerIndex = state.tileOwner[tile.index] ?? -1;
  const owner = ownerIndex >= 0 ? roster[ownerIndex] : undefined;
  const isPlayers = ownerIndex === state.playerFactionIndex;

  const cityFeature = tile.feature?.kind === 'city' ? tile.feature : undefined;
  const city = cityFeature ? state.cities.find((c) => c.tileIndex === tile.index) : undefined;
  const tabbed = Boolean(city && isPlayers);

  return (
    <aside className={`panel${isPlayers ? ' panel--owned' : ''}`}>
      <header className="panel__header">
        <div className="panel__title">
          {cityFeature ? cityFeature.name : `Tile ${tile.x}, ${tile.y}`}
          {isPlayers && <span className="panel__badge">Yours</span>}
        </div>
        <button type="button" className="panel__close" onClick={onClose} title="Close">
          ✕
        </button>
      </header>

      {tabbed && (
        <nav className="tabs" role="tablist">
          {(['info', 'buildings', 'armies'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              className={`tab${tab === value ? ' tab--active' : ''}`}
              onClick={() => setTab(value)}
            >
              {value === 'info' ? 'Info' : value === 'buildings' ? 'Buildings' : 'Armies'}
            </button>
          ))}
        </nav>
      )}

      {(!tabbed || tab === 'info') && (
        <div className="panel__body">
          {owner ? (
            <div className="panel__owner">
              <span className="swatch" style={{ background: owner.color }} aria-hidden="true" />
              <span>{owner.name}</span>
              {owner.religion !== 'none' && (
                <span className="panel__muted">· {RELIGION_LABEL[owner.religion]}</span>
              )}
            </div>
          ) : (
            <div className="panel__owner panel__muted">Unclaimed</div>
          )}

          <TileFacts tile={tile} state={state} world={world} city={city} />

          {isPlayers && TERRAIN_PROFILE[tile.terrain].buildable && (
            <ImprovementSection tile={tile} game={game} state={state} world={world} />
          )}
        </div>
      )}

      {tabbed && tab === 'buildings' && city && (
        <div className="panel__body">
          <CityBuildings city={city} game={game} state={state} world={world} />
        </div>
      )}

      {tabbed && tab === 'armies' && (
        <div className="panel__body">
          <p className="panel__note">
            Garrisons and recruitment arrive in 0.6.0. Nothing is stationed here yet.
          </p>
        </div>
      )}
    </aside>
  );
}

function TileFacts({
  tile,
  state,
  world,
  city,
}: {
  tile: TileInfo;
  state: SimState;
  world: World;
  city: CityState | undefined;
}): JSX.Element {
  const node = tile.feature?.kind === 'resource' ? tile.feature.resource : null;
  const kind = improvementAt(state, tile.index);
  const level = state.improvementLevel[tile.index] ?? 0;
  const profile = TERRAIN_PROFILE[tile.terrain];
  const water = adjacentWaterCount(world, tile.x, tile.y);

  const output = tileOutput({ terrain: tile.terrain, improvement: kind, level, node });
  const outputText =
    Object.entries(output)
      .filter(([, amount]) => amount > 0)
      .map(([resource, amount]) => `+${amount} ${resource}`)
      .join(', ') || '—';

  const buildings = city ? summariseBuildings(city.buildings) : undefined;

  return (
    <>
      <Row label="Terrain" value={TERRAIN_LABEL[tile.terrain]} />
      <Row label="Defence" value={`+${Math.round(profile.defence * 100)}%`} />
      {node && <Row label="Node" value={`${node[0]?.toUpperCase()}${node.slice(1)}`} />}
      <Row label="Tile yields" value={`${outputText} / month`} />
      {water > 0 && <Row label="Adjacent water" value={`${water} tiles`} />}

      {city && buildings && (
        <>
          <Row label="Settlement" value={TIER_NAME[city.tier]} />
          <Row label="Population" value={num(city.populationMilli / MILLI)} />
          <Row
            label="Housing"
            value={buildings.housingLevel > 0 ? `Level ${buildings.housingLevel}` : 'None'}
          />
          <Row
            label="Walls"
            value={buildings.defenceTenths > 0 ? `+${buildings.defenceTenths * 10}%` : 'None'}
          />
          {buildings.goldPerWaterTile > 0 && (
            <Row
              label="Fishing"
              value={`+${num(buildings.goldPerWaterTile * water)} gold / month`}
            />
          )}
        </>
      )}
    </>
  );
}

function ImprovementSection({
  tile,
  game,
  state,
  world,
}: {
  tile: TileInfo;
  game: Game;
  state: SimState;
  world: World;
}): JSX.Element {
  const player = state.playerFactionIndex;
  const kind = improvementAt(state, tile.index);
  const level = state.improvementLevel[tile.index] ?? 0;
  const monthsLeft = state.improvementMonths[tile.index] ?? 0;
  const target = state.improvementTarget[tile.index] ?? 0;
  const cap = improvementCap(state, player);

  if (monthsLeft > 0) {
    return (
      <div className="panel__section">
        <div className="panel__heading">Improvement</div>
        <div className="progress">
          <span>
            {kind ? IMPROVEMENT_NAME[kind] : 'Work'} → level {target}
          </span>
          <span className="panel__muted">{monthsLeft} mo</span>
        </div>
        <button
          type="button"
          className="action action--minor"
          onClick={() => game.command((s) => cancelImprovement(s, tile.index))}
        >
          Cancel · full refund
        </button>
      </div>
    );
  }

  // A tile holds one improvement, so once something is built only that line can continue.
  const choices = kind === null ? IMPROVEMENT_KINDS : [kind];
  const nextLevel = level + 1;

  return (
    <div className="panel__section">
      <div className="panel__heading">
        Improvement
        {kind !== null && (
          <span className="panel__muted">
            {' '}
            · {IMPROVEMENT_NAME[kind]} level {level}
          </span>
        )}
      </div>

      {nextLevel > cap ? (
        <p className="panel__note">
          Level {nextLevel} needs a tier-{nextLevel} settlement somewhere in your realm. Your
          best is tier {cap}.
        </p>
      ) : (
        choices.map((choice) => {
          const cost = improvementCost(choice, nextLevel);
          const affordable = canAfford(state, player, cost);
          return (
            <button
              key={choice}
              type="button"
              className="action"
              disabled={!affordable}
              onClick={() =>
                game.command((s) => queueImprovement(s, world, player, tile.x, tile.y, choice))
              }
              title={affordable ? undefined : 'Not enough resources'}
            >
              <span>
                {level === 0 ? 'Build' : 'Upgrade'} {IMPROVEMENT_NAME[choice]}
                {level > 0 ? ` ${nextLevel}` : ''}
              </span>
              <span className="action__cost">
                {costText(cost)} · {improvementMonths(nextLevel)} mo
              </span>
            </button>
          );
        })
      )}
    </div>
  );
}

function CityBuildings({
  city,
  game,
  state,
  world,
}: {
  city: CityState;
  game: Game;
  state: SimState;
  world: World;
}): JSX.Element {
  const options = buildOptions(world, city);
  const upgrade = settlementUpgradeTo(city.tier + 1);
  const upgradeQueued = city.queue.some((order) => order.kind === 'settlement');

  return (
    <>
      {city.queue.length > 0 && (
        <div className="panel__section panel__section--first">
          <div className="panel__heading">Under construction</div>
          {city.queue.map((order, position) => (
            <div className="progress" key={`${order.kind}-${position}`}>
              <span>
                {order.kind === 'building'
                  ? (options.find((b) => b.id === order.id)?.name ?? labelOf(order.id))
                  : `Upgrade to ${TIER_NAME[order.targetTier]}`}
                {position > 0 && <span className="panel__muted"> · waiting</span>}
              </span>
              <span className="panel__muted">{order.monthsRemaining} mo</span>
              <button
                type="button"
                className="panel__close"
                title="Cancel, full refund"
                onClick={() => game.command((s) => cancelOrder(s, city, position))}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {upgrade && !upgradeQueued && (
        <div className="panel__section panel__section--first">
          <button
            type="button"
            className="action action--primary"
            disabled={!canAfford(state, city.ownerIndex, upgrade.cost)}
            onClick={() => game.command((s) => queueSettlementUpgrade(s, city))}
          >
            <span>Upgrade to {upgrade.name}</span>
            <span className="action__cost">
              {costText(upgrade.cost)} · {upgrade.months} mo
            </span>
          </button>
        </div>
      )}

      {options.length > 0 ? (
        <div className="panel__section">
          <div className="panel__heading">Build</div>
          {options.map((building) => (
            <button
              key={building.id}
              type="button"
              className="action"
              disabled={!canAfford(state, city.ownerIndex, building.cost)}
              onClick={() => game.command((s) => queueBuilding(s, world, city, building.id))}
            >
              <span>{building.name}</span>
              <span className="action__cost">
                {costText(building.cost)} · {building.months} mo
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="panel__note">Nothing further can be built at this settlement tier.</p>
      )}

      {city.buildings.length > 0 && (
        <div className="panel__section">
          <div className="panel__heading">Standing</div>
          {city.buildings.map((id) => (
            <div className="progress" key={id}>
              <span>{labelOf(id)}</span>
            </div>
          ))}
        </div>
      )}

      <p className="panel__note">
        Treasury {num(whole(state.factions[city.ownerIndex]?.stock.gold ?? 0))} gold
      </p>
    </>
  );
}

function labelOf(id: string): string {
  return id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
