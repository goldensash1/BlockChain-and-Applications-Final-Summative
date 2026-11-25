const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");
const cfg = require("./config");

fs.mkdirSync(path.dirname(path.resolve(cfg.dbPath)), { recursive: true });
const db = new Database(cfg.dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS institutions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,            -- e.g. ALU-RW ; keccak(code) is the on-chain id
  name TEXT NOT NULL,
  country TEXT,
  type TEXT DEFAULT 'school',           -- school | university | elearning | other
  active INTEGER NOT NULL DEFAULT 1,
  chain_tx TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('super_admin','institution_admin','issuer','student','verifier')),
  institution_id INTEGER REFERENCES institutions(id),
  student_id INTEGER,                   -- link to students.id for role=student
  organization TEXT,                    -- for verifiers (embassy, employer...)
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending','disabled')),
  must_change_password INTEGER NOT NULL DEFAULT 0,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  institution_id INTEGER NOT NULL REFERENCES institutions(id),
  student_number TEXT NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (institution_id, student_number)
);
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,            -- public verification code printed on the document
  institution_id INTEGER NOT NULL REFERENCES institutions(id),
  student_id INTEGER NOT NULL REFERENCES students(id),
  doc_type TEXT NOT NULL,               -- certificate | report_card | transcript | diploma
  title TEXT NOT NULL,
  payload TEXT NOT NULL,                -- canonical JSON that was hashed
  doc_hash TEXT UNIQUE NOT NULL,
  expires_at TEXT,
  chain_tx TEXT,
  chain_status TEXT NOT NULL DEFAULT 'pending',   -- pending | anchored | failed
  status TEXT NOT NULL DEFAULT 'valid',           -- cache only; the chain is the source of truth
  revoke_reason TEXT,
  superseded_by INTEGER REFERENCES documents(id),
  issued_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS verification_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  query TEXT NOT NULL,
  result TEXT NOT NULL,
  doc_hash TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,            -- public verification code (VF-XXXXX-XXXXX)
  institution_id INTEGER NOT NULL REFERENCES institutions(id),
  title TEXT NOT NULL,
  description TEXT,
  original_name TEXT NOT NULL,
  mime TEXT,
  size INTEGER NOT NULL,
  doc_hash TEXT UNIQUE NOT NULL,        -- keccak256 of the raw file bytes (this is what is anchored on-chain)
  chain_tx TEXT,
  chain_status TEXT NOT NULL DEFAULT 'pending',   -- pending | anchored | failed
  status TEXT NOT NULL DEFAULT 'valid',           -- cache only; the chain is the source of truth
  revoke_reason TEXT,
  uploaded_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_files_inst ON files(institution_id);
CREATE INDEX IF NOT EXISTS idx_docs_student ON documents(student_id);
CREATE INDEX IF NOT EXISTS idx_docs_inst ON documents(institution_id);
`);

const audit = (userId, action, detail) =>
  db.prepare("INSERT INTO audit_log (user_id, action, detail) VALUES (?,?,?)").run(userId ?? null, action, detail ? String(detail).slice(0, 500) : null);

module.exports = { db, audit };
