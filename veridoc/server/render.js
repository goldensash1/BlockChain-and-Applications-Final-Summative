// Printable certificate / report card page (use browser "Print → Save as PDF").
const QRCode = require("qrcode");
const cfg = require("./config");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

module.exports = async function render(d, payload, onChain) {
  const url = `${cfg.publicUrl}/#/verify/${d.code}`;
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 180 });
  const c = payload.content;
  const body = d.doc_type === "report_card"
    ? `<p class="sub">${esc(c.term)} · ${esc(c.academicYear)}${c.className ? " · " + esc(c.className) : ""}</p>
       <table><thead><tr><th>Course</th><th>Score</th><th>Grade</th></tr></thead><tbody>
       ${c.courses.map((x) => `<tr><td>${esc(x.name)}</td><td>${x.score}</td><td>${esc(x.grade)}</td></tr>`).join("")}
       </tbody><tfoot><tr><td>Average / GPA</td><td>${c.average}</td><td>${c.gpa}</td></tr></tfoot></table>
       ${c.remarks ? `<p class="rem"><b>Remarks:</b> ${esc(c.remarks)}</p>` : ""}`
    : `<p class="sub">This is to certify that</p><h2>${esc(payload.holder.name)}</h2>
       <p>has successfully completed <b>${esc(c.program)}</b>${c.completionDate ? " on " + esc(c.completionDate) : ""}${c.grade ? " with " + esc(c.grade) : ""}.</p>
       ${c.description ? `<p class="rem">${esc(c.description)}</p>` : ""}`;
  const stamp = onChain && onChain.status !== "VALID" ? `<div class="stamp">${esc(onChain.status.replace("_", " "))}</div>` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(d.title)}</title>
<link rel="stylesheet" href="/doc.css"></head><body><main class="sheet">${stamp}
<h3>${esc(payload.institutionName)}</h3><h1>${esc(d.title)}</h1>
${d.doc_type === "report_card" ? `<p class="holder"><b>${esc(payload.holder.name)}</b> · Student No. ${esc(payload.holder.studentNumber)}</p>` : ""}
${body}
<footer><img src="${qr}" alt="QR"><div><p>Verify this document: scan the QR code or visit<br><b>${esc(cfg.publicUrl)}</b> and enter code</p><p class="code">${esc(d.code)}</p>
<p class="hash">Blockchain fingerprint: ${esc(d.doc_hash)}</p></div></footer></main>
<p class="noprint"><button onclick="window.print()">Print / Save as PDF</button></p></body></html>`;
};
