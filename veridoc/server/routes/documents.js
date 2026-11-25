// Issuing, revoking, superseding and listing documents (certificates, report cards...).
const router = require("express").Router();
const { db, audit } = require("../db");
const chain = require("../chain");
const D = require("../docs");
const { requireRole, wrap, HttpError } = require("../middleware");

const staff = requireRole("institution_admin", "issuer");
const TYPES = ["certificate", "report_card", "transcript", "diploma"];

const getInst = (id) => db.prepare("SELECT * FROM institutions WHERE id=?").get(id);
function getStudent(instId, studentId) {
  const s = db.prepare("SELECT * FROM students WHERE id=? AND institution_id=?").get(studentId, instId);
  if (!s) throw new HttpError(404, `Student ${studentId} not found in your institution`);
  return s;
}
function checkExpiry(expiresAt) {
  if (!expiresAt) return null;
  const t = new Date(expiresAt).getTime();
  if (Number.isNaN(t) || t <= Date.now()) throw new HttpError(400, "expiresAt must be a future date");
  return new Date(t).toISOString();
}

/** Prepare a pending document row (not yet on chain). */
function prepare({ inst, student, docType, title, content, expiresAt, userId }) {
  if (!TYPES.includes(docType)) throw new HttpError(400, "Invalid docType");
  if (!title || !String(title).trim()) throw new HttpError(400, "title is required");
  let norm;
  try { norm = D.normalizeContent(docType, content); } catch (e) { throw new HttpError(400, e.message); }
  const salt = D.newSalt();
  const payload = D.buildPayload({ institution: inst, student, docType, title: String(title).trim(), content: norm, expiresAt, salt });
  const canonical = D.canonicalize(payload);
  return { code: D.newCode(), inst, student, docType, title: payload.title, canonical, hash: D.hashPayload(canonical), expiresAt, userId };
}

const insertDoc = (p) =>
  db.prepare(`INSERT INTO documents (code,institution_id,student_id,doc_type,title,payload,doc_hash,expires_at,issued_by)
              VALUES (?,?,?,?,?,?,?,?,?)`).run(p.code, p.inst.id, p.student.id, p.docType, p.title, p.canonical, p.hash, p.expiresAt, p.userId).lastInsertRowid;

const markAnchored = (ids, tx) => {
  const st = db.prepare("UPDATE documents SET chain_status='anchored', chain_tx=? WHERE id=?");
  ids.forEach((id) => st.run(tx, id));
};
const markFailed = (ids) => ids.forEach((id) => db.prepare("UPDATE documents SET chain_status='failed' WHERE id=?").run(id));

const summary = (d) => ({
  id: d.id, code: d.code, docType: d.doc_type, title: d.title, status: d.status, chainStatus: d.chain_status,
  hash: d.doc_hash, chainTx: d.chain_tx, expiresAt: d.expires_at, createdAt: d.created_at, revokeReason: d.revoke_reason,
  studentName: d.full_name, studentNumber: d.student_number, institution: d.institution_name,
});
const LIST_SQL = `SELECT d.*, s.full_name, s.student_number, i.name AS institution_name
                  FROM documents d JOIN students s ON s.id=d.student_id JOIN institutions i ON i.id=d.institution_id`;

// ---------- Issue one ----------
router.post("/", staff, wrap(async (req, res) => {
  const { studentId, docType, title, content, expiresAt } = req.body || {};
  const inst = getInst(req.user.institution_id);
  if (!inst.active) throw new HttpError(403, "Your institution is suspended");
  const p = prepare({ inst, student: getStudent(inst.id, studentId), docType, title, content, expiresAt: checkExpiry(expiresAt), userId: req.user.id });
  const id = insertDoc(p);
  try {
    const tx = await chain.issue(inst.code, p.hash, docType, p.expiresAt);
    markAnchored([id], tx);
    audit(req.user.id, "document_issued", p.code);
    res.status(201).json({ id, code: p.code, hash: p.hash, chainTx: tx });
  } catch (e) { markFailed([id]); throw new HttpError(502, "Blockchain transaction failed: " + (e.shortMessage || e.message)); }
}));

// ---------- Issue report cards for a whole class in one transaction ----------
router.post("/batch", staff, wrap(async (req, res) => {
  const { term, academicYear, className, items } = req.body || {};
  if (!term || !academicYear) throw new HttpError(400, "term and academicYear are required");
  if (!Array.isArray(items) || !items.length) throw new HttpError(400, "items[] required");
  const inst = getInst(req.user.institution_id);
  if (!inst.active) throw new HttpError(403, "Your institution is suspended");

  const prepared = items.map((it) =>
    prepare({
      inst, student: getStudent(inst.id, it.studentId), docType: "report_card",
      title: `Report Card - ${term} ${academicYear}`,
      content: { term, academicYear, className, courses: it.courses, remarks: it.remarks },
      expiresAt: null, userId: req.user.id,
    }));
  const ids = db.transaction(() => prepared.map(insertDoc))();
  const results = [];
  for (let i = 0; i < prepared.length; i += 100) {
    const chunk = prepared.slice(i, i + 100), chunkIds = ids.slice(i, i + 100);
    try {
      const tx = await chain.issueBatch(inst.code, chunk.map((p) => p.hash), "report_card", null);
      markAnchored(chunkIds, tx);
      chunk.forEach((p) => results.push({ studentNumber: p.student.student_number, code: p.code, chainTx: tx }));
    } catch (e) { markFailed(chunkIds); throw new HttpError(502, "Blockchain transaction failed: " + (e.shortMessage || e.message)); }
  }
  audit(req.user.id, "report_cards_batch", `${results.length} docs`);
  res.status(201).json({ issued: results.length, results });
}));

// ---------- List ----------
router.get("/", staff, (req, res) =>
  res.json(db.prepare(LIST_SQL + " WHERE d.institution_id=? ORDER BY d.id DESC LIMIT 500").all(req.user.institution_id).map(summary)));

router.get("/mine", requireRole("student"), (req, res) =>
  res.json(db.prepare(LIST_SQL + " WHERE d.student_id=? AND d.chain_status='anchored' ORDER BY d.id DESC").all(req.user.student_id).map(summary)));

// ---------- Revoke ----------
router.post("/:id/revoke", staff, wrap(async (req, res) => {
  const reason = String(req.body?.reason || "").trim();
  if (reason.length < 3) throw new HttpError(400, "A reason is required");
  const d = db.prepare("SELECT * FROM documents WHERE id=? AND institution_id=?").get(req.params.id, req.user.institution_id);
  if (!d) throw new HttpError(404, "Not found");
  if (d.status !== "valid") throw new HttpError(409, `Document is already ${d.status}`);
  try { await chain.revoke(d.doc_hash, reason); }
  catch (e) { throw new HttpError(502, "Blockchain transaction failed: " + (e.shortMessage || e.message)); }
  db.prepare("UPDATE documents SET status='revoked', revoke_reason=? WHERE id=?").run(reason, d.id);
  audit(req.user.id, "document_revoked", d.code);
  res.json({ ok: true });
}));

// ---------- Supersede (issue corrected version) ----------
router.post("/:id/supersede", staff, wrap(async (req, res) => {
  const old = db.prepare("SELECT * FROM documents WHERE id=? AND institution_id=?").get(req.params.id, req.user.institution_id);
  if (!old) throw new HttpError(404, "Not found");
  if (old.status !== "valid") throw new HttpError(409, `Document is already ${old.status}`);
  const inst = getInst(old.institution_id);
  const { title, content, expiresAt } = req.body || {};
  const p = prepare({ inst, student: getStudent(inst.id, old.student_id), docType: old.doc_type, title: title || old.title, content, expiresAt: checkExpiry(expiresAt), userId: req.user.id });
  const newId = insertDoc(p);
  try {
    const tx = await chain.supersede(old.doc_hash, p.hash, old.doc_type, p.expiresAt);
    markAnchored([newId], tx);
    db.prepare("UPDATE documents SET status='superseded', superseded_by=? WHERE id=?").run(newId, old.id);
  } catch (e) { markFailed([newId]); throw new HttpError(502, "Blockchain transaction failed: " + (e.shortMessage || e.message)); }
  audit(req.user.id, "document_superseded", `${old.code} -> ${p.code}`);
  res.status(201).json({ id: newId, code: p.code, hash: p.hash });
}));

// ---------- Portable verification package (staff of that institution, or the student) ----------
router.get("/:id/package", requireRole("institution_admin", "issuer", "student"), wrap(async (req, res) => {
  const d = db.prepare("SELECT * FROM documents WHERE id=?").get(req.params.id);
  const u = req.user;
  if (!d || (u.role === "student" ? d.student_id !== u.student_id : d.institution_id !== u.institution_id)) throw new HttpError(404, "Not found");
  res.setHeader("Content-Disposition", `attachment; filename="${d.code}.veridoc.json"`);
  res.json({ format: "veridoc/1", code: d.code, hash: d.doc_hash, payload: JSON.parse(d.payload), contract: chain.info().contract, chainTx: d.chain_tx });
}));

module.exports = router;
