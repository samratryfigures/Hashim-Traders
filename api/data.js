const { getSession, json, readBody, readCloud, writeCloud } = require("./_lib");

module.exports = async function handler(req, res) {
  if (!getSession(req)) return json(res, 401, { error: "Unauthorized" });
  try {
    if (req.method === "GET") {
      const cloud = await readCloud();
      return json(res, 200, { empty: !cloud || cloud.empty || !cloud.db, db: cloud?.db || null });
    }
    if (req.method === "POST") {
      const body = await readBody(req);
      const incoming = body.db;
      if (!incoming || incoming.version !== 2) return json(res, 400, { error: "Invalid database" });
      const bytes = Buffer.byteLength(JSON.stringify(incoming));
      if (bytes > 4.5 * 1024 * 1024) return json(res, 413, { error: "Payload too large (Vercel 4.5 MB limit)" });
      const cloud = await readCloud();
      const cloudDb = cloud?.db;
      if (!body.force && cloudDb && cloudDb.updatedAt && body.loadedUpdatedAt) {
        const cloudTime = Date.parse(cloudDb.updatedAt);
        const loadedTime = Date.parse(body.loadedUpdatedAt);
        if (cloudTime > loadedTime) {
          return json(res, 409, {
            error: "conflict",
            db: cloudDb,
          });
        }
      }
      const saved = await writeCloud(incoming);
      return json(res, 200, { ok: true, db: saved?.db || incoming });
    }
    return json(res, 405, { error: "Method not allowed" });
  } catch (err) {
    return json(res, 500, { error: err.message || "Server error" });
  }
};
