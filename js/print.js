import { money, escapeHtml, WALK_IN } from "./utils.js";
import { paidAmount, dueAmount, partyBalance, partyName, partyLedger, ledgerSummary, payStatus, qtyReturnedOn } from "./compute.js";
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
        `<tr><td>${i + 1}</td><td>${escapeHtml(it.name)}</td><td>${escapeHtml(it.category || "")}</td><td>${it.qty}</td><td>${escapeHtml(it.unit || "pcs")}</td><td>${money(it.rate)}</td><td>${money(it.lineTotal ?? it.qty * it.rate)}</td></tr>`
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
        <thead><tr><th>Sr</th><th>Product</th><th>Category</th><th>Qty</th><th>Unit</th><th>Price</th><th>Total</th></tr></thead>
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

export function invoiceDetailHtml(doc, { kind = "sale" } = {}) {
  const isSale = kind === "sale";
  const partyType = isSale ? "customer" : "supplier";
  const partyId = isSale ? doc.customerId : doc.supplierId;
  const paid = paidAmount(doc);
  const due = dueAmount(doc);
  const status = payStatus(doc);
  const pay = doc.payment || {};
  const partyList = isSale ? store.db.customers : store.db.suppliers;
  const party = partyId && partyId !== WALK_IN ? partyList.find((x) => x.id === partyId) : null;
  const partyTitle = isSale ? "Customer" : "Supplier";
  const lines = (doc.items || [])
    .map((it, i) => {
      const retq = qtyReturnedOn(store.db, doc.id, it.productId);
      return `<tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(it.name)}</td>
        <td>${escapeHtml(it.category || "—")}</td>
        <td>${it.qty}</td>
        <td>${escapeHtml(it.unit || "pcs")}</td>
        <td>${money(it.rate)}</td>
        <td>${money(it.cost)}</td>
        <td>${money(it.lineTotal ?? numSafe(it.qty) * numSafe(it.rate))}</td>
        <td>${retq ? retq : "—"}</td>
      </tr>`;
    })
    .join("");
  const rets = (store.db.returns || []).filter((r) => r.sourceId === doc.id);
  const retBlock = rets.length
    ? `<h4>Returns against this bill</h4>
      <ul class="inv-ret-list">${rets
        .map(
          (r) =>
            `<li>${escapeHtml(r.no)} · ${escapeHtml(r.date)} · ${money(r.total)} · ${escapeHtml(r.settlement || "")} · ${escapeHtml(r.reason || "")}</li>`
        )
        .join("")}</ul>`
    : `<p class="muted">No returns on this bill.</p>`;
  const khata =
    partyId && partyId !== WALK_IN
      ? partyBalance(store.db, partyType, partyId)
      : null;
  return `
    <article class="inv-detail">
      <div class="inv-detail-grid">
        <div>
          <p class="eyebrow">${isSale ? "SALE INVOICE" : "PURCHASE BILL"}</p>
          <h3>${escapeHtml(doc.no)}</h3>
          <p>Date: <strong>${escapeHtml(doc.date)}</strong></p>
          <p>Status: <strong>${escapeHtml(status)}</strong></p>
        </div>
        <div>
          <p class="muted">${partyTitle}</p>
          ${
            party
              ? `<p><strong>${escapeHtml(party.name)}</strong></p>
                 <p>${escapeHtml(party.phone || "No phone")}</p>
                 <p>${escapeHtml(party.address || "No address")}</p>`
              : `<p><strong>Walk-in</strong></p>`
          }
        </div>
      </div>
      <div class="table-scroll">
        <table class="data-table items-table">
          <thead><tr><th>Sr</th><th>Product</th><th>Category</th><th>Qty</th><th>Unit</th><th>Price</th><th>Cost</th><th>Line total</th><th>Returned</th></tr></thead>
          <tbody>${lines || `<tr><td colspan="9">No line items</td></tr>`}</tbody>
        </table>
      </div>
      <div class="inv-money">
        <div><span>Subtotal</span><strong>${money(doc.subtotal)}</strong></div>
        <div><span>Discount</span><strong>${money(doc.discount)}</strong></div>
        <div><span>Total</span><strong>${money(doc.total)}</strong></div>
        <div><span>Paid</span><strong>${money(paid)}</strong></div>
        <div><span>Balance due</span><strong>${money(due)}</strong></div>
        ${khata != null ? `<div><span>${isSale ? "Customer khata now" : "Supplier khata now"}</span><strong>${money(khata)}</strong></div>` : ""}
      </div>
      <div class="inv-pay-box">
        <h4>Payment</h4>
        <p>Method: <strong>${escapeHtml(pay.method || "—")}</strong></p>
        <p>Amount on this bill: <strong>${money(pay.amount)}</strong></p>
        <p>Bank: ${escapeHtml(pay.bankName || "—")}</p>
        <p>Reference: ${escapeHtml(pay.reference || "—")}</p>
        <p>Note: ${escapeHtml(doc.note || "—")}</p>
        <p class="muted">Invoice id: ${escapeHtml(doc.id)}</p>
      </div>
      ${retBlock}
    </article>`;
}

function numSafe(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

export function creditNoteHtml(ret) {
  const s = biz();
  const isSale = ret.type === "sale";
  const items = (ret.items || [])
    .map(
      (it, i) =>
        `<tr><td>${i + 1}</td><td>${escapeHtml(it.name)}</td><td>${escapeHtml(it.category || "")}</td><td>${it.qty}</td><td>${escapeHtml(it.unit || "")}</td><td>${money(it.rate)}</td><td>${money(it.lineTotal)}</td></tr>`
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
        <thead><tr><th>Sr</th><th>Product</th><th>Category</th><th>Qty</th><th>Unit</th><th>Price</th><th>Total</th></tr></thead>
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
  let iframe = document.getElementById("ht-print-frame");
  if (!iframe) {
    iframe = document.createElement("iframe");
    iframe.id = "ht-print-frame";
    iframe.className = "ht-print-frame";
    iframe.setAttribute("aria-hidden", "true");
    document.body.appendChild(iframe);
  }
  const css = new URL("css/style.css", document.baseURI).href;
  const doc = iframe.contentDocument;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>Print</title>
    <link rel="stylesheet" href="${css}">
    <style>
      body { background:#fff; color:#111; margin:0; padding:16px; }
      .print-root, .print-sheet { display:block !important; }
    </style>
  </head><body>${html}</body></html>`);
  doc.close();
  let printed = false;
  const run = () => {
    if (printed) return;
    printed = true;
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch (err) {
      const host = document.getElementById("print-root");
      if (host) {
        host.innerHTML = html;
        document.body.classList.add("printing");
        window.print();
        window.addEventListener("afterprint", () => document.body.classList.remove("printing"), { once: true });
      }
    }
  };
  iframe.onload = run;
  setTimeout(run, 400);
}
