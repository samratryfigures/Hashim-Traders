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
    wrap.addEventListener("click", (e) => {
      if (e.target === wrap || e.target.dataset.act === "no") {
        wrap.remove();
        resolve(false);
      }
      if (e.target.dataset.act === "yes") {
        wrap.remove();
        resolve(true);
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
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap || e.target.closest("[data-close]")) close();
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

export function bindTable(container, opts) {
  container._htOpts = opts;
  if (container._htBound) {
    container._htRender();
    return container._htApi;
  }
  container._htBound = true;
  const state = {
    q: "",
    sort: opts.sort || { key: opts.columns[0]?.key, dir: "desc" },
    page: 1,
    chip: opts.chip || "all",
    pageSize: opts.pageSize || 25,
  };

  function rows() {
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

  function render() {
    const opts = container._htOpts;
    const all = rows();
    const pages = Math.max(1, Math.ceil(all.length / state.pageSize));
    if (state.page > pages) state.page = pages;
    const slice = all.slice((state.page - 1) * state.pageSize, state.page * state.pageSize);
    const chips = (opts.chips || [])
      .map(
        (c) =>
          `<button type="button" class="chip ${state.chip === c.id ? "on" : ""}" data-chip="${c.id}">${escapeHtml(c.label)}</button>`
      )
      .join("");
    const head = opts.columns
      .map(
        (c) =>
          `<th data-sort="${c.key}" class="${state.sort.key === c.key ? "sorted " + state.sort.dir : ""}">${escapeHtml(c.label)}</th>`
      )
      .join("");
    const body = slice.length
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

    container.innerHTML = `
      <div class="table-tools">
        <input type="search" class="search" placeholder="${escapeHtml(opts.searchPlaceholder || "Search…")}" value="${escapeHtml(state.q)}">
        <div class="chips">${chips}</div>
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr>${head}<th></th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
      <div class="pager">
        <span>${all.length} record${all.length === 1 ? "" : "s"}</span>
        <div>
          <button type="button" class="btn sm ghost" data-pg="-1" ${state.page <= 1 ? "disabled" : ""}>Prev</button>
          <span>Page ${state.page} / ${pages}</span>
          <button type="button" class="btn sm ghost" data-pg="1" ${state.page >= pages ? "disabled" : ""}>Next</button>
        </div>
      </div>`;

    container.querySelector(".search").oninput = (e) => {
      state.q = e.target.value;
      state.page = 1;
      render();
    };
    container.querySelectorAll("[data-chip]").forEach((b) => {
      b.onclick = () => {
        state.chip = b.dataset.chip;
        state.page = 1;
        render();
      };
    });
    container.querySelectorAll("[data-sort]").forEach((th) => {
      th.onclick = () => {
        const key = th.dataset.sort;
        if (state.sort.key === key) state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc";
        else state.sort = { key, dir: "asc" };
        render();
      };
    });
    container.querySelectorAll("[data-pg]").forEach((b) => {
      b.onclick = () => {
        state.page += Number(b.dataset.pg);
        render();
      };
    });
    container.querySelectorAll("[data-act]").forEach((b) => {
      b.onclick = (e) => {
        e.stopPropagation();
        const act = (opts.actions || []).find((a) => a.id === b.dataset.act);
        const row = all.find((r) => String(r.id) === String(b.dataset.id));
        if (act && row) act.onClick(row);
      };
    });
    if (opts.onRowClick) {
      container.querySelectorAll("tbody tr[data-id]").forEach((tr) => {
        tr.onclick = () => {
          const row = all.find((r) => String(r.id) === String(tr.dataset.id));
          if (row) opts.onRowClick(row);
        };
      });
    }
  }

  render();
  container._htRender = render;
  container._htApi = { render, state };
  return container._htApi;
}

export function fillDateInput(el, value) {
  el.value = value || localToday();
}

export { money };
