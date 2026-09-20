const { clearSession, json } = require("./_lib");

module.exports = async function handler(req, res) {
  clearSession(res);
  return json(res, 200, { ok: true });
};
