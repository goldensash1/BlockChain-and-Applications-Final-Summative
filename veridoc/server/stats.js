// Dashboard statistics (monthly series, status breakdown) shared by admin and institution routes.
const { db } = require("./db");

/** Last `n` calendar months as ["2026-04", ...] (oldest first). */
function lastMonths(n = 8) {
  const out = [], d = new Date();
  d.setUTCDate(1);
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    out.push(x.toISOString().slice(0, 7));
  }
  return out;
}

/** Documents issued and verifications per month. instId = null → whole platform. */
function monthlySeries(instId = null, n = 8) {
  const months = lastMonths(n);
  const w = instId ? "WHERE institution_id = ?" : "";
  const a = instId ? [instId] : [];
  const issued = Object.fromEntries(db.prepare(`SELECT strftime('%Y-%m', created_at) m, COUNT(*) c FROM documents ${w} GROUP BY m`).all(...a).map((r) => [r.m, r.c]));
  const verified = Object.fromEntries(db.prepare(
    instId
      ? `SELECT strftime('%Y-%m', v.created_at) m, COUNT(*) c FROM verification_log v JOIN documents d ON d.doc_hash = v.doc_hash WHERE d.institution_id = ? GROUP BY m`
      : `SELECT strftime('%Y-%m', created_at) m, COUNT(*) c FROM verification_log GROUP BY m`
  ).all(...a).map((r) => [r.m, r.c]));
  return { months, issued: months.map((m) => issued[m] || 0), verifications: months.map((m) => verified[m] || 0) };
}

function statusBreakdown(instId = null) {
  const rows = db.prepare(`SELECT status, COUNT(*) c FROM documents ${instId ? "WHERE institution_id = ?" : ""} GROUP BY status`).all(...(instId ? [instId] : []));
  const out = { valid: 0, revoked: 0, superseded: 0, other: 0 };
  for (const r of rows) (r.status in out ? (out[r.status] += r.c) : (out.other += r.c));
  return out;
}

module.exports = { monthlySeries, statusBreakdown };
