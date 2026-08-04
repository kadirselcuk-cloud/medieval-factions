import { LEVEL_DIFFICULTY } from '../data/ai';
import type { Faction } from '../data/factions';
import type { World } from '../data/world';
import { calendarAt } from './calendar';
import { autosave, serialise, SAVE_VERSION, writeSave, type SaveFile } from './save';
import { createInitialState } from './state';
import { advance } from './tick';
import type { AiDifficulty, SimState } from './types';
import { rememberGround } from './vision';

export const SPEEDS = [0, 1, 2, 5, 10] as const;

/**
 * **CHEAT — remove before release.** See docs/OWED.md.
 *
 * A century of campaign in about two and a half minutes, for testing balance by eye rather than
 * by projection. Hidden until unlocked, and unlocked by a key sequence no player finds by
 * accident: three clicks on Pause, then three on 10x.
 */
export const MAX_SPEED = 1000;

export type Speed = (typeof SPEEDS)[number] | typeof MAX_SPEED;

/**
 * Real time is clamped per frame so a stalled tab cannot dump thousands of queued ticks into
 * one frame when it wakes. The simulation would still be correct — it just would not be
 * watchable.
 */
const MAX_FRAME_MS = 250;
const MAX_TICKS_PER_FRAME = 40;

/**
 * Owns the clock and the simulation state, and nothing else. React subscribes; it never
 * holds simulation data itself.
 *
 * The tick accumulator is the one place a float is allowed, because it decides *when* a tick
 * happens, never what the tick does. Simulation state stays integer-only.
 */
export class Game {
  state: SimState;
  version = 0;

  private speedValue: Speed = 1;
  private speedBeforeAutoPause: Speed = 1;
  /** CHEAT — remove before release. Session-only; deliberately not part of a save. */
  private cheatsOn = false;
  /** CHEAT — remove before release. */
  private fogOff = false;
  private autoPaused = false;
  private frameHandle = 0;
  private lastFrameTime = 0;
  private accumulator = 0;
  private lastAutosavedMonth = 0;
  private readonly listeners = new Set<() => void>();

  constructor(
    readonly world: World,
    readonly roster: readonly Faction[],
    playerFactionId: string,
    seed = 1,
    difficulty: AiDifficulty = LEVEL_DIFFICULTY,
  ) {
    this.state = createInitialState(world, roster, playerFactionId, seed, difficulty);
  }

  /**
   * The rung every rival is playing at — read off the realms themselves rather than stored
   * beside them, so a loaded campaign reports what it is actually being played against.
   */
  get difficulty(): AiDifficulty {
    return this.state.factions.find((faction) => faction.ai)?.ai?.difficulty ?? LEVEL_DIFFICULTY;
  }

  get speed(): Speed {
    return this.speedValue;
  }

  get isAutoPaused(): boolean {
    return this.autoPaused;
  }

  /** CHEAT — remove before release. */
  get cheatsUnlocked(): boolean {
    return this.cheatsOn;
  }

  /** CHEAT — remove before release. */
  unlockCheats(): void {
    if (this.cheatsOn) return;
    this.cheatsOn = true;
    this.emit();
  }

  /**
   * CHEAT — remove before release. See docs/OWED.md.
   *
   * Lifts the fog of war off the whole map, and puts it back. Session-only and deliberately not
   * part of a save, like the speed cheat — it changes what is drawn and nothing else, so a
   * campaign played with it off is the same campaign.
   */
  get fogRevealed(): boolean {
    return this.fogOff;
  }

  /** CHEAT — remove before release. */
  toggleFog(): void {
    this.fogOff = !this.fogOff;
    this.emit();
  }

  get playerFaction(): Faction {
    const faction = this.roster[this.state.playerFactionIndex];
    if (!faction) throw new Error('Player faction missing from roster');
    return faction;
  }

  factionAt(index: number): Faction | undefined {
    return index < 0 ? undefined : this.roster[index];
  }

  /**
   * Apply a player action to the simulation.
   *
   * The single write path from the UI. Everything the player does mutates state here and
   * nowhere else, so there is exactly one place that has to notify React — and exactly one
   * place to hook when commands need recording for replays or an undo stack.
   */
  command<T>(action: (state: SimState) => T): T {
    const result = action(this.state);
    this.emit();
    return result;
  }

  setSpeed(speed: Speed): void {
    if (this.speedValue === speed) return;
    this.speedValue = speed;
    this.autoPaused = false;
    // Drop any partial tick so changing speed never nudges the simulation forward.
    this.accumulator = 0;
    this.emit();
  }

  start(): void {
    if (this.frameHandle !== 0) return;
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.lastFrameTime = performance.now();
    this.frameHandle = requestAnimationFrame(this.frame);
  }

  stop(): void {
    if (this.frameHandle !== 0) cancelAnimationFrame(this.frameHandle);
    this.frameHandle = 0;
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  private emit(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  private readonly frame = (now: number): void => {
    const elapsed = Math.min(now - this.lastFrameTime, MAX_FRAME_MS);
    this.lastFrameTime = now;

    if (this.speedValue > 0) {
      this.accumulator += (elapsed / 1000) * this.speedValue;
      let ran = 0;
      while (this.accumulator >= 1 && ran < MAX_TICKS_PER_FRAME) {
        advance(this.state, this.world);
        this.accumulator -= 1;
        ran += 1;
      }
      if (ran > 0) {
        this.emit();
        this.maybeAutosave();
      }
    }

    this.frameHandle = requestAnimationFrame(this.frame);
  };

  // --------------------------------------------------------------- persistence

  private meta(): Omit<SaveFile, 'id' | 'kind' | 'name'> {
    return {
      version: SAVE_VERSION,
      tick: this.state.tick,
      factionId: this.playerFaction.id,
      mapId: this.world.id,
      savedAt: Date.now(),
      state: serialise(this.state),
    };
  }

  async save(name: string): Promise<void> {
    await writeSave({ ...this.meta(), id: `manual-${Date.now()}`, kind: 'manual', name });
  }

  snapshot(): SaveFile {
    return { ...this.meta(), id: 'export', kind: 'manual', name: this.describe() };
  }

  /** Replace the running campaign, e.g. after loading a save. */
  loadState(state: SimState): void {
    this.state = state;
    // Bring the remembered map up to date before the first frame. A campaign loaded and left
    // paused never ticks, and a save migrated up from v6 carries no memory at all — either way
    // the player would be looking at a black map until they pressed play.
    rememberGround(state, this.world);
    this.accumulator = 0;
    this.lastAutosavedMonth = calendarAt(state.tick).totalMonths;
    this.emit();
  }

  describe(): string {
    const date = calendarAt(this.state.tick);
    return `${this.playerFaction.name} — ${date.monthName} ${date.year}`;
  }

  /**
   * Autosave on month rollover, and again on year rollover into a separate rotation.
   * Fire-and-forget: a failed write must never stall the simulation, but it must be visible.
   */
  private maybeAutosave(): void {
    const date = calendarAt(this.state.tick);
    if (date.totalMonths === this.lastAutosavedMonth) return;
    this.lastAutosavedMonth = date.totalMonths;
    if (date.totalMonths === 0) return;

    const base = this.meta();
    const write = async () => {
      await autosave({ ...base, kind: 'monthly', name: this.describe() });
      if (date.monthIndex === 0) {
        await autosave({ ...base, kind: 'yearly', name: `${this.playerFaction.name} — ${date.year}` });
      }
    };
    void write().catch((error: unknown) => {
      console.error('Autosave failed', error);
    });
  }

  /**
   * docs/MECHANICS.md §1 — the simulation pauses when the player is not in the game. There is
   * no offline progress, so a backgrounded tab must not silently bank a decade of income.
   */
  private readonly onVisibilityChange = (): void => {
    if (document.hidden) {
      if (this.speedValue > 0) {
        this.speedBeforeAutoPause = this.speedValue;
        this.speedValue = 0;
        this.accumulator = 0;
        this.autoPaused = true;
        this.emit();
      }
      return;
    }

    this.lastFrameTime = performance.now();
    if (this.autoPaused) {
      this.speedValue = this.speedBeforeAutoPause;
      this.autoPaused = false;
      this.emit();
    }
  };
}
