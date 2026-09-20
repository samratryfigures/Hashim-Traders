import { num, round2, inRange, daysInRange, monthKey, WALK_IN, money } from "./utils.js";

export function paidAmount(doc) {
  const method = doc.payment?.method || "cash";
  if (method === "credit") return 0;
  return round2(Math.min(num(doc.payment?.amount), num(doc.total)));
}

export function dueAmount(doc) {
  return round2(num(doc.total) - paidAmount(doc));
}

export function payStatus(doc) {
  const paid = paidAmount(doc);
  const total = num(doc.total);
  if (total <= 0) return paid > 0 ? "paid" : "paid";
  if (paid <= 0) return "unpaid";
  if (paid + 0.009 >= total) return "paid";
  return "partial";
}

export function productStock(db, productId, exclude = {}) {
  const p = (db.products || []).find((x) => String(x.id) === String(productId));
  if (!p) return 0;
  let qty = num(p.openingStock);
  for (const inv of db.invoices || []) {
    if (exclude.invoiceId && inv.id === exclude.invoiceId) continue;
    for (const it of inv.items || []) {
      if (String(it.productId) === String(productId)) qty -= num(it.qty);
    }
  }
  for (const pur of db.purchases || []) {
    if (exclude.purchaseId && pur.id === exclude.purchaseId) continue;
    for (const it of pur.items || []) {
      if (String(it.productId) === String(productId)) qty += num(it.qty);
    }
  }
  for (const ret of db.returns || []) {
    if (exclude.returnId && ret.id === exclude.returnId) continue;
    for (const it of ret.items || []) {
      if (String(it.productId) !== String(productId)) continue;
      if (ret.type === "sale") qty += num(it.qty);
      else qty -= num(it.qty);
    }
  }
  return qty;
}

export function allStocks(db, exclude) {
  const map = {};
  for (const p of db.products || []) map[p.id] = productStock(db, p.id, exclude);
  return map;
}

export function stockValue(db) {
  let value = 0;
  let items = 0;
  for (const p of db.products || []) {
    if (p.archived) continue;
    const s = productStock(db, p.id);
    items += s;
    value += s * num(p.purchasePrice);
  }
  return { items: round2(items), value: round2(value) };
}

export function qtyReturnedOn(db, sourceId, productId, excludeReturnId) {
  let q = 0;
  for (const r of db.returns || []) {
    if (r.sourceId !== sourceId) continue;
    if (excludeReturnId && r.id === excludeReturnId) continue;
    for (const it of r.items || []) {
      if (String(it.productId) === String(productId)) q += num(it.qty);
    }
  }
  return q;
}

export function wouldGoNegative(db, exclude) {
  const issues = [];
  for (const p of db.products || []) {
    const s = productStock(db, p.id, exclude);
    if (s < -0.0001) issues.push({ id: p.id, name: p.name, stock: s });
  }
  return issues;
}

export function partyName(db, type, id) {
  if (!id || id === WALK_IN) return "Walk-in";
  const list = type === "supplier" ? db.suppliers : db.customers;
  return list.find((x) => x.id === id)?.name || "Unknown";
}

function pushEntry(entries, e) {
  entries.push({
    date: e.date,
    type: e.type,
    ref: e.ref || "",
    details: e.details || "",
    debit: round2(e.debit || 0),
    credit: round2(e.credit || 0),
    method: e.method || "",
    source: e.source || null,
    sortKey: e.sortKey || `${e.date}-m`,
  });
}

/** Customer: Debit = they owe us. Supplier: Credit = we owe them. */
export function partyLedger(db, partyType, partyId, range = {}) {
  const entries = [];
  if (!partyId || partyId === WALK_IN) return { entries: [], opening: 0, closing: 0 };

  if (partyType === "customer") {
    for (const inv of db.invoices || []) {
      if (inv.customerId !== partyId) continue;
      pushEntry(entries, {
        date: inv.date,
        type: "Invoice",
        ref: inv.no,
        details: (inv.items || []).map((i) => i.name).join(", "),
        debit: inv.total,
        credit: 0,
        method: inv.payment?.method,
        source: { kind: "invoice", id: inv.id },
        sortKey: `${inv.date}-a-${inv.no}`,
      });
      const paid = paidAmount(inv);
      if (paid > 0 && inv.payment?.method !== "advance") {
        pushEntry(entries, {
          date: inv.date,
          type: "Payment",
          ref: inv.no,
          details: "Paid with invoice",
          debit: 0,
          credit: paid,
          method: inv.payment?.method,
          source: { kind: "invoice", id: inv.id },
          sortKey: `${inv.date}-b-${inv.no}`,
        });
      }
    }
    for (const pay of db.payments || []) {
      if (pay.partyType !== "customer" || pay.partyId !== partyId) continue;
      pushEntry(entries, {
        date: pay.date,
        type: "Payment",
        ref: pay.no || pay.id.slice(0, 8),
        details: pay.note || "Payment received",
        debit: 0,
        credit: pay.amount,
        method: pay.method,
        source: { kind: "payment", id: pay.id },
        sortKey: `${pay.date}-c-${pay.id}`,
      });
    }
    for (const ret of db.returns || []) {
      if (ret.type !== "sale" || ret.partyId !== partyId) continue;
      pushEntry(entries, {
        date: ret.date,
        type: "Return",
        ref: ret.no,
        details: ret.reason || "Sales return",
        debit: 0,
        credit: ret.total,
        method: "",
        source: { kind: "return", id: ret.id },
        sortKey: `${ret.date}-d-${ret.no}`,
      });
      if (ret.settlement === "cash" || ret.settlement === "bank") {
        pushEntry(entries, {
          date: ret.date,
          type: "Refund",
          ref: ret.no,
          details: ret.settlement === "bank" ? "Bank refund" : "Cash refund",
          debit: ret.total,
          credit: 0,
          method: ret.settlement,
          source: { kind: "return", id: ret.id },
          sortKey: `${ret.date}-e-${ret.no}`,
        });
      }
    }
  } else {
    for (const pur of db.purchases || []) {
      if (pur.supplierId !== partyId) continue;
      pushEntry(entries, {
        date: pur.date,
        type: "Invoice",
        ref: pur.no,
        details: (pur.items || []).map((i) => i.name).join(", "),
        debit: 0,
        credit: pur.total,
        method: pur.payment?.method,
        source: { kind: "purchase", id: pur.id },
        sortKey: `${pur.date}-a-${pur.no}`,
      });
      const paid = paidAmount(pur);
      if (paid > 0 && pur.payment?.method !== "advance") {
        pushEntry(entries, {
          date: pur.date,
          type: "Payment",
          ref: pur.no,
          details: "Paid with bill",
          debit: paid,
          credit: 0,
          method: pur.payment?.method,
          source: { kind: "purchase", id: pur.id },
          sortKey: `${pur.date}-b-${pur.no}`,
        });
      }
    }
    for (const pay of db.payments || []) {
      if (pay.partyType !== "supplier" || pay.partyId !== partyId) continue;
      pushEntry(entries, {
        date: pay.date,
        type: "Payment",
        ref: pay.no || pay.id.slice(0, 8),
        details: pay.note || "Payment made",
        debit: pay.amount,
        credit: 0,
        method: pay.method,
        source: { kind: "payment", id: pay.id },
        sortKey: `${pay.date}-c-${pay.id}`,
      });
    }
    for (const ret of db.returns || []) {
      if (ret.type !== "purchase" || ret.partyId !== partyId) continue;
      pushEntry(entries, {
        date: ret.date,
        type: "Return",
        ref: ret.no,
        details: ret.reason || "Purchase return",
        debit: ret.total,
        credit: 0,
        method: "",
        source: { kind: "return", id: ret.id },
        sortKey: `${ret.date}-d-${ret.no}`,
      });
      if (ret.settlement === "cash" || ret.settlement === "bank") {
        pushEntry(entries, {
          date: ret.date,
          type: "Refund",
          ref: ret.no,
          details: ret.settlement === "bank" ? "Bank refund received" : "Cash refund received",
          debit: 0,
          credit: ret.total,
          method: ret.settlement,
          source: { kind: "return", id: ret.id },
          sortKey: `${ret.date}-e-${ret.no}`,
        });
      }
    }
  }

  entries.sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  const { from, to } = range;
  let running = 0;
  let opening = 0;
  const rows = [];
  for (const e of entries) {
    const signed = partyType === "customer" ? e.debit - e.credit : e.credit - e.debit;
    const next = round2(running + signed);
    if (from && e.date < from) {
      running = next;
      opening = running;
      continue;
    }
    if (to && e.date > to) continue;
    e.balance = next;
    running = next;
    rows.push(e);
  }
  if (!from) opening = 0;
  return { entries: rows, opening: round2(opening), closing: round2(running), all: entries };
}

export function partyBalance(db, partyType, partyId) {
  const { closing } = partyLedger(db, partyType, partyId, {});
  return closing;
}

export function advanceBalance(db, partyType, partyId) {
  const bal = partyBalance(db, partyType, partyId);
  if (partyType === "customer") return bal < 0 ? round2(-bal) : 0;
  return bal < 0 ? round2(-bal) : 0;
}

export function balanceLabel(partyType, bal) {
  if (Math.abs(bal) < 0.009) return { text: "Settled", kind: "settled", amount: 0 };
  if (bal < 0) return { text: "Advance " + money(-bal), kind: "advance", amount: -bal };
  if (partyType === "customer") return { text: "Receivable " + money(bal), kind: "recv", amount: bal };
  return { text: "Payable " + money(bal), kind: "pay", amount: bal };
}

export function totalsReceivablePayable(db) {
  let recv = 0;
  let pay = 0;
  for (const c of db.customers || []) {
    if (c.archived) continue;
    const b = partyBalance(db, "customer", c.id);
    if (b > 0) recv += b;
  }
  for (const s of db.suppliers || []) {
    if (s.archived) continue;
    const b = partyBalance(db, "supplier", s.id);
    if (b > 0) pay += b;
  }
  return { receivable: round2(recv), payable: round2(pay) };
}

export function ledgerSummary(db, partyType, partyId) {
  const { all } = partyLedger(db, partyType, partyId, {});
  let billed = 0;
  let paid = 0;
  let returned = 0;
  for (const e of all) {
    if (partyType === "customer") {
      if (e.type === "Invoice") billed += e.debit;
      if (e.type === "Payment") paid += e.credit;
      if (e.type === "Return") returned += e.credit;
    } else {
      if (e.type === "Invoice") billed += e.credit;
      if (e.type === "Payment") paid += e.debit;
      if (e.type === "Return") returned += e.debit;
    }
  }
  const remaining = partyBalance(db, partyType, partyId);
  return { billed: round2(billed), paid: round2(paid), returned: round2(returned), remaining: round2(remaining) };
}

function invoiceCogs(inv) {
  return round2((inv.items || []).reduce((a, it) => a + num(it.qty) * num(it.cost), 0));
}

function returnCogs(db, ret) {
  if (ret.type !== "sale") return 0;
  const src = (db.invoices || []).find((i) => i.id === ret.sourceId);
  let cogs = 0;
  for (const it of ret.items || []) {
    const orig = src?.items?.find((x) => String(x.productId) === String(it.productId));
    const cost = orig ? num(orig.cost) : num(it.cost);
    cogs += num(it.qty) * cost;
  }
  return round2(cogs);
}

export function dashboardStats(db, range) {
  const { from, to } = range || {};
  const invs = (db.invoices || []).filter((x) => inRange(x.date, from, to));
  const purs = (db.purchases || []).filter((x) => inRange(x.date, from, to));
  const exps = (db.expenses || []).filter((x) => inRange(x.date, from, to));
  const rets = (db.returns || []).filter((x) => inRange(x.date, from, to));
  const pays = (db.payments || []).filter((x) => inRange(x.date, from, to));

  const sales = round2(invs.reduce((a, x) => a + num(x.total), 0));
  const purchases = round2(purs.reduce((a, x) => a + num(x.total), 0));
  const expenses = round2(exps.reduce((a, x) => a + num(x.amount), 0));
  const salesReturns = round2(rets.filter((r) => r.type === "sale").reduce((a, x) => a + num(x.total), 0));
  const purchaseReturns = round2(rets.filter((r) => r.type === "purchase").reduce((a, x) => a + num(x.total), 0));

  const cogsSold = round2(invs.reduce((a, x) => a + invoiceCogs(x), 0));
  const cogsRet = round2(rets.filter((r) => r.type === "sale").reduce((a, x) => a + returnCogs(db, x), 0));
  const cogs = round2(cogsSold - cogsRet);
  const gross = round2(sales - salesReturns - cogs);
  const net = round2(gross - expenses);

  let cashIn = 0;
  let bankIn = 0;
  for (const inv of invs) {
    const m = inv.payment?.method;
    const amt = paidAmount(inv);
    if (m === "cash") cashIn += amt;
    if (m === "bank") bankIn += amt;
  }
  for (const pay of pays) {
    if (pay.partyType !== "customer") continue;
    if (pay.method === "cash") cashIn += num(pay.amount);
    if (pay.method === "bank") bankIn += num(pay.amount);
  }
  for (const ret of rets) {
    if (ret.type !== "sale") continue;
    if (ret.settlement === "cash") cashIn -= num(ret.total);
    if (ret.settlement === "bank") bankIn -= num(ret.total);
  }

  const stock = stockValue(db);
  const rp = totalsReceivablePayable(db);

  return {
    sales,
    salesReturns,
    purchases,
    purchaseReturns,
    expenses,
    gross,
    net,
    cogs,
    cashReceived: round2(cashIn),
    bankReceived: round2(bankIn),
    stockItems: stock.items,
    stockValue: stock.value,
    receivable: rp.receivable,
    payable: rp.payable,
  };
}

export function chartSeries(db, range, kind) {
  const { from, to } = range || {};
  const byDay = daysInRange(from, to) <= 31 && from && to;
  const buckets = new Map();

  function add(date, amount) {
    if (!inRange(date, from, to)) return;
    const key = byDay ? String(date).slice(0, 10) : monthKey(date);
    buckets.set(key, (buckets.get(key) || 0) + num(amount));
  }

  if (kind === "sales") {
    for (const inv of db.invoices || []) add(inv.date, inv.total);
    for (const ret of db.returns || []) if (ret.type === "sale") add(ret.date, -num(ret.total));
  } else {
    for (const e of db.expenses || []) add(e.date, e.amount);
  }

  if (from && to && byDay) {
    const labels = [];
    const values = [];
    const start = new Date(from + "T00:00:00");
    const end = new Date(to + "T00:00:00");
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      labels.push(local);
      values.push(round2(buckets.get(local) || 0));
    }
    return { labels, values, mode: "day" };
  }

  if (from && to && !byDay) {
    const labels = [];
    const values = [];
    const s = new Date(from + "T00:00:00");
    const e = new Date(to + "T00:00:00");
    const cur = new Date(s.getFullYear(), s.getMonth(), 1);
    const last = new Date(e.getFullYear(), e.getMonth(), 1);
    while (cur <= last) {
      const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}`;
      labels.push(key);
      values.push(round2(buckets.get(key) || 0));
      cur.setMonth(cur.getMonth() + 1);
    }
    return { labels, values, mode: "month" };
  }

  const labels = [...buckets.keys()].sort();
  return { labels, values: labels.map((k) => round2(buckets.get(k))), mode: byDay ? "day" : "month" };
}

export function partyHasTransactions(db, type, id) {
  if (type === "customer") {
    if ((db.invoices || []).some((i) => i.customerId === id)) return true;
    if ((db.payments || []).some((p) => p.partyType === "customer" && p.partyId === id)) return true;
    if ((db.returns || []).some((r) => r.type === "sale" && r.partyId === id)) return true;
  } else {
    if ((db.purchases || []).some((i) => i.supplierId === id)) return true;
    if ((db.payments || []).some((p) => p.partyType === "supplier" && p.partyId === id)) return true;
    if ((db.returns || []).some((r) => r.type === "purchase" && r.partyId === id)) return true;
  }
  return false;
}

export function productHasTransactions(db, id) {
  const hit = (items) => (items || []).some((it) => String(it.productId) === String(id));
  if ((db.invoices || []).some((i) => hit(i.items))) return true;
  if ((db.purchases || []).some((i) => hit(i.items))) return true;
  if ((db.returns || []).some((i) => hit(i.items))) return true;
  return false;
}

export function validateInvoiceItems(items) {
  if (!items || !items.length) return "Add at least one product";
  for (const it of items) {
    if (!it.productId) return "Select a product on every row";
    if (num(it.qty) <= 0) return "Quantity must be greater than 0";
    if (num(it.rate) < 0) return "Rate cannot be negative";
  }
  return null;
}

export function totalsFromItems(items, discount) {
  const subtotal = round2((items || []).reduce((a, it) => a + num(it.qty) * num(it.rate), 0));
  const disc = Math.min(subtotal, Math.max(0, num(discount)));
  const total = round2(subtotal - disc);
  return { subtotal, discount: disc, total };
}
