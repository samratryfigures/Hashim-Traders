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

async function readCloud() {
  if (process.env.APPS_SCRIPT_URL) {
    const data = await gasFetch("read");
    return data;
  }
  return readFileDb();
}

async function writeCloud(db) {
  if (process.env.APPS_SCRIPT_URL) {
    return gasFetch("write", db);
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
};
