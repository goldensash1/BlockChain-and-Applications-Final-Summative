// End-to-end API tests against a running stack (chain + deployed contract + server + seeded data).
// Usage: npm run e2e
require("dotenv").config();
const Database = require("better-sqlite3");
const BASE = process.env.BASE_URL || "http://localhost:3000";
let pass = 0, fail = 0;

async function call(method, url, body, cookie) {
  const r = await fetch(BASE + url, { method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})), cookie: (r.headers.get("set-cookie") || "").split(";")[0] };
}
async function upload(url, fields, name, bytes, cookie) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields || {})) fd.append(k, v);
  if (bytes) fd.append("file", new Blob([bytes]), name);
  const r = await fetch(BASE + url, { method: "POST", headers: cookie ? { cookie } : {}, body: fd });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}
const login = async (e, p) => (await call("POST", "/api/auth/login", { email: e, password: p })).cookie;
function t(name, cond, extra = "") { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  -> " + extra}`); }

(async () => {
  const reg = await login("registrar@demo.edu", "Registrar#2026pw");
  const sa = await login(process.env.SUPER_ADMIN_EMAIL, process.env.SUPER_ADMIN_PASSWORD);
  const students = (await call("GET", "/api/institution/students", null, reg)).data;
  const s1 = students.find((s) => s.student_number === "S001");

  // --- AUTH ---
  t("E01 wrong password rejected (401)", (await call("POST", "/api/auth/login", { email: "registrar@demo.edu", password: "nope" })).status === 401);
  t("E02 unauthenticated request to protected route (401)", (await call("GET", "/api/documents")).status === 401);
  t("E03 weak password refused on verifier registration", (await call("POST", "/api/auth/register-verifier", { email: "x@y.com", name: "x", organization: "y", password: "short" })).status === 400);
  const pendEmail = `pending${Date.now()}@y.com`;
  const pend = await call("POST", "/api/auth/register-verifier", { email: pendEmail, name: "P", organization: "Org", password: "LongPassw0rd!" });
  t("E04 verifier registers as pending", pend.status === 201);
  t("E05 pending verifier cannot log in (403)", (await call("POST", "/api/auth/login", { email: pendEmail, password: "LongPassw0rd!" })).status === 403);

  // --- RBAC ---
  const stuLogin = await call("POST", "/api/auth/login", { email: "aline@student.demo.edu", password: "wrong" });
  t("E06 student wrong pw rejected", stuLogin.status === 401);
  const ver = await login("visa@embassy.example", "Embassy#2026pw");
  t("E07 verifier cannot issue documents (403)", (await call("POST", "/api/documents", { studentId: s1.id }, ver)).status === 403);
  t("E08 institution admin cannot create institutions (403)", (await call("POST", "/api/admin/institutions", {}, reg)).status === 403);
  t("E09 super admin cannot be reached by verifier (403)", (await call("GET", "/api/admin/stats", null, ver)).status === 403);
  t("E10 super admin stats include live chain", (await call("GET", "/api/admin/stats", null, sa)).data.chain?.ok === true);

  // --- ISSUE + VERIFY ---
  const issued = await call("POST", "/api/documents", { studentId: s1.id, docType: "certificate", title: "E2E Certificate", content: { program: "Blockchain 101", completionDate: "2026-11-01", grade: "Distinction" } }, reg);
  t("E11 issue certificate -> 201 with tx hash", issued.status === 201 && /^0x[0-9a-f]{64}$/.test(issued.data.chainTx || ""), JSON.stringify(issued.data));
  const code = issued.data.code;
  let v = (await call("GET", `/api/verify/code/${code}`)).data;
  t("E12 public verify (no login) -> VALID", v.status === "VALID" && v.holder.name === "Aline Uwase", JSON.stringify(v));
  t("E13 lower-case code also works", (await call("GET", `/api/verify/code/${code.toLowerCase()}`)).data.status === "VALID");
  t("E14 unknown code -> NOT_FOUND", (await call("GET", "/api/verify/code/VD-AAAAA-BBBBB")).data.status === "NOT_FOUND");
  t("E15 hash lookup straight from chain -> VALID", (await call("POST", "/api/verify/hash", { hash: issued.data.hash })).data.status === "VALID");
  t("E16 random hash -> NOT_FOUND", (await call("POST", "/api/verify/hash", { hash: "0x" + "ab".repeat(32) })).data.status === "NOT_FOUND");
  t("E17 invalid hash format -> 400", (await call("POST", "/api/verify/hash", { hash: "123" })).status === 400);

  // --- PACKAGE (portable proof) ---
  const pkgRes = await fetch(`${BASE}/api/documents/${issued.data.id}/package`, { headers: { cookie: reg } });
  const pkg = await pkgRes.json();
  t("E18 downloaded package verifies VALID", (await call("POST", "/api/verify/package", { package: pkg })).data.status === "VALID");
  const forged = JSON.parse(JSON.stringify(pkg)); forged.payload.content.grade = "First Class"; forged.hash = pkg.hash;
  t("E19 forged package (grade edited) -> TAMPERED", (await call("POST", "/api/verify/package", { package: forged })).data.status === "TAMPERED");
  const forged2 = JSON.parse(JSON.stringify(pkg)); forged2.payload.content.grade = "First Class"; delete forged2.hash;
  t("E20 forged package without hash -> NOT_FOUND", (await call("POST", "/api/verify/package", { package: forged2 })).data.status === "NOT_FOUND");

  // --- DB TAMPERING DETECTION ---
  const db = new Database(process.env.DB_PATH || "./data/veridoc.db");
  const row = db.prepare("SELECT payload FROM documents WHERE code=?").get(code);
  db.prepare("UPDATE documents SET payload=? WHERE code=?").run(row.payload.replace("Distinction", "Fraudulent"), code);
  t("E21 database record edited behind our back -> TAMPERED", (await call("GET", `/api/verify/code/${code}`)).data.status === "TAMPERED");
  db.prepare("UPDATE documents SET payload=? WHERE code=?").run(row.payload, code);
  t("E22 restoring the record -> VALID again", (await call("GET", `/api/verify/code/${code}`)).data.status === "VALID");

  // --- STUDENT VIEW & ISOLATION ---
  const a = await db.prepare("SELECT id FROM users WHERE email='aline@student.demo.edu'").get();
  // reset student password through direct DB for test login
  const bcrypt = require("bcryptjs");
  db.prepare("UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?").run(bcrypt.hashSync("StudentPass123", 10), a.id);
  const st = await login("aline@student.demo.edu", "StudentPass123");
  const mine = (await call("GET", "/api/documents/mine", null, st)).data;
  t("E23 student sees only own documents", Array.isArray(mine) && mine.length >= 2 && mine.every((d) => d.studentNumber === "S001"));
  t("E24 student cannot list institution docs (403)", (await call("GET", "/api/documents", null, st)).status === 403);
  const eric = db.prepare("SELECT d.id FROM documents d JOIN students s ON s.id=d.student_id WHERE s.student_number='S002' LIMIT 1").get();
  t("E25 student cannot download another student's package (404)", (await fetch(`${BASE}/api/documents/${eric.id}/package`, { headers: { cookie: st } })).status === 404);

  // --- REVOKE ---
  t("E26 revoke without reason -> 400", (await call("POST", `/api/documents/${issued.data.id}/revoke`, { reason: "" }, reg)).status === 400);
  t("E27 revoke OK", (await call("POST", `/api/documents/${issued.data.id}/revoke`, { reason: "Issued in error" }, reg)).status === 200);
  v = (await call("GET", `/api/verify/code/${code}`)).data;
  t("E28 revoked doc verifies REVOKED with reason", v.status === "REVOKED" && v.revokeReason === "Issued in error", JSON.stringify(v));
  t("E29 revoking twice -> 409", (await call("POST", `/api/documents/${issued.data.id}/revoke`, { reason: "again" }, reg)).status === 409);

  // --- SUPERSEDE ---
  const i2 = await call("POST", "/api/documents", { studentId: s1.id, docType: "certificate", title: "Cert v1", content: { program: "P", grade: "B" } }, reg);
  const sup = await call("POST", `/api/documents/${i2.data.id}/supersede`, { content: { program: "P", grade: "A" } }, reg);
  t("E30 supersede issues corrected version", sup.status === 201, JSON.stringify(sup.data));
  v = (await call("GET", `/api/verify/code/${i2.data.code}`)).data;
  t("E31 old version -> SUPERSEDED pointing to new code", v.status === "SUPERSEDED" && v.supersededBy === sup.data.code, JSON.stringify(v));
  t("E32 new version -> VALID", (await call("GET", `/api/verify/code/${sup.data.code}`)).data.status === "VALID");

  // --- ISSUER role & cross-institution ---
  const issuerPw = process.argv[2];
  t("E33 batch with unknown student -> 404", (await call("POST", "/api/documents/batch", { term: "T", academicYear: "2026", items: [{ studentId: 99999, courses: [{ name: "x", score: 50 }] }] }, reg)).status === 404);
  t("E34 invalid score rejected (400)", (await call("POST", "/api/documents", { studentId: s1.id, docType: "report_card", title: "bad", content: { courses: [{ name: "Math", score: 150 }] } }, reg)).status === 400);

  // --- SUSPEND INSTITUTION ---
  const inst = (await call("GET", "/api/admin/institutions", null, sa)).data.find((i) => i.code === "DEMO-UNI");
  const keep = (await call("POST", "/api/documents", { studentId: s1.id, docType: "certificate", title: "Suspension probe", content: { program: "X" } }, reg)).data;
  await call("PATCH", `/api/admin/institutions/${inst.id}/active`, { active: false }, sa);
  t("E35 suspended institution's documents -> INSTITUTION_SUSPENDED", (await call("GET", `/api/verify/code/${keep.code}`)).data.status === "INSTITUTION_SUSPENDED");
  t("E36 suspended institution cannot issue (403)", (await call("POST", "/api/documents", { studentId: s1.id, docType: "certificate", title: "t", content: { program: "X" } }, reg)).status === 403);
  await call("PATCH", `/api/admin/institutions/${inst.id}/active`, { active: true }, sa);
  t("E37 re-activated -> VALID again", (await call("GET", `/api/verify/code/${keep.code}`)).data.status === "VALID");

  // --- verification log ---
  const hist = (await call("GET", "/api/verify/history", null, ver)).data;
  t("E38 verifier history endpoint reachable", Array.isArray(hist));
  const printable = await fetch(`${BASE}/d/${keep.code}`);
  t("E39 printable document page renders", printable.status === 200 && (await printable.text()).includes(keep.code));

  // --- IMPERSONATION ("sign in as", no password needed) ---
  const users = (await call("GET", "/api/admin/users", null, sa)).data;
  const uid = (email) => users.find((u) => u.email === email)?.id;
  const asStudent = await call("POST", `/api/auth/impersonate/${uid("aline@student.demo.edu")}`, null, sa);
  t("E40 super admin can act as a student without a password", asStudent.status === 200 && asStudent.data.user.role === "student" && asStudent.data.impersonator.role === "super_admin", JSON.stringify(asStudent.data));
  const stuCookie = asStudent.cookie;
  const me1 = (await call("GET", "/api/auth/me", null, stuCookie)).data;
  t("E41 /me reports the acted-as user plus the real administrator", me1.user.role === "student" && me1.impersonator?.email === process.env.SUPER_ADMIN_EMAIL);
  t("E42 acting-as student sees own documents", (await call("GET", "/api/documents/mine", null, stuCookie)).status === 200);
  t("E43 acting-as student has NO admin rights (403)", (await call("GET", "/api/admin/stats", null, stuCookie)).status === 403);
  t("E44 impersonation cannot be chained (403)", (await call("POST", `/api/auth/impersonate/${uid("eric@student.demo.edu")}`, null, stuCookie)).status === 403);
  t("E45 passwords cannot be changed while acting as someone (403)", (await call("POST", "/api/auth/change-password", { currentPassword: "x", newPassword: "LongPassw0rd!" }, stuCookie)).status === 403);
  const back = await call("POST", "/api/auth/stop-impersonation", null, stuCookie);
  t("E46 stop-impersonation returns to the administrator", back.status === 200 && back.data.user.role === "super_admin" && !back.data.impersonator);
  t("E47 after returning, admin rights work again", (await call("GET", "/api/admin/stats", null, back.cookie)).status === 200);
  t("E48 institution admin can act as own issuer", (await call("POST", `/api/auth/impersonate/${uid("issuer@demo.edu")}`, null, reg)).status === 200);
  t("E49 institution admin cannot act as a verifier (403)", (await call("POST", `/api/auth/impersonate/${uid("visa@embassy.example")}`, null, reg)).status === 403);
  t("E50 a verifier cannot impersonate anyone (403)", (await call("POST", `/api/auth/impersonate/${uid("issuer@demo.edu")}`, null, ver)).status === 403);
  t("E51 inactive (pending) account cannot be impersonated (409)", (await call("POST", `/api/auth/impersonate/${uid(pendEmail)}`, null, sa)).status === 409);
  t("E52 unknown user id -> 404", (await call("POST", "/api/auth/impersonate/999999", null, sa)).status === 404);
  const audit = (await call("GET", "/api/admin/audit", null, sa)).data;
  t("E53 impersonation start and end are audit-logged", audit.some((a) => a.action === "impersonation_started") && audit.some((a) => a.action === "impersonation_ended"));

  // --- FILE REGISTRY: upload any file on-chain so OTHER institutions / the public can validate it ---
  const pdf = Buffer.from("%PDF-1.4 demo accreditation letter " + Date.now());
  const up = await upload("/api/files", { title: "Accreditation letter", description: "demo" }, "letter.pdf", pdf, reg);
  t("E54 institution uploads a file -> anchored with a VF- code", up.status === 201 && up.data.code?.startsWith("VF-") && up.data.chainStatus === "anchored", JSON.stringify(up.data));
  const vf = await upload("/api/verify/file", {}, "letter.pdf", pdf, ver); // a different party (verifier) validates
  t("E55 another party verifies the same file by upload -> VALID", vf.data.status === "VALID" && vf.data.institution === "Demo University of Kigali" && vf.data.title === "Accreditation letter", JSON.stringify(vf.data));
  const edited = await upload("/api/verify/file", {}, "letter.pdf", Buffer.concat([pdf, Buffer.from(" ")]), null);
  t("E56 a single changed byte -> NOT_FOUND (anonymous)", edited.data.status === "NOT_FOUND");
  const byCode = (await call("GET", `/api/verify/code/${up.data.code}`)).data;
  t("E57 file verifies by VF- code with a download link", byCode.status === "VALID" && byCode.downloadUrl === "/f/" + up.data.code, JSON.stringify(byCode));
  const dl = Buffer.from(await (await fetch(BASE + "/f/" + up.data.code)).arrayBuffer());
  t("E58 public download returns the exact original bytes", dl.equals(pdf));
  t("E59 uploading the same file again -> 409", (await upload("/api/files", { title: "dup" }, "letter.pdf", pdf, reg)).status === 409);
  t("E60 verifier cannot upload files (403)", (await upload("/api/files", { title: "x" }, "a.txt", Buffer.from("zzz"), ver)).status === 403);
  t("E61 anonymous cannot upload files (401)", (await upload("/api/files", { title: "x" }, "a.txt", Buffer.from("zzz"), null)).status === 401);
  t("E62 title is required (400)", (await upload("/api/files", { title: " " }, "b.txt", Buffer.from("bbb" + Date.now()), reg)).status === 400);
  const myFiles = (await call("GET", "/api/files", null, reg)).data;
  t("E63 institution lists its own files", myFiles.some((f) => f.code === up.data.code));
  t("E64 file revoke requires a reason (400)", (await call("POST", `/api/files/${up.data.id}/revoke`, { reason: "" }, reg)).status === 400);
  t("E65 institution revokes its file", (await call("POST", `/api/files/${up.data.id}/revoke`, { reason: "Superseded by new letter" }, reg)).status === 200);
  const vr = await upload("/api/verify/file", {}, "letter.pdf", pdf, null);
  t("E66 revoked file verifies as REVOKED with the reason", vr.data.status === "REVOKED" && vr.data.revokeReason === "Superseded by new letter", JSON.stringify(vr.data));

  // --- INSTITUTION DETAIL + EDITING (super admin) ---
  const demo = (await call("GET", "/api/admin/institutions", null, sa)).data.find((i) => i.code === "DEMO-UNI");
  const det = (await call("GET", `/api/admin/institutions/${demo.id}`, null, sa)).data;
  t("E67 institution detail has counts (users, documents, files)", det.counts.users >= 3 && det.counts.documents >= 1 && det.counts.files >= 1, JSON.stringify(det.counts));
  const dd = (await call("GET", `/api/admin/institutions/${demo.id}/documents`, null, sa)).data;
  t("E68 institution page lists its documents and uploaded files", dd.documents.length >= 1 && dd.files.some((f) => f.code === up.data.code));
  const iu = (await call("GET", `/api/admin/institutions/${demo.id}/users`, null, sa)).data;
  t("E69 institution page lists only its own users", iu.length >= 3 && iu.every((u) => u.email.endsWith("demo.edu")));
  t("E70 institution detail forbidden to non-super-admin (403)", (await call("GET", `/api/admin/institutions/${demo.id}`, null, reg)).status === 403);
  t("E71 super admin edits institution country and type", (await call("PATCH", `/api/admin/institutions/${demo.id}`, { country: "Rwanda", type: "university" }, sa)).status === 200);
  t("E72 invalid institution type rejected (400)", (await call("PATCH", `/api/admin/institutions/${demo.id}`, { type: "casino" }, sa)).status === 400);
  const renamed = await call("PATCH", `/api/admin/institutions/${demo.id}`, { name: "Demo University of Kigali" }, sa);
  t("E73 institution name can be edited", renamed.status === 200);

  // --- USER EDITING ---
  const iss = iu.find((u) => u.email === "issuer@demo.edu");
  t("E74 super admin edits a user's name", (await call("PATCH", `/api/admin/users/${iss.id}`, { name: "Ivan Issuer" }, sa)).status === 200);
  t("E75 duplicate email on edit -> 409", (await call("PATCH", `/api/admin/users/${iss.id}`, { email: "registrar@demo.edu" }, sa)).status === 409);
  t("E76 invalid email on edit -> 400", (await call("PATCH", `/api/admin/users/${iss.id}`, { email: "nope" }, sa)).status === 400);
  t("E77 issuer promoted to institution admin", (await call("PATCH", `/api/admin/users/${iss.id}`, { role: "institution_admin" }, sa)).status === 200);
  t("E78 ...and demoted back to issuer", (await call("PATCH", `/api/admin/users/${iss.id}`, { role: "issuer" }, sa)).status === 200);
  const stu = iu.find((u) => u.role === "student");
  t("E79 a student's role cannot be changed (400)", stu ? (await call("PATCH", `/api/admin/users/${stu.id}`, { role: "issuer" }, sa)).status === 400 : true);
  const rp = await call("POST", `/api/admin/users/${iss.id}/reset-password`, null, sa);
  const rl = await call("POST", "/api/auth/login", { email: "issuer@demo.edu", password: rp.data.temporaryPassword });
  t("E80 reset password issues a working one-time temp password", rp.status === 200 && rl.status === 200 && rl.data.user.mustChangePassword === true);
  const nu = await call("POST", `/api/admin/institutions/${demo.id}/users`, { name: "Temp Teacher", email: `teacher${Date.now()}@demo.edu`, role: "issuer" }, sa);
  t("E81 super admin adds a user inside an institution", nu.status === 201 && !!nu.data.temporaryPassword);
  t("E82 institution admin edits their own issuer", (await call("PATCH", `/api/institution/staff/${iss.id}`, { name: "Ivan I." }, reg)).status === 200);
  t("E83 institution admin cannot use the admin edit endpoint (403)", (await call("PATCH", `/api/admin/users/${iss.id}`, { name: "x" }, reg)).status === 403);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
