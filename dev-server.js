const http = require("http");
const fs = require("fs");
const path = require("path");

function loadEnv() {
  for (const f of [".env.local", ".env"]) {
    const p = path.join(process.cwd(), f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i < 1) continue;
      const k = t.slice(0, i).trim();
      let v = t.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!process.env[k]) process.env[k] = v;
    }
  }
}
loadEnv();

const PORT = Number(process.env.PORT || 43127);
const ROOT = process.cwd();
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const api = {
  login: require("./api/login.js"),
  logout: require("./api/logout.js"),
  data: require("./api/data.js"),
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/")) {
    const name = url.pathname.replace(/^\/api\//, "").replace(/\/$/, "");
    const handler = api[name];
    if (!handler) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }
    try {
      await handler(req, res);
    } catch (err) {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: err.message }));
      }
    }
    return;
  }

  let rel = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  rel = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, "");
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT)) {
    res.statusCode = 403;
    res.end("Forbidden");
    return;
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }
    res.setHeader("Content-Type", MIME[path.extname(file)] || "application/octet-stream");
    res.end(buf);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("HASHMI TRADERS at http://127.0.0.1:" + PORT);
});
