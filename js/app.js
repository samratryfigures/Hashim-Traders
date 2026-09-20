import { localToday, rangeForPreset, daysInRange, money, escapeHtml, downloadJson, WALK_IN } from "./utils.js";
import { store, subscribe, loadLocal, setSyncHandler, payloadInfo, importBackup, setDb, commit } from "./store.js";
import {
  dashboardStats,
  chartSeries,
  productStock,
  payStatus,
  partyBalance,
  balanceLabel,
  partyName,
  partyLedger,
  ledgerSummary,
  productHasTransactions,
  partyHasTransactions,
  paidAmount,
  wouldGoNegative,
} from "./compute.js";
import { toast, bindTable, badge, confirmDialog, openModal } from "./ui.js";
import {
  openDocumentForm,
  openPaymentForm,
  openReturnForm,
  openProductForm,
  openPartyForm,
  openExpenseForm,
  tryDelete,
} from "./forms.js";
import { invoiceHtml, creditNoteHtml, statementHtml, printHtml } from "./print.js";
import { login, logout, checkSession, loadFromCloud, syncHandler, pushCloud } from "./sync.js";
import { normalizeDb } from "./migrate.js";

setSyncHandler(syncHandler);

const pages = {};
let salesChart, expenseChart;
let khataCtx = null;

function $(id) {
  return document.getElementById(id);
}

function setTheme(theme) {
  store.theme = theme;
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("ht_theme", theme);
}

function showPage(id) {
  document.querySelectorAll(".page").forEach((p) => p.classList.toggle("active", p.id === id));
  document.querySelectorAll("#nav button[data-page]").forEach((b) => b.classList.toggle("active", b.dataset.page === id));
  if (id !== "khata") khataCtx = null;
  renderPage(id);
}

function currentRange() {
  return rangeForPreset(store.filter.preset, store.filter.from, store.filter.to);
}

function renderFilterBar(el) {
  if (!el) return;
  const presets = [
    ["today", "Today"],
    ["yesterday", "Yesterday"],
    ["week", "This Week"],
    ["month", "This Month"],
    ["lastMonth", "Last Month"],
    ["year", "This Year"],
    ["all", "All Time"],
    ["custom", "Custom"],
  ];
  const r = currentRange();
  el.innerHTML = `
    <div class="filter-bar">
      ${presets.map(([id, lab]) => `<button type="button" class="chip ${store.filter.preset === id ? "on" : ""}" data-preset="${id}">${lab}</button>`).join("")}
      <label class="custom-dates ${store.filter.preset === "custom" ? "" : "hide"}">From <input type="date" id="cf-from" value="${store.filter.from || ""}"> to <input type="date" id="cf-to" value="${store.filter.to || ""}"></label>
    </div>
    <p class="muted">${r.from || "…"} → ${r.to || "…"} ${daysInRange(r.from, r.to) <= 31 ? "· grouped by day" : "· grouped by month"}</p>`;
  el.querySelectorAll("[data-preset]").forEach((b) => {
    b.onclick = () => {
      store.filter.preset = b.dataset.preset;
      if (b.dataset.preset === "custom") {
        store.filter.from = store.filter.from || localToday();
        store.filter.to = store.filter.to || localToday();
      }
      render();
    };
  });
  const from = el.querySelector("#cf-from");
  const to = el.querySelector("#cf-to");
  if (from) from.onchange = () => { store.filter.from = from.value; render(); };
  if (to) to.onchange = () => { store.filter.to = to.value; render(); };
}

function renderDashboard() {
  renderFilterBar($("dash-filter"));
  const s = dashboardStats(store.db, currentRange());
  const cards = [
    ["Sales", money(s.sales)],
    ["Sales Returns", money(s.salesReturns)],
    ["Purchases", money(s.purchases)],
    ["Expenses", money(s.expenses)],
    ["Gross Profit", money(s.gross)],
    ["Net Profit", money(s.net)],
    ["Cash received", money(s.cashReceived)],
    ["Bank received", money(s.bankReceived)],
    ["Stock items", s.stockItems],
    ["Stock value", money(s.stockValue)],
    ["Total Receivable", money(s.receivable)],
    ["Total Payable", money(s.payable)],
  ];
  $("dash-cards").innerHTML = cards.map(([l, v]) => `<div class="card"><div class="label">${l}</div><div class="value">${v}</div></div>`).join("");
  drawCharts();
}

function drawCharts() {
  const range = currentRange();
  const sales = chartSeries(store.db, range, "sales");
  const exps = chartSeries(store.db, range, "expenses");
  const dark = store.theme === "dark";
  const tick = dark ? "#cbd5e1" : "#475569";
  const grid = dark ? "rgba(148,163,184,.2)" : "rgba(15,23,42,.08)";

  function make(canvas, data, color, existing) {
    if (!canvas || typeof Chart === "undefined") return existing;
    if (existing) existing.destroy();
    return new Chart(canvas, {
      type: "bar",
      data: {
        labels: data.labels,
        datasets: [{ data: data.values, backgroundColor: color, borderRadius: 6, maxBarThickness: 28 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => money(c.parsed.y) } } },
        scales: {
          x: { ticks: { color: tick, maxRotation: 45 }, grid: { display: false } },
          y: { ticks: { color: tick, callback: (v) => (v >= 1000 ? v / 1000 + "k" : v) }, grid: { color: grid } },
        },
        onClick: (_e, els) => {
          if (!els.length) return;
          const label = data.labels[els[0].index];
          if (data.mode === "day") {
            store.filter.preset = "custom";
            store.filter.from = label;
            store.filter.to = label;
          } else {
            store.filter.preset = "custom";
            store.filter.from = label + "-01";
            const [y, m] = label.split("-").map(Number);
            const last = new Date(y, m, 0).getDate();
            store.filter.to = `${label}-${String(last).padStart(2, "0")}`;
          }
          render();
          toast("Showing " + label, { type: "ok" });
        },
      },
    });
  }
  salesChart = make($("salesChart"), sales, "#0f766e", salesChart);
  expenseChart = make($("expenseChart"), exps, "#b45309", expenseChart);
}

function renderProducts() {
  const host = $("product-table");
  bindTable(host, {
    searchPlaceholder: "Search products…",
    empty: "No products yet",
    emptyHint: "Add items you buy and sell. Stock is calculated from opening stock, purchases, sales and returns.",
    columns: [
      { key: "code", label: "Code" },
      { key: "name", label: "Product" },
      { key: "category", label: "Category" },
      { key: "purchasePrice", label: "Purchase", render: (r) => money(r.purchasePrice) },
      { key: "salePrice", label: "Sale", render: (r) => money(r.salePrice) },
      { key: "stock", label: "Stock" },
      { key: "archived", label: "", render: (r) => (r.archived ? `<span class="badge">Archived</span>` : "") },
    ],
    rows: () =>
      store.db.products
        .filter((p) => store.showArchived || !p.archived)
        .map((p) => ({ ...p, stock: productStock(store.db, p.id) })),
    actions: [
      { id: "edit", label: "Edit", onClick: (r) => openProductForm(store.db.products.find((p) => p.id === r.id)) },
      { id: "del", label: "Delete", onClick: (r) => deleteOrArchive("product", r) },
    ],
  });
}

function invoiceRows() {
  return [...store.db.invoices].reverse().map((inv) => ({
    ...inv,
    customer: partyName(store.db, "customer", inv.customerId),
    status: payStatus(inv),
    paid: paidAmount(inv),
    _clickable: true,
  }));
}

function renderSales() {
  bindTable($("sales-table"), {
    searchPlaceholder: "Search invoices…",
    empty: "No sales yet",
    emptyHint: "Create one invoice per visit. Add several products on the same bill.",
    chips: [
      { id: "all", label: "All" },
      { id: "paid", label: "Paid" },
      { id: "partial", label: "Partial" },
      { id: "unpaid", label: "Unpaid" },
    ],
    filterChip: (r, chip) => r.status === chip,
    sort: { key: "date", dir: "desc" },
    columns: [
      { key: "date", label: "Date" },
      { key: "no", label: "Invoice" },
      { key: "customer", label: "Customer" },
      { key: "total", label: "Total", render: (r) => money(r.total) },
      { key: "paid", label: "Paid", render: (r) => money(r.paid) },
      { key: "status", label: "Status", render: (r) => badge(r.status) },
    ],
    rows: invoiceRows,
    actions: [
      { id: "view", label: "View", onClick: (r) => viewDoc(r, "sale") },
      { id: "print", label: "Print", onClick: (r) => printDoc(r, "sale") },
      { id: "edit", label: "Edit", onClick: (r) => openDocumentForm({ kind: "sale", existing: store.db.invoices.find((x) => x.id === r.id) }) },
      { id: "del", label: "Delete", onClick: (r) => tryDelete("invoice", r) },
    ],
  });
}

function renderPurchases() {
  bindTable($("purchase-table"), {
    searchPlaceholder: "Search purchases…",
    empty: "No purchases yet",
    emptyHint: "Record supplier bills with multiple products on one voucher.",
    chips: [
      { id: "all", label: "All" },
      { id: "paid", label: "Paid" },
      { id: "partial", label: "Partial" },
      { id: "unpaid", label: "Unpaid" },
    ],
    filterChip: (r, chip) => r.status === chip,
    sort: { key: "date", dir: "desc" },
    columns: [
      { key: "date", label: "Date" },
      { key: "no", label: "Bill" },
      { key: "supplier", label: "Supplier" },
      { key: "total", label: "Total", render: (r) => money(r.total) },
      { key: "status", label: "Status", render: (r) => badge(r.status) },
    ],
    rows: () =>
      [...store.db.purchases].reverse().map((p) => ({
        ...p,
        supplier: partyName(store.db, "supplier", p.supplierId),
        status: payStatus(p),
      })),
    actions: [
      { id: "view", label: "View", onClick: (r) => viewDoc(r, "purchase") },
      { id: "print", label: "Print", onClick: (r) => printDoc(r, "purchase") },
      { id: "edit", label: "Edit", onClick: (r) => openDocumentForm({ kind: "purchase", existing: store.db.purchases.find((x) => x.id === r.id) }) },
      { id: "del", label: "Delete", onClick: (r) => tryDelete("purchase", r) },
    ],
  });
}

function viewDoc(row, kind) {
  const doc = kind === "sale" ? store.db.invoices.find((x) => x.id === row.id) : store.db.purchases.find((x) => x.id === row.id);
  if (!doc) return;
  openModal({
    title: doc.no,
    width: "modal-wide",
    html: `<div class="view-toolbar">
        <label class="switch"><input type="checkbox" id="thermal-tog"> 80mm receipt</label>
        <button type="button" class="btn primary" id="do-print">Print</button>
      </div>
      <div id="inv-preview">${invoiceHtml(doc, { kind })}</div>`,
    onOpen: (wrap) => {
      const tog = wrap.querySelector("#thermal-tog");
      tog.onchange = () => {
        wrap.querySelector("#inv-preview").innerHTML = invoiceHtml(doc, { kind, thermal: tog.checked });
      };
      wrap.querySelector("#do-print").onclick = () => printHtml(invoiceHtml(doc, { kind, thermal: tog.checked }));
    },
  });
}

function printDoc(row, kind) {
  const doc = kind === "sale" ? store.db.invoices.find((x) => x.id === row.id) : store.db.purchases.find((x) => x.id === row.id);
  if (doc) printHtml(invoiceHtml(doc, { kind }));
}

function renderExpenses() {
  bindTable($("expense-table"), {
    empty: "No expenses yet",
    sort: { key: "date", dir: "desc" },
    columns: [
      { key: "date", label: "Date" },
      { key: "name", label: "Expense" },
      { key: "amount", label: "Amount", render: (r) => money(r.amount) },
      { key: "note", label: "Note" },
    ],
    rows: () => [...store.db.expenses].reverse(),
    actions: [
      { id: "edit", label: "Edit", onClick: (r) => openExpenseForm(r) },
      { id: "del", label: "Delete", onClick: (r) => tryDelete("expense", r) },
    ],
  });
}

function renderPeople(kind) {
  const isC = kind === "customer";
  bindTable($(isC ? "customer-table" : "supplier-table"), {
    empty: isC ? "No customers yet" : "No suppliers yet",
    columns: [
      { key: "name", label: "Name" },
      { key: "phone", label: "Phone" },
      { key: "address", label: "Address" },
      { key: "balText", label: "Balance", render: (r) => `<span class="badge badge-${r.kind}">${escapeHtml(r.balText)}</span>` },
    ],
    rows: () =>
      (isC ? store.db.customers : store.db.suppliers)
        .filter((p) => store.showArchived || !p.archived)
        .map((p) => {
          const bal = partyBalance(store.db, kind, p.id);
          const lab = balanceLabel(kind, bal);
          return { ...p, bal, balText: lab.text, kind: lab.kind };
        }),
    actions: [
      { id: "khata", label: "View Khata", onClick: (r) => openKhata(kind, r.id) },
      { id: "pay", label: isC ? "Receive" : "Pay", onClick: (r) => openPaymentForm({ partyType: kind, partyId: r.id }) },
      { id: "edit", label: "Edit", onClick: (r) => openPartyForm(kind, r) },
      { id: "del", label: "Delete", onClick: (r) => deleteOrArchive(kind, r) },
    ],
  });
}

function renderPayments() {
  bindTable($("payment-table"), {
    empty: "No standalone payments yet",
    sort: { key: "date", dir: "desc" },
    columns: [
      { key: "date", label: "Date" },
      { key: "no", label: "Ref" },
      { key: "who", label: "Party" },
      { key: "amount", label: "Amount", render: (r) => money(r.amount) },
      { key: "method", label: "Method" },
      { key: "note", label: "Note" },
    ],
    rows: () =>
      [...store.db.payments].reverse().map((p) => ({
        ...p,
        who: (p.partyType === "customer" ? "C · " : "S · ") + partyName(store.db, p.partyType, p.partyId),
      })),
    actions: [
      { id: "edit", label: "Edit", onClick: (r) => openPaymentForm({ partyType: r.partyType, partyId: r.partyId, existing: r }) },
      { id: "del", label: "Delete", onClick: (r) => tryDelete("payment", r) },
    ],
  });
}

function renderReturns() {
  bindTable($("return-table"), {
    empty: "No returns yet",
    sort: { key: "date", dir: "desc" },
    columns: [
      { key: "date", label: "Date" },
      { key: "no", label: "Credit note" },
      { key: "type", label: "Type" },
      { key: "who", label: "Party" },
      { key: "total", label: "Amount", render: (r) => money(r.total) },
      { key: "settlement", label: "Settlement" },
    ],
    rows: () =>
      [...store.db.returns].reverse().map((r) => ({
        ...r,
        who: partyName(store.db, r.type === "sale" ? "customer" : "supplier", r.partyId),
      })),
    actions: [
      { id: "print", label: "Print", onClick: (r) => printHtml(creditNoteHtml(r)) },
      { id: "edit", label: "Edit", onClick: (r) => openReturnForm({ type: r.type, existing: r }) },
      { id: "del", label: "Delete", onClick: (r) => tryDelete("return", r) },
    ],
  });
}

function renderReports() {
  renderFilterBar($("report-filter"));
  const s = dashboardStats(store.db, currentRange());
  $("report-cards").innerHTML = [
    ["Sales", money(s.sales)],
    ["Purchases", money(s.purchases)],
    ["Expenses", money(s.expenses)],
    ["Gross Profit", money(s.gross)],
    ["Net Profit", money(s.net)],
    ["Receivable", money(s.receivable)],
    ["Payable", money(s.payable)],
  ]
    .map(([l, v]) => `<div class="card"><div class="label">${l}</div><div class="value">${v}</div></div>`)
    .join("");
}

function renderSettings() {
  const s = store.db.settings;
  $("set-name").value = s.businessName || "";
  $("set-phone").value = s.phone || "";
  $("set-address").value = s.address || "";
  $("set-footer").value = s.invoiceFooter || "";
  $("show-archived").checked = store.showArchived;
}

function openKhata(kind, id) {
  khataCtx = { kind, id };
  showPage("khata");
}

function renderKhata() {
  if (!khataCtx) {
    $("khata").innerHTML = `<div class="panel"><p class="muted">Open a customer or supplier and click View Khata.</p></div>`;
    return;
  }
  const { kind, id } = khataCtx;
  const from = $("khata-from")?.value || "";
  const to = $("khata-to")?.value || "";
  const range = { from: from || null, to: to || null };
  const name = partyName(store.db, kind, id);
  const sum = ledgerSummary(store.db, kind, id);
  const { entries, opening, closing } = partyLedger(store.db, kind, id, range);
  const lab = balanceLabel(kind, sum.remaining);
  $("khata").innerHTML = `
    <div class="page-head">
      <button type="button" class="btn ghost" id="khata-back">← Back</button>
      <h2>${escapeHtml(name)} · Khata</h2>
      <div class="row-split">
        <button type="button" class="btn" id="khata-pay">${kind === "customer" ? "Receive Payment" : "Make Payment"}</button>
        <button type="button" class="btn primary" id="khata-print">Print Statement</button>
      </div>
    </div>
    <div class="cards">
      <div class="card"><div class="label">Total billed</div><div class="value">${money(sum.billed)}</div></div>
      <div class="card"><div class="label">Total paid</div><div class="value">${money(sum.paid)}</div></div>
      <div class="card"><div class="label">Total returned</div><div class="value">${money(sum.returned)}</div></div>
      <div class="card"><div class="label">Remaining</div><div class="value">${escapeHtml(lab.text)}</div></div>
    </div>
    <div class="panel">
      <div class="filter-bar">
        <label>From <input type="date" id="khata-from" value="${from}"></label>
        <label>To <input type="date" id="khata-to" value="${to}"></label>
        <span class="muted">Opening ${money(opening)} · Closing ${money(closing)}</span>
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Date</th><th>Type</th><th>Ref</th><th>Details</th><th>Debit</th><th>Credit</th><th>Balance</th><th>Method</th></tr></thead>
          <tbody>
            ${
              entries.length
                ? entries
                    .map(
                      (e) => `<tr class="clickable" data-src='${JSON.stringify(e.source || {})}'>
                        <td>${e.date}</td><td>${e.type}</td><td>${escapeHtml(e.ref)}</td><td>${escapeHtml(e.details)}</td>
                        <td>${e.debit ? money(e.debit) : ""}</td><td>${e.credit ? money(e.credit) : ""}</td>
                        <td>${money(e.balance)}</td><td>${escapeHtml(e.method)}</td></tr>`
                    )
                    .join("")
                : `<tr><td colspan="8">No entries in this range.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>`;
  $("khata-back").onclick = () => showPage(kind === "customer" ? "customers" : "suppliers");
  $("khata-pay").onclick = () => openPaymentForm({ partyType: kind, partyId: id });
  $("khata-print").onclick = () => printHtml(statementHtml(kind, id, range));
  $("khata-from").onchange = renderKhata;
  $("khata-to").onchange = renderKhata;
  $("khata").querySelectorAll("tr[data-src]").forEach((tr) => {
    tr.onclick = () => {
      const src = JSON.parse(tr.dataset.src || "{}");
      if (src.kind === "invoice") {
        const doc = store.db.invoices.find((x) => x.id === src.id);
        if (doc) viewDoc(doc, "sale");
      }
      if (src.kind === "purchase") {
        const doc = store.db.purchases.find((x) => x.id === src.id);
        if (doc) viewDoc(doc, "purchase");
      }
      if (src.kind === "return") {
        const doc = store.db.returns.find((x) => x.id === src.id);
        if (doc) printHtml(creditNoteHtml(doc));
      }
    };
  });
}

async function deleteOrArchive(kind, rec) {
  const has =
    kind === "product" ? productHasTransactions(store.db, rec.id) : partyHasTransactions(store.db, kind, rec.id);
  if (has) {
    const ok = await confirmDialog({
      title: "Archive instead?",
      message: "This record has transactions, so it cannot be permanently deleted. Archive (hide) it instead?",
      ok: "Archive / Hide",
      danger: false,
    });
    if (!ok) return;
    commit((db) => {
      const list = kind === "product" ? db.products : kind === "customer" ? db.customers : db.suppliers;
      const row = list.find((x) => x.id === rec.id);
      if (row) row.archived = true;
    });
    toast("Archived", { type: "ok" });
    return;
  }
  await tryDelete(kind, rec);
}

function renderPage(id) {
  if (id === "dashboard") renderDashboard();
  if (id === "products") renderProducts();
  if (id === "sales") renderSales();
  if (id === "purchases") renderPurchases();
  if (id === "expenses") renderExpenses();
  if (id === "customers") renderPeople("customer");
  if (id === "suppliers") renderPeople("supplier");
  if (id === "payments") renderPayments();
  if (id === "returns") renderReturns();
  if (id === "reports") renderReports();
  if (id === "settings") renderSettings();
  if (id === "khata") renderKhata();
}

function render() {
  const active = document.querySelector(".page.active")?.id || "dashboard";
  $("biz-title").textContent = store.db.settings.businessName || "HASHMI TRADERS";
  renderPage(active);
}

pages.render = render;

function bindChrome() {
  document.querySelectorAll("#nav button[data-page]").forEach((b) => {
    b.onclick = () => {
      showPage(b.dataset.page);
      $("sidebar").classList.remove("open");
    };
  });
  $("menu-btn").onclick = () => $("sidebar").classList.toggle("open");
  $("theme-btn").onclick = () => setTheme(store.theme === "dark" ? "light" : "dark");
  $("logout-btn").onclick = async () => {
    await logout();
    location.reload();
  };
  $("sync-now").onclick = () => pushCloud(store.db);
  $("new-sale").onclick = () => openDocumentForm({ kind: "sale" });
  $("new-purchase").onclick = () => openDocumentForm({ kind: "purchase" });
  $("new-product").onclick = () => openProductForm();
  $("new-expense").onclick = () => openExpenseForm();
  $("new-customer").onclick = () => openPartyForm("customer");
  $("new-supplier").onclick = () => openPartyForm("supplier");
  $("recv-pay").onclick = () => openPaymentForm({ partyType: "customer" });
  $("make-pay").onclick = () => openPaymentForm({ partyType: "supplier" });
  $("new-sret").onclick = () => openReturnForm({ type: "sale" });
  $("new-pret").onclick = () => openReturnForm({ type: "purchase" });
  $("export-json").onclick = () => downloadJson("hashmi-traders-backup.json", store.db);
  $("import-json").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const db = importBackup(text);
      setDb(db, { bump: true });
      toast("Backup imported", { type: "ok" });
    } catch (err) {
      toast("Could not import: " + err.message, { type: "err" });
    }
    e.target.value = "";
  };
  $("print-report").onclick = () => window.print();
  $("settings-form").onsubmit = (e) => {
    e.preventDefault();
    commit((db) => {
      db.settings.businessName = $("set-name").value.trim() || "HASHMI TRADERS";
      db.settings.phone = $("set-phone").value.trim();
      db.settings.address = $("set-address").value.trim();
      db.settings.invoiceFooter = $("set-footer").value.trim();
    });
    toast("Settings saved", { type: "ok" });
  };
  $("show-archived").onchange = (e) => {
    store.showArchived = e.target.checked;
    render();
  };

  document.addEventListener("keydown", (e) => {
    const tag = document.activeElement?.tagName;
    if (e.key === "Escape") document.querySelector(".modal-backdrop")?.remove();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      const btn = document.querySelector(".modal .btn.primary");
      if (btn) btn.click();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") {
      if (document.querySelector(".print-sheet")) return;
    }
    if (e.key.toLowerCase() === "n" && tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") {
      const p = document.querySelector(".page.active")?.id;
      if (p === "sales") openDocumentForm({ kind: "sale" });
      if (p === "purchases") openDocumentForm({ kind: "purchase" });
      if (p === "products") openProductForm();
      if (p === "expenses") openExpenseForm();
    }
  });
}

function showApp() {
  $("login-screen").hidden = true;
  $("app").hidden = false;
  setTheme(store.theme);
  bindChrome();
  subscribe(render);
  render();
}

function showLogin(err) {
  $("login-screen").hidden = false;
  $("app").hidden = true;
  $("login-error").hidden = !err;
  $("login-error").textContent = err || "";
}

async function boot() {
  const migrated = loadLocal();
  if (migrated.migrated) toast("Old records were upgraded to invoices. Stock levels kept.", { type: "ok", timeout: 6000 });

  const session = await checkSession();
  if (session.auth || session.offline) {
    if ($("logout-btn")) $("logout-btn").hidden = true;
    await afterLogin();
    return;
  }
  $("logout-btn").hidden = false;
  showLogin();
  $("login-form").onsubmit = async (e) => {
    e.preventDefault();
    $("login-btn").disabled = true;
    const start = Date.now();
    const result = await login($("password").value);
    const wait = 650 - (Date.now() - start);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    $("login-btn").disabled = false;
    if (!result.ok) {
      showLogin(result.error || "Wrong password");
      return;
    }
    await afterLogin();
  };
}

async function afterLogin() {
  showApp();
  const cloud = await loadFromCloud();
  if (cloud.offline) toast("Working from this device until the cloud is reachable.", { type: "warn" });
  const info = payloadInfo();
  if (info.warn) toast(`Database size ${info.mb} MB`, { type: "warn" });
}

boot();
