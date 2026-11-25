// Adds a demo institution, people and documents to a running VeriDoc, through its normal API.
// Run it ON the server (it needs the server's .env and database):  npm run demo-data
//
// It acts as the super admin without anyone typing a password: it signs a short session
// with the server's own JWT secret, exactly as "Sign in as" does, so every action goes
// through the usual checks, reaches the blockchain and is written to the audit log.
// The new accounts get one-time temporary passwords. They are written only to
// data/demo-accounts.txt (readable by this user only), never printed or committed.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");
const cfg = require("../server/config");
const { db } = require("../server/db");

const BASE = process.env.BASE_URL || `http://127.0.0.1:${cfg.port || process.env.PORT || 3000}`;
const CODE = "DEMO-UNI";
const DOMAIN = "demo-university.example";

const session = (uid, imp) => "cc_token=" + jwt.sign(imp ? { uid, imp } : { uid }, cfg.jwtSecret, { expiresIn: "15m" });
async function call(method, url, body, cookie) {
  const r = await fetch(BASE + url, { method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${url} -> ${r.status} ${data.error || ""}`);
  return data;
}
const userId = (email) => db.prepare("SELECT id FROM users WHERE email=?").get(email).id;
const step = (msg) => console.log("✔ " + msg);

(async () => {
  if (db.prepare("SELECT 1 FROM institutions WHERE code=?").get(CODE)) {
    console.log(`Demo data is already there (institution ${CODE}). Nothing to do.`);
    return;
  }
  const admin = db.prepare("SELECT id, email FROM users WHERE role='super_admin' AND status='active' ORDER BY id LIMIT 1").get();
  if (!admin) throw new Error("No active super admin found");
  const sa = session(admin.id);
  const accounts = [];

  // 1. Platform admin registers the institution (also registered on-chain) and its first admin.
  const inst = await call("POST", "/api/admin/institutions", { code: CODE, name: "Demo University of Kigali", country: "Rwanda", type: "university", adminEmail: `registrar@${DOMAIN}`, adminName: "Grace Registrar" }, sa);
  accounts.push(["Institution admin", `registrar@${DOMAIN}`, inst.admin.temporaryPassword]);
  step("Institution Demo University of Kigali registered on Sepolia");

  // 2. Act as the institution admin, the same way "Sign in as" works.
  const ia = session(userId(`registrar@${DOMAIN}`), admin.id);
  const staff = await call("POST", "/api/institution/staff", { email: `issuer@${DOMAIN}`, name: "Ivan Issuer" }, ia);
  accounts.push(["Issuer (staff)", `issuer@${DOMAIN}`, staff.temporaryPassword]);
  step("Issuer account created");

  const imp = await call("POST", "/api/institution/students/import", { createLogins: true, csv: `studentNumber,fullName,email\nS001,Aline Uwase,aline@${DOMAIN}\nS002,Eric Mugisha,eric@${DOMAIN}\nS003,Sandra Ingabire,sandra@${DOMAIN}` }, ia);
  const emails = { S001: `aline@${DOMAIN}`, S002: `eric@${DOMAIN}`, S003: `sandra@${DOMAIN}` };
  for (const s of imp.created) if (s.temporaryPassword) accounts.push([`Student ${s.studentNumber}`, emails[s.studentNumber] || "", s.temporaryPassword]);
  const students = await call("GET", "/api/institution/students", null, ia);
  step(`${students.length} students imported`);

  // 3. Documents, each anchored on Sepolia.
  const cert = await call("POST", "/api/documents", { studentId: students[0].id, docType: "certificate", title: "Bachelor of Science in Software Engineering", content: { program: "BSc Software Engineering", completionDate: "2026-06-30", grade: "First Class Honours" } }, ia);
  step(`Certificate issued: ${cert.code}`);

  const batch = await call("POST", "/api/documents/batch", { term: "Term 3", academicYear: "2026", className: "Year 2", items: students.map((s, i) => ({ studentId: s.id, courses: [{ name: "Algorithms", score: 90 - i * 7 }, { name: "Databases", score: 82 - i * 5 }, { name: "Networks", score: 75 }], remarks: "Good progress." })) }, ia);
  step(`Report cards for the whole class in one transaction: ${batch.results.map((r) => r.code).join(", ")}`);

  const wrong = await call("POST", "/api/documents", { studentId: students[1].id, docType: "certificate", title: "Diploma in Data Science", content: { program: "Diploma in Data Science", completionDate: "2026-06-30", grade: "Distinction" } }, ia);
  await call("POST", `/api/documents/${wrong.id}/revoke`, { reason: "Issued in error - demo of revocation" }, ia);
  step(`Certificate issued then revoked: ${wrong.code}`);

  // 4. A file registered on-chain, so another organisation can check it by uploading it.
  const sample = fs.readFileSync(path.join(__dirname, "..", "docs", "demo", "accreditation-letter-2026.txt"));
  const fd = new FormData();
  fd.append("title", "Institutional accreditation letter 2026");
  fd.append("description", "Sample file: upload it unchanged on the Verify page, then edit one word and try again");
  fd.append("file", new Blob([sample], { type: "text/plain" }), "accreditation-letter-2026.txt");
  const fr = await fetch(BASE + "/api/files", { method: "POST", headers: { cookie: ia }, body: fd });
  const fj = await fr.json();
  if (!fr.ok) throw new Error("POST /api/files -> " + fr.status + " " + (fj.error || ""));
  step(`File registered: ${fj.code} (docs/demo/accreditation-letter-2026.txt)`);

  // 5. A verifier waiting for approval, so the platform admin can approve them during the demo.
  const vpw = require("crypto").randomBytes(9).toString("base64url") + "7a";
  await call("POST", "/api/auth/register-verifier", { email: "visa-officer@embassy.example", name: "Visa Officer", organization: "Example Embassy", password: vpw });
  accounts.push(["Verifier (pending approval)", "visa-officer@embassy.example", vpw]);
  step("Verifier registered, waiting for approval");

  const out = path.resolve(path.dirname(cfg.dbPath), "demo-accounts.txt");
  const lines = ["VeriDoc demo accounts (created " + new Date().toISOString() + ")", "Temporary passwords must be changed at first sign-in.", "Easier: sign in as the super admin and use 'Sign in as' on any of these users.", ""];
  for (const [role, email, pw] of accounts) lines.push(`${role.padEnd(28)} ${email.padEnd(36)} ${pw}`);
  lines.push("", "Codes to verify on the home page:", `  Certificate (valid)   ${cert.code}`, `  Certificate (revoked) ${wrong.code}`, ...batch.results.map((r) => `  Report card ${r.studentNumber}      ${r.code}`), `  Registered file       ${fj.code}`);
  fs.writeFileSync(out, lines.join("\n") + "\n", { mode: 0o600 });
  console.log(`\nDone. Accounts and codes saved to ${out} (only this user can read it).`);
})().catch((e) => { console.error("Failed:", e.message); process.exit(1); });
