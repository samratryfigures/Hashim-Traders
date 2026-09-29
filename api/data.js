const { getSession, json, readBody, readCloud, writeCloud, mergeDb } = require("./_lib");

function allowed(req) {
  if (!process.env.APP_PASSWORD) return true;
  return !!getSession(req);
}

module.exports = async function handler(req, res) {
  if (!allowed(req)) return json(res, 401, { error: "Unauthorized" });
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
      let outgoing = incoming;
      if (cloudDb) {
        outgoing = mergeDb(incoming, cloudDb);
        const inR = Number(incoming.revision) || 0;
        const cR = Number(cloudDb.revision) || 0;
        if (inR >= cR) {
          outgoing.revision = inR;
          outgoing.updatedAt = incoming.updatedAt || outgoing.updatedAt;
        } else {
          outgoing.revision = cR + 1;
          outgoing.updatedAt = new Date().toISOString();
        }
      }
      const saved = await writeCloud(outgoing);
      return json(res, 200, { ok: true, db: saved?.db || outgoing });
    }
    return json(res, 405, { error: "Method not allowed" });
  } catch (err) {
    return json(res, 500, { error: err.message || "Server error" });
  }
};
