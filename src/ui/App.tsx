import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { loadFactions, playableFactions, type Faction } from '../data/factions';
import { loadEurope1350 } from '../data/maps';
import { describeTile, type World } from '../data/world';
import type { ArmyView, MapRenderer, TerritoryView, TileInfo } from '../render/MapRenderer';
import { stackSize } from '../sim/armies';
import { Game, type Speed } from '../sim/game';
import { orderMove } from '../sim/movement';
import type { BattleReport, GameEvent, SimState } from '../sim/types';
import { BalancePanel } from './BalancePanel';
import { BattleView } from './BattleView';
import { BottomBar } from './BottomBar';
import { MapView } from './MapView';
import { RosterMenu, type RosterKind } from './RosterMenu';
import { SaveMenu } from './SaveMenu';
import { SelectionPanel } from './SelectionPanel';
import { StartScreen } from './StartScreen';
import { TopBar } from './TopBar';
import { useGameState } from './useGame';

interface Loaded {
  world: World;
  roster: readonly Faction[];
}

export function App(): JSX.Element {
  const load = useMemo<Loaded | { error: Error }>(() => {
    try {
      return { world: loadEurope1350(), roster: loadFactions() };
    } catch (error) {
      return { error: error instanceof Error ? error : new Error(String(error)) };
    }
  }, []);

  const [factionId, setFactionId] = useState<string | null>(null);

  if ('error' in load) {
    return (
      <div className="fatal">
        <h1>Game data failed to load</h1>
        <p>
          Content did not pass validation, so the game will not start on bad data. Fix the file
          named below and reload.
        </p>
        <pre>{load.error.message}</pre>
      </div>
    );
  }

  if (factionId === null) {
    return <StartScreen playable={playableFactions()} onChoose={setFactionId} />;
  }

  return <Campaign world={load.world} roster={load.roster} factionId={factionId} />;
}

function Campaign({
  world,
  roster,
  factionId,
}: {
  world: World;
  roster: readonly Faction[];
  factionId: string;
}): JSX.Element {
  const game = useMemo(() => new Game(world, roster, factionId), [world, roster, factionId]);
  const state = useGameState(game);

  useEffect(() => {
    game.start();
    return () => game.stop();
  }, [game]);

  const rendererRef = useRef<MapRenderer | null>(null);
  const [hovered, setHovered] = useState<TileInfo | null>(null);
  const [selected, setSelected] = useState<TileInfo | null>(null);
  const [zoom, setZoom] = useState(16);
  const [menuOpen, setMenuOpen] = useState(false);
  const [rosterKind, setRoster] = useState<RosterKind | null>(null);
  /** The army waiting for a destination click, if the player has pressed March. */
  const [marchingId, setMarching] = useState<number | null>(null);
  /** The balance panel is a developer tool, opened with B. */
  const [balanceOpen, setBalanceOpen] = useState(false);
  /** The battle currently on screen, if any. */
  const [battle, setBattle] = useState<BattleReport | null>(null);
  /** The newest battle already offered to the player, so one is never shown twice. */
  const seenBattle = useRef(0);

  /**
   * docs/DESIGN.md decision 11 — a battle the player is in **pauses the campaign and prompts**.
   *
   * In v1 auto-resolve is the only option, so what the prompt offers is a seat at a fight that
   * has already been decided. Phase B plugs in here: the pause moves in front of the
   * resolution, and the dialog gains the choice to command it.
   */
  useEffect(() => {
    const latest = state.battles[0];
    if (!latest || latest.id <= seenBattle.current) return;
    seenBattle.current = latest.id;

    // Battles are recorded on the tick they are fought. Anything older came in with a loaded
    // save and has already been lived through — it belongs in the log, not in a dialog.
    if (state.tick - latest.tick > 1) return;

    const mine =
      latest.attackerIndex === state.playerFactionIndex ||
      latest.defenderIndex === state.playerFactionIndex;
    if (!mine) return;

    game.setSpeed(0);
    setBattle(latest);
  }, [game, game.version, state]);

  const territory = useMemo<TerritoryView>(
    () => ({ owner: state.tileOwner, colors: roster.map((f) => f.color) }),
    [state.tileOwner, roster],
  );

  const selectedArmyId = selected
    ? (state.armies.find((army) => army.tileIndex === selected.index)?.id ?? null)
    : null;

  const armies = useMemo<ArmyView>(
    () => ({
      markers: state.armies.map((army) => ({
        id: army.id,
        tileIndex: army.tileIndex,
        ownerIndex: army.ownerIndex,
        size: stackSize(army.units),
        path: army.path,
      })),
      colors: roster.map((f) => f.color),
      playerIndex: state.playerFactionIndex,
      selectedId: selectedArmyId,
      marchingId,
    }),
    // Keyed on the simulation's version counter, not on `state`, which is mutated in place and
    // never changes identity. This is also what keeps the canvas repainting while armies march:
    // handing the renderer a fresh view is what marks it dirty.
    [game.version, state, roster, selectedArmyId, marchingId],
  );

  /**
   * A map click is either a selection or a march order.
   *
   * Once March is pressed the next click on the map is the destination, and nothing else —
   * which is why the order is issued here rather than inside the panel that started it.
   */
  const handleMapSelect = useCallback(
    (tile: TileInfo | null) => {
      if (marchingId !== null && tile) {
        const result = game.command((s) => orderMove(s, world, marchingId, tile.index));
        setMarching(null);
        if (!result.ok) return;
        return;
      }
      setSelected(tile);
    },
    [game, world, marchingId],
  );

  const handleReady = useCallback((renderer: MapRenderer | null) => {
    rendererRef.current = renderer;
  }, []);

  // Keyboard shortcuts: space toggles pause, number keys pick a speed.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return;
      if (event.code === 'Space') {
        event.preventDefault();
        game.setSpeed(game.speed === 0 ? 1 : 0);
      } else if (event.key === 'b' || event.key === 'B') {
        setBalanceOpen((open) => !open);
      } else if (event.key === 'Escape') {
        setMenuOpen(false);
        setRoster(null);
        setMarching(null);
        setBalanceOpen(false);
        setBattle(null);
        setSelected(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [game]);

  return (
    <div className="app">
      <TopBar
        state={state}
        playerFaction={game.playerFaction}
        onOpenMenu={() => setMenuOpen(true)}
        onOpenRoster={setRoster}
      />

      <main className="stage">
        <MapView
          world={world}
          territory={territory}
          armies={armies}
          selection={selected?.index ?? null}
          onHover={setHovered}
          onSelect={handleMapSelect}
          onZoomChange={setZoom}
          onReady={handleReady}
        />
        {marchingId !== null && (
          <div className="march-hint">
            Click a tile to march to — it continues from where the army is already headed.
            <button onClick={() => setMarching(null)}>Cancel</button>
          </div>
        )}
        {selected && (
          <SelectionPanel
            key={selected.index}
            tile={selected}
            game={game}
            state={state}
            world={world}
            roster={roster}
            onMarch={setMarching}
            onClose={() => setSelected(null)}
          />
        )}
      </main>

      {menuOpen && <SaveMenu game={game} onClose={() => setMenuOpen(false)} />}

      {balanceOpen && (
        <BalancePanel
          state={state}
          world={world}
          roster={roster}
          onClose={() => setBalanceOpen(false)}
        />
      )}

      {battle && (
        <BattleView
          key={battle.id}
          report={battle}
          world={world}
          roster={roster}
          onClose={() => setBattle(null)}
        />
      )}

      <Verdict state={state} roster={roster} />

      {rosterKind && (
        <RosterMenu
          kind={rosterKind}
          state={state}
          world={world}
          onSelect={(tile) => {
            setSelected(tile);
            rendererRef.current?.centerOn(tile.x, tile.y);
          }}
          onClose={() => setRoster(null)}
        />
      )}

      <BottomBar
        state={state}
        speed={game.speed}
        autoPaused={game.isAutoPaused}
        onSpeedChange={(speed: Speed) => game.setSpeed(speed)}
        onSelectEvent={(event: GameEvent) => {
          // A battle notification opens the fight if the report is still held; everything else
          // — and a battle too old to have been kept — goes to the map.
          const report = event.battleId
            ? state.battles.find((b) => b.id === event.battleId)
            : undefined;
          if (report) {
            game.setSpeed(0);
            setBattle(report);
            return;
          }
          const tile = describeTile(
            world,
            event.tileIndex % world.width,
            Math.floor(event.tileIndex / world.width),
          );
          setSelected(tile);
          rendererRef.current?.centerOn(tile.x, tile.y);
        }}
        hovered={hovered}
        zoom={zoom}
        onZoomIn={() => rendererRef.current?.zoomBy(1.35)}
        onZoomOut={() => rendererRef.current?.zoomBy(1 / 1.35)}
        onFit={() => rendererRef.current?.fit()}
      />

      <div className="rotate-gate">
        <div className="rotate-gate__inner">
          <span className="rotate-gate__icon" aria-hidden="true">
            ⟳
          </span>
          <p>Rotate your device to landscape.</p>
        </div>
      </div>
    </div>
  );
}

/**
 * Total conquest, or the end of a realm — docs/MECHANICS.md §2.
 *
 * A faction is finished when it holds neither a settlement nor an army, so a landless army in
 * the field is still a campaign. The banner is deliberately not a modal: the map underneath is
 * the interesting part, and there is nothing left to decide.
 */
function Verdict({
  state,
  roster,
}: {
  state: SimState;
  roster: readonly Faction[];
}): JSX.Element | null {
  const alive = state.factions.filter((faction) => faction.alive);
  const player = state.factions[state.playerFactionIndex];
  if (!player) return null;

  if (!player.alive) {
    return (
      <div className="verdict verdict--lost">
        <h2>Your realm is extinguished</h2>
        <p>{roster[state.playerFactionIndex]?.name} holds neither a settlement nor an army.</p>
      </div>
    );
  }
  if (alive.length > 1) return null;

  return (
    <div className="verdict verdict--won">
      <h2>Europe is yours</h2>
      <p>{roster[state.playerFactionIndex]?.name} is the last realm standing.</p>
    </div>
  );
}
