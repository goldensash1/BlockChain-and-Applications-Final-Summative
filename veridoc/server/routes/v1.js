// VeriDoc public API v1 - the "seal" service for other companies' systems.
//
//   Issuing companies (with an API key from their institution admin):
//     GET  /api/v1/me                          check the key; shows the institution it seals for
//     POST /api/v1/documents                   seal one document (multipart "file" OR JSON "fileHash")
//     POST /api/v1/documents/batch             seal up to 100 fingerprints in one blockchain transaction
//     GET  /api/v1/documents                   list sealed documents
//     GET  /api/v1/documents/:code             one document + its seal (QR code, verify link)
//     POST /api/v1/documents/:code/revoke      revoke with a public reason
//
//   Anyone (no key needed), e.g. an embassy, employer or another school:
//     POST /api/v1/verify                      multipart "file", or JSON { code } | { hash }
//
// Keys go in the header:  Authorization: Bearer vdk_...   (or  X-API-Key: vdk_...)
const router = require("express").Router();
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const seal = require("../seal");
const { verifyCode, verifyFile, verifyHash } = require("./verify");
const { oneFile } = require("../upload");
const { wrap, HttpError } = require("../middleware");

const rawKey = (req) => {
  const h = req.get("authorization") || "";
  return h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : (req.get("x-api-key") || "").trim();
};

// Per key when one is sent, otherwise per IP.
router.use(rateLimit({
  windowMs: 60 * 1000, limit: +process.env.API_RATE_LIMIT || 120, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => { const k = rawKey(req); return k ? "key:" + seal.sha256(k) : ipKeyGenerator(req.ip); },
  message: { error: "Too many requests, slow down" },
}));

/** Requires a valid, non-revoked API key; sets req.apiKey. */
function apiKey(req, _res, next) {
  const raw = rawKey(req);
  if (!raw) return next(new HttpError(401, "Missing API key. Send it as 'Authorization: Bearer vdk_...'"));
  const k = seal.lookupKey(raw);
  if (!k) return next(new HttpError(401, "Invalid or revoked API key"));
  req.apiKey = k;
  next();
}

router.get("/me", apiKey, (req, res) => res.json({
  institution: { name: req.apiKey.inst_name, code: req.apiKey.inst_code, active: !!req.apiKey.inst_active },
  key: { name: req.apiKey.name, prefix: req.apiKey.prefix, createdAt: req.apiKey.created_at },
}));

// Multipart (file upload) or JSON (fileHash). Multer only runs for multipart bodies.
const maybeFile = (req, res, next) => (req.is("multipart/form-data") ? oneFile(req, res, next) : next());

router.post("/documents", apiKey, maybeFile, wrap(async (req, res) => {
  const b = req.body || {};
  const out = await seal.register(req.apiKey, {
    buffer: req.file?.buffer, fileName: req.file?.originalname || b.fileName, mime: req.file?.mimetype,
    fileHash: b.fileHash, title: b.title, description: b.description, docType: b.docType, externalRef: b.externalRef, expiresAt: b.expiresAt,
  });
  res.status(201).json(out);
}));

router.post("/documents/batch", apiKey, wrap(async (req, res) => {
  const documents = await seal.registerBatch(req.apiKey, req.body);
  res.status(201).json({ count: documents.length, transaction: documents[0]?.chain.tx, documents });
}));

router.get("/documents", apiKey, wrap(async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
  res.json(await Promise.all(seal.list(req.apiKey, limit).map((r) => seal.present(r, { qr: false }))));
}));

router.get("/documents/:code", apiKey, wrap(async (req, res) => res.json(await seal.present(seal.ownRow(req.apiKey, req.params.code)))));

router.post("/documents/:code/revoke", apiKey, wrap(async (req, res) =>
  res.json(await seal.revoke(req.apiKey, req.params.code, req.body?.reason))));

// Public verification for any company or person.
router.post("/verify", maybeFile, wrap(async (req, res) => {
  const b = req.body || {};
  let r;
  if (req.file) r = await verifyFile(req, req.file);
  else if (b.code) r = await verifyCode(req, b.code);
  else if (b.hash) r = await verifyHash(req, b.hash);
  else throw new HttpError(400, "Send a multipart 'file', or JSON { \"code\": \"VF-...\" } or { \"hash\": \"0x...\" }");
  res.json({ valid: r.status === "VALID", ...r });
}));

router.use((_req, res) => res.status(404).json({ error: "Unknown API endpoint. See /#/developers" }));

module.exports = router;
