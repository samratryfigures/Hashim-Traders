import { money, escapeHtml, WALK_IN } from "./utils.js";
import { paidAmount, dueAmount, partyBalance, partyName, partyLedger, ledgerSummary, payStatus } from "./compute.js";
import { store } from "./store.js";

function biz() {
  return store.db.settings || {};
}

function partyBlock(type, id) {
  if (!id || id === WALK_IN) return `<div>Walk-in customer</div>`;
  const list = type === "supplier" ? store.db.suppliers : store.db.customers;
  const p = list.find((x) => x.id === id);
  if (!p) return "";
  return `<div><strong>${escapeHtml(p.name)}</strong><br>${escapeHtml(p.phone || "")}<br>${escapeHtml(p.address || "")}</div>`;
}

export function invoiceHtml(doc, { kind = "sale", thermal = false } = {}) {
  const s = biz();
  const isSale = kind === "sale";
  const title = isSale ? "INVOICE" : "PURCHASE BILL";
  const party = isSale ? partyBlock("customer", doc.customerId) : partyBlock("supplier", doc.supplierId);
  const paid = paidAmount(doc);
  const due = dueAmount(doc);
  const prev = isSale && doc.customerId && doc.customerId !== WALK_IN ? partyBalance(store.db, "customer", doc.customerId) : null;
  const items = (doc.items || [])
    .map(
      (it, i) =>
        `<tr><td>${i + 1}</td><td>${escapeHtml(it.name)}</td><td>${it.qty} ${escapeHtml(it.unit || "")}</td><td>${money(it.rate)}</td><td>${money(it.lineTotal ?? it.qty * it.rate)}</td></tr>`
    )
    .join("");
  const method = (doc.payment?.method || "").toUpperCase();
  return `
    <div class="print-sheet ${thermal ? "thermal" : "a4"}">
      <header class="print-head">
        <div>
          <h1>${escapeHtml(s.businessName || "HASHMI TRADERS")}</h1>
          <p>${escapeHtml(s.address || "")}</p>
          <p>${escapeHtml(s.phone || "")}</p>
        </div>
        <div class="print-meta">
          <h2>${title}</h2>
          <p><strong>${escapeHtml(doc.no)}</strong></p>
          <p>Date: ${escapeHtml(doc.date)}</p>
          <p>Status: ${payStatus(doc)}</p>
        </div>
      </header>
      <div class="print-party">${party}</div>
      <table class="print-items">
        <thead><tr><th>Sr</th><th>Product</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead>
        <tbody>${items}</tbody>
      </table>
      <div class="print-totals">
        <p>Subtotal: ${money(doc.subtotal)}</p>
        <p>Discount: ${money(doc.discount)}</p>
        <p><strong>Total: ${money(doc.total)}</strong></p>
        <p>Paid (${escapeHtml(method)}): ${money(paid)}</p>
        <p>Balance due: ${money(due)}</p>
        ${prev != null ? `<p>Total outstanding: ${money(prev)}</p>` : ""}
      </div>
      <div class="print-sign">
        <div>Received by</div>
        <div>For HASHMI TRADERS</div>
      </div>
      <p class="print-foot">${escapeHtml(s.invoiceFooter || "")}</p>
    </div>`;
}

export function creditNoteHtml(ret) {
  const s = biz();
  const isSale = ret.type === "sale";
  const items = (ret.items || [])
    .map(
      (it, i) =>
        `<tr><td>${i + 1}</td><td>${escapeHtml(it.name)}</td><td>${it.qty} ${escapeHtml(it.unit || "")}</td><td>${money(it.rate)}</td><td>${money(it.lineTotal)}</td></tr>`
    )
    .join("");
  return `
    <div class="print-sheet a4">
      <header class="print-head">
        <div>
          <h1>${escapeHtml(s.businessName || "HASHMI TRADERS")}</h1>
          <p>${escapeHtml(s.address || "")}</p>
          <p>${escapeHtml(s.phone || "")}</p>
        </div>
        <div class="print-meta">
          <h2>CREDIT NOTE</h2>
          <p><strong>${escapeHtml(ret.no)}</strong></p>
          <p>Date: ${escapeHtml(ret.date)}</p>
          <p>${isSale ? "Sales" : "Purchase"} return</p>
        </div>
      </header>
      <p>Party: ${escapeHtml(partyName(store.db, isSale ? "customer" : "supplier", ret.partyId))}</p>
      <p>Against: ${escapeHtml(ret.sourceNo || ret.sourceId)}</p>
      <p>Reason: ${escapeHtml(ret.reason || "—")}</p>
      <p>Settlement: ${escapeHtml(ret.settlement)}</p>
      <table class="print-items">
        <thead><tr><th>Sr</th><th>Product</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead>
        <tbody>${items}</tbody>
      </table>
      <p><strong>Total: ${money(ret.total)}</strong></p>
      <p class="print-foot">${escapeHtml(s.invoiceFooter || "")}</p>
    </div>`;
}

export function statementHtml(partyType, partyId, range) {
  const s = biz();
  const name = partyName(store.db, partyType, partyId);
  const { entries, opening, closing } = partyLedger(store.db, partyType, partyId, range);
  const sum = ledgerSummary(store.db, partyType, partyId);
  const rows = entries
    .map(
      (e) =>
        `<tr><td>${e.date}</td><td>${e.type}</td><td>${escapeHtml(e.ref)}</td><td>${escapeHtml(e.details)}</td><td>${e.debit ? money(e.debit) : ""}</td><td>${e.credit ? money(e.credit) : ""}</td><td>${money(e.balance)}</td><td>${escapeHtml(e.method)}</td></tr>`
    )
    .join("");
  return `
    <div class="print-sheet a4">
      <header class="print-head">
        <div>
          <h1>${escapeHtml(s.businessName || "HASHMI TRADERS")}</h1>
          <p>${partyType === "customer" ? "Customer" : "Supplier"} Khata</p>
        </div>
        <div>
          <h2>${escapeHtml(name)}</h2>
          <p>${range?.from || "Start"} → ${range?.to || "Today"}</p>
        </div>
      </header>
      <p>Opening: ${money(opening)} · Closing: ${money(closing)}</p>
      <p>Billed ${money(sum.billed)} · Paid ${money(sum.paid)} · Returned ${money(sum.returned)}</p>
      <table class="print-items">
        <thead><tr><th>Date</th><th>Type</th><th>Ref</th><th>Details</th><th>Debit</th><th>Credit</th><th>Balance</th><th>Method</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="8">No entries</td></tr>`}</tbody>
      </table>
    </div>`;
}

export function printHtml(html) {
  const host = document.getElementById("print-root");
  host.innerHTML = html;
  document.body.classList.add("printing");
  window.print();
  setTimeout(() => {
    document.body.classList.remove("printing");
  }, 300);
}
