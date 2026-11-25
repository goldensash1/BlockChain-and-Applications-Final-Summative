// Shared upload plumbing for registered files (any file type, up to 10 MB, kept in memory then written to data/uploads).
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const cfg = require("./config");
const { HttpError } = require("./middleware");

const MAX_BYTES = 10 * 1024 * 1024;
const UPLOAD_DIR = path.join(path.dirname(path.resolve(cfg.dbPath)), "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const multi = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1 } });
/** Express middleware: accepts one multipart field named "file" and turns multer errors into clean HTTP errors. */
const oneFile = (req, res, next) =>
  multi.single("file")(req, res, (err) => {
    if (!err) return next();
    next(new HttpError(err.code === "LIMIT_FILE_SIZE" ? 413 : 400, err.code === "LIMIT_FILE_SIZE" ? "File too large (max 10 MB)" : err.message));
  });

const filePath = (code) => path.join(UPLOAD_DIR, String(code).replace(/[^A-Z0-9-]/gi, ""));
module.exports = { oneFile, filePath, MAX_BYTES, UPLOAD_DIR };
