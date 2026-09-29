import { money, escapeHtml, localToday } from "./utils.js";

export function toast(message, { type = "info", timeout = 4200, action } = {}) {
  let host = document.getElementById("toasts");
  if (!host) {
    host = document.createElement("div");
    host.id = "toasts";
    host.className = "toasts";
    document.body.appendChild(host);
  }
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span>${escapeHtml(message)}</span>`;
  if (action) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = action.label;
    btn.onclick = () => {
      action.onClick();
      el.remove();
    };
    el.appendChild(btn);
  }
  host.appendChild(el);
  if (timeout) setTimeout(() => el.remove(), timeout);
}

export function confirmDialog({ title, message, ok = "Delete", danger = true }) {
  return new Promise((resolve) => {
    const wrap = modalShell();
    wrap.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <h3>${escapeHtml(title)}</h3>
        <p class="muted">${escapeHtml(message)}</p>
        <div class="modal-actions">
          <button type="button" class="btn ghost" data-act="no">Cancel</button>
          <button type="button" class="btn ${danger ? "danger" : "primary"}" data-act="yes">${escapeHtml(ok)}</button>
        </div>
      </div>`;
    let pointerDown = null;
    wrap.addEventListener("pointerdown", (e) => {
      pointerDown = e.target;
    });
    wrap.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-act]");
      if (btn && wrap.contains(btn)) {
        wrap.remove();
        resolve(btn.dataset.act === "yes");
        return;
      }
      if (e.target === wrap && pointerDown === wrap) {
        wrap.remove();
        resolve(false);
      }
    });
    document.body.appendChild(wrap);
    wrap.querySelector("[data-act=no]").focus();
  });
}

export function modalShell() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.tabIndex = -1;
  const stack = document.querySelectorAll(".modal-backdrop").length;
  wrap.style.zIndex = String(50 + stack * 10);
  return wrap;
}

export function openModal({ title, html, width, onOpen }) {
  const wrap = modalShell();
  wrap.innerHTML = `
    <div class="modal ${width || ""}" role="dialog" aria-modal="true">
      <div class="modal-head">
        <h3>${escapeHtml(title)}</h3>
        <button type="button" class="icon-btn" data-close aria-label="Close">×</button>
      </div>
      <div class="modal-body">${html}</div>
    </div>`;
  const close = () => wrap.remove();
  let pointerDown = null;
  const ignoreBackdropUntil = Date.now() + 500;
  wrap.addEventListener("pointerdown", (e) => {
    pointerDown = e.target;
  });
  wrap.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) {
      close();
      return;
    }
    /* Ignore the click that opened this modal (nested product form, native <select>). */
    if (Date.now() < ignoreBackdropUntil) return;
    if (e.target === wrap && pointerDown === wrap) close();
  });
  document.body.appendChild(wrap);
  if (onOpen) onOpen(wrap, close);
  return { el: wrap, close };
}

export function badge(status) {
  const map = { paid: "Paid", partial: "Partial", unpaid: "Unpaid" };
  return `<span class="badge badge-${status}">${map[status] || status}</span>`;
}

export function emptyState(text, hint) {
  return `<div class="empty-state"><strong>${escapeHtml(text)}</strong><p>${escapeHtml(hint || "")}</p></div>`;
}

export function skeleton(n = 4) {
  return `<div class="skeletons">${Array.from({ length: n }, () => `<div class="skeleton"></div>`).join("")}</div>`;
}

export function isEditingField() {
  const ae = document.activeElement;
  if (!ae || ae === document.body || ae === document.documentElement) return false;
  if (ae.isContentEditable) return true;
  const tag = ae.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const t = String(ae.type || "text").toLowerCase();
    return !["button", "submit", "reset", "checkbox", "radio", "file", "hidden", "color"].includes(t);
  }
  return false;
}

export function bindTable(container, opts) {
  if (!container) return null;
  container._htOpts = opts;
  const state = (container._htState ||= {
    q: "",
    sort: opts.sort || { key: opts.columns[0]?.key, dir: "desc" },
    page: 1,
    chip: opts.chip || "all",
    pageSize: opts.pageSize || 25,
  });
  if (opts.pageSize) state.pageSize = opts.pageSize;

  function rowList() {
    const opts = container._htOpts;
    let list = opts.rows() || [];
    if (opts.filterChip && state.chip !== "all") list = list.filter((r) => opts.filterChip(r, state.chip));
    const q = state.q.trim().toLowerCase();
    if (q) {
      list = list.filter((r) =>
        (opts.searchKeys || opts.columns.map((c) => c.key)).some((k) => String(r[k] ?? "").toLowerCase().includes(q))
      );
    }
    const { key, dir } = state.sort;
    list = [...list].sort((a, b) => {
      const va = a[key];
      const vb = b[key];
      if (typeof va === "number" && typeof vb === "number") return dir === "asc" ? va - vb : vb - va;
      return dir === "asc" ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
    });
    return list;
  }

  function paint() {
    const opts = container._htOpts;
    if (!container._htShell) {
      container._htShell = true;
      container.innerHTML = `
      <div class="table-tools">
        <input type="text" class="search" inputmode="search" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(opts.searchPlaceholder || "Search…")}">
        <div class="chips"></div>
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead></thead>
          <tbody></tbody>
        </table>
      </div>
      <div class="pager"></div>`;
      const searchBox = container.querySelector(".search");
      searchBox.value = state.q;
      searchBox.addEventListener("input", (e) => {
        state.q = e.target.value;
        state.page = 1;
        paint();
      });
      container.addEventListener("click", (e) => {
        const opts = container._htOpts;
        const chip = e.target.closest("[data-chip]");
        if (chip) {
          state.chip = chip.dataset.chip;
          state.page = 1;
          paint();
          return;
        }
        const th = e.target.closest("[data-sort]");
        if (th && container.contains(th)) {
          const key = th.dataset.sort;
          if (state.sort.key === key) state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc";
          else state.sort = { key, dir: "asc" };
          paint();
          return;
        }
        const pg = e.target.closest("[data-pg]");
        if (pg) {
          state.page += Number(pg.dataset.pg);
          paint();
          return;
        }
        const actBtn = e.target.closest("[data-act]");
        if (actBtn) {
          e.stopPropagation();
          const act = (opts.actions || []).find((a) => a.id === actBtn.dataset.act);
          const all = rowList();
          const row = all.find((r) => String(r.id) === String(actBtn.dataset.id));
          if (act && row) act.onClick(row);
          return;
        }
        const tr = e.target.closest("tbody tr[data-id]");
        if (tr && opts.onRowClick) {
          const row = rowList().find((r) => String(r.id) === String(tr.dataset.id));
          if (row) opts.onRowClick(row);
        }
      });
    }

    const searchBox = container.querySelector(".search");
    searchBox.placeholder = opts.searchPlaceholder || "Search…";
    const typingSearch = document.activeElement === searchBox;
    if (!typingSearch) searchBox.value = state.q;

    const all = rowList();
    const pages = Math.max(1, Math.ceil(all.length / state.pageSize));
    if (state.page > pages) state.page = pages;
    const slice = all.slice((state.page - 1) * state.pageSize, state.page * state.pageSize);
    if (!typingSearch) {
      container.querySelector(".chips").innerHTML = (opts.chips || [])
        .map((c) => `<button type="button" class="chip ${state.chip === c.id ? "on" : ""}" data-chip="${c.id}">${escapeHtml(c.label)}</button>`)
        .join("");
      container.querySelector("thead").innerHTML = `<tr>${opts.columns
        .map(
          (c) =>
            `<th data-sort="${c.key}" class="${state.sort.key === c.key ? "sorted " + state.sort.dir : ""}">${escapeHtml(c.label)}</th>`
        )
        .join("")}<th></th></tr>`;
    }
    container.querySelector("tbody").innerHTML = slice.length
      ? slice
          .map((r) => {
            const tds = opts.columns.map((c) => `<td>${c.render ? c.render(r) : escapeHtml(r[c.key] ?? "")}</td>`).join("");
            const actions = (opts.actions || [])
              .map((a) => `<button type="button" class="btn sm ghost" data-act="${a.id}" data-id="${r.id}">${a.label}</button>`)
              .join("");
            return `<tr data-id="${r.id}" class="${r._clickable ? "clickable" : ""}">${tds}<td class="td-actions">${actions}</td></tr>`;
          })
          .join("")
      : `<tr><td colspan="${opts.columns.length + 1}">${emptyState(opts.empty || "No records yet", opts.emptyHint || "Add the first one using the form above.")}</td></tr>`;
    container.querySelector(".pager").innerHTML = `
        <span>${all.length} record${all.length === 1 ? "" : "s"}</span>
        <div>
          <button type="button" class="btn sm ghost" data-pg="-1" ${state.page <= 1 ? "disabled" : ""}>Prev</button>
          <span>Page ${state.page} / ${pages}</span>
          <button type="button" class="btn sm ghost" data-pg="1" ${state.page >= pages ? "disabled" : ""}>Next</button>
        </div>`;
  }

  paint();
  container._htRender = paint;
  container._htApi = { render: paint, state };
  return container._htApi;
}

export function fillDateInput(el, value) {
  el.value = value || localToday();
}

export { money };
