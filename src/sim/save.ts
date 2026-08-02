import type { SimState } from './types';

/**
 * Persistence.
 *
 * Saves are versioned and migrated on load. The simulation state is integers all the way
 * down, so a save is a structural copy with the typed arrays widened to plain arrays — there
 * is nothing to reconstruct, and a round trip is exact by construction.
 */

export const SAVE_VERSION = 1;

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
 * Nothing to do yet — but the seam exists from the first save that was ever written, because
 * retrofitting migration onto saves already in the wild is not possible.
 */
export function migrate(file: SaveFile): SaveFile {
  if (file.version === SAVE_VERSION) return file;
  if (file.version > SAVE_VERSION) {
    throw new Error(
      `Save was written by a newer version of the game (save v${file.version}, game v${SAVE_VERSION}).`,
    );
  }
  return { ...file, version: SAVE_VERSION };
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
