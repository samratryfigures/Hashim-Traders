import { store, persistLocal, setDb, payloadInfo } from "./store.js";
import { emptyDb, cloneDb, normalizeDb } from "./migrate.js";
import { toast } from "./ui.js";
import { shouldKeepLocal, mergeDb } from "./utils.js";

const badgeEl = () => document.getElementById("sync-badge");

function setBadge(state, label) {
  store.syncState = state;
  const el = badgeEl();
  if (!el) return;
  el.dataset.state = state;
  el.textContent = label;
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  return { res, data };
}

export async function login(password) {
  const { res, data } = await api("/api/login", { method: "POST", body: JSON.stringify({ password }) });
  return { ok: res.ok, ...data };
}

export async function logout() {
  await api("/api/logout", { method: "POST", body: "{}" });
}

export async function checkSession() {
  try {
    const { res, data } = await api("/api/data");
    if (res.status === 401) return { auth: false };
    return { auth: true, ...data };
  } catch (err) {
    return { auth: false, offline: true, error: err.message };
  }
}

let retryTimer = null;

export async function loadFromCloud() {
  setBadge("syncing", "Syncing…");
  try {
    const { res, data } = await api("/api/data");
    if (res.status === 401) return { auth: false };
    if (!res.ok) throw new Error(data.error || "Cloud read failed");

    const cloudEmpty = !data.db || data.empty;
    const localHas =
      (store.db.invoices?.length ||
        store.db.products?.length ||
        store.db.customers?.length ||
        store.db.purchases?.length ||
        store.db.suppliers?.length ||
        store.db.payments?.length ||
        store.db.expenses?.length) > 0;

    if (cloudEmpty && localHas) {
      await pushCloud(store.db, { force: true });
      store.loadedRevision = store.db.revision;
      store.loadedUpdatedAt = store.db.updatedAt;
      setBadge("saved", "Saved ✓");
      return { auth: true, uploaded: true };
    }

    if (!cloudEmpty && data.db) {
      const cloud = normalizeDb(data.db);
      const merged = normalizeDb(mergeDb(store.db, cloud));
      const keepPushing = shouldKeepLocal(store.db, cloud) || hasLocalOnlyRows(store.db, cloud);
      store.loadedRevision = merged.revision;
      store.loadedUpdatedAt = merged.updatedAt;
      setDb(merged, { bump: keepPushing, sync: false });
      persistLocal();
      if (keepPushing) {
        await pushCloud(store.db, { force: true });
        setBadge("saved", "Saved ✓");
        return { auth: true, keptLocal: true };
      }
    }

    setBadge("saved", "Saved ✓");
    return { auth: true };
  } catch (err) {
    console.error(err);
    setBadge("offline", "Offline – will retry");
    scheduleRetry();
    return { auth: true, offline: true };
  }
}

export async function pushCloud(db, { force = false } = {}) {
  const info = payloadInfo(db);
  if (info.over) {
    toast("Backup is over the 4.5 MB Vercel limit. Export JSON and archive old data.", { type: "err", timeout: 8000 });
    return false;
  }
  if (info.warn) {
    toast(`Database is ${info.mb} MB (warn at 3 MB). Consider archiving.`, { type: "warn", timeout: 6000 });
  }

  setBadge("syncing", "Syncing…");
  try {
    const { res, data } = await api("/api/data", {
      method: "POST",
      body: JSON.stringify({
        db,
        loadedRevision: store.loadedRevision,
        loadedUpdatedAt: store.loadedUpdatedAt,
        force,
      }),
    });
    if (res.status === 409) {
      store.conflict = data;
      setBadge("conflict", "Merging…");
      await handleConflict(data);
      return true;
    }
    if (res.status === 401) {
      location.reload();
      return false;
    }
    if (!res.ok) throw new Error(data.error || "Save failed");
    if (data.db) {
      const merged = normalizeDb(mergeDb(store.db, data.db));
      store.loadedRevision = merged.revision;
      store.loadedUpdatedAt = merged.updatedAt;
      setDb(merged, { bump: false, sync: false });
    } else {
      store.loadedRevision = db.revision;
      store.loadedUpdatedAt = db.updatedAt;
    }
    setBadge("saved", "Saved ✓");
    return true;
  } catch (err) {
    console.error(err);
    setBadge("offline", "Offline – will retry");
    scheduleRetry();
    return false;
  }
}

function hasLocalOnlyRows(local, cloud) {
  const keys = ["invoices", "purchases", "products", "customers", "suppliers", "payments", "returns", "expenses"];
  for (const key of keys) {
    const cloudIds = new Set((cloud?.[key] || []).map((row) => String(row.id)));
    if ((local?.[key] || []).some((row) => row && row.id != null && !cloudIds.has(String(row.id)))) return true;
  }
  return false;
}

let mergingConflict = false;
async function handleConflict(data) {
  if (mergingConflict) return;
  mergingConflict = true;
  try {
    const cloud = data?.db ? normalizeDb(data.db) : null;
    const merged = normalizeDb(mergeDb(store.db, cloud));
    setDb(merged, { bump: true, sync: false });
    store.conflict = null;
    const ok = await pushCloud(store.db, { force: true });
    if (ok) {
      setBadge("saved", "Saved ✓");
    }
  } finally {
    mergingConflict = false;
  }
}

function scheduleRetry() {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => pushCloud(store.db), 8000);
}

export async function syncHandler() {
  await pushCloud(store.db);
}

export { cloneDb, emptyDb };
