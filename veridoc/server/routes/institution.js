// Institution admin: staff (issuers) and students.
const router = require("express").Router();
const bcrypt = require("bcryptjs");
const { db, audit } = require("../db");
const { requireRole, wrap, HttpError } = require("../middleware");
const { tempPassword } = require("./auth");
const { monthlySeries, statusBreakdown } = require("../stats");

const emailOk = (e) => typeof e === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// ---- API keys for the company "seal" API (institution_admin only) ----
const seal = require("../seal");
router.get("/api-keys", requireRole("institution_admin"), (req, res) =>
  res.json(db.prepare(`SELECT k.id, k.name, k.prefix, k.created_at, k.last_used_at, k.revoked_at, u.name AS created_by,
      (SELECT COUNT(*) FROM files f WHERE f.api_key_id = k.id AND f.chain_status='anchored') AS documents
    FROM api_keys k LEFT JOIN users u ON u.id = k.created_by WHERE k.institution_id = ? ORDER BY k.id DESC`).all(req.user.institution_id)));

router.post("/api-keys", requireRole("institution_admin"), (req, res) => {
  if (req.impersonator) throw new HttpError(403, "API keys cannot be created while acting as another user");
  const k = seal.createKey(req.user.institution_id, req.body?.name, req.user.id);
  audit(req.user.id, "api_key_created", `${k.name} (${k.prefix}…)`);
  res.status(201).json(k); // the full key is returned ONCE
});

router.delete("/api-keys/:id", requireRole("institution_admin"), (req, res) => {
  const k = db.prepare("SELECT * FROM api_keys WHERE id=? AND institution_id=?").get(req.params.id, req.user.institution_id);
  if (!k) throw new HttpError(404, "Key not found");
  if (k.revoked_at) throw new HttpError(409, "Key is already revoked");
  db.prepare("UPDATE api_keys SET revoked_at = datetime('now') WHERE id=?").run(k.id);
  audit(req.user.id, "api_key_revoked", `${k.name} (${k.prefix}…)`);
  res.json({ ok: true });
});

// ---- Staff (institution_admin only) ----
router.get("/staff", requireRole("institution_admin"), (req, res) =>
  res.json(db.prepare("SELECT id,email,name,role,status,created_at FROM users WHERE institution_id=? AND role IN ('issuer','institution_admin')").all(req.user.institution_id)));

router.post("/staff", requireRole("institution_admin"), wrap(async (req, res) => {
  const { email, name } = req.body || {};
  if (!emailOk(email) || !name) throw new HttpError(400, "Valid email and name required");
  if (db.prepare("SELECT 1 FROM users WHERE email=?").get(email.toLowerCase())) throw new HttpError(409, "Email already in use");
  const temp = tempPassword();
  db.prepare("INSERT INTO users (email,name,password_hash,role,institution_id,must_change_password) VALUES (?,?,?,?,?,1)")
    .run(email.toLowerCase(), name, bcrypt.hashSync(temp, 10), "issuer", req.user.institution_id);
  audit(req.user.id, "issuer_created", email);
  res.status(201).json({ email, temporaryPassword: temp });
}));

router.patch("/staff/:id", requireRole("institution_admin"), wrap(async (req, res) => {
  const u = db.prepare("SELECT * FROM users WHERE id=? AND institution_id=? AND role='issuer'").get(req.params.id, req.user.institution_id);
  if (!u) throw new HttpError(404, "Not found");
  const name = String(req.body?.name ?? u.name).trim(), email = String(req.body?.email ?? u.email).trim().toLowerCase();
  if (!name || !emailOk(email)) throw new HttpError(400, "Valid name and email required");
  try { db.prepare("UPDATE users SET name=?, email=? WHERE id=?").run(name, email, u.id); }
  catch (e) { if (String(e.message).includes("UNIQUE")) throw new HttpError(409, "Email already in use"); throw e; }
  audit(req.user.id, "issuer_edited", email);
  res.json({ ok: true });
}));

router.patch("/staff/:id/status", requireRole("institution_admin"), wrap(async (req, res) => {
  const { status } = req.body || {};
  if (!["active", "disabled"].includes(status)) throw new HttpError(400, "Invalid status");
  const r = db.prepare("UPDATE users SET status=? WHERE id=? AND institution_id=? AND role='issuer'").run(status, req.params.id, req.user.institution_id);
  if (!r.changes) throw new HttpError(404, "Not found");
  audit(req.user.id, "staff_status_" + status, req.params.id);
  res.json({ ok: true });
}));

// People who can be impersonated by this institution's admin (issuers + students with a login)
router.get("/people", requireRole("institution_admin"), (req, res) =>
  res.json(db.prepare("SELECT id,email,name,role,status,created_at FROM users WHERE institution_id=? AND role IN ('issuer','student','institution_admin') ORDER BY role, name").all(req.user.institution_id)));

// Dashboard numbers for this institution
router.get("/stats", requireRole("institution_admin", "issuer"), (req, res) => {
  const id = req.user.institution_id, n = (q) => db.prepare(q).get(id).n;
  res.json({
    students: n("SELECT COUNT(*) n FROM students WHERE institution_id=?"),
    documents: n("SELECT COUNT(*) n FROM documents WHERE institution_id=?"),
    files: n("SELECT COUNT(*) n FROM files WHERE institution_id=?"),
    verifications: n("SELECT COUNT(*) n FROM verification_log v JOIN documents d ON d.doc_hash=v.doc_hash WHERE d.institution_id=?"),
    issuers: n("SELECT COUNT(*) n FROM users WHERE institution_id=? AND role='issuer'"),
    series: monthlySeries(id),
    byStatus: statusBreakdown(id),
    recentActivity: db.prepare(`SELECT a.action, a.detail, a.created_at, u.name, u.email FROM audit_log a JOIN users u ON u.id=a.user_id WHERE u.institution_id=? ORDER BY a.id DESC LIMIT 7`).all(id),
  });
});

// ---- Students (admin + issuer) ----
const staff = requireRole("institution_admin", "issuer");

router.get("/students", staff, (req, res) =>
  res.json(db.prepare("SELECT s.*, (SELECT COUNT(*) FROM users u WHERE u.student_id=s.id) AS has_login FROM students s WHERE institution_id=? ORDER BY full_name").all(req.user.institution_id)));

function createStudent(instId, { studentNumber, fullName, email, createLogin }) {
  if (!studentNumber || !fullName) throw new HttpError(400, "studentNumber and fullName are required");
  let r;
  try { r = db.prepare("INSERT INTO students (institution_id,student_number,full_name,email) VALUES (?,?,?,?)").run(instId, String(studentNumber).trim(), String(fullName).trim(), email || null); }
  catch (e) { if (String(e.message).includes("UNIQUE")) throw new HttpError(409, `Student number ${studentNumber} already exists`); throw e; }
  const out = { id: r.lastInsertRowid, studentNumber, fullName };
  if (createLogin && email) {
    if (!emailOk(email)) throw new HttpError(400, "Invalid student email");
    if (db.prepare("SELECT 1 FROM users WHERE email=?").get(email.toLowerCase())) throw new HttpError(409, "Student email already has an account");
    const temp = tempPassword();
    db.prepare("INSERT INTO users (email,name,password_hash,role,institution_id,student_id,must_change_password) VALUES (?,?,?,?,?,?,1)")
      .run(email.toLowerCase(), fullName, bcrypt.hashSync(temp, 10), "student", instId, r.lastInsertRowid);
    out.temporaryPassword = temp;
  }
  return out;
}

router.post("/students", staff, wrap(async (req, res) => {
  const out = createStudent(req.user.institution_id, req.body || {});
  audit(req.user.id, "student_created", out.studentNumber);
  res.status(201).json(out);
}));

/** CSV: studentNumber,fullName,email  (header row optional). Creates logins when email given and createLogins=true. */
router.post("/students/import", staff, wrap(async (req, res) => {
  const { csv, createLogins } = req.body || {};
  if (!csv) throw new HttpError(400, "csv is required");
  const rows = String(csv).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (rows[0] && /student/i.test(rows[0])) rows.shift();
  const created = [], errors = [];
  rows.forEach((line, i) => {
    const [studentNumber, fullName, email] = line.split(",").map((x) => x?.trim());
    try { created.push(createStudent(req.user.institution_id, { studentNumber, fullName, email, createLogin: !!createLogins })); }
    catch (e) { errors.push({ line: i + 1, error: e.message }); }
  });
  audit(req.user.id, "students_imported", `${created.length} ok, ${errors.length} errors`);
  res.json({ created, errors });
}));

module.exports = router;
