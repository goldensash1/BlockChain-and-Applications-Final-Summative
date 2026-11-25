// Seeds demo data through the real API (so it also exercises the blockchain path).
// Usage: npm run seed   (server must be running)
const BASE = process.env.BASE_URL || "http://localhost:3000";
require("dotenv").config();

async function call(method, url, body, cookie) {
  const r = await fetch(BASE + url, { method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${url} -> ${r.status} ${data.error || ""}`);
  return { data, cookie: (r.headers.get("set-cookie") || "").split(";")[0] };
}
const login = async (email, password) => (await call("POST", "/api/auth/login", { email, password })).cookie;

(async () => {
  const sa = await login(process.env.SUPER_ADMIN_EMAIL, process.env.SUPER_ADMIN_PASSWORD);
  const inst = await call("POST", "/api/admin/institutions", { code: "DEMO-UNI", name: "Demo University of Kigali", country: "Rwanda", type: "university", adminEmail: "registrar@demo.edu", adminName: "Grace Registrar" }, sa);
  console.log("Institution created. Admin temp password:", inst.data.admin.temporaryPassword);

  // First login must change password
  let c = await login("registrar@demo.edu", inst.data.admin.temporaryPassword);
  await call("POST", "/api/auth/change-password", { currentPassword: inst.data.admin.temporaryPassword, newPassword: "Registrar#2026pw" }, c);
  c = await login("registrar@demo.edu", "Registrar#2026pw");

  const staff = await call("POST", "/api/institution/staff", { email: "issuer@demo.edu", name: "Ivan Issuer" }, c);
  const imp = await call("POST", "/api/institution/students/import", { createLogins: true, csv: "studentNumber,fullName,email\nS001,Aline Uwase,aline@student.demo.edu\nS002,Eric Mugisha,eric@student.demo.edu\nS003,Sandra Ingabire," }, c);
  console.log("Students:", imp.data.created.map((s) => `${s.studentNumber}${s.temporaryPassword ? " (temp pw " + s.temporaryPassword + ")" : ""}`).join(", "));

  const students = (await call("GET", "/api/institution/students", null, c)).data;
  const cert = await call("POST", "/api/documents", { studentId: students[0].id, docType: "certificate", title: "Bachelor of Science in Software Engineering", content: { program: "BSc Software Engineering", completionDate: "2026-06-30", grade: "First Class Honours" } }, c);
  console.log("Certificate code:", cert.data.code);

  const batch = await call("POST", "/api/documents/batch", { term: "Term 1", academicYear: "2026", className: "Year 2", items: students.map((s, i) => ({ studentId: s.id, courses: [{ name: "Algorithms", score: 90 - i * 7 }, { name: "Databases", score: 82 - i * 5 }, { name: "Networks", score: 75 }], remarks: "Good progress." })) }, c);
  console.log("Report card codes:", batch.data.results.map((r) => `${r.studentNumber}:${r.code}`).join("  "));

  // A sample file registered on-chain so other institutions can validate it (upload the same file on the Verify page)
  const sample = "DEMO UNIVERSITY OF KIGALI\nInstitutional Accreditation Letter 2026\nThis letter confirms the institution is accredited.\n";
  const fd = new FormData(); fd.append("title", "Institutional accreditation letter 2026"); fd.append("description", "Sample file - download it, then verify it on the public page");
  fd.append("file", new Blob([sample], { type: "text/plain" }), "accreditation-letter-2026.txt");
  const fr = await fetch((process.env.BASE_URL || "http://localhost:3000") + "/api/files", { method: "POST", headers: { cookie: c }, body: fd });
  const fj = await fr.json(); console.log("Registered file code:", fj.code);

  await call("POST", "/api/auth/register-verifier", { email: "visa@embassy.example", name: "Visa Officer", organization: "Example Embassy", password: "Embassy#2026pw" });
  const users = (await call("GET", "/api/admin/users", null, sa)).data;
  const v = users.find((u) => u.email === "visa@embassy.example");
  await call("PATCH", `/api/admin/users/${v.id}/status`, { status: "active" }, sa);
  // Demo only: spread timestamps over the last months so dashboard charts show a realistic history.
  try {
    const { db } = require("../server/db");
    const ago = (days) => new Date(Date.now() - days * 864e5).toISOString().replace("T", " ").slice(0, 19);
    const docs = db.prepare("SELECT id, doc_hash FROM documents ORDER BY id").all();
    docs.forEach((d, i) => db.prepare("UPDATE documents SET created_at=? WHERE id=?").run(ago([150, 95, 60, 20][i % 4]), d.id));
    const plan = [3, 5, 4, 8, 11, 9, 14, 17]; // verifications per month, oldest → newest
    plan.forEach((n, m) => { for (let k = 0; k < n; k++) db.prepare("INSERT INTO verification_log (query,result,doc_hash,created_at) VALUES (?,?,?,?)").run("demo", "VALID", docs[(m + k) % docs.length].doc_hash, ago((7 - m) * 30 + (k % 25))); });
  } catch (e) { console.log("(demo history skipped: " + e.message + ")"); }

  console.log("\nDemo logins:\n  super admin : " + process.env.SUPER_ADMIN_EMAIL + " / " + process.env.SUPER_ADMIN_PASSWORD + "\n  institution : registrar@demo.edu / Registrar#2026pw\n  issuer      : issuer@demo.edu / (temp) " + staff.data.temporaryPassword + "\n  verifier    : visa@embassy.example / Embassy#2026pw");
})().catch((e) => { console.error(e.message); process.exit(1); });
