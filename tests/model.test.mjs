import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { migrateV1 } from "../js/migrate.js";
import {
  productStock,
  dashboardStats,
  paidAmount,
  dueAmount,
  payStatus,
  partyBalance,
  advanceBalance,
  wouldGoNegative,
  qtyReturnedOn,
  chartSeries,
} from "../js/compute.js";
import { rangeForPreset, localToday, round2 } from "../js/utils.js";

function v1Sample() {
  return {
    products: [
      { id: 1, name: "Cement", code: "C1", cat: "Build", purchase: 100, sale: 140, stock: 8 },
      { id: 2, name: "Paint", code: "P1", cat: "Finish", purchase: 50, sale: 80, stock: 3 },
    ],
    sales: [
      { date: "2026-09-01", pid: 1, name: "Cement", qty: 2, total: 280, customer: "Ali" },
      { date: "2026-09-02", pid: 2, name: "Paint", qty: 1, total: 80, customer: "Ali" },
    ],
    purchases: [{ date: "2026-08-20", pid: 1, name: "Cement", qty: 10, total: 1000, supplier: "Lucky" }],
    expenses: [{ date: "2026-09-01", name: "Rent", amount: 500, note: "" }],
    customers: [{ name: "Ali", phone: "0300", address: "Khushab" }],
    suppliers: [{ name: "Lucky", phone: "0321", address: "Lahore" }],
  };
}

describe("phase 1 migration", () => {
  it("keeps identical computed stock vs old stock", () => {
    const old = v1Sample();
    const db = migrateV1(old);
    assert.equal(db.invoices.length, 2);
    assert.equal(db.invoices[0].no, "INV-0001");
    assert.equal(db.invoices[0].items.length, 1);
    assert.equal(db.purchases[0].no, "PUR-0001");
    const ali = db.customers.find((c) => c.name === "Ali");
    assert.ok(ali);
    assert.equal(db.invoices[0].customerId, ali.id);
    assert.equal(productStock(db, String(1)), 8);
    assert.equal(productStock(db, String(2)), 3);
    const salesTotal = db.invoices.reduce((a, x) => a + x.total, 0);
    assert.equal(salesTotal, 360);
  });

  it("uses local date helper not UTC ISO", () => {
    const d = new Date(2026, 8, 20, 1, 0, 0);
    assert.equal(localToday(d), "2026-09-20");
  });
});

function freshDb() {
  const db = migrateV1({ products: [], sales: [], purchases: [], expenses: [], customers: [], suppliers: [] });
  db.products = [
    { id: "a", name: "A", code: "A", category: "", purchasePrice: 10, salePrice: 20, openingStock: 100, archived: false },
    { id: "b", name: "B", code: "B", category: "", purchasePrice: 5, salePrice: 9, openingStock: 100, archived: false },
    { id: "c", name: "C", code: "C", category: "", purchasePrice: 8, salePrice: 15, openingStock: 100, archived: false },
  ];
  db.customers = [{ id: "cust1", name: "Sara", phone: "1", address: "", archived: false }];
  db.suppliers = [{ id: "sup1", name: "Depot", phone: "2", address: "", archived: false }];
  db.invoices = [];
  db.purchases = [];
  db.payments = [];
  db.returns = [];
  db.expenses = [];
  return db;
}

describe("invoice with 3 products, discount, partial bank", () => {
  it("totals, khata, stock", () => {
    const db = freshDb();
    const inv = {
      id: "inv1",
      no: "INV-0001",
      date: "2026-09-20",
      customerId: "cust1",
      items: [
        { productId: "a", name: "A", qty: 2, rate: 20, cost: 10, lineTotal: 40 },
        { productId: "b", name: "B", qty: 3, rate: 9, cost: 5, lineTotal: 27 },
        { productId: "c", name: "C", qty: 1, rate: 15, cost: 8, lineTotal: 15 },
      ],
      discount: 7,
      subtotal: 82,
      total: 75,
      payment: { method: "bank", amount: 40, bankName: "HBL", reference: "TRX1" },
    };
    db.invoices.push(inv);
    assert.equal(paidAmount(inv), 40);
    assert.equal(dueAmount(inv), 35);
    assert.equal(payStatus(inv), "partial");
    assert.equal(productStock(db, "a"), 98);
    assert.equal(productStock(db, "b"), 97);
    assert.equal(productStock(db, "c"), 99);
    assert.equal(partyBalance(db, "customer", "cust1"), 35);
    const stats = dashboardStats(db, { from: "2026-09-20", to: "2026-09-20" });
    assert.equal(stats.sales, 75);
    assert.equal(stats.bankReceived, 40);
    assert.equal(stats.cogs, 2 * 10 + 3 * 5 + 8);
    assert.equal(stats.gross, 75 - 0 - stats.cogs);
  });
});

describe("edit and delete invoice", () => {
  it("recalculates stock and balance", () => {
    const db = freshDb();
    db.invoices.push({
      id: "inv1",
      no: "INV-0001",
      date: "2026-09-20",
      customerId: "cust1",
      items: [{ productId: "a", name: "A", qty: 2, rate: 20, cost: 10, lineTotal: 40 }],
      discount: 0,
      subtotal: 40,
      total: 40,
      payment: { method: "credit", amount: 0 },
    });
    assert.equal(productStock(db, "a"), 98);
    db.invoices[0].items[0].qty = 5;
    db.invoices[0].items[0].rate = 22;
    db.invoices[0].items[0].lineTotal = 110;
    db.invoices[0].subtotal = 110;
    db.invoices[0].total = 110;
    assert.equal(productStock(db, "a"), 95);
    assert.equal(partyBalance(db, "customer", "cust1"), 110);
    db.invoices = [];
    assert.equal(productStock(db, "a"), 100);
    assert.equal(partyBalance(db, "customer", "cust1"), 0);
  });
});

describe("sales return cash refund", () => {
  it("stock up, sales down, ledger nets with refund", () => {
    const db = freshDb();
    db.invoices.push({
      id: "inv1",
      no: "INV-0001",
      date: "2026-09-20",
      customerId: "cust1",
      items: [{ productId: "a", name: "A", qty: 4, rate: 20, cost: 10, lineTotal: 80 }],
      discount: 0,
      subtotal: 80,
      total: 80,
      payment: { method: "cash", amount: 80 },
    });
    db.returns.push({
      id: "r1",
      no: "SR-0001",
      date: "2026-09-21",
      type: "sale",
      partyId: "cust1",
      sourceId: "inv1",
      items: [{ productId: "a", name: "A", qty: 1, rate: 20, lineTotal: 20 }],
      settlement: "cash",
      total: 20,
    });
    assert.equal(productStock(db, "a"), 97);
    assert.equal(qtyReturnedOn(db, "inv1", "a"), 1);
    const stats = dashboardStats(db, { from: "2026-09-20", to: "2026-09-21" });
    assert.equal(stats.sales, 80);
    assert.equal(stats.salesReturns, 20);
    assert.equal(partyBalance(db, "customer", "cust1"), 0);
  });
});

describe("advance then invoice paid with advance", () => {
  it("cannot exceed advance; remaining is correct", () => {
    const db = freshDb();
    db.payments.push({
      id: "p1",
      no: "PAY-0001",
      date: "2026-09-19",
      partyType: "customer",
      partyId: "cust1",
      amount: 500,
      method: "cash",
    });
    assert.equal(advanceBalance(db, "customer", "cust1"), 500);
    db.invoices.push({
      id: "inv1",
      no: "INV-0001",
      date: "2026-09-20",
      customerId: "cust1",
      items: [{ productId: "a", name: "A", qty: 10, rate: 20, cost: 10, lineTotal: 200 }],
      discount: 0,
      subtotal: 200,
      total: 200,
      payment: { method: "advance", amount: 200 },
    });
    assert.equal(partyBalance(db, "customer", "cust1"), -300);
    assert.equal(advanceBalance(db, "customer", "cust1"), 300);
    assert.equal(payStatus(db.invoices[0]), "paid");
  });
});

describe("dashboard filters", () => {
  it("today / this month / custom change cards", () => {
    const db = freshDb();
    db.invoices.push({
      id: "1",
      no: "INV-0001",
      date: localToday(),
      customerId: "walk-in",
      items: [{ productId: "a", name: "A", qty: 1, rate: 20, cost: 10, lineTotal: 20 }],
      discount: 0,
      subtotal: 20,
      total: 20,
      payment: { method: "cash", amount: 20 },
    });
    db.invoices.push({
      id: "2",
      no: "INV-0002",
      date: "2026-01-15",
      customerId: "walk-in",
      items: [{ productId: "a", name: "A", qty: 1, rate: 50, cost: 10, lineTotal: 50 }],
      discount: 0,
      subtotal: 50,
      total: 50,
      payment: { method: "cash", amount: 50 },
    });
    const today = rangeForPreset("today");
    const all = rangeForPreset("all");
    assert.equal(dashboardStats(db, today).sales, 20);
    assert.equal(dashboardStats(db, all).sales, 70);
    const custom = dashboardStats(db, { from: "2026-01-01", to: "2026-01-31" });
    assert.equal(custom.sales, 50);
    const series = chartSeries(db, { from: "2026-01-01", to: "2026-01-31" }, "sales");
    assert.equal(series.mode, "day");
    assert.ok(series.labels.length >= 28);
  });
});

describe("purchases and supplier khata", () => {
  it("mirrors customer behaviour", () => {
    const db = freshDb();
    db.purchases.push({
      id: "pu1",
      no: "PUR-0001",
      date: "2026-09-20",
      supplierId: "sup1",
      items: [{ productId: "a", name: "A", qty: 10, rate: 10, cost: 10, lineTotal: 100 }],
      discount: 0,
      subtotal: 100,
      total: 100,
      payment: { method: "credit", amount: 0 },
    });
    assert.equal(productStock(db, "a"), 110);
    assert.equal(partyBalance(db, "supplier", "sup1"), 100);
    db.payments.push({
      id: "p2",
      date: "2026-09-21",
      partyType: "supplier",
      partyId: "sup1",
      amount: 40,
      method: "cash",
    });
    assert.equal(partyBalance(db, "supplier", "sup1"), 60);
    const neg = wouldGoNegative({
      ...db,
      purchases: [],
    });
    // removing purchase of 10 while 0 sold from that extra: stock 100 opening, would be 100, ok
    assert.equal(neg.length, 0);
  });
});
