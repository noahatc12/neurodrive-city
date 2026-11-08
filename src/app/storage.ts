/**
 * World library persisted in IndexedDB (multi-megabyte OSM towns fit; localStorage's
 * ~5 MB quota does not). Only a tiny pointer to the last-opened world lives in
 * localStorage. Falls back to an in-memory store when IndexedDB is unavailable
 * (private windows, blocked storage) so the app still works.
 * @module app/storage
 */
import type { WorldFile } from '../engine/io/worldSchema.ts';

export interface WorldEntry {
  id: string;
  name: string;
  updatedAt: string;
  /** PNG data URL rendered from the minimap. */
  thumbnail: string | null;
  file: WorldFile;
}

export type WorldSummary = Omit<WorldEntry, 'file'>;

const DB_NAME = 'neurodrive-city';
const STORE = 'worlds';
const LAST_KEY = 'nd:lastWorldId';

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
  });
}

export interface WorldStore {
  readonly persistent: boolean;
  save(entry: WorldEntry): Promise<void>;
  load(id: string): Promise<WorldEntry | undefined>;
  list(): Promise<WorldSummary[]>;
  remove(id: string): Promise<void>;
}

class IdbWorldStore implements WorldStore {
  readonly persistent = true;
  private readonly db: IDBDatabase;

  constructor(db: IDBDatabase) {
    this.db = db;
  }

  async save(entry: WorldEntry): Promise<void> {
    const tx = this.db.transaction(STORE, 'readwrite');
    await req(tx.objectStore(STORE).put(entry));
  }

  async load(id: string): Promise<WorldEntry | undefined> {
    const tx = this.db.transaction(STORE, 'readonly');
    return (await req(tx.objectStore(STORE).get(id))) as WorldEntry | undefined;
  }

  async list(): Promise<WorldSummary[]> {
    const tx = this.db.transaction(STORE, 'readonly');
    const all = (await req(tx.objectStore(STORE).getAll())) as WorldEntry[];
    return all
      .map(({ id, name, updatedAt, thumbnail }) => ({ id, name, updatedAt, thumbnail }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async remove(id: string): Promise<void> {
    const tx = this.db.transaction(STORE, 'readwrite');
    await req(tx.objectStore(STORE).delete(id));
  }
}

class MemoryWorldStore implements WorldStore {
  readonly persistent = false;
  private readonly map = new Map<string, WorldEntry>();

  save(entry: WorldEntry): Promise<void> {
    this.map.set(entry.id, structuredClone(entry));
    return Promise.resolve();
  }

  load(id: string): Promise<WorldEntry | undefined> {
    const e = this.map.get(id);
    return Promise.resolve(e ? structuredClone(e) : undefined);
  }

  list(): Promise<WorldSummary[]> {
    return Promise.resolve(
      [...this.map.values()]
        .map(({ id, name, updatedAt, thumbnail }) => ({ id, name, updatedAt, thumbnail }))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    );
  }

  remove(id: string): Promise<void> {
    this.map.delete(id);
    return Promise.resolve();
  }
}

/** Opens the world library, falling back to memory if IndexedDB is unavailable. */
export async function openWorldStore(): Promise<WorldStore> {
  try {
    if (typeof indexedDB === 'undefined') return new MemoryWorldStore();
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(STORE))
        open.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    const db = await req(open);
    return new IdbWorldStore(db);
  } catch (e) {
    console.warn('IndexedDB unavailable, worlds will not persist', e);
    return new MemoryWorldStore();
  }
}

/** Last-opened world id (small localStorage pointer). */
export function getLastWorldId(): string | null {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}

export function setLastWorldId(id: string): void {
  try {
    localStorage.setItem(LAST_KEY, id);
  } catch {
    // storage blocked: nothing to do
  }
}

/** Small typed localStorage helpers for preferences. */
export function getPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`nd:pref:${key}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function setPref(key: string, value: unknown): void {
  try {
    localStorage.setItem(`nd:pref:${key}`, JSON.stringify(value));
  } catch {
    // ignore
  }
}

/** Generates a short unique id for a new world. */
export function newWorldId(): string {
  const rand = crypto.getRandomValues(new Uint32Array(2));
  return `w-${Date.now().toString(36)}-${(rand[0] ?? 0).toString(36)}${(rand[1] ?? 0).toString(36)}`;
}
