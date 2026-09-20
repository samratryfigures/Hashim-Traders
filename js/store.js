import { LOCAL_KEY_V1, LOCAL_KEY_V2, debounce, byteSize, PAYLOAD_WARN, PAYLOAD_LIMIT } from "./utils.js";
import { emptyDb, cloneDb, importBackup, isV1, migrateV1, normalizeDb } from "./migrate.js";

const listeners = new Set();

export const store = {
  db: emptyDb(),
  loadedRevision: 0,
  loadedUpdatedAt: null,
  syncState: "idle", // idle | syncing | saved | offline | conflict
  conflict: null,
  undo: null,
  filter: { preset: "month", from: null, to: null },
  showArchived: false,
  theme: localStorage.getItem("ht_theme") || "light",
};

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notify() {
  for (const fn of listeners) fn(store);
}

export function loadLocal() {
  try {
    const v2 = localStorage.getItem(LOCAL_KEY_V2);
    if (v2) {
      store.db = normalizeDb(JSON.parse(v2));
      return { migrated: false, from: "v2" };
    }
    const v1 = localStorage.getItem(LOCAL_KEY_V1);
    if (v1) {
      const raw = JSON.parse(v1);
      store.db = isV1(raw) ? migrateV1(raw) : normalizeDb(raw);
      persistLocal();
      return { migrated: true, from: "v1" };
    }
  } catch (err) {
    console.error(err);
  }
  store.db = emptyDb();
  return { migrated: false, from: "empty" };
}

export function persistLocal() {
  localStorage.setItem(LOCAL_KEY_V2, JSON.stringify(store.db));
}

export function setDb(db, { bump = true, sync = true } = {}) {
  store.db = db;
  if (bump) {
    store.db.revision = (Number(store.db.revision) || 0) + 1;
    store.db.updatedAt = new Date().toISOString();
  }
  persistLocal();
  notify();
  if (sync) scheduleSync();
}

export function commit(mutator, { undoLabel } = {}) {
  const before = cloneDb(store.db);
  const next = cloneDb(store.db);
  mutator(next);
  if (undoLabel) {
    store.undo = { db: before, label: undoLabel };
  }
  setDb(next);
  return next;
}

export function applyUndo() {
  if (!store.undo) return false;
  const restored = cloneDb(store.undo.db);
  store.undo = null;
  setDb(restored);
  return true;
}

export function payloadInfo(db = store.db) {
  const bytes = byteSize(db);
  return {
    bytes,
    warn: bytes >= PAYLOAD_WARN,
    over: bytes >= PAYLOAD_LIMIT,
    mb: (bytes / (1024 * 1024)).toFixed(2),
  };
}

let syncFn = null;
export function setSyncHandler(fn) {
  syncFn = fn;
}

const scheduleSync = debounce(() => {
  if (syncFn) syncFn();
}, 1500);

export function syncNow() {
  scheduleSync.flush();
}

export { importBackup };
