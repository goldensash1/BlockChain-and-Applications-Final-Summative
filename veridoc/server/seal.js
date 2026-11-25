// The "seal" service: other companies' systems register the documents they generate (report cards,
// certificates, transcripts, letters...) through the API. VeriDoc anchors each document's keccak256
// fingerprint on Ethereum under that company's institution and returns a seal (verification code,
// verify link and QR code) to print on the document. Anyone can later check the document against
// the blockchain.
const fs = require("fs");
const crypto = require("crypto");
const QRCode = require("qrcode");
const { ethers } = require("ethers");
const { db, audit } = require("./db");
const chain = require("./chain");
const cfg = require("./config");
const D = require("./docs");
const { filePath } = require("./upload");
const { HttpError } = require("./middleware");

const DOC_TYPES = ["certificate", "report_card", "transcript", "diploma", "other"];
// The contract knows four types; anything else is anchored as a generic certificate-type record.
const chainType = (t) => (t === "other" ? "certificate" : t);
const HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const MAX_BATCH = 100;

// ───────────────────────────── API keys ─────────────────────────────
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

/** Create a key for an institution. The full key is returned once; only its hash is stored. */
function createKey(institutionId, name, userId) {
  const clean = String(name || "").trim();
  if (!clean || clean.length > 80) throw new HttpError(400, "Give the key a name (max 80 characters)");
  const key = "vdk_" + crypto.randomBytes(24).toString("base64url");
  const prefix = key.slice(0, 12);
  const id = db.prepare("INSERT INTO api_keys (institution_id,name,prefix,key_hash,created_by) VALUES (?,?,?,?,?)")
    .run(institutionId, clean, prefix, sha256(key), userId).lastInsertRowid;
  return { id, name: clean, prefix, key };
}

/** Find the active key + institution for a raw key from a request header (or null). */
function lookupKey(raw) {
  if (typeof raw !== "string" || !raw.startsWith("vdk_")) return null;
  const k = db.prepare(`SELECT k.*, i.code AS inst_code, i.name AS inst_name, i.active AS inst_active
    FROM api_keys k JOIN institutions i ON i.id = k.institution_id WHERE k.key_hash = ? AND k.revoked_at IS NULL`).get(sha256(raw));
  if (k) db.prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?").run(k.id);
  return k || null;
}

// ───────────────────────────── seals ─────────────────────────────
const verifyUrl = (code) => `${cfg.publicUrl.replace(/\/$/, "")}/#/verify/${code}`;
const explorer = (tx) => (tx && cfg.chain.explorerTx ? cfg.chain.explorerTx + tx : null);

async function sealFor(row, { qr = true } = {}) {
  const url = verifyUrl(row.code);
  return {
    code: row.code,
    verifyUrl: url,
    text: `Sealed by VeriDoc on Ethereum. Verify at ${url} (code ${row.code})`,
    qrPng: qr ? await QRCode.toDataURL(url, { margin: 1, width: 240 }) : undefined,
  };
}

/** Public JSON shape of a sealed document (row = files row joined with institution name). */
async function present(row, opts) {
  return {
    code: row.code, hash: row.doc_hash, title: row.title, description: row.description || undefined,
    docType: row.doc_type, externalRef: row.external_ref || undefined, fileName: row.stored ? row.original_name : undefined,
    institution: row.inst_name, status: row.status === "valid" ? "VALID" : row.status.toUpperCase(),
    revokeReason: row.revoke_reason || undefined, expiresAt: row.expires_at || null, registeredAt: row.created_at,
    chain: { contract: chain.info().contract, tx: row.chain_tx, explorer: explorer(row.chain_tx), status: row.chain_status },
    seal: await sealFor(row, opts),
  };
}
const ROW = "SELECT f.*, i.name AS inst_name FROM files f JOIN institutions i ON i.id = f.institution_id";
const getRow = (where, ...args) => db.prepare(`${ROW} WHERE ${where}`).get(...args);

/** Validate one registration request. Returns normalised fields (hash computed from bytes when given). */
function normalise(input) {
  const title = String(input.title || "").trim();
  if (!title) throw new HttpError(400, "title is required");
  if (title.length > 200) throw new HttpError(400, "title is too long (max 200 characters)");
  const docType = input.docType ? String(input.docType) : "other";
  if (!DOC_TYPES.includes(docType)) throw new HttpError(400, `docType must be one of: ${DOC_TYPES.join(", ")}`);
  let expiresAt = null;
  if (input.expiresAt) {
    const t = new Date(input.expiresAt);
    if (isNaN(t) || t <= new Date()) throw new HttpError(400, "expiresAt must be a future date (ISO 8601)");
    expiresAt = t.toISOString();
  }
  let hash, buffer = null;
  if (input.buffer?.length) { buffer = input.buffer; hash = ethers.keccak256(buffer); }
  else if (input.fileHash) {
    hash = String(input.fileHash).trim();
    if (!HASH_RE.test(hash)) throw new HttpError(400, "fileHash must be the keccak256 of the file bytes: 0x followed by 64 hex characters");
    hash = hash.toLowerCase();
  } else throw new HttpError(400, "Send the document as a multipart 'file', or send its keccak256 'fileHash'");
  return {
    title, docType, expiresAt, hash, buffer,
    description: input.description ? String(input.description).slice(0, 1000) : null,
    externalRef: input.externalRef ? String(input.externalRef).slice(0, 120) : null,
    fileName: String(input.fileName || (buffer ? "document" : "(fingerprint only)")).replace(/[\r\n"\\/]/g, "_").slice(0, 200),
    mime: input.mime || null,
  };
}

function insertPending(key, n) {
  if (db.prepare("SELECT 1 FROM files WHERE doc_hash = ?").get(n.hash)) throw new HttpError(409, `Already sealed: ${n.hash}`);
  const code = D.newCode().replace(/^VD-/, "VF-");
  const id = db.prepare(`INSERT INTO files (code,institution_id,title,description,original_name,mime,size,doc_hash,source,stored,doc_type,external_ref,expires_at,api_key_id)
    VALUES (?,?,?,?,?,?,?,?,'api',?,?,?,?,?)`).run(code, key.institution_id, n.title, n.description, n.fileName, n.mime, n.buffer ? n.buffer.length : 0,
    n.hash, n.buffer ? 1 : 0, n.docType, n.externalRef, n.expiresAt, key.id).lastInsertRowid;
  return { id, code };
}
const chainError = (e) => String(e.message).includes("AlreadyIssued")
  ? new HttpError(409, "This document fingerprint is already registered on the blockchain")
  : new HttpError(502, "Blockchain transaction failed: " + (e.shortMessage || e.message));

function requireActive(key) { if (!key.inst_active) throw new HttpError(403, "Your institution is suspended"); }

/** Register (seal) one document for the API key's institution. */
async function register(key, input) {
  requireActive(key);
  const n = normalise(input);
  const { id, code } = insertPending(key, n);
  try {
    const tx = await chain.issue(key.inst_code, n.hash, chainType(n.docType), n.expiresAt);
    if (n.buffer) fs.writeFileSync(filePath(code), n.buffer);
    db.prepare("UPDATE files SET chain_status='anchored', chain_tx=? WHERE id=?").run(tx, id);
  } catch (e) {
    db.prepare("DELETE FROM files WHERE id=?").run(id); // nothing was anchored; allow a clean retry
    throw chainError(e);
  }
  audit(null, "api_document_sealed", `${key.prefix}… ${code} ${n.title}`);
  return present(getRow("f.id = ?", id));
}

/** Seal up to 100 fingerprints in ONE transaction (e.g. a whole class's report cards). */
async function registerBatch(key, body) {
  requireActive(key);
  const items = Array.isArray(body?.documents) ? body.documents : null;
  if (!items?.length) throw new HttpError(400, "documents must be a non-empty array");
  if (items.length > MAX_BATCH) throw new HttpError(400, `At most ${MAX_BATCH} documents per batch`);
  const shared = { docType: body.docType, expiresAt: body.expiresAt };
  const norm = items.map((d, i) => {
    if (d?.file || d?.buffer) throw new HttpError(400, `documents[${i}]: batches take fileHash values only`);
    try { return normalise({ ...d, ...shared }); } catch (e) { throw new HttpError(e.status || 400, `documents[${i}]: ${e.message}`); }
  });
  if (new Set(norm.map((n) => n.hash)).size !== norm.length) throw new HttpError(400, "The batch contains the same fileHash twice");
  const rows = db.transaction(() => norm.map((n) => insertPending(key, n)))();
  try {
    const tx = await chain.issueBatch(key.inst_code, norm.map((n) => n.hash), chainType(norm[0].docType), norm[0].expiresAt);
    const upd = db.prepare("UPDATE files SET chain_status='anchored', chain_tx=? WHERE id=?");
    db.transaction(() => rows.forEach((r) => upd.run(tx, r.id)))();
  } catch (e) {
    const del = db.prepare("DELETE FROM files WHERE id=?");
    db.transaction(() => rows.forEach((r) => del.run(r.id)))();
    throw chainError(e);
  }
  audit(null, "api_batch_sealed", `${key.prefix}… ${rows.length} documents`);
  return Promise.all(rows.map((r) => present(getRow("f.id = ?", r.id), { qr: false })));
}

async function revoke(key, code, reason) {
  requireActive(key);
  const r = String(reason || "").trim();
  if (r.length < 3) throw new HttpError(400, "reason is required (at least 3 characters)");
  const row = getRow("f.code = ? AND f.institution_id = ?", String(code).toUpperCase(), key.institution_id);
  if (!row) throw new HttpError(404, "No document with this code belongs to your institution");
  if (row.status !== "valid") throw new HttpError(409, `Document is already ${row.status}`);
  try { await chain.revoke(row.doc_hash, r); } catch (e) { throw chainError(e); }
  db.prepare("UPDATE files SET status='revoked', revoke_reason=? WHERE id=?").run(r, row.id);
  audit(null, "api_document_revoked", `${key.prefix}… ${row.code}`);
  return present(getRow("f.id = ?", row.id), { qr: false });
}

function ownRow(key, code) {
  const row = getRow("f.code = ? AND f.institution_id = ?", String(code).toUpperCase(), key.institution_id);
  if (!row) throw new HttpError(404, "No document with this code belongs to your institution");
  return row;
}
const list = (key, limit) =>
  db.prepare(`${ROW} WHERE f.institution_id = ? AND f.chain_status = 'anchored' ORDER BY f.id DESC LIMIT ?`).all(key.institution_id, limit);

module.exports = { DOC_TYPES, MAX_BATCH, createKey, lookupKey, register, registerBatch, revoke, ownRow, list, present, sha256 };
