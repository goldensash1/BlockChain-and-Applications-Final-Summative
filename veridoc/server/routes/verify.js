// Verification: public (no login) with optional logged-in history for embassies/employers.
const router = require("express").Router();
const rateLimit = require("express-rate-limit");
const { db } = require("../db");
const chain = require("../chain");
const cfg = require("../config");
const D = require("../docs");
const { requireRole, wrap, HttpError } = require("../middleware");
const fs = require("fs");
const { ethers } = require("ethers");
const { oneFile, filePath } = require("../upload");

const limiter = rateLimit({ windowMs: 60 * 1000, limit: +process.env.VERIFY_RATE_LIMIT || 40, standardHeaders: true, legacyHeaders: false });
router.use(limiter);

const log = (req, query, result, hash) =>
  db.prepare("INSERT INTO verification_log (user_id,query,result,doc_hash,ip) VALUES (?,?,?,?,?)")
    .run(req.user?.id ?? null, String(query).slice(0, 200), result, hash || null, req.ip);

const explorer = (tx) => (tx && cfg.chain.explorerTx ? cfg.chain.explorerTx + tx : null);

/** Core check: recompute hash from stored payload, compare with chain truth. */
async function check(canonicalJson, expectedHash) {
  const recomputed = D.hashPayload(canonicalJson);
  const tampered = expectedHash && recomputed !== expectedHash;
  let onChain;
  try { onChain = await chain.verify(recomputed); }
  catch (e) { throw new HttpError(503, "Blockchain network unreachable, please retry shortly"); }
  return { hash: recomputed, tampered, onChain };
}

// GET /api/verify/code/VD-XXXXX-XXXXX
router.get("/code/:code", wrap(async (req, res) => {
  const code = String(req.params.code).trim().toUpperCase();
  if (code.startsWith("VF-")) return res.json(await verifyFileCode(req, code));
  const d = db.prepare(`SELECT d.*, i.name AS inst_name FROM documents d JOIN institutions i ON i.id=d.institution_id WHERE d.code=?`).get(code);
  if (!d || d.chain_status !== "anchored") { log(req, code, "NOT_FOUND"); return res.json({ status: "NOT_FOUND", message: "No document with this code exists in the registry." }); }

  const { hash, tampered, onChain } = await check(d.payload, d.doc_hash);
  const status = tampered ? "TAMPERED" : onChain.status;
  log(req, code, status, d.doc_hash);
  const payload = JSON.parse(d.payload);
  res.json({
    status,
    message: tampered ? "Stored record does not match its blockchain fingerprint. Do NOT trust this document." : undefined,
    code: d.code, hash, docType: d.doc_type, title: d.title,
    institution: onChain.institutionName || d.inst_name,
    holder: payload.holder, content: payload.content,
    issuedAt: onChain.issuedAt, expiresAt: onChain.expiresAt,
    revokeReason: onChain.revokeReason,
    supersededBy: onChain.supersededBy && db.prepare("SELECT code FROM documents WHERE doc_hash=?").get(onChain.supersededBy)?.code,
    chain: { contract: chain.info().contract, tx: d.chain_tx, explorer: explorer(d.chain_tx) },
  });
}));

/** Registered file looked up by code; the stored bytes are re-hashed so a doctored server copy is detected too. */
async function verifyFileCode(req, code) {
  const f = db.prepare("SELECT f.*, i.name AS inst_name FROM files f JOIN institutions i ON i.id=f.institution_id WHERE f.code=?").get(code);
  if (!f || f.chain_status !== "anchored") { log(req, code, "NOT_FOUND"); return { status: "NOT_FOUND", message: "No document with this code exists in the registry." }; }
  let tampered = false;
  try { tampered = ethers.keccak256(fs.readFileSync(filePath(f.code))) !== f.doc_hash; } catch { tampered = true; }
  let onChain; try { onChain = await chain.verify(f.doc_hash); } catch { throw new HttpError(503, "Blockchain network unreachable, please retry shortly"); }
  const status = tampered ? "TAMPERED" : onChain.status;
  log(req, code, status, f.doc_hash);
  return { status, message: tampered ? "The stored file does not match its blockchain fingerprint. Do NOT trust it." : undefined, code: f.code, hash: f.doc_hash, docType: "uploaded_file",
    title: f.title, description: f.description, fileName: f.original_name, fileSize: f.size, institution: onChain.institutionName || f.inst_name, issuedAt: onChain.issuedAt, expiresAt: onChain.expiresAt,
    revokeReason: onChain.revokeReason, downloadUrl: "/f/" + f.code, chain: { contract: chain.info().contract, tx: f.chain_tx, explorer: explorer(f.chain_tx) } };
}

// POST /api/verify/file  (multipart "file") → hash the uploaded bytes and ask the blockchain. Works for ANY institution's registered file.
router.post("/file", oneFile, wrap(async (req, res) => {
  if (!req.file?.buffer?.length) throw new HttpError(400, "Choose a file to verify");
  const hash = ethers.keccak256(req.file.buffer);
  let onChain; try { onChain = await chain.verify(hash); } catch { throw new HttpError(503, "Blockchain network unreachable, please retry shortly"); }
  const f = db.prepare("SELECT f.*, i.name AS inst_name FROM files f JOIN institutions i ON i.id=f.institution_id WHERE f.doc_hash=?").get(hash);
  log(req, "file:" + String(req.file.originalname).slice(0, 80), onChain.status, hash);
  res.json({
    status: onChain.status, hash, institution: onChain.institutionName, docType: f ? "uploaded_file" : onChain.docType, title: f?.title, description: f?.description,
    fileName: f?.original_name || req.file.originalname, fileSize: req.file.size, code: f?.code, issuedAt: onChain.issuedAt, expiresAt: onChain.expiresAt, revokeReason: onChain.revokeReason,
    message: onChain.status === "NOT_FOUND" ? "This exact file is not in the registry. It may be forged, or it was modified after it was registered (even one changed byte gives a different fingerprint)." : undefined,
    downloadUrl: f ? "/f/" + f.code : undefined, chain: f ? { contract: chain.info().contract, tx: f.chain_tx, explorer: explorer(f.chain_tx) } : undefined,
  });
}));

// POST /api/verify/hash  { hash }   → pure on-chain lookup (no database involved)
router.post("/hash", wrap(async (req, res) => {
  const hash = String(req.body?.hash || "").trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new HttpError(400, "hash must be a 0x-prefixed 32-byte hex string");
  let onChain;
  try { onChain = await chain.verify(hash); } catch { throw new HttpError(503, "Blockchain network unreachable"); }
  log(req, hash, onChain.status, hash);
  res.json({ hash, ...onChain });
}));

// POST /api/verify/package  { payload }  → independent check of a downloaded .veridoc.json
// The server re-computes the fingerprint itself, so a doctored file simply won't match anything on-chain.
router.post("/package", wrap(async (req, res) => {
  const pkg = req.body?.package || req.body;
  if (!pkg?.payload || typeof pkg.payload !== "object") throw new HttpError(400, "package.payload is required");
  const { hash, tampered, onChain } = await check(D.canonicalize(pkg.payload), pkg.hash);
  const status = tampered ? "TAMPERED" : onChain.status;
  log(req, "package", status, hash);
  res.json({ ...onChain, status, hash, holder: pkg.payload.holder, title: pkg.payload.title });
}));

// Logged-in verifier's own history
router.get("/history", requireRole("verifier", "super_admin"), (req, res) =>
  res.json(db.prepare("SELECT query,result,created_at FROM verification_log WHERE user_id=? ORDER BY id DESC LIMIT 200").all(req.user.id)));

module.exports = router;
