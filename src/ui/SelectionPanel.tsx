import { useState, type JSX } from "react";
import { artFor, settlementArtKey } from "../data/art";
import {
  buildingById,
  buildingsForTier,
  CHAIN_LINES,
  settlementUpgradeTo,
  siegeMonths,
  summariseBuildings,
  type Building,
  type SettlementUpgrade,
} from "../data/buildings";
import { RELIGION_LABEL, type Faction } from "../data/factions";
import {
  improvementCost,
  improvementMonths,
  MAX_IMPROVEMENT_LEVEL,
  tileOutput,
} from "../data/improvements";
import { TERRAIN_PROFILE, type ImprovementKind } from "../data/terrain";
import {
  buildableShips,
  defenceBuildings,
  loadShips,
  loadUnits,
  recruitableUnits,
  shipById,
  unitById,
  type Unit,
} from "../data/units";
import {
  adjacentWaterCount,
  TERRAIN_LABEL,
  type TileInfo,
  type World,
} from "../data/world";
import {
  BuildGrid,
  BuildGridScope,
  costText,
  type BuildTile,
} from "./BuildGrid";
import {
  armyAt,
  armySpeed,
  defenceOf,
  disband,
  mobilise,
  stackSize,
  stackSoldiers,
  stackUpkeep,
  standDown,
} from "../sim/armies";
import { calendarAt } from "../sim/calendar";
import { beginSiege, siegeTarget } from "../sim/conquest";
import { assault, halt, SEASON_MOVEMENT } from "../sim/movement";
import {
  buildOptions,
  cancelImprovement,
  availableManpower,
  cancelOrder,
  cancelProduction,
  canAfford,
  improvementAt,
  improvementCap,
  isCoastal,
  queueBuilding,
  queueImprovement,
  queueSettlementUpgrade,
  queueShip,
  queueUnit,
  settlementUpgradeBlock,
  type BuildFailure,
} from "../sim/construction";
import type { Game } from "../sim/game";
import { cityGrowth } from "../sim/tick";
import {
  MAX_ARMY_UNITS,
  TIER_NAME,
  whole,
  type ArmyState,
  type CityState,
  type SimState,
} from "../sim/types";
import { num, signed } from "./format";

interface SelectionPanelProps {
  tile: TileInfo;
  game: Game;
  state: SimState;
  world: World;
  roster: readonly Faction[];
  /**
   * Whether this tile is inside the player's line of sight — docs/MECHANICS.md §9.
   *
   * The panel is the other half of the fog: darkening the map would be worth nothing if
   * clicking a shrouded tile still read out its owner, its garrison and what it is building.
   */
  visible: boolean;
  /** Hands the map a march order to collect a destination for. */
  onMarch: (armyId: number) => void;
  onClose: () => void;
}

type Tab = "info" | "buildings" | "armies" | "navy";

const TAB_LABEL: Record<Tab, string> = {
  info: "Info",
  buildings: "Buildings",
  armies: "Armies",
  navy: "Navy",
};

const IMPROVEMENT_KINDS: readonly ImprovementKind[] = [
  "farm",
  "mine",
  "sawmill",
];
const IMPROVEMENT_NAME: Record<ImprovementKind, string> = {
  farm: "Farm",
  mine: "Mine",
  sawmill: "Sawmill",
};

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="panel__row">
      <span className="panel__label">{label}</span>
      <span className="panel__value">{value}</span>
    </div>
  );
}

export function SelectionPanel(props: SelectionPanelProps): JSX.Element {
  const { tile, game, state, world, roster, visible, onMarch, onClose } = props;
  const [tab, setTab] = useState<Tab>("info");

  // Ground the player cannot see reads as unclaimed, because that is all they know about it.
  const ownerIndex = visible ? (state.tileOwner[tile.index] ?? -1) : -1;
  const owner = ownerIndex >= 0 ? roster[ownerIndex] : undefined;
  const isPlayers = ownerIndex === state.playerFactionIndex;

  const cityFeature = tile.feature?.kind === "city" ? tile.feature : undefined;
  const city =
    cityFeature && visible
      ? state.cities.find((c) => c.tileIndex === tile.index)
      : undefined;
  const tabbed = Boolean(city && isPlayers);

  // Landlocked settlements have no navy to speak of, so they do not carry the tab at all.
  const coastal = isCoastal(world, tile.x, tile.y);
  const tabs: Tab[] = coastal
    ? ["info", "buildings", "armies", "navy"]
    : ["info", "buildings", "armies"];

  // An army is selected by selecting the ground it stands on. Ownership of the tile and of the
  // army can differ the moment fighting exists, so the panel asks the army who it belongs to.
  const army = armyAt(state, tile.index);
  const playersArmy =
    army && army.ownerIndex === state.playerFactionIndex ? army : undefined;

  return (
    // Keyed on the tab so switching one closes any detail box the last tab had open.
    <BuildGridScope key={tab}>
      <aside className={`panel${isPlayers ? " panel--owned" : ""}`}>
        <header className="panel__header">
          <div className="panel__title">
            {cityFeature ? cityFeature.name : `Tile ${tile.x}, ${tile.y}`}
            {isPlayers && <span className="panel__badge">Yours</span>}
          </div>
          <button
            type="button"
            className="panel__close"
            onClick={onClose}
            title="Close"
          >
            ✕
          </button>
        </header>

        {tabbed && (
          <nav className="tabs" role="tablist">
            {tabs.map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                className={`tab${tab === value ? " tab--active" : ""}`}
                onClick={() => setTab(value)}
              >
                {TAB_LABEL[value]}
              </button>
            ))}
          </nav>
        )}

        {(!tabbed || tab === "info") && (
          <div className="panel__body">
            {owner ? (
              <div className="panel__owner">
                <span
                  className="swatch"
                  style={{ background: owner.color }}
                  aria-hidden="true"
                />
                <span>{owner.name}</span>
                {owner.religion !== "none" && (
                  <span className="panel__muted">
                    · {RELIGION_LABEL[owner.religion]}
                  </span>
                )}
              </div>
            ) : visible ? (
              <div className="panel__owner panel__muted">Unclaimed</div>
            ) : (
              <div className="panel__owner panel__muted">Beyond your sight</div>
            )}

            <TileFacts tile={tile} state={state} world={world} city={city} />

            {/* Info reports; it never acts. Every button lives in a tab of its own. */}
            <ProgressLines city={city} tile={tile} state={state} />

            {/* A tile with no city has no tabs, so its army and its actions belong here. */}
            {!tabbed && playersArmy && (
              <ArmyCard
                army={playersArmy}
                game={game}
                state={state}
                world={world}
                onMarch={onMarch}
              />
            )}
            {!tabbed &&
              isPlayers &&
              TERRAIN_PROFILE[tile.terrain].buildable && (
                <FiefBuildings
                  tile={tile}
                  game={game}
                  state={state}
                  world={world}
                />
              )}
          </div>
        )}

        {tabbed && tab === "buildings" && city && (
          <div className="panel__body">
            <CityBuildings
              city={city}
              tile={tile}
              game={game}
              state={state}
              world={world}
            />
          </div>
        )}

        {tabbed && tab === "armies" && city && (
          <div className="panel__body">
            {playersArmy && (
              <ArmyCard
                army={playersArmy}
                game={game}
                state={state}
                world={world}
                onMarch={onMarch}
              />
            )}
            <Garrison city={city} game={game} state={state} world={world} />
          </div>
        )}

        {tabbed && tab === "navy" && city && coastal && (
          <div className="panel__body">
            <Navy city={city} game={game} state={state} coastal={coastal} />
          </div>
        )}
      </aside>
    </BuildGridScope>
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
  const node = tile.feature?.kind === "resource" ? tile.feature.resource : null;
  const kind = improvementAt(state, tile.index);
  const level = state.improvementLevel[tile.index] ?? 0;
  const profile = TERRAIN_PROFILE[tile.terrain];
  const water = adjacentWaterCount(world, tile.x, tile.y);

  const output = tileOutput({
    terrain: tile.terrain,
    improvement: kind,
    level,
    node,
  });
  const outputText =
    Object.entries(output)
      .filter(([, amount]) => amount > 0)
      .map(([resource, amount]) => `+${amount} ${resource}`)
      .join(", ") || "—";

  const buildings = city ? summariseBuildings(city.buildings) : undefined;

  return (
    <>
      <Row label="Terrain" value={TERRAIN_LABEL[tile.terrain]} />
      <Row label="Defence" value={`+${Math.round(profile.defence * 100)}%`} />
      {node && (
        <Row label="Node" value={`${node[0]?.toUpperCase()}${node.slice(1)}`} />
      )}
      <Row label="Tile yields" value={`${outputText} / month`} />
      {water > 0 && <Row label="Adjacent water" value={`${water} tiles`} />}

      {city && buildings && (
        <>
          <Row label="Settlement" value={TIER_NAME[city.tier]} />
          <Row label="Population" value={num(city.population)} />
          <Row label="Growth" value={growthText(state, city)} />
          <Row
            label="Housing"
            value={
              buildings.housingLevel > 0
                ? `Level ${buildings.housingLevel}`
                : "None"
            }
          />
          <Row
            label="Walls"
            value={
              buildings.defencePercent > 0
                ? `+${buildings.defencePercent}%`
                : "None"
            }
          />
          {buildings.goldPerWaterTile > 0 && (
            <Row
              label="Fishing"
              value={`+${num(buildings.goldPerWaterTile * water)} gold / month`}
            />
          )}
          {city.siege && (
            <>
              <Row
                label="Under siege"
                value={`${city.siege.monthsRemaining} month${city.siege.monthsRemaining === 1 ? "" : "s"} left`}
              />
              <p className="panel__note panel__note--bad">
                Invested for {city.siege.monthsHeld} month
                {city.siege.monthsHeld === 1 ? "" : "s"}. It pays nothing,
                finishes nothing and is starving. When the clock runs out its
                defenders must come out and fight in the open — or surrender.
              </p>
            </>
          )}
        </>
      )}
    </>
  );
}

function growthText(state: SimState, city: CityState): string {
  // Whole people, and the one growth figure that can be negative — debt and sieges both bite.
  return `${signed(cityGrowth(state, city))} people / month`;
}

interface ProgressItem {
  label: string;
  /** Months completed. Fractional for whatever is actually being worked on. */
  done: number;
  total: number;
}

/**
 * How far through the current month the campaign is, 0..1.
 *
 * Construction only ever ticks over on a month boundary, so a bar driven by `monthsRemaining`
 * alone sits still for 120 ticks and then jumps. Adding the month's own progress to the head
 * of a queue makes the bar creep the way the clock does, without the simulation having to
 * store anything finer than whole months.
 */
function monthFraction(state: SimState): number {
  return calendarAt(state.tick).monthProgress;
}

function Meter({
  item,
  waiting,
}: {
  item: ProgressItem;
  waiting: boolean;
}): JSX.Element {
  const percent =
    item.total > 0 ? Math.min(100, (item.done / item.total) * 100) : 0;
  const left = Math.max(1, Math.ceil(item.total - item.done));
  return (
    <div className="bar-item">
      <div className="bar-item__top">
        <span className="bar-item__label">{item.label}</span>
        <span className="panel__muted">
          {waiting ? "waiting" : `${left} mo`}
        </span>
      </div>
      <div className="meter">
        <div
          className={`meter__fill${waiting ? " meter__fill--idle" : ""}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

/** Only the head of a queue is being worked on, so only the head creeps within the month. */
function creeping(items: ProgressItem[], fraction: number): ProgressItem[] {
  const head = items[0];
  if (!head) return items;
  return [
    { ...head, done: Math.min(head.total, head.done + fraction) },
    ...items.slice(1),
  ];
}

/**
 * Live progress on everything happening here — construction, recruitment, shipyard, and the
 * tile's own improvement.
 *
 * Only the head of each queue is actually advancing, so the rest are marked as waiting. This
 * answers "what is this place doing?" without opening another tab, and it is read-only: every
 * button lives elsewhere.
 */
function ProgressLines({
  city,
  tile,
  state,
}: {
  city: CityState | undefined;
  tile: TileInfo;
  state: SimState;
}): JSX.Element | null {
  const lines: { heading: string; items: ProgressItem[] }[] = [];
  const fraction = monthFraction(state);

  if (city) {
    lines.push(
      {
        heading: "Building",
        items: city.queue.map((order) => ({
          label:
            order.kind === "building"
              ? (buildingById(order.id)?.name ?? labelOf(order.id))
              : `Upgrade to ${TIER_NAME[order.targetTier]}`,
          done: totalMonths(order) - order.monthsRemaining,
          total: totalMonths(order),
        })),
      },
      {
        heading: "Recruiting",
        items: city.recruitQueue.map((order) => ({
          label: unitById(order.id)?.name ?? order.id,
          done: (unitById(order.id)?.months ?? 0) - order.monthsRemaining,
          total: unitById(order.id)?.months ?? 0,
        })),
      },
      {
        heading: "Shipyard",
        items: city.shipQueue.map((order) => ({
          label: shipById(order.id)?.name ?? order.id,
          done: (shipById(order.id)?.months ?? 0) - order.monthsRemaining,
          total: shipById(order.id)?.months ?? 0,
        })),
      },
    );
  }

  const monthsLeft = state.improvementMonths[tile.index] ?? 0;
  if (monthsLeft > 0) {
    const kind = improvementAt(state, tile.index);
    const target = state.improvementTarget[tile.index] ?? 0;
    const total = improvementMonths(target);
    lines.push({
      heading: "Improvement",
      items: [
        {
          label: `${kind ? IMPROVEMENT_NAME[kind] : "Work"} → level ${target}`,
          done: total - monthsLeft,
          total,
        },
      ],
    });
  }

  const visible = lines
    .filter((line) => line.items.length > 0)
    .map((line) => ({ ...line, items: creeping(line.items, fraction) }));
  if (visible.length === 0) return null;

  return (
    <>
      {visible.map((line) => (
        <div className="panel__section" key={line.heading}>
          <div className="panel__heading">{line.heading}</div>
          {line.items.map((item, position) => (
            <Meter
              key={`${item.label}-${position}`}
              item={item}
              waiting={position > 0}
            />
          ))}
        </div>
      ))}
    </>
  );
}

/**
 * A settlement's three quite different bodies of troops.
 *
 * Defenders are free, immobile and derived from the settlement itself. The garrison is what
 * the faction paid to recruit, and the only thing an army can be mustered from. The fleet sits
 * in harbour until naval lands.
 */
function Garrison({
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
  const defenders = Object.entries(defenceOf(city)).filter(
    ([, count]) => count > 0,
  );
  const units = Object.entries(city.garrison).filter(([, count]) => count > 0);
  const recruitable = new Set(
    recruitableUnits(city.tier, city.buildings).map((u) => u.id),
  );

  // The whole roster, so a player can read what a Barracks would eventually buy them rather
  // than only what they can already afford today.
  const manpower = availableManpower(city);

  const tiles: BuildTile[] = loadUnits().map((unit) => {
    const affordable = canAfford(state, city.ownerIndex, unit.cost);
    const enoughPeople = manpower >= unit.size;
    const unlocked = recruitable.has(unit.id);
    const missing = unit.requires
      .filter((id) => !city.buildings.includes(id))
      .map((id) => buildingById(id)?.name ?? id);

    return {
      id: unit.id,
      name: unit.name,
      state: unlocked && affordable && enoughPeople ? "available" : "blocked",
      blurb: artFor(unit.id).blurb,
      facts: [
        { label: "Class", value: labelOf(unit.class) },
        { label: "Soldiers", value: `${num(unit.size)} men` },
        {
          label: "Drawn from",
          value: `${num(unit.size)} of this settlement's people`,
        },
        {
          label: "Per soldier",
          value: `${unit.hp} HP · ${unit.damage} damage`,
        },
        {
          label: "Unit strength",
          value: `${num(unit.size * unit.hp)} HP total`,
        },
        ...(unit.range > 0
          ? [{ label: "Range", value: String(unit.range) }]
          : []),
        { label: "Speed", value: `${unit.strategicSpeed} tiles a month` },
        { label: "Cost", value: costText(unit.cost) },
        { label: "Takes", value: `${unit.months} months` },
        { label: "Upkeep", value: `${unit.upkeep} gold a month` },
        {
          label: "Needs",
          value:
            unit.requires.length > 0
              ? unit.requires
                  .map((id) => buildingById(id)?.name ?? id)
                  .join(" + ")
              : `${TIER_NAME[unit.minTier as 1 | 2 | 3 | 4]} tier`,
        },
        ...unitTraits(unit),
      ],
      reason:
        unit.minTier > city.tier
          ? `Needs a ${TIER_NAME[unit.minTier as 1 | 2 | 3 | 4]}. This settlement is a ${TIER_NAME[city.tier]}.`
          : missing.length > 0
            ? `Needs ${missing.join(" and ")}, built in the Buildings tab.`
            : !affordable
              ? "Not enough in the treasury."
              : enoughPeople
                ? undefined
                : `Not enough people. ${num(unit.size)} men must come from somewhere, and only ${num(manpower)} can be spared.`,
      action: `Recruit ${unit.name}`,
      onAction: () => game.command((s) => queueUnit(s, city, unit.id)),
    };
  });

  const training = creeping(
    city.recruitQueue.map((order) => ({
      label: unitById(order.id)?.name ?? order.id,
      done: (unitById(order.id)?.months ?? 0) - order.monthsRemaining,
      total: unitById(order.id)?.months ?? 0,
    })),
    monthFraction(state),
  );

  const muster = (picks: Record<string, number>) => {
    game.command((s) => mobilise(s, world, city, picks));
  };

  return (
    <>
      <div className="panel__section panel__section--first">
        <div className="panel__heading">Defenders</div>
        {defenders.map(([id, count]) => (
          <div className="panel__row" key={id}>
            <span className="panel__label">{unitById(id)?.name ?? id}</span>
            <span className="panel__value">×{count}</span>
          </div>
        ))}
        <p className="panel__note">
          Free, and they never leave. A settlement's tier and its Barracks,
          Archery Range, Stables and Town Hall decide who stands on the walls.
        </p>
      </div>

      <div className="panel__section">
        <div className="panel__heading">Garrison</div>
        {units.length === 0 ? (
          <p className="panel__note">
            Nothing recruited here yet. Finished units muster into this
            garrison, and an army is raised from it.
          </p>
        ) : (
          <>
            {units.map(([id, count]) => (
              <div className="panel__row" key={id}>
                <span className="panel__label">{unitById(id)?.name ?? id}</span>
                <span className="panel__value">
                  ×{count}
                  <span className="panel__muted">
                    {" "}
                    · {(unitById(id)?.upkeep ?? 0) * count}g/mo
                  </span>
                  <button
                    type="button"
                    className="panel__mini"
                    onClick={() => muster({ [id]: 1 })}
                    title="Move one unit into the army on this tile"
                  >
                    Muster
                  </button>
                </span>
              </div>
            ))}
            <button
              type="button"
              className="action"
              onClick={() => muster(Object.fromEntries(units))}
            >
              Muster the whole garrison
            </button>
          </>
        )}
      </div>

      {training.length > 0 && (
        <div className="panel__section">
          <div className="panel__heading">
            In training
            <span className="panel__muted"> · {training.length} queued</span>
          </div>
          {training.map((item, position) => (
            <div className="training-row" key={`${item.label}-${position}`}>
              <Meter item={item} waiting={position > 0} />
              <button
                type="button"
                className="panel__close"
                title="Cancel, full refund"
                onClick={() =>
                  game.command((s) =>
                    cancelProduction(s, city, "recruit", position),
                  )
                }
              >
                ✕
              </button>
            </div>
          ))}
          <p className="panel__note">
            Only the first is being worked on. The rest start when it finishes.
          </p>
        </div>
      )}

      <BuildGrid
        heading="Recruit"
        tiles={tiles}
        note={
          <>
            Every unit is men, and the men come out of this settlement — {num(manpower)} can be
            spared. They do not come back, so an army is a permanent choice against growth.
          </>
        }
      />
    </>
  );
}

/** A unit's combat quirks, in words. Read from the roster so they cannot drift from the rules. */
function unitTraits(unit: Unit): { label: string; value: string }[] {
  const traits: string[] = [];
  if (unit.antiCavalry > 1)
    traits.push(`×${unit.antiCavalry} damage against cavalry`);
  if (unit.rangedResist > 0)
    traits.push(
      `−${Math.round(unit.rangedResist * 100)}% damage from missiles`,
    );
  if (unit.chargeBonus > 0)
    traits.push(`+${unit.chargeBonus} damage on the charge`);
  if (unit.chargeMultiplier > 1)
    traits.push(`×${unit.chargeMultiplier} damage on the charge`);
  return traits.length > 0
    ? [{ label: "In battle", value: traits.join(" · ") }]
    : [];
}

/** A field army: what it is made of, where it is going, and the orders it can be given. */
function ArmyCard({
  army,
  game,
  state,
  world,
  onMarch,
}: {
  army: ArmyState;
  game: Game;
  state: SimState;
  world: World;
  onMarch: (armyId: number) => void;
}): JSX.Element {
  const units = Object.entries(army.units).filter(([, count]) => count > 0);
  const speed = armySpeed(army);
  const onOwnSettlement = state.cities.some(
    (c) => c.tileIndex === army.tileIndex && c.ownerIndex === army.ownerIndex,
  );

  // Standing at the gates of a hostile settlement opens the two ways of taking one: throw the
  // army at the walls now, or sit outside until the defenders have to come out to you.
  const besiegeable = siegeTarget(state, world, army);
  const siege = besiegeable?.siege;
  const investing = siege?.byIndex === army.ownerIndex;

  const winter = calendarAt(state.tick).season === "winter";
  const effective =
    (speed * (SEASON_MOVEMENT[calendarAt(state.tick).season] ?? 100)) / 100;

  return (
    <div className="panel__section panel__section--first">
      <div className="panel__heading">Army</div>

      {units.map(([id, count]) => (
        <div className="panel__row" key={id}>
          <span className="panel__label">{unitById(id)?.name ?? id}</span>
          <span className="panel__value">
            ×{count}
            <span className="panel__muted">
              {" "}
              · {(unitById(id)?.upkeep ?? 0) * count}g/mo
            </span>
          </span>
        </div>
      ))}

      <Row
        label="Strength"
        value={`${stackSize(army.units)} / ${MAX_ARMY_UNITS} units`}
      />
      <Row label="Soldiers" value={num(stackSoldiers(army.units))} />
      <Row label="Upkeep" value={`${num(stackUpkeep(army.units))} g/month`} />
      <Row
        label="Speed"
        value={
          winter
            ? `${effective} tiles/month · ${speed} in fair weather`
            : `${speed} tiles/month`
        }
      />
      <Row
        label="Orders"
        value={
          investing
            ? `Besieging · ${siege?.monthsRemaining} month${siege?.monthsRemaining === 1 ? "" : "s"} until they must come out`
            : army.path.length > 0
              ? `Marching · ${army.path.length} tiles to go`
              : "Holding"
        }
      />

      {besiegeable && (
        <p className="panel__note">
          {investing
            ? "The settlement pays its owner nothing, finishes nothing and starves. When the clock runs out its defenders must sortie into the open — or surrender, if the odds are hopeless."
            : `Assaulting ${world.cities[besiegeable.cityIndex]?.name ?? "it"} means storming the walls, and the walls count. A siege takes ${siegeMonths(besiegeable.tier)} month${siegeMonths(besiegeable.tier) === 1 ? "" : "s"}, but the fight at the end of it is fought in the open.`}
        </p>
      )}

      <div className="army-orders">
        <button
          type="button"
          className="action"
          onClick={() => onMarch(army.id)}
        >
          March…
        </button>
        {besiegeable && !investing && (
          <button
            type="button"
            className="action"
            onClick={() => game.command((s) => beginSiege(s, world, army.id))}
            title="Invest the settlement and starve it out"
          >
            Besiege
          </button>
        )}
        {besiegeable && (
          <button
            type="button"
            className="action action--danger"
            onClick={() =>
              game.command((s) =>
                assault(s, world, army.id, besiegeable.tileIndex),
              )
            }
            title="Storm the walls now, with every army of yours within two tiles"
          >
            Assault
          </button>
        )}
        {army.path.length > 0 && (
          <button
            type="button"
            className="action"
            onClick={() => game.command((s) => halt(s, army.id))}
            title="Cancel the whole route, queued legs and all"
          >
            Halt
          </button>
        )}
        {onOwnSettlement && (
          <button
            type="button"
            className="action"
            onClick={() => game.command((s) => standDown(s, world, army.id))}
            title="Return every unit to this settlement's garrison"
          >
            Stand down
          </button>
        )}
        <button
          type="button"
          className="action action--danger"
          onClick={() => game.command((s) => disband(s, army.id))}
          title="Disband in the field — the units are lost"
        >
          Disband
        </button>
      </div>
    </div>
  );
}

function totalMonths(order: CityState["queue"][number]): number {
  if (order.kind === "building") return buildingById(order.id)?.months ?? 1;
  return settlementUpgradeTo(order.targetTier)?.months ?? 1;
}

/**
 * Fief buildings — what can be raised on the land itself rather than inside the walls.
 *
 * A tile holds one of farm, mine or sawmill, upgraded up to four times, so the grid offers all
 * three on bare ground and only the one already there afterwards.
 */
function FiefBuildings({
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
  const profile = TERRAIN_PROFILE[tile.terrain];
  const nextLevel = level + 1;

  if (monthsLeft > 0) {
    const total = improvementMonths(target);
    return (
      <div className="panel__section">
        <div className="panel__heading">Fief Buildings</div>
        <Meter
          item={{
            label: `${kind ? IMPROVEMENT_NAME[kind] : "Work"} → level ${target}`,
            done: Math.min(total, total - monthsLeft + monthFraction(state)),
            total,
          }}
          waiting={false}
        />
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

  const choices = kind === null ? IMPROVEMENT_KINDS : [kind];
  const tiles: BuildTile[] = choices.map((choice) => {
    const cost = improvementCost(choice, nextLevel);
    const beyondCap = nextLevel > cap;
    const affordable = canAfford(state, player, cost);
    const modifier = profile.output[choice];

    return {
      id: choice,
      name: IMPROVEMENT_NAME[choice],
      state: beyondCap || !affordable ? "blocked" : "available",
      blurb: artFor(choice).blurb,
      facts: [
        { label: "Cost", value: costText(cost) },
        { label: "Takes", value: `${improvementMonths(nextLevel)} months` },
        {
          label: "Level",
          value: `${level} → ${nextLevel} of ${MAX_IMPROVEMENT_LEVEL}`,
        },
        { label: "Ground", value: TERRAIN_LABEL[tile.terrain] },
        {
          label: "Terrain effect",
          value:
            modifier === 1
              ? "no change"
              : `${modifier > 1 ? "+" : ""}${Math.round((modifier - 1) * 100)}% yield here`,
        },
        {
          label: "Yield at this level",
          value: yieldText(tile, choice, nextLevel),
        },
      ],
      reason: beyondCap
        ? `Level ${nextLevel} needs a tier-${nextLevel} settlement somewhere in your realm. Your best is tier ${cap}.`
        : affordable
          ? undefined
          : "Not enough in the treasury.",
      action:
        level === 0
          ? `Build ${IMPROVEMENT_NAME[choice]}`
          : `Upgrade to level ${nextLevel}`,
      onAction: () =>
        game.command((s) =>
          queueImprovement(s, world, player, tile.x, tile.y, choice),
        ),
    };
  });

  return (
    <BuildGrid
      heading="Fief Buildings"
      tiles={tiles}
      note={
        kind === null
          ? "A tile holds one of these three, and the choice is permanent. Improve the land around a settlement by selecting those tiles on the map."
          : `This land is worked as a ${IMPROVEMENT_NAME[kind].toLowerCase()}, level ${level}.`
      }
    />
  );
}

/** What one tile would yield with the given improvement at the given level. */
function yieldText(
  tile: TileInfo,
  kind: ImprovementKind,
  level: number,
): string {
  const node = tile.feature?.kind === "resource" ? tile.feature.resource : null;
  const before = tileOutput({
    terrain: tile.terrain,
    improvement: kind,
    level: level - 1,
    node,
  });
  const after = tileOutput({
    terrain: tile.terrain,
    improvement: kind,
    level,
    node,
  });

  const parts = (["gold", "wood", "iron", "stone"] as const)
    .filter((resource) => after[resource] > 0)
    .map((resource) => {
      const gain = after[resource] - before[resource];
      return `${after[resource]} ${resource}${gain > 0 ? ` (+${gain})` : ""}`;
    });
  return parts.length > 0 ? `${parts.join(", ")} / month` : "—";
}

function CityBuildings({
  city,
  tile,
  game,
  state,
  world,
}: {
  city: CityState;
  tile: TileInfo;
  game: Game;
  state: SimState;
  world: World;
}): JSX.Element {
  const available = new Set(buildOptions(world, city).map((b) => b.id));
  const built = new Set(city.buildings);
  const queued = new Set(
    city.queue.flatMap((order) =>
      order.kind === "building" ? [order.id] : [],
    ),
  );
  const coastal = isCoastal(world, tile.x, tile.y);

  // Every building this settlement's tier can reach, in one grid — built, queued, buildable
  // and merely unaffordable alike. Seeing the whole line at once is what makes it read as a
  // progression rather than a menu that changes shape every time something finishes.
  const tiles: BuildTile[] = buildingsForTier(city.tier)
    .filter((building) => !building.coastal || coastal)
    .map((building) => {
      const affordable = canAfford(state, city.ownerIndex, building.cost);
      const state_: BuildTile["state"] = built.has(building.id)
        ? "built"
        : queued.has(building.id)
          ? "queued"
          : available.has(building.id) && affordable
            ? "available"
            : "blocked";

      return {
        id: building.id,
        name: building.name,
        state: state_,
        blurb: artFor(building.id).blurb,
        facts: [
          {
            label: "Line",
            value: `${labelOf(building.line)} · level ${building.level}`,
          },
          { label: "Cost", value: costText(building.cost) },
          { label: "Takes", value: `${building.months} months` },
          {
            label: "Needs",
            value: `${TIER_NAME[building.minTier as 1 | 2 | 3 | 4]} or better`,
          },
          ...buildingEffects(building),
        ],
        reason: buildingReason(building, built, queued, available, affordable),
        action: `Build ${building.name}`,
        onAction: () =>
          game.command((s) => queueBuilding(s, world, city, building.id)),
      };
    });

  const upgrade = settlementUpgradeTo(city.tier + 1);
  if (upgrade) {
    const blocked = settlementUpgradeBlock(state, city);
    tiles.unshift({
      id: settlementArtKey(upgrade.toTier),
      name: upgrade.name,
      state:
        blocked === "already-building"
          ? "queued"
          : blocked
            ? "blocked"
            : "available",
      blurb: artFor(settlementArtKey(upgrade.toTier)).blurb,
      facts: [
        {
          label: "Expands",
          value: `${TIER_NAME[city.tier]} → ${upgrade.name}`,
        },
        { label: "Needs", value: `${num(upgrade.minPopulation)} people` },
        {
          label: "Population",
          value: `${num(city.population)} here now`,
        },
        { label: "Cost", value: costText(upgrade.cost) },
        { label: "Takes", value: `${upgrade.months} months` },
        ...(upgrade.unique ? [{ label: "Limit", value: "One per realm" }] : []),
      ],
      reason: upgradeReason(blocked, upgrade, city),
      action: `Expand into a ${upgrade.name}`,
      onAction: () => game.command((s) => queueSettlementUpgrade(s, city)),
    });
  }

  const underway = creeping(
    city.queue.map((order) => ({
      label:
        order.kind === "building"
          ? (buildingById(order.id)?.name ?? labelOf(order.id))
          : `Expanding into a ${TIER_NAME[order.targetTier]}`,
      done: totalMonths(order) - order.monthsRemaining,
      total: totalMonths(order),
    })),
    monthFraction(state),
  );

  return (
    <>
      {underway.length > 0 && (
        <div className="panel__section panel__section--first">
          <div className="panel__heading">Under construction</div>
          {underway.map((item, position) => (
            <div className="training-row" key={`${item.label}-${position}`}>
              <Meter item={item} waiting={position > 0} />
              <button
                type="button"
                className="panel__close"
                title="Cancel, full refund"
                onClick={() =>
                  game.command((s) => cancelOrder(s, city, position))
                }
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <BuildGrid heading="City Buildings" tiles={tiles} />

      <FiefBuildings tile={tile} game={game} state={state} world={world} />

      <p className="panel__note">
        Treasury {num(whole(state.factions[city.ownerIndex]?.stock.gold ?? 0))}{" "}
        gold
      </p>
    </>
  );
}

/** The mechanical effects a building carries, as rows. Derived, so they cannot go stale. */
function buildingEffects(
  building: Building,
): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  // Housing and halls both pay through growthPeople, so one row covers either.
  if (building.growthPeople > 0) {
    rows.push({
      label: "Growth",
      value: `+${num(building.growthPeople)} people a month`,
    });
  }
  if (building.goldPerMonth > 0) {
    rows.push({
      label: "Income",
      value: `+${num(building.goldPerMonth)} gold a month`,
    });
  }
  if (building.goldPerWaterTile > 0) {
    rows.push({
      label: "Income",
      value: `+${building.goldPerWaterTile} gold a month per adjacent water tile`,
    });
  }
  if (building.defencePercent > 0) {
    rows.push({
      label: "Defence",
      value: `+${building.defencePercent}% for the defender`,
    });
  }

  const trains = loadUnits().filter((unit) =>
    unit.requires.includes(building.id),
  );
  if (trains.length > 0) {
    rows.push({
      label: "Unlocks",
      value: trains.map((unit) => unit.name).join(", "),
    });
  }
  const launches = loadShips().filter((ship) => ship.requires === building.id);
  if (launches.length > 0) {
    rows.push({
      label: "Unlocks",
      value: launches.map((ship) => ship.name).join(", "),
    });
  }
  if (defenceBuildings().includes(building.id)) {
    rows.push({ label: "Garrison", value: "+1 permanent defender" });
  }
  if (building.coastal)
    rows.push({ label: "Requires", value: "A coastal settlement" });
  return rows;
}

function buildingReason(
  building: Building,
  built: ReadonlySet<string>,
  queued: ReadonlySet<string>,
  available: ReadonlySet<string>,
  affordable: boolean,
): string | undefined {
  if (built.has(building.id) || queued.has(building.id)) return undefined;
  if (!available.has(building.id)) {
    return CHAIN_LINES.includes(building.line)
      ? `The ${labelOf(building.line).toLowerCase()} line has to be built in order — finish level ${building.level - 1} first.`
      : "Not available at this settlement yet.";
  }
  return affordable ? undefined : "Not enough in the treasury.";
}

function upgradeReason(
  blocked: BuildFailure | null,
  upgrade: SettlementUpgrade,
  city: CityState,
): string | undefined {
  switch (blocked) {
    case null:
    case "already-building":
      return undefined;
    case "too-few-people":
      return `A ${upgrade.name} needs ${num(upgrade.minPopulation)} people. This settlement holds ${num(city.population)} — it has to grow into it.`;
    case "already-have-one":
      return `A realm may only ever have one ${upgrade.name}.`;
    case "insufficient-resources":
      return "Not enough in the treasury.";
    default:
      return "Cannot expand any further.";
  }
}

/** Ships, their yard and the fleet they join. */
function Navy({
  city,
  game,
  state,
  coastal,
}: {
  city: CityState;
  game: Game;
  state: SimState;
  coastal: boolean;
}): JSX.Element {
  const moored = Object.entries(city.fleet).filter(([, count]) => count > 0);
  const buildable = new Set(buildableShips(city.buildings).map((s) => s.id));

  const inYard = creeping(
    city.shipQueue.map((order) => ({
      label: shipById(order.id)?.name ?? order.id,
      done: (shipById(order.id)?.months ?? 0) - order.monthsRemaining,
      total: shipById(order.id)?.months ?? 0,
    })),
    monthFraction(state),
  );

  const tiles: BuildTile[] = loadShips().map((ship) => {
    const affordable = canAfford(state, city.ownerIndex, ship.cost);
    const unlocked = buildable.has(ship.id);
    return {
      id: ship.id,
      name: ship.name,
      state: unlocked && affordable ? "available" : "blocked",
      blurb: artFor(ship.id).blurb,
      facts: [
        { label: "Cost", value: costText(ship.cost) },
        { label: "Takes", value: `${ship.months} months` },
        { label: "Upkeep", value: `${ship.upkeep} gold a month` },
        {
          label: "Needs",
          value: buildingById(ship.requires)?.name ?? ship.requires,
        },
      ],
      reason: !coastal
        ? "This settlement does not border water."
        : !unlocked
          ? `Needs a ${buildingById(ship.requires)?.name ?? ship.requires}, built in the Buildings tab.`
          : affordable
            ? undefined
            : "Not enough in the treasury.",
      action: `Lay down a ${ship.name}`,
      onAction: () => game.command((s) => queueShip(s, city, ship.id)),
    };
  });

  return (
    <>
      <div className="panel__section panel__section--first">
        <div className="panel__heading">Fleet</div>
        {moored.length === 0 ? (
          <p className="panel__note">Nothing in harbour here.</p>
        ) : (
          moored.map(([id, count]) => (
            <div className="panel__row" key={id}>
              <span className="panel__label">{shipById(id)?.name ?? id}</span>
              <span className="panel__value">
                ×{count}
                <span className="panel__muted">
                  {" "}
                  · {(shipById(id)?.upkeep ?? 0) * count}g/mo
                </span>
              </span>
            </div>
          ))
        )}
      </div>

      {inYard.length > 0 && (
        <div className="panel__section">
          <div className="panel__heading">
            In the yard
            <span className="panel__muted"> · {inYard.length} queued</span>
          </div>
          {inYard.map((item, position) => (
            <div className="training-row" key={`${item.label}-${position}`}>
              <Meter item={item} waiting={position > 0} />
              <button
                type="button"
                className="panel__close"
                title="Cancel, full refund"
                onClick={() =>
                  game.command((s) =>
                    cancelProduction(s, city, "ship", position),
                  )
                }
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <BuildGrid
        heading="Shipyard"
        tiles={tiles}
        note="Ships are built and moored here. Putting a fleet to sea comes with the naval phase."
      />
    </>
  );
}

function labelOf(id: string): string {
  return id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
