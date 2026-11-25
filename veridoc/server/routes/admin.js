// Platform super-admin: institutions, user approval, stats, audit.
const router = require("express").Router();
const bcrypt = require("bcryptjs");
const { db, audit } = require("../db");
const chain = require("../chain");
const { requireRole, wrap, HttpError } = require("../middleware");
const { tempPassword } = require("./auth");
const { monthlySeries, statusBreakdown } = require("../stats");

router.use(requireRole("super_admin"));

router.get("/stats", wrap(async (_req, res) => {
  const n = (q) => db.prepare(q).get().n;
  res.json({
    institutions: n("SELECT COUNT(*) n FROM institutions"),
    users: n("SELECT COUNT(*) n FROM users"),
    pendingVerifiers: n("SELECT COUNT(*) n FROM users WHERE status='pending'"),
    documents: n("SELECT COUNT(*) n FROM documents"),
    verifications: n("SELECT COUNT(*) n FROM verification_log"),
    series: monthlySeries(null),
    byStatus: statusBreakdown(null),
    recentActivity: db.prepare(`SELECT a.action, a.detail, a.created_at, u.name, u.email FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 7`).all(),
    recentDocuments: db.prepare(`SELECT d.code, d.title, d.doc_type, d.status, d.created_at, i.name AS institution, s.full_name AS student FROM documents d JOIN institutions i ON i.id=d.institution_id JOIN students s ON s.id=d.student_id ORDER BY d.id DESC LIMIT 6`).all(),
    chain: { ...chain.info(), ...(await chain.health().catch((e) => ({ ok: false, error: e.message }))) },
  });
}));

router.get("/institutions", (_req, res) =>
  res.json(db.prepare(`SELECT i.*, (SELECT COUNT(*) FROM documents d WHERE d.institution_id=i.id) AS documents,
                              (SELECT COUNT(*) FROM files f WHERE f.institution_id=i.id) AS files,
                              (SELECT COUNT(*) FROM users u WHERE u.institution_id=i.id) AS users FROM institutions i ORDER BY i.id DESC`).all()));

const emailOk = (e) => typeof e === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const getInst = (id) => { const i = db.prepare("SELECT * FROM institutions WHERE id=?").get(id); if (!i) throw new HttpError(404, "Institution not found"); return i; };

// ---- One institution: details, users, documents, files ----
router.get("/institutions/:id", (req, res) => {
  const i = getInst(req.params.id), n = (q) => db.prepare(q).get(i.id).n;
  res.json({ ...i, counts: { users: n("SELECT COUNT(*) n FROM users WHERE institution_id=?"), students: n("SELECT COUNT(*) n FROM students WHERE institution_id=?"),
    documents: n("SELECT COUNT(*) n FROM documents WHERE institution_id=?"), files: n("SELECT COUNT(*) n FROM files WHERE institution_id=?") } });
});

/** Edit institution details. The on-chain registered name is immutable; this changes the name shown inside the app. */
router.patch("/institutions/:id", wrap(async (req, res) => {
  const i = getInst(req.params.id);
  const name = req.body?.name === undefined ? i.name : String(req.body.name).trim();
  const country = req.body?.country === undefined ? i.country : String(req.body.country).trim() || null;
  const type = req.body?.type === undefined ? i.type : req.body.type;
  if (!name || name.length > 150) throw new HttpError(400, "Name is required (max 150 characters)");
  if (!["school", "university", "elearning", "other"].includes(type)) throw new HttpError(400, "Invalid institution type");
  db.prepare("UPDATE institutions SET name=?, country=?, type=? WHERE id=?").run(name, country, type, i.id);
  audit(req.user.id, "institution_edited", i.code);
  res.json({ ok: true });
}));

router.get("/institutions/:id/users", (req, res) => {
  getInst(req.params.id);
  res.json(db.prepare("SELECT id,email,name,role,status,organization,created_at FROM users WHERE institution_id=? ORDER BY CASE role WHEN 'institution_admin' THEN 0 WHEN 'issuer' THEN 1 ELSE 2 END, name").all(req.params.id));
});

router.post("/institutions/:id/users", wrap(async (req, res) => {
  const i = getInst(req.params.id), { name, email, role } = req.body || {};
  if (!name || !emailOk(email)) throw new HttpError(400, "Valid name and email are required");
  if (!["issuer", "institution_admin"].includes(role)) throw new HttpError(400, "role must be issuer or institution_admin");
  if (db.prepare("SELECT 1 FROM users WHERE email=?").get(email.toLowerCase())) throw new HttpError(409, "Email already in use");
  const temp = tempPassword();
  const r = db.prepare("INSERT INTO users (email,name,password_hash,role,institution_id,must_change_password) VALUES (?,?,?,?,?,1)").run(email.toLowerCase(), name, bcrypt.hashSync(temp, 10), role, i.id);
  audit(req.user.id, "user_created", `${email} @ ${i.code}`);
  res.status(201).json({ id: r.lastInsertRowid, email: email.toLowerCase(), temporaryPassword: temp });
}));

router.get("/institutions/:id/documents", (req, res) => {
  getInst(req.params.id);
  const documents = db.prepare(`SELECT d.id,d.code,d.doc_type,d.title,d.status,d.chain_status,d.chain_tx,d.created_at,d.revoke_reason,s.full_name AS student,s.student_number
                                FROM documents d JOIN students s ON s.id=d.student_id WHERE d.institution_id=? ORDER BY d.id DESC LIMIT 500`).all(req.params.id);
  const files = db.prepare(`SELECT f.id,f.code,f.title,f.original_name,f.size,f.status,f.chain_status,f.chain_tx,f.created_at,f.revoke_reason,u.name AS uploader
                            FROM files f LEFT JOIN users u ON u.id=f.uploaded_by WHERE f.institution_id=? ORDER BY f.id DESC LIMIT 500`).all(req.params.id);
  res.json({ documents, files });
});

/** Create an institution (on-chain + DB) together with its first admin account. */
router.post("/institutions", wrap(async (req, res) => {
  const { code, name, country, type, adminEmail, adminName } = req.body || {};
  if (!/^[A-Z0-9-]{2,20}$/.test(code || "")) throw new HttpError(400, "Code must be 2-20 chars: A-Z, 0-9, dash");
  if (!name || !adminEmail || !adminName) throw new HttpError(400, "name, adminEmail and adminName are required");
  if (db.prepare("SELECT 1 FROM institutions WHERE code=?").get(code)) throw new HttpError(409, "Institution code already exists");
  if (db.prepare("SELECT 1 FROM users WHERE email=?").get(adminEmail.toLowerCase())) throw new HttpError(409, "Admin email already in use");

  const txHash = await chain.registerInstitution(code, name);
  const temp = tempPassword();
  const tx = db.transaction(() => {
    const inst = db.prepare("INSERT INTO institutions (code,name,country,type,chain_tx) VALUES (?,?,?,?,?)").run(code, name, country || null, type || "school", txHash);
    db.prepare("INSERT INTO users (email,name,password_hash,role,institution_id,must_change_password) VALUES (?,?,?,?,?,1)")
      .run(adminEmail.toLowerCase(), adminName, bcrypt.hashSync(temp, 10), "institution_admin", inst.lastInsertRowid);
    return inst.lastInsertRowid;
  })();
  audit(req.user.id, "institution_created", code);
  res.status(201).json({ id: tx, code, chainTx: txHash, admin: { email: adminEmail, temporaryPassword: temp } });
}));

/** Suspend / re-activate an institution (also on-chain: its documents verify as SUSPENDED). */
router.patch("/institutions/:id/active", wrap(async (req, res) => {
  const inst = db.prepare("SELECT * FROM institutions WHERE id=?").get(req.params.id);
  if (!inst) throw new HttpError(404, "Not found");
  const active = !!req.body.active;
  await chain.setInstitutionActive(inst.code, active);
  db.prepare("UPDATE institutions SET active=? WHERE id=?").run(active ? 1 : 0, inst.id);
  audit(req.user.id, active ? "institution_activated" : "institution_suspended", inst.code);
  res.json({ ok: true });
}));

router.get("/users", (_req, res) =>
  res.json(db.prepare(`SELECT u.id,u.email,u.name,u.role,u.status,u.organization,i.name AS institution, u.created_at
                       FROM users u LEFT JOIN institutions i ON i.id=u.institution_id ORDER BY u.id DESC LIMIT 500`).all()));

/** Edit a user's profile. Role may only move between issuer and institution_admin (within their institution). */
router.patch("/users/:id", wrap(async (req, res) => {
  const u = db.prepare("SELECT * FROM users WHERE id=?").get(req.params.id);
  if (!u) throw new HttpError(404, "Not found");
  const b = req.body || {};
  const name = b.name === undefined ? u.name : String(b.name).trim();
  const email = b.email === undefined ? u.email : String(b.email).trim().toLowerCase();
  const organization = b.organization === undefined ? u.organization : String(b.organization).trim() || null;
  let role = u.role;
  if (b.role !== undefined && b.role !== u.role) {
    if (!u.institution_id || !["issuer", "institution_admin"].includes(u.role) || !["issuer", "institution_admin"].includes(b.role)) throw new HttpError(400, "Role can only switch between issuer and institution admin");
    if (u.id === req.user.id) throw new HttpError(400, "You cannot change your own role");
    role = b.role;
  }
  if (!name) throw new HttpError(400, "Name is required");
  if (!emailOk(email)) throw new HttpError(400, "A valid email is required");
  try { db.prepare("UPDATE users SET name=?, email=?, organization=?, role=? WHERE id=?").run(name, email, organization, role, u.id); }
  catch (e) { if (String(e.message).includes("UNIQUE")) throw new HttpError(409, "Email already in use"); throw e; }
  audit(req.user.id, "user_edited", email);
  res.json({ ok: true });
}));

/** Generate a new one-time temporary password (user must change it at next login). */
router.post("/users/:id/reset-password", wrap(async (req, res) => {
  const u = db.prepare("SELECT * FROM users WHERE id=?").get(req.params.id);
  if (!u) throw new HttpError(404, "Not found");
  if (u.id === req.user.id) throw new HttpError(400, "Use Change password for your own account");
  const temp = tempPassword();
  db.prepare("UPDATE users SET password_hash=?, must_change_password=1, failed_attempts=0, locked_until=NULL WHERE id=?").run(bcrypt.hashSync(temp, 10), u.id);
  audit(req.user.id, "password_reset", u.email);
  res.json({ email: u.email, temporaryPassword: temp });
}));

router.patch("/users/:id/status", wrap(async (req, res) => {
  const { status } = req.body || {};
  if (!["active", "disabled"].includes(status)) throw new HttpError(400, "status must be active or disabled");
  const u = db.prepare("SELECT * FROM users WHERE id=?").get(req.params.id);
  if (!u) throw new HttpError(404, "Not found");
  if (u.id === req.user.id) throw new HttpError(400, "You cannot change your own status");
  db.prepare("UPDATE users SET status=? WHERE id=?").run(status, u.id);
  audit(req.user.id, "user_status_" + status, u.email);
  res.json({ ok: true });
}));

router.get("/audit", (_req, res) =>
  res.json(db.prepare(`SELECT a.*, u.email FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 200`).all()));

module.exports = router;
