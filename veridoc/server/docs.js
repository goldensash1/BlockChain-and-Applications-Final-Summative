// Canonical document payloads and hashing. The hash is what gets anchored on-chain.
const { ethers } = require("ethers");
const crypto = require("crypto");

/** JSON.stringify with recursively sorted keys → identical bytes on every machine. */
function canonicalize(v) {
  if (Array.isArray(v)) return "[" + v.map(canonicalize).join(",") + "]";
  if (v && typeof v === "object")
    return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonicalize(v[k])).join(",") + "}";
  return JSON.stringify(v);
}

const hashPayload = (canonicalJson) => ethers.keccak256(ethers.toUtf8Bytes(canonicalJson));

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
function newCode() {
  const b = crypto.randomBytes(10);
  let s = "";
  for (const x of b) s += ALPHABET[x % ALPHABET.length];
  return `VD-${s.slice(0, 5)}-${s.slice(5)}`;
}
const newSalt = () => crypto.randomBytes(16).toString("hex");

function gradeLetter(score) {
  if (score >= 90) return "A"; if (score >= 80) return "B"; if (score >= 70) return "C";
  if (score >= 60) return "D"; if (score >= 50) return "E"; return "F";
}
const gradePoints = { A: 4, B: 3, C: 2, D: 1, E: 0.5, F: 0 };

/** Build the exact object that is hashed. */
function buildPayload({ institution, student, docType, title, content, expiresAt, salt }) {
  return {
    v: 1,
    institutionCode: institution.code,
    institutionName: institution.name,
    docType,
    title,
    holder: { name: student.full_name, studentNumber: student.student_number },
    content,
    expiresAt: expiresAt || null,
    salt,
  };
}

function normalizeContent(docType, c = {}) {
  if (docType === "report_card") {
    const courses = (c.courses || []).map((x) => {
      const score = Number(x.score);
      if (!x.name || Number.isNaN(score) || score < 0 || score > 100) throw new Error("Each course needs a name and a score 0-100");
      return { name: String(x.name).trim(), score, grade: x.grade || gradeLetter(score) };
    });
    if (!courses.length) throw new Error("Report card needs at least one course");
    const average = Math.round((courses.reduce((a, x) => a + x.score, 0) / courses.length) * 100) / 100;
    const gpa = Math.round((courses.reduce((a, x) => a + (gradePoints[x.grade] ?? 0), 0) / courses.length) * 100) / 100;
    return { term: String(c.term || "").trim(), academicYear: String(c.academicYear || "").trim(), className: String(c.className || "").trim(), courses, average, gpa, remarks: String(c.remarks || "").trim() };
  }
  // certificate / diploma / transcript: free-form but bounded
  return {
    program: String(c.program || "").trim(),
    completionDate: String(c.completionDate || "").trim(),
    grade: String(c.grade || "").trim(),
    description: String(c.description || "").trim(),
  };
}

module.exports = { canonicalize, hashPayload, newCode, newSalt, buildPayload, normalizeContent };
