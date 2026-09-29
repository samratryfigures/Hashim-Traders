import { localToday, num, round2, uid, nextNo, WALK_IN, escapeHtml, unitLabel, unitOptions, money } from "./utils.js";
import { productStock, wouldGoNegative, totalsFromItems, advanceBalance, filledInvoiceItems } from "./compute.js";
import { store, commit } from "./store.js";
import { toast, isEditingField } from "./ui.js";
import { pushCloud } from "./sync.js";
import { invoiceHtml, printHtml } from "./print.js";
import { openProductForm } from "./forms.js";

function blankLine() {
  return { productId: "", name: "", category: "", qty: 1, unit: "packets", rate: 0, cost: 0 };
}

export const pos = {
  items: [blankLine()],
  customerId: WALK_IN,
  discount: 0,
  paid: 0,
  method: "cash",
  date: localToday(),
  bound: false,
};

function products() {
  return (store.db.products || []).filter((p) => store.showArchived || !p.archived);
}
function customers() {
  return (store.db.customers || []).filter((c) => store.showArchived || !c.archived);
}

function filledItems() {
  return filledInvoiceItems(pos.items);
}

function totals() {
  const t = totalsFromItems(filledItems(), pos.discount);
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

function productHits(q) {
  const needle = String(q || "").trim().toLowerCase();
  const list = products();
  if (!needle) return list.slice(0, 40);
  return list
    .filter((p) => [p.name, p.code, p.category].some((x) => String(x || "").toLowerCase().includes(needle)))
    .slice(0, 40);
}

function posError(msg) {
  const el = document.getElementById("pos-error");
  if (el) {
    el.hidden = !msg;
    el.textContent = msg || "";
  }
  if (msg) toast(msg, { type: "err", timeout: 7000 });
}

let posMenu = null;
function posMenuEl() {
  if (posMenu && document.body.contains(posMenu)) return posMenu;
  posMenu = document.createElement("div");
  posMenu.className = "prod-menu";
  posMenu.hidden = true;
  document.body.appendChild(posMenu);
  posMenu.addEventListener("mousedown", (e) => e.preventDefault());
  posMenu.addEventListener("click", (e) => {
    const idx = Number(posMenu.dataset.idx);
    const hit = e.target.closest("[data-pick]");
    const create = e.target.closest("[data-create]");
    if (hit) {
      applyProduct(idx, hit.getAttribute("data-pick"));
      hidePosMenu();
      paintCart();
      document.querySelector(`.pos-qty[data-i="${idx}"]`)?.focus();
      return;
    }
    if (create) {
      const typed = document.querySelector(`.pos-product-q[data-i="${idx}"]`)?.value || "";
      hidePosMenu();
      openProductForm(null, {
        defaults: { name: typed.trim() },
        onSaved: (rec) => {
          applyProduct(idx, rec.id);
          paintCart();
        },
      });
    }
  });
  return posMenu;
}

function hidePosMenu() {
  const m = posMenuEl();
  m.hidden = true;
  m.innerHTML = "";
}

function openPosMenu(input) {
  const idx = Number(input.dataset.i);
  const q = input.value;
  const hits = productHits(q);
  const name = q.trim();
  const r = input.getBoundingClientRect();
  const m = posMenuEl();
  m.style.left = `${Math.min(Math.max(8, r.left), window.innerWidth - 280)}px`;
  m.style.top = `${Math.min(r.bottom + 4, window.innerHeight - 160)}px`;
  m.style.width = `${Math.max(r.width, 260)}px`;
  m.dataset.idx = String(idx);
  m.innerHTML =
    (hits.length
      ? hits
          .map(
            (p) =>
              `<button type="button" class="prod-hit" data-pick="${escapeHtml(String(p.id))}">${escapeHtml(p.name)} <span class="muted">${escapeHtml(p.category || "General")} · ${unitLabel(p.unit)} · stock ${productStock(store.db, p.id)}</span></button>`
          )
          .join("")
      : `<p class="muted prod-none">${name ? "No catalog match" : "Type a name or add a product"}</p>`) +
    `<button type="button" class="prod-create" data-create="1">+ Add ${
      name ? `“${escapeHtml(name)}” as new product` : "new product"
    }</button>`;
  m.hidden = false;
}

function fillCustomers() {
  const sel = document.getElementById("pos-customer");
  if (!sel) return;
  const cur = pos.customerId;
  if (document.activeElement === sel) return;
  const html =
    `<option value="${WALK_IN}">Walk-in</option>` +
    customers()
      .map((c) => `<option value="${c.id}" ${c.id === cur ? "selected" : ""}>${escapeHtml(c.name)}</option>`)
      .join("");
  if (sel.innerHTML === html) {
    sel.value = cur;
    return;
  }
  sel.innerHTML = html;
  sel.value = cur;
}

function nextInvoiceNo() {
  return nextNo(
    "INV-",
    store.db.invoices.map((x) => x.no)
  );
}

function fillMeta() {
  const date = document.getElementById("pos-date");
  const no = document.getElementById("pos-no");
  if (date && document.activeElement !== date) {
    if (!date.value) date.value = pos.date || localToday();
    pos.date = date.value;
  } else if (date) {
    pos.date = date.value;
  }
  if (no && document.activeElement !== no) no.value = nextInvoiceNo();
}

function lineHasProduct(it) {
  return !!(it && (it.productId || String(it.name || "").trim()));
}

function ensureBlankRow() {
  const last = pos.items[pos.items.length - 1];
  if (!last || lineHasProduct(last)) pos.items.push(blankLine());
  if (pos.items.length > 1) {
    const empty = pos.items.filter((it) => !lineHasProduct(it));
    if (empty.length > 1) {
      let kept = false;
      pos.items = pos.items.filter((it) => {
        if (lineHasProduct(it)) return true;
        if (!kept) {
          kept = true;
          return true;
        }
        return false;
      });
    }
  }
}

function applyProduct(i, id) {
  const p = products().find((x) => String(x.id) === String(id));
  if (!p) {
    pos.items[i] = blankLine();
    return;
  }
  const other = pos.items.find((x, idx) => idx !== i && String(x.productId) === String(p.id));
  if (other) {
    other.qty = num(other.qty) + num(pos.items[i].qty || 1);
    pos.items[i] = blankLine();
    toast("Qty added to the existing " + p.name + " row", { type: "ok" });
    return;
  }
  pos.items[i] = {
    productId: p.id,
    name: p.name,
    category: p.category || "",
    qty: num(pos.items[i].qty) || 1,
    unit: unitLabel(p.unit),
    rate: num(p.salePrice),
    cost: num(p.purchasePrice),
  };
}

function renderLines() {
  const body = document.getElementById("pos-lines");
  if (!body) return;
  ensureBlankRow();
  body.innerHTML = pos.items
    .map(
      (it, i) => `<tr>
        <td>${i + 1}</td>
        <td>
          <div class="prod-picker">
            <input class="pos-product-q" data-i="${i}" placeholder="Type product name…" value="${escapeHtml(it.name || "")}" autocomplete="off" aria-label="Product">
          </div>
        </td>
        <td class="pos-cat">${escapeHtml(it.category || "—")}</td>
        <td><input class="pos-qty" data-i="${i}" type="number" min="0.01" step="any" value="${it.qty}"></td>
        <td><select class="pos-unit" data-i="${i}">${unitOptions(it.unit)}</select></td>
        <td><input class="pos-rate" data-i="${i}" type="number" min="0" step="any" value="${it.rate}"></td>
        <td class="pos-line">${lineHasProduct(it) ? money(num(it.qty) * num(it.rate)) : "—"}</td>
        <td>${lineHasProduct(it) ? `<button type="button" class="pos-x" data-i="${i}" aria-label="Remove">×</button>` : ""}</td>
      </tr>`
    )
    .join("");

  body.querySelectorAll(".pos-product-q").forEach((inp) => {
    inp.onfocus = () => openPosMenu(inp);
    inp.oninput = () => openPosMenu(inp);
    inp.onkeydown = (e) => {
      if (e.key === "Escape") {
        hidePosMenu();
        return;
      }
      if (e.key !== "Enter") return;
      e.preventDefault();
      const hits = productHits(inp.value);
      const needle = inp.value.trim().toLowerCase();
      const exact = hits.find((p) => String(p.name).toLowerCase() === needle);
      const i = Number(inp.dataset.i);
      if (exact) {
        applyProduct(i, exact.id);
        hidePosMenu();
        paintCart();
      } else if (inp.value.trim()) {
        hidePosMenu();
        openProductForm(null, {
          defaults: { name: inp.value.trim() },
          onSaved: (rec) => {
            applyProduct(i, rec.id);
            paintCart();
          },
        });
      }
    };
  });
  body.querySelectorAll(".pos-qty").forEach((inp) => {
    inp.oninput = () => {
      const i = Number(inp.dataset.i);
      pos.items[i].qty = num(inp.value);
      const row = inp.closest("tr");
      if (row && lineHasProduct(pos.items[i])) {
        row.querySelector(".pos-line").textContent = money(num(pos.items[i].qty) * num(pos.items[i].rate));
      }
      paintTotals();
    };
  });
  body.querySelectorAll(".pos-unit").forEach((sel) => {
    sel.onchange = () => {
      pos.items[Number(sel.dataset.i)].unit = unitLabel(sel.value);
    };
  });
  body.querySelectorAll(".pos-rate").forEach((inp) => {
    inp.oninput = () => {
      const i = Number(inp.dataset.i);
      pos.items[i].rate = num(inp.value);
      const row = inp.closest("tr");
      if (row && lineHasProduct(pos.items[i])) {
        row.querySelector(".pos-line").textContent = money(num(pos.items[i].qty) * num(pos.items[i].rate));
      }
      paintTotals();
    };
  });
  body.querySelectorAll(".pos-x").forEach((b) => {
    b.onclick = () => {
      pos.items.splice(Number(b.dataset.i), 1);
      if (!pos.items.length) pos.items = [blankLine()];
      paintCart();
    };
  });
}

function paintTotals() {
  const t = totals();
  const set = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };
  set("pos-subtotal", money(t.subtotal));
  set("pos-total", money(t.total));
  set("pos-due", t.due ? money(t.due) : money(0));
}

function paintCart() {
  fillCustomers();
  fillMeta();
  renderLines();
  paintTotals();
  renderCatalog();
}

function renderCatalog() {
  const box = document.getElementById("pos-catalog");
  if (!box) return;
  const list = products().slice(0, 24);
  if (!list.length) {
    box.innerHTML = "";
    return;
  }
  box.innerHTML = list
    .map((p) => {
      const st = productStock(store.db, p.id);
      return `<button type="button" class="pos-chip" data-id="${p.id}">
        <strong>${escapeHtml(p.name)}</strong>
        <span>${escapeHtml(p.category || "—")} · ${unitLabel(p.unit)}</span>
        <span>${money(p.salePrice)} · stock ${st}</span>
      </button>`;
    })
    .join("");
  box.querySelectorAll(".pos-chip").forEach((b) => {
    b.onclick = () => addProduct(b.dataset.id);
  });
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
        String(p.code || "")
          .toLowerCase()
          .includes(s) ||
        String(p.category || "")
          .toLowerCase()
          .includes(s)
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
    const blank = pos.items.find((x) => !x.productId);
    const row = {
      productId: p.id,
      name: p.name,
      category: p.category || "",
      qty: 1,
      unit: unitLabel(p.unit),
      rate: num(p.salePrice),
      cost: num(p.purchasePrice),
    };
    if (blank) Object.assign(blank, row);
    else pos.items.push(row);
  }
  const search = document.getElementById("pos-search");
  if (search) search.value = "";
  const hits = document.getElementById("pos-hits");
  if (hits) {
    hits.hidden = true;
    hits.innerHTML = "";
  }
  paintCart();
  search?.focus();
}

function resetBill() {
  pos.items = [blankLine()];
  pos.discount = 0;
  pos.paid = 0;
  pos.method = "cash";
  pos.date = localToday();
  pos.customerId = WALK_IN;
  const d = document.getElementById("pos-discount");
  const p = document.getElementById("pos-paid");
  const dt = document.getElementById("pos-date");
  const m = document.getElementById("pos-method");
  if (d) d.value = 0;
  if (p) p.value = 0;
  if (dt) dt.value = pos.date;
  if (m) m.value = "cash";
  paintCart();
}

function pullCartFromDom() {
  document.querySelectorAll("#pos-lines tr").forEach((tr, i) => {
    if (!pos.items[i]) pos.items[i] = blankLine();
    const q = tr.querySelector(".pos-product-q");
    const qty = tr.querySelector(".pos-qty");
    const rate = tr.querySelector(".pos-rate");
    const unit = tr.querySelector(".pos-unit");
    if (q && q.value.trim()) pos.items[i].name = q.value.trim();
    if (qty && qty.value !== "") pos.items[i].qty = num(qty.value);
    if (rate && rate.value !== "") pos.items[i].rate = num(rate.value);
    if (unit) pos.items[i].unit = unitLabel(unit.value);
  });
}

function matchNamedProducts() {
  const list = products();
  for (const it of pos.items) {
    if (it.productId && list.some((p) => String(p.id) === String(it.productId))) continue;
    const name = String(it.name || "").trim();
    if (!name) continue;
    const lower = name.toLowerCase();
    const exact = list.find((p) => String(p.name).toLowerCase() === lower);
    const fuzzy = list.filter((p) => String(p.name).toLowerCase().includes(lower));
    const p = exact || (fuzzy.length === 1 ? fuzzy[0] : null);
    if (!p) continue;
    it.productId = p.id;
    it.name = p.name;
    it.category = p.category || it.category || "";
    if (!num(it.rate)) it.rate = num(p.salePrice);
    it.cost = num(p.purchasePrice);
    it.unit = it.unit || unitLabel(p.unit);
  }
}

function takeSearchIntoCart() {
  const search = document.getElementById("pos-search");
  const q = String(search?.value || "").trim();
  if (!q) return;
  const hits = productHits(q);
  const lower = q.toLowerCase();
  const exact = hits.find((p) => String(p.name).toLowerCase() === lower) || (hits.length === 1 ? hits[0] : null);
  if (exact) {
    addProduct(exact.id);
    return;
  }
  const blank = pos.items.find((it) => !lineHasProduct(it));
  if (blank) {
    blank.name = q;
  } else {
    pos.items.push({ ...blankLine(), name: q });
  }
  if (search) search.value = "";
}

async function completeSale(andPrint) {
  posError("");
  takeSearchIntoCart();
  pullCartFromDom();
  matchNamedProducts();
  const dateEl = document.getElementById("pos-date");
  pos.date = dateEl?.value || localToday();
  if (!pos.date) {
    posError("Date is required");
    return;
  }
  let items = filledItems();
  if (!items.length) {
    items = pos.items.filter((it) => String(it.name || "").trim());
  }
  if (!items.length) {
    posError("Type a product name or tap a product chip, then Save.");
    return;
  }
  for (const it of items) {
    if (num(it.qty) <= 0) it.qty = 1;
    if (!it.unit) it.unit = "packets";
    if (num(it.rate) < 0) {
      posError("Price cannot be negative");
      return;
    }
  }

  const t = totalsFromItems(
    items.map((it) => ({ ...it, productId: it.productId || "pending" })),
    pos.discount
  );
  let paid = num(pos.paid);
  if (pos.method === "credit") paid = 0;
  if (pos.method === "cash" && paid <= 0) paid = t.total;
  if (pos.method === "advance") {
    const adv = advanceBalance(store.db, "customer", pos.customerId);
    paid = Math.min(t.total, paid, adv);
    if (!pos.customerId || pos.customerId === WALK_IN) {
      posError("Advance needs a customer (not Walk-in)");
      return;
    }
  } else {
    paid = Math.min(t.total, Math.max(0, paid));
  }

  const saveBtns = ["pos-complete", "pos-complete-side", "pos-save-print", "pos-print-side"]
    .map((id) => document.getElementById(id))
    .filter(Boolean);
  saveBtns.forEach((b) => {
    b.disabled = true;
  });

  try {
    let created = 0;
    let stockNote = "";
    let doc = null;
    commit((db) => {
      const mapped = items.map((it) => {
        let pid = it.productId;
        let rec = db.products.find((p) => String(p.id) === String(pid));
        if (!rec) {
          rec = {
            id: uid(),
            name: String(it.name || "Item").trim(),
            code: "",
            category: it.category || "",
            unit: unitLabel(it.unit || "packets"),
            purchasePrice: num(it.cost) || num(it.rate),
            salePrice: num(it.rate),
            openingStock: num(it.qty) || 0,
            archived: false,
          };
          db.products.push(rec);
          created += 1;
        }
        pid = rec.id;
        return {
          productId: pid,
          name: rec.name,
          category: rec.category || "",
          qty: num(it.qty) || 1,
          unit: unitLabel(it.unit || rec.unit),
          rate: num(it.rate),
          cost: num(it.cost) || num(rec.purchasePrice),
          lineTotal: round2((num(it.qty) || 1) * num(it.rate)),
        };
      });
      const tot = totalsFromItems(mapped, pos.discount);
      let payAmt = paid;
      if (pos.method === "credit") payAmt = 0;
      if (pos.method === "cash" && payAmt <= 0) payAmt = tot.total;
      payAmt = Math.min(tot.total, Math.max(0, payAmt));
      doc = {
        id: uid(),
        no: nextNo(
          "INV-",
          db.invoices.map((x) => x.no)
        ),
        date: pos.date,
        customerId: pos.customerId || WALK_IN,
        items: mapped,
        discount: tot.discount,
        subtotal: tot.subtotal,
        total: tot.total,
        payment: { method: pos.method, amount: payAmt, bankName: "", reference: "" },
        note: "",
      };
      db.invoices.push(doc);
      const neg = wouldGoNegative(db, {});
      if (neg.length) {
        stockNote = neg.map((n) => n.name).join(", ");
        for (const n of neg) {
          const p = db.products.find((x) => String(x.id) === String(n.id));
          if (p) p.openingStock = num(p.openingStock) - n.stock;
        }
      }
    }, { undoLabel: "Undo sale" });

    if (!doc) {
      posError("Could not save this sale. Try again.");
      return;
    }
    let msg = "Sale " + doc.no + " saved";
    if (created) msg += ` · ${created} new product${created > 1 ? "s" : ""} added`;
    if (stockNote) msg += " · opening stock increased for " + stockNote;
    toast(msg, { type: "ok", timeout: 7000 });
    const saved = await pushCloud(store.db, { force: true });
    if (!saved) {
      toast("Bill is on this device. Cloud retry in a few seconds.", { type: "warn", timeout: 6000 });
    }
    document.dispatchEvent(new CustomEvent("ht:invoice-saved", { detail: { id: doc.id } }));
    if (andPrint) printHtml(invoiceHtml(doc, { kind: "sale" }));
    resetBill();
  } catch (err) {
    console.error(err);
    posError("Save failed: " + (err.message || "unknown error"));
  } finally {
    saveBtns.forEach((b) => {
      b.disabled = false;
    });
  }
}

export function startSaleFor(customerId) {
  pos.customerId = customerId || WALK_IN;
  if (pos.bound) {
    fillCustomers();
    paintTotals();
  }
}

export function bindPOS() {
  if (pos.bound) {
    paintCart();
    return;
  }
  pos.bound = true;
  const search = document.getElementById("pos-search");
  const hits = document.getElementById("pos-hits");
  if (search) {
    search.oninput = () => searchHits(search.value);
    search.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const first = hits?.querySelector(".pos-hit[data-id]");
        if (first) addProduct(first.dataset.id);
      }
      if (e.key === "Escape" && hits) hits.hidden = true;
    };
  }
  document.addEventListener("click", (e) => {
    if (hits && !e.target.closest(".pos-search-wrap")) hits.hidden = true;
    if (!e.target.closest(".pos-product-q") && !e.target.closest(".prod-menu")) hidePosMenu();
  });
  const cust = document.getElementById("pos-customer");
  if (cust) cust.onchange = (e) => {
    pos.customerId = e.target.value;
    paintTotals();
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
  document.getElementById("pos-complete")?.addEventListener("click", () => completeSale(false));
  document.getElementById("pos-complete-side")?.addEventListener("click", () => completeSale(false));
  document.getElementById("pos-save-print")?.addEventListener("click", () => completeSale(true));
  document.getElementById("pos-print-side")?.addEventListener("click", () => completeSale(true));
  document.getElementById("pos-reset")?.addEventListener("click", () => resetBill());
  document.getElementById("pos-date")?.addEventListener("change", (e) => {
    pos.date = e.target.value;
  });
  document.getElementById("pos-add-cust").onclick = () => {
    const name = prompt("New customer name");
    if (!name || !name.trim()) return;
    const rec = { id: uid(), name: name.trim(), phone: "", address: "", archived: false };
    commit((db) => db.customers.push(rec));
    pos.customerId = rec.id;
    fillCustomers();
    toast("Customer added", { type: "ok" });
  };
  paintCart();
}

/** Update invoice no / customers / totals without wiping an in-progress cart. */
export function refreshPOS() {
  if (!document.getElementById("pos-search")) return;
  paintTotals();
  if (isEditingField()) return;
  fillCustomers();
  fillMeta();
  renderCatalog();
  if (document.querySelector(".page.active")?.id === "sales") renderLines();
}
