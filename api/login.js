const { timingSafeEqualStr, setSession, json, readBody } = require("./_lib");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
  const password = process.env.APP_PASSWORD;
  const secret = process.env.SESSION_SECRET;
  if (!password || !secret) return json(res, 500, { error: "Server is not configured" });
  try {
    const body = await readBody(req);
    const ok = timingSafeEqualStr(body.password || "", password);
    if (!ok) {
      await new Promise((r) => setTimeout(r, 450));
      return json(res, 401, { error: "Wrong password" });
    }
    setSession(res, secret);
    return json(res, 200, { ok: true });
  } catch (err) {
    return json(res, 400, { error: err.message || "Bad request" });
  }
};
