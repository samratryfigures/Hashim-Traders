/** HASHMI TRADERS — shared helpers (en-PK, local dates). */

export const LOCAL_KEY_V1 = "hashmi_traders_v1";
export const LOCAL_KEY_V2 = "hashmi_traders_v2";
export const WALK_IN = "walk-in";
export const PAYLOAD_WARN = 3 * 1024 * 1024;
export const PAYLOAD_LIMIT = 4.5 * 1024 * 1024;

export const UNITS = ["lari", "kg", "packets", "gucheh", "pcs"];

export function unitLabel(u) {
  return UNITS.includes(u) ? u : "pcs";
}

export function unitOptions(selected) {
  const cur = unitLabel(selected);
  return UNITS.map((u) => `<option value="${u}" ${u === cur ? "selected" : ""}>${u}</option>`).join("");
}

export function localToday(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseDate(iso) {
  if (!iso) return new Date();
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function money(n) {
  const v = Number(n) || 0;
  return "Rs " + v.toLocaleString("en-PK", { maximumFractionDigits: 2 });
}

export function num(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

export function round2(n) {
  return Math.round((num(n) + Number.EPSILON) * 100) / 100;
}

export function uid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "id-" + Date.now().toString(36) + "-" + Math.random().toString(16).slice(2);
}

export function nextNo(prefix, numbers) {
  let max = 0;
  for (const n of numbers) {
    const m = String(n || "").match(/(\d+)\s*$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return prefix + String(max + 1).padStart(4, "0");
}

export function padNo(prefix, n) {
  return prefix + String(n).padStart(4, "0");
}

export function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function shouldKeepLocal(local, cloud) {
  const lr = Number(local?.revision) || 0;
  const cr = Number(cloud?.revision) || 0;
  if (lr > cr) return true;
  if (cr > lr) return false;
  const lt = Date.parse(local?.updatedAt || 0) || 0;
  const ct = Date.parse(cloud?.updatedAt || 0) || 0;
  return lt > ct;
}

function mergeList(local, cloud) {
  const map = new Map();
  for (const row of cloud || []) {
    if (row && row.id != null) map.set(String(row.id), row);
  }
  for (const row of local || []) {
    if (row && row.id != null) map.set(String(row.id), row);
  }
  return [...map.values()];
}

/** Local rows win on the same id so a new sale is never dropped by an older cloud copy. */
export function mergeDb(local, cloud) {
  if (!cloud) return local;
  if (!local) return cloud;
  const localTime = Date.parse(local.updatedAt || 0) || 0;
  const cloudTime = Date.parse(cloud.updatedAt || 0) || 0;
  return {
    ...cloud,
    ...local,
    products: mergeList(local.products, cloud.products),
    invoices: mergeList(local.invoices, cloud.invoices),
    purchases: mergeList(local.purchases, cloud.purchases),
    customers: mergeList(local.customers, cloud.customers),
    suppliers: mergeList(local.suppliers, cloud.suppliers),
    payments: mergeList(local.payments, cloud.payments),
    returns: mergeList(local.returns, cloud.returns),
    expenses: mergeList(local.expenses, cloud.expenses),
    settings:
      (local.invoices?.length || local.products?.length || local.purchases?.length
        ? local.settings
        : cloud.settings) ||
      local.settings ||
      cloud.settings,
    version: 2,
    revision: Math.max(Number(local.revision) || 0, Number(cloud.revision) || 0),
    updatedAt: localTime >= cloudTime ? local.updatedAt : cloud.updatedAt,
  };
}

export function debounce(fn, ms) {
  let t;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(t);
  wrapped.flush = (...args) => {
    clearTimeout(t);
    fn(...args);
  };
  return wrapped;
}

export function startOfWeek(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = x.getDay();
  const diff = day === 0 ? 6 : day - 1;
  x.setDate(x.getDate() - diff);
  return x;
}

export function addDays(d, n) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}

export function monthKey(iso) {
  return String(iso).slice(0, 7);
}

export function inRange(iso, from, to) {
  if (!from && !to) return true;
  const d = String(iso || "").slice(0, 10);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

export function rangeForPreset(preset, customFrom, customTo) {
  const today = parseDate(localToday());
  if (preset === "all") return { from: null, to: null };
  if (preset === "custom") return { from: customFrom || null, to: customTo || null };
  if (preset === "today") return { from: localToday(today), to: localToday(today) };
  if (preset === "yesterday") {
    const y = addDays(today, -1);
    return { from: localToday(y), to: localToday(y) };
  }
  if (preset === "week") {
    const s = startOfWeek(today);
    return { from: localToday(s), to: localToday(today) };
  }
  if (preset === "month") {
    const s = new Date(today.getFullYear(), today.getMonth(), 1);
    return { from: localToday(s), to: localToday(today) };
  }
  if (preset === "lastMonth") {
    const s = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const e = new Date(today.getFullYear(), today.getMonth(), 0);
    return { from: localToday(s), to: localToday(e) };
  }
  if (preset === "year") {
    const s = new Date(today.getFullYear(), 0, 1);
    return { from: localToday(s), to: localToday(today) };
  }
  return { from: null, to: null };
}

export function daysInRange(from, to) {
  if (!from || !to) return 999;
  const a = parseDate(from);
  const b = parseDate(to);
  return Math.round((b - a) / 86400000) + 1;
}

export function byteSize(obj) {
  return new TextEncoder().encode(JSON.stringify(obj)).length;
}

export function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function normName(s) {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
}
