const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const COOKIE = "ht_session";
const MAX_AGE = 30 * 24 * 3600;

function timingSafeEqualStr(a, b) {
  const ba = Buffer.from(String(a || ""), "utf8");
  const bb = Buffer.from(String(b || ""), "utf8");
  const len = Math.max(ba.length, bb.length, 1);
  const pa = Buffer.alloc(len);
  const pb = Buffer.alloc(len);
  ba.copy(pa);
  bb.copy(pb);
  const same = crypto.timingSafeEqual(pa, pb);
  return same && ba.length === bb.length;
}

function parseCookies(req) {
  const raw = req.headers.cookie || "";
  const out = {};
  raw.split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function sign(payload, secret) {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

function verify(token, secret) {
  if (!token || !secret) return null;
  const [data, sig] = String(token).split(".");
  if (!data || !sig) return null;
  const expect = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  if (!timingSafeEqualStr(sig, expect)) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function cookieHeader(value, { clear = false } = {}) {
  const prod = process.env.VERCEL === "1" || process.env.NODE_ENV === "production";
  const parts = [`${COOKIE}=${value}`, "Path=/", "HttpOnly", "SameSite=Strict"];
  if (prod) parts.push("Secure");
  parts.push(clear ? "Max-Age=0" : `Max-Age=${MAX_AGE}`);
  return parts.join("; ");
}

function setSession(res, secret) {
  const token = sign({ v: 1, exp: Date.now() + MAX_AGE * 1000 }, secret);
  res.setHeader("Set-Cookie", cookieHeader(token));
}

function clearSession(res) {
  res.setHeader("Set-Cookie", cookieHeader("", { clear: true }));
}

function getSession(req) {
  const secret = process.env.SESSION_SECRET;
  const token = parseCookies(req)[COOKIE];
  return verify(token, secret);
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 5 * 1024 * 1024) {
        reject(new Error("Payload too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function fileStorePath() {
  if (process.env.VERCEL) return path.join("/tmp", "hashmi-cloud.json");
  return path.join(process.cwd(), "data", "cloud.json");
}

function readFileDb() {
  try {
    const p = fileStorePath();
    if (!fs.existsSync(p)) return { empty: true, db: null };
    const db = JSON.parse(fs.readFileSync(p, "utf8"));
    const empty = !db || (!(db.products || []).length && !(db.invoices || []).length && !(db.customers || []).length);
    return { empty, db };
  } catch {
    return { empty: true, db: null };
  }
}

function writeFileDb(db) {
  const p = fileStorePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(db));
}

async function gasFetch(action, db) {
  const url = process.env.APPS_SCRIPT_URL;
  const token = process.env.APPS_SCRIPT_TOKEN;
  if (!url || !token) return null;
  const u = new URL(url);
  u.searchParams.set("action", action);
  u.searchParams.set("token", token);

  if (action === "read") {
    let res = await fetch(u.toString(), { method: "GET", redirect: "manual" });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      res = await fetch(res.headers.get("location"), { method: "GET", redirect: "follow" });
    }
    return res.json();
  }

  const body = JSON.stringify({ action: "write", token, db });
  let res = await fetch(u.toString(), {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body,
  });
  if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
    res = await fetch(res.headers.get("location"), {
      method: "POST",
      redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body,
    });
  }
  return res.json();
}

async function githubHeaders() {
  return {
    Authorization: "Bearer " + process.env.GITHUB_TOKEN,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "hashmi-traders",
  };
}

function githubRepo() {
  return process.env.GITHUB_REPO || "samratryfigures/Hashim-Traders";
}

function githubPath() {
  return process.env.GITHUB_DATA_PATH || "data/live.json";
}

function githubDataBranch() {
  return process.env.GITHUB_DATA_BRANCH || "live-data";
}

function contentsUrl(ref) {
  const url = `https://api.github.com/repos/${githubRepo()}/contents/${githubPath()}`;
  return ref ? `${url}?ref=${encodeURIComponent(ref)}` : url;
}

async function githubApi(pathname, opts = {}) {
  const headers = { ...(await githubHeaders()), ...(opts.headers || {}) };
  const res = await fetch(`https://api.github.com/repos/${githubRepo()}${pathname}`, { ...opts, headers });
  let data = null;
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { res, data };
}

async function ensureDataBranch() {
  const branch = githubDataBranch();
  try {
    const existing = await githubApi(`/git/ref/heads/${branch}`);
    if (existing.res.ok) return branch;
    const main = await githubApi("/git/ref/heads/main");
    if (!main.res.ok) return "main";
    const created = await githubApi("/git/refs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: main.data.object.sha }),
    });
    if (created.res.ok || created.res.status === 422) return branch;
  } catch (err) {
    console.error("ensureDataBranch", err);
  }
  return "main";
}

async function readGithubFile(ref) {
  const res = await fetch(contentsUrl(ref), { headers: await githubHeaders() });
  if (res.status === 404) return { empty: true, db: null };
  if (!res.ok) throw new Error("GitHub read failed: " + res.status);
  const meta = await res.json();
  const raw = Buffer.from(String(meta.content || "").replace(/\n/g, ""), "base64").toString("utf8");
  if (!raw) return { empty: true, db: null, sha: meta.sha };
  const db = JSON.parse(raw);
  const empty = !db || (!(db.products || []).length && !(db.invoices || []).length && !(db.customers || []).length);
  return { empty, db, sha: meta.sha };
}

async function readGithubDb() {
  try {
    const fromBranch = await readGithubFile(githubDataBranch());
    if (!fromBranch.empty || fromBranch.db) return fromBranch;
  } catch {
    /* fall back to main */
  }
  return readGithubFile("main");
}

async function writeGithubDb(db, attempt = 0) {
  const branch = await ensureDataBranch();
  const headers = await githubHeaders();
  let sha;
  let current = null;
  const cur = await fetch(contentsUrl(branch), { headers });
  if (cur.ok) {
    const meta = await cur.json();
    sha = meta.sha;
    try {
      const raw = Buffer.from(String(meta.content || "").replace(/\n/g, ""), "base64").toString("utf8");
      current = raw ? JSON.parse(raw) : null;
    } catch {
      current = null;
    }
  } else if (cur.status === 404) {
    const fallback = await readGithubFile("main");
    current = fallback.db;
  }
  const outgoing = current ? mergeDb(db, current) : db;
  const content = Buffer.from(JSON.stringify(outgoing)).toString("base64");
  const res = await fetch(`https://api.github.com/repos/${githubRepo()}/contents/${githubPath()}`, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "HASHMI TRADERS live books",
      content,
      sha,
      branch,
    }),
  });
  if (res.status === 409 && attempt < 5) {
    return writeGithubDb(db, attempt + 1);
  }
  if (!res.ok) {
    const err = await res.text();
    throw new Error("GitHub write failed: " + res.status + " " + err.slice(0, 200));
  }
  return { ok: true, db: outgoing };
}

const SHOP_MARKER = "HASHMI_BUILD pos15";
let shopPublish = { checked: 0, ok: false };

const SHOP_STATIC = [
  "index.html",
  "css/style.css",
  "js/app.js",
  "js/pos.js",
  "js/sync.js",
  "js/store.js",
  "js/forms.js",
  "js/ui.js",
  "js/utils.js",
  "js/compute.js",
  "js/print.js",
  "js/migrate.js",
];

function shopOrigin() {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (host) return "https://" + String(host).replace(/^https?:\/\//, "");
  return "https://hashmi-traders-lyart.vercel.app";
}

async function collectShopFiles() {
  const files = [];
  const origin = shopOrigin();
  for (const rel of SHOP_STATIC) {
    const res = await fetch(origin + "/" + rel + "?v=pos15", { cache: "no-store" });
    if (!res.ok) continue;
    files.push({ path: rel, content: await res.text() });
  }
  const apiDir = __dirname;
  for (const name of fs.readdirSync(apiDir)) {
    const full = path.join(apiDir, name);
    if (!fs.statSync(full).isFile()) continue;
    files.push({ path: "api/" + name, content: fs.readFileSync(full, "utf8") });
  }
  const vercelJson = path.join(apiDir, "..", "vercel.json");
  if (fs.existsSync(vercelJson)) {
    files.push({ path: "vercel.json", content: fs.readFileSync(vercelJson, "utf8") });
  }
  return files;
}

async function publishShopIfStale() {
  if (!process.env.GITHUB_TOKEN) return;
  if (shopPublish.ok && Date.now() - shopPublish.checked < 10 * 60 * 1000) return;
  shopPublish.checked = Date.now();
  try {
    const headers = await githubHeaders();
    const indexRes = await fetch(`https://api.github.com/repos/${githubRepo()}/contents/index.html?ref=main`, { headers });
    if (indexRes.ok) {
      const meta = await indexRes.json();
      const html = Buffer.from(String(meta.content || "").replace(/\n/g, ""), "base64").toString("utf8");
      if (html.includes(SHOP_MARKER)) {
        shopPublish.ok = true;
        return;
      }
    }
    const ref = await githubApi("/git/ref/heads/main");
    if (!ref.res.ok) return;
    const commit = await githubApi(`/git/commits/${ref.data.object.sha}`);
    if (!commit.res.ok) return;
    const files = await collectShopFiles();
    if (!files.some((f) => f.path === "index.html" && f.content.includes(SHOP_MARKER))) return;
    const treeRes = await githubApi("/git/trees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        base_tree: commit.data.tree.sha,
        tree: files.map((f) => ({ path: f.path, mode: "100644", type: "blob", content: f.content })),
      }),
    });
    if (!treeRes.res.ok) {
      console.error("publish tree", treeRes.res.status, treeRes.data);
      return;
    }
    const next = await githubApi("/git/commits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "HASHMI TRADERS shop v15",
        tree: treeRes.data.sha,
        parents: [ref.data.object.sha],
      }),
    });
    if (!next.res.ok) {
      console.error("publish commit", next.res.status, next.data);
      return;
    }
    const patched = await githubApi("/git/refs/heads/main", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sha: next.data.sha }),
    });
    shopPublish.ok = patched.res.ok;
    if (!patched.res.ok) console.error("publish ref", patched.res.status, patched.data);
  } catch (err) {
    console.error("publishShopIfStale", err);
  }
}

function mergeList(local, cloud) {
  const map = new Map();
  for (const row of cloud || []) {
    if (row && row.id != null) map.set(String(row.id), row);
  }
  for (const row of local || []) {
    if (row && row.id != null) map.set(String(row.id), row);
  }
  return [...map.values()];
}

function mergeDb(local, cloud) {
  if (!cloud) return local;
  if (!local) return cloud;
  const localTime = Date.parse(local.updatedAt || 0) || 0;
  const cloudTime = Date.parse(cloud.updatedAt || 0) || 0;
  return {
    ...cloud,
    ...local,
    products: mergeList(local.products, cloud.products),
    invoices: mergeList(local.invoices, cloud.invoices),
    purchases: mergeList(local.purchases, cloud.purchases),
    customers: mergeList(local.customers, cloud.customers),
    suppliers: mergeList(local.suppliers, cloud.suppliers),
    payments: mergeList(local.payments, cloud.payments),
    returns: mergeList(local.returns, cloud.returns),
    expenses: mergeList(local.expenses, cloud.expenses),
    settings:
      (local.invoices?.length || local.products?.length || local.purchases?.length
        ? local.settings
        : cloud.settings) ||
      local.settings ||
      cloud.settings,
    version: 2,
    revision: Math.max(Number(local.revision) || 0, Number(cloud.revision) || 0),
    updatedAt: localTime >= cloudTime ? local.updatedAt : cloud.updatedAt,
  };
}

async function readCloud() {
  if (process.env.GITHUB_TOKEN) await publishShopIfStale();
  if (process.env.APPS_SCRIPT_URL) {
    const data = await gasFetch("read");
    return data;
  }
  if (process.env.GITHUB_TOKEN) {
    return readGithubDb();
  }
  return readFileDb();
}

async function writeCloud(db) {
  if (process.env.GITHUB_TOKEN) await publishShopIfStale();
  if (process.env.APPS_SCRIPT_URL) {
    return gasFetch("write", db);
  }
  if (process.env.GITHUB_TOKEN) {
    return writeGithubDb(db);
  }
  writeFileDb(db);
  return { ok: true, db };
}

module.exports = {
  timingSafeEqualStr,
  setSession,
  clearSession,
  getSession,
  json,
  readBody,
  readCloud,
  writeCloud,
  mergeDb,
};
