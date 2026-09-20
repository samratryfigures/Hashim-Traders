import { store, persistLocal, setDb, payloadInfo } from "./store.js";
import { emptyDb, cloneDb, normalizeDb } from "./migrate.js";
import { toast, confirmDialog } from "./ui.js";

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
    const localHas = (store.db.invoices?.length || store.db.products?.length || store.db.customers?.length) > 0;

    if (cloudEmpty && localHas) {
      const upload = await confirmDialog({
        title: "Upload local data?",
        message: "The Google Sheet is empty and this device has records. Upload them to the cloud?",
        ok: "Upload",
        danger: false,
      });
      if (upload) {
        await pushCloud(store.db, { force: true });
        store.loadedRevision = store.db.revision;
        store.loadedUpdatedAt = store.db.updatedAt;
        setBadge("saved", "Saved ✓");
        return { auth: true, uploaded: true };
      }
    }

    if (!cloudEmpty && data.db) {
      const cloud = normalizeDb(data.db);
      store.loadedRevision = cloud.revision;
      store.loadedUpdatedAt = cloud.updatedAt;
      setDb(cloud, { bump: false });
      persistLocal();
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
      setBadge("conflict", "Conflict");
      await handleConflict(data);
      return false;
    }
    if (res.status === 401) {
      location.reload();
      return false;
    }
    if (!res.ok) throw new Error(data.error || "Save failed");
    if (data.db) {
      store.loadedRevision = data.db.revision;
      store.loadedUpdatedAt = data.db.updatedAt;
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

async function handleConflict(data) {
  const wrapChoice = await confirmDialog({
    title: "Cloud data is newer",
    message: "Another device saved after this page loaded. Reload cloud data (discard local unsynced edits) or overwrite the cloud with this device?",
    ok: "Reload cloud",
    danger: false,
  });
  if (wrapChoice) {
    if (data.db) setDb(normalizeDb(data.db), { bump: false });
    else await loadFromCloud();
    store.conflict = null;
    setBadge("saved", "Saved ✓");
    toast("Loaded latest cloud data", { type: "ok" });
    return;
  }
  const overwrite = await confirmDialog({
    title: "Overwrite cloud?",
    message: "This device will replace the Google Sheet. Do this only if you are sure this copy is correct.",
    ok: "Overwrite cloud",
    danger: true,
  });
  if (overwrite) {
    await pushCloud(store.db, { force: true });
    store.conflict = null;
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
