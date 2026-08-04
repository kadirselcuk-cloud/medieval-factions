import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { loadFactions, playableFactions, type Faction } from '../data/factions';
import { loadEurope1350 } from '../data/maps';
import { describeTile, type World } from '../data/world';
import type { ArmyView, MapRenderer, TerritoryView, TileInfo } from '../render/MapRenderer';
import { stackSize } from '../sim/armies';
import { Game, type Speed } from '../sim/game';
import { orderMove } from '../sim/movement';
import type { AiDifficulty, BattleReport, GameEvent, SimState } from '../sim/types';
import { visibleTiles } from '../sim/vision';
import { BalancePanel } from './BalancePanel';
import { BattleView } from './BattleView';
import { BottomBar } from './BottomBar';
import { GameMenu } from './GameMenu';
import { MapView } from './MapView';
import { RealmWatch } from './RealmWatch';
import { RosterMenu, type RosterKind } from './RosterMenu';
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

  /** Chosen together on the start screen, and fixed for the campaign. */
  const [start, setStart] = useState<{ factionId: string; difficulty: AiDifficulty } | null>(null);

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

  if (start === null) {
    return (
      <StartScreen
        playable={playableFactions()}
        onChoose={(factionId, difficulty) => setStart({ factionId, difficulty })}
      />
    );
  }

  return (
    <Campaign
      world={load.world}
      roster={load.roster}
      factionId={start.factionId}
      difficulty={start.difficulty}
    />
  );
}

function Campaign({
  world,
  roster,
  factionId,
  difficulty,
}: {
  world: World;
  roster: readonly Faction[];
  factionId: string;
  difficulty: AiDifficulty;
}): JSX.Element {
  const game = useMemo(
    () => new Game(world, roster, factionId, 1, difficulty),
    [world, roster, factionId, difficulty],
  );
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
  const [fullscreen, setFullscreen] = useState(false);
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

  /**
   * Fog of war — docs/MECHANICS.md §9.
   *
   * Recomputed whenever the simulation ticks, because territory, settlements and armies all move
   * the edge of it. It costs a pass over the ground the player holds rather than over the map, so
   * it stays cheap however large the realm gets. **The rivals get none of this**: it is never
   * passed to the simulation, so nothing the AI does depends on it.
   */
  const vision = useMemo(
    () => visibleTiles(state, world, state.playerFactionIndex),
    [game.version, state, world],
  );

  /**
   * **Observer mode.** A realm that no longer exists sees nothing, and that is the problem.
   *
   * Sight is derived from ground held, so the moment the player's last settlement falls their
   * vision is a mask of zeroes: every rival army, every border and every allegiance vanishes, and
   * a Europe still very much at war looks like a Europe that has stopped. The campaign keeps
   * running — nothing pauses on defeat — so the only thing missing was being able to watch it.
   *
   * There is also nothing left to hide. Fog exists to keep a player from reading a board they
   * have not earned; a player with no realm has no advantage left to protect.
   */
  const observing = !state.factions[state.playerFactionIndex]?.alive;

  /** CHEAT — remove before release. The cheat and observer mode reveal the map the same way. */
  const unfogged = observing || game.fogRevealed;

  /*
   * And what it remembers — the 62% wash, as against the black beyond it.
   *
   * Passed straight out of state, with no memo of its own. The tick maintains it (`rememberGround`
   * in the simulation) by mutating it in place, so its identity never changes and memoising it
   * would achieve nothing. `vision` is rebuilt every tick and shares the effect that hands both to
   * the renderer, which is what gets the redraw.
   */

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

  /**
   * Full screen, which the browser only grants from a user gesture and can also leave on its
   * own — pressing Escape, for instance. The flag therefore follows the document rather than
   * the button, so the icon can never claim a state the browser is not in.
   */
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => undefined);
  }, []);

  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', sync);
    sync();
    return () => document.removeEventListener('fullscreenchange', sync);
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
        {/* CHEAT — remove before release: null masks draw the map with no fog at all. */}
        <MapView
          world={world}
          territory={territory}
          armies={armies}
          vision={unfogged ? null : vision}
          known={unfogged ? null : state.discovered}
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
        {/* Every realm's economy, while the map is revealed — by the cheat or by defeat. */}
        {unfogged && <RealmWatch state={state} roster={roster} />}

        {/*
          `unfogged` gates the panel as well as the map. Observer mode and the cheat both draw
          the whole world, and a tile the player can plainly see but the panel refuses to read
          out is worse than either state on its own.
        */}
        {selected && (
          <SelectionPanel
            key={selected.index}
            tile={selected}
            game={game}
            state={state}
            world={world}
            roster={roster}
            visible={unfogged || vision[selected.index] === 1}
            onMarch={setMarching}
            onClose={() => setSelected(null)}
          />
        )}
      </main>

      {menuOpen && (
        <GameMenu
          game={game}
          onClose={() => setMenuOpen(false)}
          fullscreen={fullscreen}
          onFullscreen={toggleFullscreen}
        />
      )}

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
        onFullscreen={toggleFullscreen}
        fullscreen={fullscreen}
        cheatsUnlocked={game.cheatsUnlocked}
        onUnlockCheats={() => game.unlockCheats()}
        fogRevealed={game.fogRevealed}
        onToggleFog={() => game.toggleFog()}
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
        <p>
          {roster[state.playerFactionIndex]?.name} holds neither a settlement nor an army. The
          campaign runs on, and the fog is lifted — {alive.length} realms are still in the field.
        </p>
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
