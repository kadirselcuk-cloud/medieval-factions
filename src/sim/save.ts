import type { CityState, SimState } from './types';

/**
 * Persistence.
 *
 * Saves are versioned and migrated on load. The simulation state is integers all the way
 * down, so a save is a structural copy with the typed arrays widened to plain arrays — there
 * is nothing to reconstruct, and a round trip is exact by construction.
 */

/**
 * 1 → 2: field armies. A v1 save has none, and its factions have never left home.
 * 2 → 3: battles. A v2 save has fought none, and every faction it knows about is still alive.
 * 3 → 4: sieges. A v3 save has no settlement invested, because nothing could invest one.
 * 4 → 5: population became whole people, because growth stopped being a percentage.
 */
export const SAVE_VERSION = 5;

const DB_NAME = 'medieval-factions';
const DB_VERSION = 1;
const STORE = 'saves';

export type SlotKind = 'manual' | 'monthly' | 'yearly';

/** docs/MECHANICS.md §7 — 5 monthly plus 3 yearly autosaves. */
export const MONTHLY_AUTOSAVES = 5;
export const YEARLY_AUTOSAVES = 3;

export interface SaveMeta {
  id: string;
  name: string;
  kind: SlotKind;
  version: number;
  /** Campaign tick, not wall-clock — the only ordering that means anything in-game. */
  tick: number;
  factionId: string;
  mapId: string;
  /** Wall-clock, for display only. */
  savedAt: number;
}

export interface SaveFile extends SaveMeta {
  state: SerialisedState;
}

interface SerialisedState extends Omit<SimState, 'tileOwner' | 'improvementKind' | 'improvementLevel' | 'improvementMonths' | 'improvementTarget'> {
  tileOwner: number[];
  improvementKind: number[];
  improvementLevel: number[];
  improvementMonths: number[];
  improvementTarget: number[];
}

export function serialise(state: SimState): SerialisedState {
  return {
    tick: state.tick,
    seed: state.seed,
    rng: state.rng,
    playerFactionIndex: state.playerFactionIndex,
    factions: structuredClone(state.factions),
    cities: structuredClone(state.cities),
    armies: structuredClone(state.armies),
    nextArmyId: state.nextArmyId,
    battles: structuredClone(state.battles),
    nextBattleId: state.nextBattleId,
    events: structuredClone(state.events),
    tileOwner: Array.from(state.tileOwner),
    improvementKind: Array.from(state.improvementKind),
    improvementLevel: Array.from(state.improvementLevel),
    improvementMonths: Array.from(state.improvementMonths),
    improvementTarget: Array.from(state.improvementTarget),
  };
}

export function deserialise(data: SerialisedState): SimState {
  return {
    tick: data.tick,
    seed: data.seed,
    rng: data.rng,
    playerFactionIndex: data.playerFactionIndex,
    factions: structuredClone(data.factions),
    cities: structuredClone(data.cities),
    armies: structuredClone(data.armies ?? []),
    nextArmyId: data.nextArmyId ?? 1,
    battles: structuredClone(data.battles ?? []),
    nextBattleId: data.nextBattleId ?? 1,
    events: structuredClone(data.events ?? []),
    tileOwner: Int8Array.from(data.tileOwner),
    improvementKind: Int8Array.from(data.improvementKind),
    improvementLevel: Uint8Array.from(data.improvementLevel),
    improvementMonths: Uint8Array.from(data.improvementMonths),
    improvementTarget: Uint8Array.from(data.improvementTarget),
  };
}

/**
 * Bring an older save up to the current schema.
 *
 * Each step is written against the shape of the version *before* it, never against the current
 * one, so adding a version 3 never silently changes what a version 1 save loads as.
 */
export function migrate(file: SaveFile): SaveFile {
  if (file.version === SAVE_VERSION) return file;
  if (file.version > SAVE_VERSION) {
    throw new Error(
      `Save was written by a newer version of the game (save v${file.version}, game v${SAVE_VERSION}).`,
    );
  }

  const state = { ...file.state };

  // v1 predates field armies. The campaign carries on with none in the field, and its cities
  // keep the units they had — those were always garrison, which is where they still belong.
  if (file.version < 2) {
    state.armies = state.armies ?? [];
    state.nextArmyId = state.nextArmyId ?? 1;
  }

  // v2 predates combat. Nothing has been fought, so there is no battle to replay and no realm
  // that could already have been extinguished.
  if (file.version < 3) {
    state.battles = state.battles ?? [];
    state.nextBattleId = state.nextBattleId ?? 1;
    for (const faction of state.factions) faction.alive = faction.alive ?? true;
  }

  // v3 predates sieges. No settlement is invested, because nothing could invest one.
  if (file.version < 4) {
    for (const city of state.cities) city.siege = city.siege ?? null;
  }

  // v4 held population as thousandths of a person, because growth was a compounding percentage
  // and needed the precision. Flat growth does not, so the fraction is dropped on the way in.
  if (file.version < 5) {
    for (const city of state.cities as (CityState & { populationMilli?: number })[]) {
      if (city.population === undefined && city.populationMilli !== undefined) {
        city.population = Math.floor(city.populationMilli / 1000);
      }
      delete city.populationMilli;
    }
  }

  return { ...file, version: SAVE_VERSION, state };
}

// ---------------------------------------------------------------- IndexedDB

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the save database'));
  });
}

function transact<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const request = run(db.transaction(STORE, mode).objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Save operation failed'));
      }),
  );
}

export async function writeSave(file: SaveFile): Promise<void> {
  await transact('readwrite', (store) => store.put(file) as IDBRequest<IDBValidKey>);
}

export async function readSave(id: string): Promise<SaveFile | undefined> {
  const file = await transact<SaveFile | undefined>('readonly', (store) => store.get(id));
  return file ? migrate(file) : undefined;
}

export async function deleteSave(id: string): Promise<void> {
  await transact('readwrite', (store) => store.delete(id) as IDBRequest<undefined>);
}

export async function listSaves(): Promise<SaveMeta[]> {
  const files = await transact<SaveFile[]>('readonly', (store) => store.getAll());
  return files
    .map(({ state: _state, ...meta }) => meta)
    .sort((a, b) => b.savedAt - a.savedAt);
}

/**
 * Autosave, rotating within its own kind.
 *
 * Monthly and yearly slots rotate independently, so five months of fine-grained recovery
 * never pushes out the three-year fallback.
 */
export async function autosave(file: Omit<SaveFile, 'id'>): Promise<void> {
  const keep = file.kind === 'yearly' ? YEARLY_AUTOSAVES : MONTHLY_AUTOSAVES;
  const id = `${file.kind}-${file.tick}`;
  await writeSave({ ...file, id });

  const existing = (await listSaves())
    .filter((meta) => meta.kind === file.kind)
    .sort((a, b) => b.tick - a.tick);

  for (const stale of existing.slice(keep)) {
    await deleteSave(stale.id);
  }
}

// ------------------------------------------------------------ file transfer

export function toJSON(file: SaveFile): string {
  return JSON.stringify(file);
}

export function fromJSON(text: string): SaveFile {
  const parsed: unknown = JSON.parse(text);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('version' in parsed) ||
    !('state' in parsed)
  ) {
    throw new Error('That file is not a Medieval Factions save.');
  }
  return migrate(parsed as SaveFile);
}
