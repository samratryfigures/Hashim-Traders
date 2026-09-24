import { localToday, num, round2, uid, nextNo, WALK_IN, escapeHtml, unitLabel, unitOptions } from "./utils.js";
import {
  productStock,
  wouldGoNegative,
  paidAmount,
  advanceBalance,
  partyBalance,
  qtyReturnedOn,
  validateInvoiceItems,
  totalsFromItems,
  partyName,
} from "./compute.js";
import { store, commit, applyUndo } from "./store.js";
import { toast, confirmDialog, openModal } from "./ui.js";
import { invoiceHtml, creditNoteHtml, printHtml } from "./print.js";

function productsActive() {
  return (store.db.products || []).filter((p) => store.showArchived || !p.archived);
}
function customersActive() {
  return (store.db.customers || []).filter((c) => store.showArchived || !c.archived);
}
function suppliersActive() {
  return (store.db.suppliers || []).filter((s) => store.showArchived || !s.archived);
}

export function emptyItem() {
  return { productId: "", name: "", qty: 1, unit: "packets", rate: 0, cost: 0, lineTotal: 0 };
}

export function docTotals(state) {
  const items = state.items.map((it) => ({
    ...it,
    lineTotal: round2(num(it.qty) * num(it.rate)),
  }));
  const t = totalsFromItems(items, state.discount);
  let paid = num(state.payment.amount);
  if (state.payment.method === "credit") paid = 0;
  if (state.payment.method === "advance") {
    const adv = advanceBalance(store.db, state.kind === "sale" ? "customer" : "supplier", state.partyId);
    paid = Math.min(t.total, paid, adv);
  } else {
    paid = Math.min(t.total, Math.max(0, paid));
  }
  return { items, ...t, paid, due: round2(t.total - paid) };
}

function partySelect(kind, selected) {
  const list = kind === "sale" ? customersActive() : suppliersActive();
  const walk = kind === "sale" ? `<option value="${WALK_IN}">Walk-in</option>` : `<option value="">Select supplier</option>`;
  return (
    walk +
    list.map((p) => `<option value="${p.id}" ${p.id === selected ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("")
  );
}

function productOptions(selectedId, exclude) {
  const list = productsActive();
  const groups = new Map();
  for (const p of list) {
    const cat = p.category || "General";
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(p);
  }
  let html = `<option value="">Product</option>`;
  for (const [cat, items] of groups) {
    html += `<optgroup label="${escapeHtml(cat)}">`;
    for (const p of items) {
      const s = productStock(store.db, p.id, exclude);
      const u = unitLabel(p.unit);
      html += `<option value="${p.id}" ${p.id === selectedId ? "selected" : ""}>${escapeHtml(p.name)} · ${u} · stock ${s}</option>`;
    }
    html += `</optgroup>`;
  }
  return html;
}

export function renderItemRows(state) {
  return state.items
    .map((it, idx) => {
      const stock = it.productId ? productStock(store.db, it.productId, state.exclude) : 0;
      const low = it.productId && kindQtyCheck(state, it, stock);
      return `<tr data-idx="${idx}">
        <td>
          <select class="item-product" data-idx="${idx}">${productOptions(it.productId, state.exclude)}</select>
          ${low ? `<div class="field-error">${low}</div>` : ""}
        </td>
        <td><input class="item-qty" data-idx="${idx}" type="number" min="0.01" step="any" value="${it.qty}"></td>
        <td><select class="item-unit" data-idx="${idx}">${unitOptions(it.unit)}</select></td>
        <td><input class="item-rate" data-idx="${idx}" type="number" min="0" step="any" value="${it.rate}"></td>
        <td class="line-total">${formatLine(it)}</td>
        <td><button type="button" class="icon-btn" data-remove="${idx}" aria-label="Remove">✕</button></td>
      </tr>`;
    })
    .join("");
}

function formatLine(it) {
  return "Rs " + round2(num(it.qty) * num(it.rate)).toLocaleString("en-PK");
}

function kindQtyCheck(state, it, stock) {
  if (state.kind === "sale" && num(it.qty) > stock) return `Only ${stock} in stock`;
  return "";
}

export function openDocumentForm({ kind, existing, printAfter = false, partyId }) {
  const isSale = kind === "sale";
  const state = {
    kind,
    id: existing?.id || uid(),
    no: existing?.no || nextNo(isSale ? "INV-" : "PUR-", (isSale ? store.db.invoices : store.db.purchases).map((x) => x.no)),
    date: existing?.date || localToday(),
    partyId: existing ? (isSale ? existing.customerId : existing.supplierId) : partyId || (isSale ? WALK_IN : ""),
    items: existing?.items?.length
      ? existing.items.map((x) => ({ ...x, unit: unitLabel(x.unit) }))
      : [emptyItem()],
    discount: existing?.discount || 0,
    payment: {
      method: existing?.payment?.method || (isSale ? "cash" : "cash"),
      amount: existing?.payment?.amount ?? (existing ? paidAmount(existing) : 0),
      bankName: existing?.payment?.bankName || "",
      reference: existing?.payment?.reference || "",
    },
    note: existing?.note || "",
    exclude: isSale ? { invoiceId: existing?.id } : { purchaseId: existing?.id },
    isEdit: !!existing,
  };

  const title = existing ? (isSale ? "Edit invoice" : "Edit purchase") : isSale ? "New sale invoice" : "New purchase bill";

  const { el, close } = openModal({
    title,
    width: "modal-wide",
    html: formHtml(state, isSale),
    onOpen: (wrap) => bindForm(wrap, state, isSale, close, printAfter),
  });
  return { el, close, state };
}

function formHtml(state, isSale) {
  const t = docTotals(state);
  const adv = state.partyId && state.partyId !== WALK_IN ? advanceBalance(store.db, isSale ? "customer" : "supplier", state.partyId) : 0;
  return `
    <form class="doc-form" id="doc-form">
      <div class="form-grid">
        <label>Date<input type="date" name="date" value="${state.date}" required></label>
        <label>${isSale ? "Customer" : "Supplier"}
          <div class="row-split">
            <select name="party">${partySelect(state.kind, state.partyId)}</select>
            <button type="button" class="btn sm" data-quick-party>+ New</button>
          </div>
        </label>
        <label>Number<input name="no" value="${state.no}" readonly></label>
      </div>
      <div class="table-scroll">
        <table class="items-table">
          <thead><tr><th>Product (any category)</th><th>Qty</th><th>Unit</th><th>Rate</th><th>Amount</th><th></th></tr></thead>
          <tbody class="item-body">${renderItemRows(state)}</tbody>
        </table>
      </div>
      <button type="button" class="btn ghost" data-add-item>+ Add another product</button>
      <p class="muted">One customer can take items from many categories on this same bill.</p>
      <div class="form-grid">
        <label>Discount (Rs)<input type="number" min="0" step="any" name="discount" value="${state.discount}"></label>
        <label>How paid
          <select name="method">
            <option value="cash" ${state.payment.method === "cash" ? "selected" : ""}>Cash (full)</option>
            <option value="credit" ${state.payment.method === "credit" ? "selected" : ""}>Udhaar (khata)</option>
            <option value="bank" ${state.payment.method === "bank" ? "selected" : ""}>Bank / partial</option>
            <option value="advance" ${state.payment.method === "advance" ? "selected" : ""}>Advance</option>
          </select>
        </label>
        <label>Amount paid now<input type="number" min="0" step="any" name="paid" value="${state.payment.amount}"></label>
        <label class="bank-fields">Bank name<input name="bankName" value="${state.payment.bankName}"></label>
        <label class="bank-fields">Reference<input name="reference" value="${state.payment.reference}"></label>
      </div>
      <p class="muted advance-hint">Available advance: Rs ${adv.toLocaleString("en-PK")}</p>
      <div class="live-totals">
        <span>Subtotal <strong class="t-sub">${moneyish(t.subtotal)}</strong></span>
        <span>Discount <strong class="t-disc">${moneyish(t.discount)}</strong></span>
        <span>Total <strong class="t-total">${moneyish(t.total)}</strong></span>
        <span>Paid <strong class="t-paid">${moneyish(t.paid)}</strong></span>
        <span>Balance <strong class="t-due">${moneyish(t.due)}</strong></span>
      </div>
      <p class="field-error form-error" hidden></p>
      <div class="modal-actions">
        <button type="button" class="btn ghost" data-close>Cancel</button>
        <button type="submit" class="btn primary" data-save>Save</button>
        ${isSale || true ? `<button type="button" class="btn" data-save-print>Save &amp; Print</button>` : ""}
      </div>
    </form>`;
}

function moneyish(n) {
  return "Rs " + round2(n).toLocaleString("en-PK");
}

function bindForm(wrap, state, isSale, close, printAfter) {
  const form = wrap.querySelector("#doc-form");
  const errorEl = wrap.querySelector(".form-error");

  function read() {
    state.date = form.date.value;
    state.partyId = form.party.value;
    state.discount = num(form.discount.value);
    state.payment.method = form.method.value;
    state.payment.amount = num(form.paid.value);
    state.payment.bankName = form.bankName.value;
    state.payment.reference = form.reference.value;
    if (state.payment.method === "credit") {
      state.payment.amount = 0;
      form.paid.value = 0;
    }
    if (state.payment.method === "cash") {
      const t = totalsFromItems(state.items, state.discount);
      state.payment.amount = t.total;
      form.paid.value = t.total;
    }
  }

  function refreshItems() {
    wrap.querySelector(".item-body").innerHTML = renderItemRows(state);
    bindRows();
    refreshTotals();
  }

  function bindRows() {
    wrap.querySelectorAll(".item-product").forEach((sel) => {
      sel.onchange = () => {
        const i = Number(sel.dataset.idx);
        const p = store.db.products.find((x) => String(x.id) === sel.value);
        state.items[i].productId = sel.value;
        if (p) {
          state.items[i].name = p.name;
          state.items[i].cost = num(p.purchasePrice);
          state.items[i].rate = isSale ? num(p.salePrice) : num(p.purchasePrice);
          state.items[i].unit = unitLabel(p.unit);
        }
        refreshItems();
      };
    });
    wrap.querySelectorAll(".item-qty").forEach((inp) => {
      inp.oninput = () => {
        state.items[Number(inp.dataset.idx)].qty = num(inp.value);
        refreshTotals();
        const i = Number(inp.dataset.idx);
        const it = state.items[i];
        const stock = it.productId ? productStock(store.db, it.productId, state.exclude) : 0;
        const msg = kindQtyCheck(state, it, stock);
        const cell = inp.closest("tr").querySelector(".field-error");
        if (cell) cell.textContent = msg || "";
      };
    });
    wrap.querySelectorAll(".item-unit").forEach((sel) => {
      sel.onchange = () => {
        state.items[Number(sel.dataset.idx)].unit = unitLabel(sel.value);
      };
    });
    wrap.querySelectorAll(".item-rate").forEach((inp) => {
      inp.oninput = () => {
        const i = Number(inp.dataset.idx);
        state.items[i].rate = num(inp.value);
        if (!isSale) state.items[i].cost = num(inp.value);
        refreshTotals();
      };
    });
    wrap.querySelectorAll("[data-remove]").forEach((b) => {
      b.onclick = () => {
        const i = Number(b.dataset.remove);
        if (state.items.length === 1) {
          state.items = [emptyItem()];
        } else state.items.splice(i, 1);
        refreshItems();
      };
    });
  }

  function refreshTotals() {
    read();
    const t = docTotals(state);
    wrap.querySelector(".t-sub").textContent = moneyish(t.subtotal);
    wrap.querySelector(".t-disc").textContent = moneyish(t.discount);
    wrap.querySelector(".t-total").textContent = moneyish(t.total);
    wrap.querySelector(".t-paid").textContent = moneyish(t.paid);
    wrap.querySelector(".t-due").textContent = moneyish(t.due);
    wrap.querySelectorAll(".line-total").forEach((td, i) => {
      if (state.items[i]) td.textContent = formatLine(state.items[i]);
    });
    wrap.querySelectorAll(".bank-fields").forEach((el) => {
      el.style.display = state.payment.method === "bank" ? "" : "none";
    });
    const adv = state.partyId && state.partyId !== WALK_IN ? advanceBalance(store.db, isSale ? "customer" : "supplier", state.partyId) : 0;
    wrap.querySelector(".advance-hint").textContent = `Available advance: Rs ${adv.toLocaleString("en-PK")}`;
    wrap.querySelector(".advance-hint").style.display = state.payment.method === "advance" ? "" : "none";
  }

  form.addEventListener("input", refreshTotals);
  form.addEventListener("change", refreshTotals);
  wrap.querySelector("[data-add-item]").onclick = () => {
    state.items.push(emptyItem());
    refreshItems();
  };

  wrap.querySelector("[data-quick-party]").onclick = () => {
    const name = prompt(isSale ? "New customer name" : "New supplier name");
    if (!name || !name.trim()) return;
    const rec = { id: uid(), name: name.trim(), phone: "", address: "", archived: false };
    commit((db) => {
      if (isSale) db.customers.push(rec);
      else db.suppliers.push(rec);
    });
    state.partyId = rec.id;
    form.party.innerHTML = partySelect(state.kind, rec.id);
    toast((isSale ? "Customer" : "Supplier") + " added", { type: "ok" });
  };

  function save(andPrint) {
    read();
    errorEl.hidden = true;
    const t = docTotals(state);
    const err = validateInvoiceItems(state.items);
    if (err) {
      errorEl.hidden = false;
      errorEl.textContent = err;
      return;
    }
    if (!state.date) {
      errorEl.hidden = false;
      errorEl.textContent = "Date is required";
      return;
    }
    if (!isSale && !state.partyId) {
      errorEl.hidden = false;
      errorEl.textContent = "Select a supplier";
      return;
    }
    if (state.payment.method === "advance") {
      const adv = advanceBalance(store.db, isSale ? "customer" : "supplier", state.partyId);
      if (t.paid > adv + 0.009) {
        errorEl.hidden = false;
        errorEl.textContent = `Advance is only Rs ${adv.toLocaleString("en-PK")}`;
        return;
      }
      if (!state.partyId || state.partyId === WALK_IN) {
        errorEl.hidden = false;
        errorEl.textContent = "Advance needs a customer / supplier";
        return;
      }
    }
    const doc = {
      id: state.id,
      no: state.no,
      date: state.date,
      items: t.items.map((it) => ({
        productId: it.productId,
        name: it.name,
        qty: num(it.qty),
        unit: unitLabel(it.unit),
        rate: num(it.rate),
        cost: num(it.cost),
        lineTotal: round2(num(it.qty) * num(it.rate)),
      })),
      discount: t.discount,
      subtotal: t.subtotal,
      total: t.total,
      payment: {
        method: state.payment.method,
        amount: t.paid,
        bankName: state.payment.bankName,
        reference: state.payment.reference,
      },
      note: state.note,
    };
    if (isSale) doc.customerId = state.partyId || WALK_IN;
    else doc.supplierId = state.partyId;

    const exclude = isSale ? { invoiceId: doc.id } : { purchaseId: doc.id };
    const probe = JSON.parse(JSON.stringify(store.db));
    if (isSale) {
      const i = probe.invoices.findIndex((x) => x.id === doc.id);
      if (i >= 0) probe.invoices[i] = doc;
      else probe.invoices.push(doc);
    } else {
      const i = probe.purchases.findIndex((x) => x.id === doc.id);
      if (i >= 0) probe.purchases[i] = doc;
      else probe.purchases.push(doc);
    }
    const neg = wouldGoNegative(probe, {});
    if (neg.length) {
      errorEl.hidden = false;
      errorEl.textContent = `Cannot save: ${neg.map((n) => `${n.name} stock would become ${n.stock}`).join("; ")}`;
      return;
    }

    commit((db) => {
      if (isSale) {
        const i = db.invoices.findIndex((x) => x.id === doc.id);
        if (i >= 0) db.invoices[i] = doc;
        else db.invoices.push(doc);
      } else {
        const i = db.purchases.findIndex((x) => x.id === doc.id);
        if (i >= 0) db.purchases[i] = doc;
        else db.purchases.push(doc);
      }
    }, { undoLabel: state.isEdit ? "Undo edit" : "Undo save" });

    close();
    successDialog(doc, isSale ? "sale" : "purchase", andPrint);
    toast(state.isEdit ? "Saved" : isSale ? "Invoice saved" : "Purchase saved", { type: "ok" });
  }

  form.onsubmit = (e) => {
    e.preventDefault();
    save(printAfter);
  };
  wrap.querySelector("[data-save-print]").onclick = () => save(true);
  bindRows();
  refreshTotals();
}

function successDialog(doc, kind, autoPrint) {
  const { close } = openModal({
    title: "Saved",
    html: `<p>${kind === "sale" ? "Invoice" : "Bill"} <strong>${escapeHtml(doc.no)}</strong> is saved.</p>
      <div class="modal-actions">
        <button type="button" class="btn ghost" data-close>Close</button>
        <button type="button" class="btn primary" data-print>Print Invoice</button>
      </div>`,
    onOpen: (wrap) => {
      wrap.querySelector("[data-print]").onclick = () => {
        printHtml(invoiceHtml(doc, { kind }));
      };
    },
  });
  if (autoPrint) printHtml(invoiceHtml(doc, { kind }));
  return close;
}

export function openPaymentForm({ partyType, partyId, existing }) {
  const isCust = partyType === "customer";
  const list = isCust ? customersActive() : suppliersActive();
  const { close } = openModal({
    title: existing ? "Edit payment" : isCust ? "Receive payment" : "Make payment",
    html: `
      <form id="pay-form" class="form-grid">
        <label>Date<input type="date" name="date" value="${existing?.date || localToday()}" required></label>
        <label>${isCust ? "Customer" : "Supplier"}
          <select name="party" required>
            ${list.map((p) => `<option value="${p.id}" ${p.id === (existing?.partyId || partyId) ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("")}
          </select>
        </label>
        <label>Amount<input type="number" min="0.01" step="any" name="amount" value="${existing?.amount || ""}" required></label>
        <label>Method
          <select name="method">
            <option value="cash" ${existing?.method === "cash" ? "selected" : ""}>Cash</option>
            <option value="bank" ${existing?.method === "bank" ? "selected" : ""}>Bank</option>
          </select>
        </label>
        <label>Bank / ref<input name="reference" value="${existing?.reference || existing?.bankName || ""}"></label>
        <label>Note<input name="note" value="${existing?.note || ""}"></label>
        <p class="muted full">If there are no dues, this is recorded as an advance.</p>
        <div class="modal-actions full">
          <button type="button" class="btn ghost" data-close>Cancel</button>
          <button class="btn primary" type="submit">Save</button>
        </div>
      </form>`,
    onOpen: (wrap) => {
      wrap.querySelector("#pay-form").onsubmit = (e) => {
        e.preventDefault();
        const f = e.target;
        if (!f.party.value) return toast("Select a party", { type: "err" });
        const rec = {
          id: existing?.id || uid(),
          no: existing?.no || nextNo("PAY-", store.db.payments.map((p) => p.no)),
          date: f.date.value,
          partyType,
          partyId: f.party.value,
          amount: num(f.amount.value),
          method: f.method.value,
          bankName: f.reference.value,
          reference: f.reference.value,
          note: f.note.value,
        };
        commit((db) => {
          const i = db.payments.findIndex((x) => x.id === rec.id);
          if (i >= 0) db.payments[i] = rec;
          else db.payments.push(rec);
        }, { undoLabel: "Undo payment" });
        close();
        toast("Payment saved", { type: "ok" });
      };
    },
  });
}

export function openReturnForm({ type, existing }) {
  const isSale = type === "sale";
  const sources = isSale ? store.db.invoices : store.db.purchases;
  const parties = isSale ? customersActive() : suppliersActive();

  const state = {
    id: existing?.id || uid(),
    no: existing?.no || nextNo(isSale ? "SR-" : "PR-", store.db.returns.filter((r) => r.type === type).map((r) => r.no)),
    date: existing?.date || localToday(),
    type,
    partyId: existing?.partyId || "",
    sourceId: existing?.sourceId || "",
    items: existing?.items ? existing.items.map((x) => ({ ...x })) : [],
    reason: existing?.reason || "",
    settlement: existing?.settlement || "khata",
    exclude: { returnId: existing?.id },
  };

  function sourceOptions() {
    return sources
      .filter((d) => (isSale ? d.customerId : d.supplierId) === state.partyId)
      .map((d) => `<option value="${d.id}" ${d.id === state.sourceId ? "selected" : ""}>${d.no} · ${d.date} · ${moneyish(d.total)}</option>`)
      .join("");
  }

  function itemRows() {
    const src = sources.find((d) => d.id === state.sourceId);
    if (!src) return `<tr><td colspan="5" class="muted">Pick an original ${isSale ? "invoice" : "bill"}</td></tr>`;
    return (src.items || [])
      .map((it) => {
        const already = qtyReturnedOn(store.db, src.id, it.productId, existing?.id);
        const max = num(it.qty) - already;
        const cur = state.items.find((x) => x.productId === it.productId);
        const qty = cur ? cur.qty : 0;
        return `<tr>
          <td>${escapeHtml(it.name)}</td>
          <td>${it.qty}</td>
          <td>${max}</td>
          <td><input type="number" min="0" max="${max}" step="any" data-pid="${it.productId}" data-name="${escapeHtml(it.name)}" data-rate="${it.rate}" value="${qty}"></td>
          <td>${moneyish(num(qty) * num(it.rate))}</td>
        </tr>`;
      })
      .join("");
  }

  const { close } = openModal({
    title: existing ? "Edit return" : isSale ? "Sales return" : "Purchase return",
    width: "modal-wide",
    html: `
      <form id="ret-form">
        <div class="form-grid">
          <label>Date<input type="date" name="date" value="${state.date}" required></label>
          <label>${isSale ? "Customer" : "Supplier"}
            <select name="party">${parties.map((p) => `<option value="${p.id}" ${p.id === state.partyId ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("")}</select>
          </label>
          <label>Original
            <select name="source"><option value="">Select</option>${sourceOptions()}</select>
          </label>
          <label>Settlement
            <select name="settlement">
              <option value="khata">Adjust in khata</option>
              <option value="cash">Cash refund</option>
              <option value="bank">Bank refund</option>
            </select>
          </label>
          <label class="full">Reason<input name="reason" value="${escapeHtml(state.reason)}"></label>
        </div>
        <div class="table-scroll"><table class="data-table">
          <thead><tr><th>Product</th><th>Sold</th><th>Returnable</th><th>Return qty</th><th>Amount</th></tr></thead>
          <tbody class="ret-body">${itemRows()}</tbody>
        </table></div>
        <p class="field-error form-error" hidden></p>
        <div class="modal-actions">
          <button type="button" class="btn ghost" data-close>Cancel</button>
          <button class="btn primary" type="submit">Save</button>
          <button type="button" class="btn" data-save-print>Save &amp; Print</button>
        </div>
      </form>`,
    onOpen: (wrap) => {
      const form = wrap.querySelector("#ret-form");
      form.settlement.value = state.settlement;
      function refresh() {
        state.partyId = form.party.value;
        state.sourceId = form.source.value;
        form.source.innerHTML = `<option value="">Select</option>` + sourceOptions();
        form.source.value = state.sourceId;
        wrap.querySelector(".ret-body").innerHTML = itemRows();
      }
      form.party.onchange = () => {
        state.sourceId = "";
        refresh();
      };
      form.source.onchange = refresh;
      function collect() {
        state.date = form.date.value;
        state.reason = form.reason.value;
        state.settlement = form.settlement.value;
        state.items = [];
        wrap.querySelectorAll(".ret-body input[data-pid]").forEach((inp) => {
          const q = num(inp.value);
          if (q > 0) {
            state.items.push({
              productId: inp.dataset.pid,
              name: inp.dataset.name,
              qty: q,
              rate: num(inp.dataset.rate),
              lineTotal: round2(q * num(inp.dataset.rate)),
            });
          }
        });
      }
      function save(andPrint) {
        collect();
        const errEl = wrap.querySelector(".form-error");
        errEl.hidden = true;
        const src = sources.find((d) => d.id === state.sourceId);
        if (!src) {
          errEl.hidden = false;
          errEl.textContent = "Select the original document";
          return;
        }
        if (!state.items.length) {
          errEl.hidden = false;
          errEl.textContent = "Enter a return quantity";
          return;
        }
        for (const it of state.items) {
          const orig = src.items.find((x) => String(x.productId) === String(it.productId));
          const already = qtyReturnedOn(store.db, src.id, it.productId, existing?.id);
          const max = num(orig?.qty) - already;
          if (it.qty > max + 0.0001) {
            errEl.hidden = false;
            errEl.textContent = `Cannot return more than ${max} of ${it.name}`;
            return;
          }
        }
        const rec = {
          id: state.id,
          no: state.no,
          date: state.date,
          type,
          partyId: isSale ? src.customerId : src.supplierId,
          sourceId: src.id,
          sourceNo: src.no,
          items: state.items,
          reason: state.reason,
          settlement: state.settlement,
          total: round2(state.items.reduce((a, it) => a + it.lineTotal, 0)),
        };
        const probe = JSON.parse(JSON.stringify(store.db));
        const i = probe.returns.findIndex((x) => x.id === rec.id);
        if (i >= 0) probe.returns[i] = rec;
        else probe.returns.push(rec);
        const neg = wouldGoNegative(probe, {});
        if (neg.length) {
          errEl.hidden = false;
          errEl.textContent = `Cannot save: ${neg.map((n) => `${n.name} stock would become ${n.stock}`).join("; ")}`;
          return;
        }
        commit((db) => {
          const j = db.returns.findIndex((x) => x.id === rec.id);
          if (j >= 0) db.returns[j] = rec;
          else db.returns.push(rec);
        }, { undoLabel: "Undo return" });
        close();
        toast("Return saved", { type: "ok" });
        if (andPrint) printHtml(creditNoteHtml(rec));
        else {
          openModal({
            title: "Return saved",
            html: `<p>Credit note <strong>${rec.no}</strong></p>
              <div class="modal-actions"><button class="btn ghost" data-close>Close</button>
              <button class="btn primary" data-print>Print</button></div>`,
            onOpen: (w) => {
              w.querySelector("[data-print]").onclick = () => printHtml(creditNoteHtml(rec));
            },
          });
        }
      }
      form.onsubmit = (e) => {
        e.preventDefault();
        save(false);
      };
      wrap.querySelector("[data-save-print]").onclick = () => save(true);
    },
  });
}

export function openProductForm(existing) {
  const { close } = openModal({
    title: existing ? "Edit product" : "Add product",
    html: `
      <form id="prod-form" class="form-grid">
        <label>Name<input name="name" required value="${escapeHtml(existing?.name || "")}"></label>
        <label>Code<input name="code" value="${escapeHtml(existing?.code || "")}"></label>
        <label>Category<input name="category" value="${escapeHtml(existing?.category || "")}"></label>
        <label>Unit
          <select name="unit">${unitOptions(existing?.unit || "packets")}</select>
        </label>
        <label>Purchase price<input type="number" min="0" step="any" name="purchasePrice" value="${existing?.purchasePrice ?? ""}"></label>
        <label>Sale price<input type="number" min="0" step="any" name="salePrice" value="${existing?.salePrice ?? ""}"></label>
        <label>Opening stock<input type="number" step="any" name="openingStock" value="${existing?.openingStock ?? 0}"></label>
        <p class="field-error form-error full" hidden></p>
        <div class="modal-actions full">
          <button type="button" class="btn ghost" data-close>Cancel</button>
          <button class="btn primary">Save</button>
        </div>
      </form>`,
    onOpen: (wrap) => {
      wrap.querySelector("#prod-form").onsubmit = (e) => {
        e.preventDefault();
        const f = e.target;
        const rec = {
          id: existing?.id || uid(),
          name: f.name.value.trim(),
          code: f.code.value.trim(),
          category: f.category.value.trim(),
          unit: unitLabel(f.unit.value),
          purchasePrice: num(f.purchasePrice.value),
          salePrice: num(f.salePrice.value),
          openingStock: num(f.openingStock.value),
          archived: existing?.archived || false,
        };
        const probe = JSON.parse(JSON.stringify(store.db));
        const i = probe.products.findIndex((x) => x.id === rec.id);
        if (i >= 0) probe.products[i] = rec;
        else probe.products.push(rec);
        const neg = wouldGoNegative(probe, {});
        if (neg.length) {
          const el = wrap.querySelector(".form-error");
          el.hidden = false;
          el.textContent = `Cannot save: ${neg.map((n) => `${n.name} stock would become ${n.stock}`).join("; ")}`;
          return;
        }
        commit((db) => {
          const j = db.products.findIndex((x) => x.id === rec.id);
          if (j >= 0) db.products[j] = rec;
          else db.products.push(rec);
        }, { undoLabel: "Undo product" });
        close();
        toast("Product saved", { type: "ok" });
      };
    },
  });
}

export function openPartyForm(kind, existing) {
  const { close } = openModal({
    title: existing ? `Edit ${kind}` : `Add ${kind}`,
    html: `
      <form id="party-form" class="form-grid">
        <label>Name<input name="name" required value="${escapeHtml(existing?.name || "")}"></label>
        <label>Phone<input name="phone" value="${escapeHtml(existing?.phone || "")}"></label>
        <label class="full">Address<input name="address" value="${escapeHtml(existing?.address || "")}"></label>
        <div class="modal-actions full">
          <button type="button" class="btn ghost" data-close>Cancel</button>
          <button class="btn primary">Save</button>
        </div>
      </form>`,
    onOpen: (wrap) => {
      wrap.querySelector("#party-form").onsubmit = (e) => {
        e.preventDefault();
        const f = e.target;
        const rec = {
          id: existing?.id || uid(),
          name: f.name.value.trim(),
          phone: f.phone.value.trim(),
          address: f.address.value.trim(),
          archived: existing?.archived || false,
        };
        commit((db) => {
          const list = kind === "customer" ? db.customers : db.suppliers;
          const i = list.findIndex((x) => x.id === rec.id);
          if (i >= 0) list[i] = rec;
          else list.push(rec);
        });
        close();
        toast("Saved", { type: "ok" });
      };
    },
  });
}

export function openExpenseForm(existing) {
  const { close } = openModal({
    title: existing ? "Edit expense" : "Add expense",
    html: `
      <form id="exp-form" class="form-grid">
        <label>Date<input type="date" name="date" value="${existing?.date || localToday()}" required></label>
        <label>Name<input name="name" required value="${escapeHtml(existing?.name || "")}"></label>
        <label>Amount<input type="number" min="0" step="any" name="amount" required value="${existing?.amount ?? ""}"></label>
        <label>Method
          <select name="method">
            <option value="cash">Cash</option>
            <option value="bank">Bank</option>
          </select>
        </label>
        <label class="full">Note<input name="note" value="${escapeHtml(existing?.note || "")}"></label>
        <div class="modal-actions full">
          <button type="button" class="btn ghost" data-close>Cancel</button>
          <button class="btn primary">Save</button>
        </div>
      </form>`,
    onOpen: (wrap) => {
      wrap.querySelector("[name=method]").value = existing?.method || "cash";
      wrap.querySelector("#exp-form").onsubmit = (e) => {
        e.preventDefault();
        const f = e.target;
        const rec = {
          id: existing?.id || uid(),
          date: f.date.value,
          name: f.name.value.trim(),
          amount: num(f.amount.value),
          note: f.note.value,
          method: f.method.value,
        };
        commit((db) => {
          const i = db.expenses.findIndex((x) => x.id === rec.id);
          if (i >= 0) db.expenses[i] = rec;
          else db.expenses.push(rec);
        });
        close();
        toast("Expense saved", { type: "ok" });
      };
    },
  });
}

export async function tryDelete(kind, rec) {
  const ok = await confirmDialog({
    title: "Delete this record?",
    message: "This cannot be undone from the table, but you can use Undo in the toast.",
    ok: "Delete",
  });
  if (!ok) return;
  const probe = JSON.parse(JSON.stringify(store.db));
  pull(probe, kind, rec.id);
  const neg = wouldGoNegative(probe, {});
  if (neg.length) {
    toast(`Cannot delete: ${neg.map((n) => `${n.name} stock would become ${n.stock}`).join("; ")}`, { type: "err" });
    return;
  }
  commit((db) => pull(db, kind, rec.id), { undoLabel: "Undo delete" });
  toast("Deleted", {
    type: "ok",
    action: {
      label: "Undo",
      onClick: () => applyUndo(),
    },
  });
}

function pull(db, kind, id) {
  const map = {
    product: "products",
    invoice: "invoices",
    purchase: "purchases",
    expense: "expenses",
    customer: "customers",
    supplier: "suppliers",
    payment: "payments",
    return: "returns",
  };
  const key = map[kind];
  db[key] = db[key].filter((x) => x.id !== id);
}

export { partyName };
