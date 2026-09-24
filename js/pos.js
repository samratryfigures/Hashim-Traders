import { localToday, num, round2, uid, nextNo, WALK_IN, escapeHtml, unitLabel, money } from "./utils.js";
import { productStock, wouldGoNegative, totalsFromItems, validateInvoiceItems, advanceBalance } from "./compute.js";
import { store, commit } from "./store.js";
import { toast } from "./ui.js";

export const pos = {
  items: [],
  customerId: WALK_IN,
  discount: 0,
  paid: 0,
  method: "cash",
  bound: false,
};

function products() {
  return (store.db.products || []).filter((p) => store.showArchived || !p.archived);
}
function customers() {
  return (store.db.customers || []).filter((c) => store.showArchived || !c.archived);
}

function totals() {
  const t = totalsFromItems(pos.items, pos.discount);
  let paid = num(pos.paid);
  if (pos.method === "credit") paid = 0;
  if (pos.method === "cash" && paid <= 0) paid = t.total;
  if (pos.method === "advance") {
    const adv = advanceBalance(store.db, "customer", pos.customerId);
    paid = Math.min(t.total, paid, adv);
  } else {
    paid = Math.min(t.total, Math.max(0, paid));
  }
  return { ...t, paid, due: round2(t.total - paid) };
}

function fillCustomers() {
  const sel = document.getElementById("pos-customer");
  if (!sel) return;
  const cur = pos.customerId;
  sel.innerHTML =
    `<option value="${WALK_IN}">Walk-in</option>` +
    customers()
      .map((c) => `<option value="${c.id}" ${c.id === cur ? "selected" : ""}>${escapeHtml(c.name)}</option>`)
      .join("");
  sel.value = cur;
}

function renderLines() {
  const body = document.getElementById("pos-lines");
  if (!body) return;
  if (!pos.items.length) {
    body.innerHTML = `<tr><td colspan="6" class="pos-empty">Search a product to add it to the bill.</td></tr>`;
    return;
  }
  body.innerHTML = pos.items
    .map(
      (it, i) => `<tr>
        <td>
          <div class="pos-name">${escapeHtml(it.name)}</div>
          <div class="muted">${escapeHtml(it.category || "")}</div>
        </td>
        <td><input class="pos-qty" data-i="${i}" type="number" min="0.01" step="any" value="${it.qty}"></td>
        <td class="muted">${escapeHtml(unitLabel(it.unit))}</td>
        <td><input class="pos-rate" data-i="${i}" type="number" min="0" step="any" value="${it.rate}"></td>
        <td>${money(num(it.qty) * num(it.rate))}</td>
        <td><button type="button" class="pos-x" data-i="${i}" aria-label="Remove">×</button></td>
      </tr>`
    )
    .join("");
  body.querySelectorAll(".pos-qty").forEach((inp) => {
    inp.oninput = () => {
      const i = Number(inp.dataset.i);
      pos.items[i].qty = num(inp.value);
      const row = inp.closest("tr");
      if (row) row.children[4].textContent = money(num(pos.items[i].qty) * num(pos.items[i].rate));
      paintTotals();
    };
  });
  body.querySelectorAll(".pos-rate").forEach((inp) => {
    inp.oninput = () => {
      const i = Number(inp.dataset.i);
      pos.items[i].rate = num(inp.value);
      const row = inp.closest("tr");
      if (row) row.children[4].textContent = money(num(pos.items[i].qty) * num(pos.items[i].rate));
      paintTotals();
    };
  });
  body.querySelectorAll(".pos-x").forEach((b) => {
    b.onclick = () => {
      pos.items.splice(Number(b.dataset.i), 1);
      paint();
    };
  });
}

function paintTotals() {
  const t = totals();
  const el = document.getElementById("pos-total");
  if (el) el.textContent = money(t.total);
  const due = document.getElementById("pos-due");
  if (due) due.textContent = t.due ? "Khata: " + money(t.due) : "";
}

function paint() {
  fillCustomers();
  renderLines();
  paintTotals();
}

function searchHits(q) {
  const s = q.trim().toLowerCase();
  const box = document.getElementById("pos-hits");
  if (!box) return;
  if (!s) {
    box.hidden = true;
    box.innerHTML = "";
    return;
  }
  const hits = products()
    .filter(
      (p) =>
        p.name.toLowerCase().includes(s) ||
        String(p.code || "").toLowerCase().includes(s) ||
        String(p.category || "").toLowerCase().includes(s)
    )
    .slice(0, 12);
  if (!hits.length) {
    box.hidden = false;
    box.innerHTML = `<div class="pos-hit muted">No product found</div>`;
    return;
  }
  box.hidden = false;
  box.innerHTML = hits
    .map((p) => {
      const st = productStock(store.db, p.id);
      return `<button type="button" class="pos-hit" data-id="${p.id}">
        <strong>${escapeHtml(p.name)}</strong>
        <span>${escapeHtml(p.category || "")} · ${unitLabel(p.unit)} · stock ${st} · ${money(p.salePrice)}</span>
      </button>`;
    })
    .join("");
  box.querySelectorAll(".pos-hit[data-id]").forEach((b) => {
    b.onclick = () => addProduct(b.dataset.id);
  });
}

export function addProduct(id) {
  const p = products().find((x) => String(x.id) === String(id));
  if (!p) return;
  const exist = pos.items.find((x) => String(x.productId) === String(p.id));
  if (exist) exist.qty = num(exist.qty) + 1;
  else {
    pos.items.push({
      productId: p.id,
      name: p.name,
      category: p.category || "",
      qty: 1,
      unit: unitLabel(p.unit),
      rate: num(p.salePrice),
      cost: num(p.purchasePrice),
      lineTotal: num(p.salePrice),
    });
  }
  const search = document.getElementById("pos-search");
  if (search) search.value = "";
  const hits = document.getElementById("pos-hits");
  if (hits) {
    hits.hidden = true;
    hits.innerHTML = "";
  }
  paint();
  search?.focus();
}

function completeSale() {
  const err = validateInvoiceItems(pos.items);
  if (err) {
    toast(err, { type: "err" });
    return;
  }
  const t = totals();
  if (pos.method === "advance") {
    const adv = advanceBalance(store.db, "customer", pos.customerId);
    if (t.paid > adv + 0.009) {
      toast("Advance is only " + money(adv), { type: "err" });
      return;
    }
    if (!pos.customerId || pos.customerId === WALK_IN) {
      toast("Advance needs a customer", { type: "err" });
      return;
    }
  }
  const doc = {
    id: uid(),
    no: nextNo("INV-", store.db.invoices.map((x) => x.no)),
    date: localToday(),
    customerId: pos.customerId || WALK_IN,
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
    payment: { method: pos.method, amount: t.paid, bankName: "", reference: "" },
    note: "",
  };
  const probe = JSON.parse(JSON.stringify(store.db));
  probe.invoices.push(doc);
  const neg = wouldGoNegative(probe, {});
  if (neg.length) {
    toast(`Cannot save: ${neg.map((n) => `${n.name} stock would become ${n.stock}`).join("; ")}`, { type: "err" });
    return;
  }
  commit((db) => db.invoices.push(doc), { undoLabel: "Undo sale" });
  toast("Sale " + doc.no + " saved", { type: "ok" });
  pos.items = [];
  pos.discount = 0;
  pos.paid = 0;
  const d = document.getElementById("pos-discount");
  const p = document.getElementById("pos-paid");
  if (d) d.value = 0;
  if (p) p.value = 0;
  paint();
}

export function bindPOS() {
  if (pos.bound) {
    paint();
    return;
  }
  pos.bound = true;
  const search = document.getElementById("pos-search");
  const hits = document.getElementById("pos-hits");
  search.oninput = () => searchHits(search.value);
  search.onkeydown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const first = hits.querySelector(".pos-hit[data-id]");
      if (first) addProduct(first.dataset.id);
    }
    if (e.key === "Escape") {
      hits.hidden = true;
    }
  };
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".pos-search-wrap")) hits.hidden = true;
  });
  document.getElementById("pos-customer").onchange = (e) => {
    pos.customerId = e.target.value;
  };
  document.getElementById("pos-discount").oninput = (e) => {
    pos.discount = num(e.target.value);
    paintTotals();
  };
  document.getElementById("pos-paid").oninput = (e) => {
    pos.paid = num(e.target.value);
    paintTotals();
  };
  document.getElementById("pos-method").onchange = (e) => {
    pos.method = e.target.value;
    if (pos.method === "credit") {
      pos.paid = 0;
      document.getElementById("pos-paid").value = 0;
    }
    paintTotals();
  };
  document.getElementById("pos-complete").onclick = completeSale;
  document.getElementById("pos-add-cust").onclick = () => {
    const name = prompt("New customer name");
    if (!name || !name.trim()) return;
    const rec = { id: uid(), name: name.trim(), phone: "", address: "", archived: false };
    commit((db) => db.customers.push(rec));
    pos.customerId = rec.id;
    paint();
    toast("Customer added", { type: "ok" });
  };
  paint();
}

export function refreshPOS() {
  if (!document.getElementById("pos-search")) return;
  paint();
}
