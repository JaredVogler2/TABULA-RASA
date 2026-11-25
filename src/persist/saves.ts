/**
 * Local saves in IndexedDB. Nothing leaves the player's browser.
 *
 * A save is the canonical snapshot text of the world (plus the untouched control twin
 * if the timeline has been forked) with its SHA-256, so a save can be verified and
 * replayed bit-for-bit. Writes are single transactions: a save is either fully
 * replaced or untouched.
 */
import type { DaySample, PackedWorld, SavePayload } from "@/worker/protocol";

const DB_NAME = "tabula-rasa";
const DB_VERSION = 1;
const STORE = "saves";
export const AUTOSAVE_ID = "autosave";

export interface SaveMeta {
  id: string;
  name: string;
  savedAt: number;
  scenario: string;
  seed: number;
  tick: number;
  day: number;
  alive: number;
  treated: boolean;
  hash: string;
  bytes: number;
}

/** One page of the observer's field journal, as kept with a save (see src/ui/game/journal.ts). */
export interface SavedJournalEntry {
  id: string;
  tick: number;
  text: string;
  agents: number[];
  x?: number;
  y?: number;
}

export interface SaveRecord extends SaveMeta {
  /** Canonical text ("" when the record is packed). Saves made before packing existed hold their text here. */
  snapshot: string;
  control: string | null;
  /** The same text gzip-compressed: how saves are kept since phase 15. The hash is of the text either way. */
  packed?: PackedWorld | null;
  series: DaySample[];
  controlSeries: DaySample[];
  /** What the observer had witnessed by then. Absent in saves made before the journal existed. */
  journal?: SavedJournalEntry[];
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("Local saves are unavailable in this browser."));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Could not open local storage."));
    req.onblocked = () => reject(new Error("Local storage is blocked by another tab."));
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        let result: T;
        req.onsuccess = () => {
          result = req.result;
        };
        t.oncomplete = () => {
          db.close();
          resolve(result);
        };
        t.onerror = () => {
          db.close();
          reject(t.error ?? new Error("Local storage transaction failed."));
        };
        t.onabort = () => {
          db.close();
          reject(t.error ?? new Error("Local storage transaction was aborted."));
        };
      }),
  );
}

export function toRecord(id: string, name: string, payload: SavePayload, savedAt: number, journal: SavedJournalEntry[] = []): SaveRecord {
  return {
    journal,
    id,
    name,
    savedAt,
    scenario: payload.scenario,
    seed: payload.seed,
    tick: payload.tick,
    day: payload.day,
    alive: payload.alive,
    treated: payload.treated,
    hash: payload.hash,
    // what the record actually occupies: compressed bytes when packed, characters of text otherwise
    bytes: payload.packed ? payload.packed.snapshot.byteLength + (payload.packed.control?.byteLength ?? 0) : payload.snapshot.length + (payload.control?.length ?? 0),
    snapshot: payload.snapshot,
    control: payload.control,
    packed: payload.packed,
    series: payload.series,
    controlSeries: payload.controlSeries,
  };
}

export async function putSave(record: SaveRecord): Promise<void> {
  await tx("readwrite", (s) => s.put(record));
}

export async function getSave(id: string): Promise<SaveRecord | null> {
  const r = await tx<SaveRecord | undefined>("readonly", (s) => s.get(id) as IDBRequest<SaveRecord | undefined>);
  return r ?? null;
}

export async function deleteSave(id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(id));
}

export async function listSaves(): Promise<SaveMeta[]> {
  const all = await tx<SaveRecord[]>("readonly", (s) => s.getAll() as IDBRequest<SaveRecord[]>);
  return all
    .map((r) => ({ id: r.id, name: r.name, savedAt: r.savedAt, scenario: r.scenario, seed: r.seed, tick: r.tick, day: r.day, alive: r.alive, treated: r.treated, hash: r.hash, bytes: r.bytes }))
    .sort((a, b) => b.savedAt - a.savedAt);
}
