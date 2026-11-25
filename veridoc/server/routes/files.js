// Registered files: an institution uploads any document (PDF, image, ...). Its keccak256 fingerprint is anchored
// on Ethereum so ANY other institution (or person) can later prove the file is genuine - and unmodified - by
// uploading it again on the public verify page or by entering its code.
const router = require("express").Router();
const fs = require("fs");
const { ethers } = require("ethers");
const { db, audit } = require("../db");
const chain = require("../chain");
const D = require("../docs");
const { oneFile, filePath } = require("../upload");
const { requireRole, wrap, HttpError } = require("../middleware");

const staff = requireRole("institution_admin", "issuer");
const newFileCode = () => D.newCode().replace(/^VD-/, "VF-");
const summary = (f) => ({
  id: f.id, code: f.code, title: f.title, description: f.description, fileName: f.original_name, mime: f.mime, size: f.size,
  hash: f.doc_hash, chainTx: f.chain_tx, chainStatus: f.chain_status, status: f.status, revokeReason: f.revoke_reason, createdAt: f.created_at, uploadedBy: f.uploader,
});
const LIST = "SELECT f.*, u.name AS uploader FROM files f LEFT JOIN users u ON u.id=f.uploaded_by";

/** Core registration used by the upload endpoint. Returns the stored row. */
async function registerFile({ inst, user, file, title, description }) {
  if (!file?.buffer?.length) throw new HttpError(400, "Choose a file to upload");
  const cleanTitle = String(title || "").trim();
  if (!cleanTitle) throw new HttpError(400, "A title is required");
  if (cleanTitle.length > 200) throw new HttpError(400, "Title is too long (max 200 characters)");
  if (!inst.active) throw new HttpError(403, "Your institution is suspended");
  const hash = ethers.keccak256(file.buffer);
  if (db.prepare("SELECT 1 FROM files WHERE doc_hash=?").get(hash)) throw new HttpError(409, "This exact file is already registered on the blockchain");

  const code = newFileCode();
  const name = String(file.originalname || "file").replace(/[\r\n"\\/]/g, "_").slice(0, 200);
  const id = db.prepare(`INSERT INTO files (code,institution_id,title,description,original_name,mime,size,doc_hash,uploaded_by) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(code, inst.id, cleanTitle, String(description || "").slice(0, 1000) || null, name, file.mimetype || null, file.buffer.length, hash, user.id).lastInsertRowid;
  try {
    const tx = await chain.issue(inst.code, hash, "certificate", null);
    fs.writeFileSync(filePath(code), file.buffer);
    db.prepare("UPDATE files SET chain_status='anchored', chain_tx=? WHERE id=?").run(tx, id);
  } catch (e) {
    db.prepare("UPDATE files SET chain_status='failed' WHERE id=?").run(id);
    if (String(e.message).includes("AlreadyIssued")) throw new HttpError(409, "This exact file is already registered on the blockchain");
    throw new HttpError(502, "Blockchain transaction failed: " + (e.shortMessage || e.message));
  }
  audit(user.id, "file_registered", `${code} ${name}`);
  return db.prepare(LIST + " WHERE f.id=?").get(id);
}

// POST /api/files  (multipart: file, title, description)
router.post("/", staff, oneFile, wrap(async (req, res) => {
  const inst = db.prepare("SELECT * FROM institutions WHERE id=?").get(req.user.institution_id);
  const row = await registerFile({ inst, user: req.user, file: req.file, title: req.body?.title, description: req.body?.description });
  res.status(201).json(summary(row));
}));

router.get("/", staff, (req, res) =>
  res.json(db.prepare(LIST + " WHERE f.institution_id=? ORDER BY f.id DESC LIMIT 500").all(req.user.institution_id).map(summary)));

// Original file download for the owning institution
router.get("/:id/download", staff, wrap(async (req, res) => {
  const f = db.prepare("SELECT * FROM files WHERE id=? AND institution_id=?").get(req.params.id, req.user.institution_id);
  if (!f || f.chain_status !== "anchored") throw new HttpError(404, "Not found");
  res.attachment(f.original_name); // forces download; type derives from the extension
  res.send(fs.readFileSync(filePath(f.code)));
}));

router.post("/:id/revoke", staff, wrap(async (req, res) => {
  const reason = String(req.body?.reason || "").trim();
  if (reason.length < 3) throw new HttpError(400, "A reason is required");
  const f = db.prepare("SELECT * FROM files WHERE id=? AND institution_id=?").get(req.params.id, req.user.institution_id);
  if (!f) throw new HttpError(404, "Not found");
  if (f.status !== "valid") throw new HttpError(409, `File is already ${f.status}`);
  try { await chain.revoke(f.doc_hash, reason); } catch (e) { throw new HttpError(502, "Blockchain transaction failed: " + (e.shortMessage || e.message)); }
  db.prepare("UPDATE files SET status='revoked', revoke_reason=? WHERE id=?").run(reason, f.id);
  audit(req.user.id, "file_revoked", f.code);
  res.json({ ok: true });
}));

module.exports = router;
module.exports.summary = summary;
