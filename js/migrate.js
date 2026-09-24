import { uid, num, round2, padNo, normName, WALK_IN, localToday } from "./utils.js";

export function emptyDb() {
  return {
    version: 2,
    revision: 0,
    updatedAt: null,
    products: [],
    invoices: [],
    purchases: [],
    expenses: [],
    customers: [],
    suppliers: [],
    payments: [],
    returns: [],
    settings: {
      businessName: "HASHMI TRADERS",
      phone: "",
      address: "",
      invoiceFooter: "Thank you for your business.",
    },
  };
}

export function cloneDb(db) {
  return JSON.parse(JSON.stringify(db));
}

export function isV1(data) {
  if (!data || typeof data !== "object") return false;
  if (data.version === 2 || Array.isArray(data.invoices)) return false;
  return Array.isArray(data.products) || Array.isArray(data.sales);
}

export function isV2(data) {
  return !!(data && data.version === 2 && Array.isArray(data.invoices));
}

/**
 * Convert v1 localStorage (or exported JSON) to v2.
 * openingStock is chosen so computed stock equals the old stored stock:
 *   opening = oldStock − purchases + sales
 */
export function migrateV1(old) {
  const db = emptyDb();
  const src = old && typeof old === "object" ? old : {};

  const nameToCustomer = new Map();
  const nameToSupplier = new Map();

  function ensureCustomer(name) {
    const n = String(name || "").trim();
    if (!n) return WALK_IN;
    const key = normName(n);
    if (nameToCustomer.has(key)) return nameToCustomer.get(key);
    const rec = {
      id: uid(),
      name: n,
      phone: "",
      address: "",
      archived: false,
    };
    db.customers.push(rec);
    nameToCustomer.set(key, rec.id);
    return rec.id;
  }

  function ensureSupplier(name) {
    const n = String(name || "").trim();
    if (!n) return null;
    const key = normName(n);
    if (nameToSupplier.has(key)) return nameToSupplier.get(key);
    const rec = {
      id: uid(),
      name: n,
      phone: "",
      address: "",
      archived: false,
    };
    db.suppliers.push(rec);
    nameToSupplier.set(key, rec.id);
    return rec.id;
  }

  for (const c of src.customers || []) {
    const n = String(c.name || "").trim();
    if (!n) continue;
    const rec = {
      id: c.id || uid(),
      name: n,
      phone: c.phone || "",
      address: c.address || "",
      archived: !!c.archived,
    };
    db.customers.push(rec);
    nameToCustomer.set(normName(n), rec.id);
  }

  for (const s of src.suppliers || []) {
    const n = String(s.name || "").trim();
    if (!n) continue;
    const rec = {
      id: s.id || uid(),
      name: n,
      phone: s.phone || "",
      address: s.address || "",
      archived: !!s.archived,
    };
    db.suppliers.push(rec);
    nameToSupplier.set(normName(n), rec.id);
  }

  const saleQtyByPid = new Map();
  const purchQtyByPid = new Map();
  for (const s of src.sales || []) {
    const pid = s.pid ?? s.productId;
    saleQtyByPid.set(pid, (saleQtyByPid.get(pid) || 0) + num(s.qty));
  }
  for (const p of src.purchases || []) {
    const pid = p.pid ?? p.productId;
    purchQtyByPid.set(pid, (purchQtyByPid.get(pid) || 0) + num(p.qty));
  }

  const idMap = new Map();
  for (const p of src.products || []) {
    const oldId = p.id;
    const newId = String(oldId ?? uid());
    idMap.set(oldId, newId);
    const oldStock = num(p.stock);
    const sold = saleQtyByPid.get(oldId) || 0;
    const bought = purchQtyByPid.get(oldId) || 0;
    const openingStock = oldStock - bought + sold;
    db.products.push({
      id: newId,
      name: p.name || "Item",
      code: p.code || "",
      category: p.cat || p.category || "",
      purchasePrice: num(p.purchase ?? p.purchasePrice),
      salePrice: num(p.sale ?? p.salePrice),
      openingStock,
      unit: p.unit || "packets",
      archived: !!p.archived,
    });
  }

  let invSeq = 0;
  for (const s of src.sales || []) {
    invSeq += 1;
    const pid = idMap.get(s.pid) || String(s.pid || uid());
    const prod = db.products.find((x) => x.id === pid);
    const qty = num(s.qty);
    const total = round2(num(s.total));
    const rate = qty ? round2(total / qty) : num(s.price ?? s.rate);
    const cost = prod ? num(prod.purchasePrice) : 0;
    const customerId = ensureCustomer(s.customer);
    db.invoices.push({
      id: uid(),
      no: padNo("INV-", invSeq),
      date: (s.date || localToday()).slice(0, 10),
      customerId,
      items: [
        {
          productId: pid,
          name: s.name || prod?.name || "Item",
          qty,
          rate,
          cost,
          lineTotal: total,
        },
      ],
      discount: 0,
      subtotal: total,
      total,
      payment: { method: "cash", amount: total, bankName: "", reference: "" },
      note: "",
      createdAt: s.date || localToday(),
    });
  }

  let purSeq = 0;
  for (const p of src.purchases || []) {
    purSeq += 1;
    const pid = idMap.get(p.pid) || String(p.pid || uid());
    const prod = db.products.find((x) => x.id === pid);
    const qty = num(p.qty);
    const total = round2(num(p.total));
    const rate = qty ? round2(total / qty) : num(p.price ?? p.rate);
    const supplierId = ensureSupplier(p.supplier);
    db.purchases.push({
      id: uid(),
      no: padNo("PUR-", purSeq),
      date: (p.date || localToday()).slice(0, 10),
      supplierId,
      items: [
        {
          productId: pid,
          name: p.name || prod?.name || "Item",
          qty,
          rate,
          cost: rate,
          lineTotal: total,
        },
      ],
      discount: 0,
      subtotal: total,
      total,
      payment: { method: "cash", amount: total, bankName: "", reference: "" },
      note: "",
      createdAt: p.date || localToday(),
    });
  }

  for (const e of src.expenses || []) {
    db.expenses.push({
      id: e.id || uid(),
      date: (e.date || localToday()).slice(0, 10),
      name: e.name || "Expense",
      amount: num(e.amount),
      note: e.note || "",
      method: e.method || "cash",
    });
  }

  if (src.settings) {
    db.settings = { ...db.settings, ...src.settings };
  }

  db.revision = 1;
  db.updatedAt = new Date().toISOString();
  return db;
}

export function normalizeDb(raw) {
  if (!raw) return emptyDb();
  if (isV1(raw)) return migrateV1(raw);
  if (!isV2(raw)) {
    if (raw.products && raw.sales) return migrateV1(raw);
    return emptyDb();
  }
  const db = emptyDb();
  Object.assign(db, raw);
  db.version = 2;
  db.products = raw.products || [];
  db.invoices = raw.invoices || [];
  db.purchases = raw.purchases || [];
  db.expenses = raw.expenses || [];
  db.customers = raw.customers || [];
  db.suppliers = raw.suppliers || [];
  db.payments = raw.payments || [];
  db.returns = raw.returns || [];
  db.settings = { ...emptyDb().settings, ...(raw.settings || {}) };
  db.revision = num(raw.revision);
  db.updatedAt = raw.updatedAt || null;
  return db;
}

export function importBackup(json) {
  const data = typeof json === "string" ? JSON.parse(json) : json;
  if (data && data.db) return normalizeDb(data.db);
  return normalizeDb(data);
}
