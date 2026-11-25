/* VeriDoc single-page app (vanilla JS + Tailwind CSS, no framework).
 * Safety: every piece of user/server data is inserted with textContent (never innerHTML).
 * The only innerHTML below is for static, hard-coded SVG icons. */
const $root = document.getElementById("root");
let me = null;   // signed-in user (the identity being acted as)
let imp = null;  // administrator who is "acting as" `me`, or null

// ───────────────────────────── helpers ─────────────────────────────
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (v !== false && v != null) el.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(k));
  return el;
}
async function api(method, url, body) {
  const r = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}
const fmt = (d) => (d ? new Date(d.includes("T") || d.includes(" ") ? d.replace(" ", "T") + (d.endsWith("Z") || d.includes("+") ? "" : "Z") : d).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "-");
const fmtDay = (d) => (d ? new Date(d.replace(" ", "T") + (d.endsWith("Z") ? "" : "Z")).toLocaleDateString(undefined, { dateStyle: "medium" }) : "-");
const short = (x, n = 10) => (x ? x.slice(0, n) + "…" + x.slice(-6) : "-");
const initials = (n) => String(n || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0].toUpperCase()).join("");
const cap = (s) => String(s || "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
function ago(d) {
  const s = (Date.now() - new Date(d.replace(" ", "T") + (d.endsWith("Z") ? "" : "Z")).getTime()) / 1000;
  if (s < 60) return "just now"; if (s < 3600) return Math.floor(s / 60) + " min ago";
  if (s < 86400) return Math.floor(s / 3600) + " h ago"; if (s < 86400 * 30) return Math.floor(s / 86400) + " d ago";
  return fmtDay(d);
}

// Feather-style icons (static markup only)
const ICONS = {
  grid: '<path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8"/>',
  award: '<circle cx="12" cy="8" r="7"/><path d="M8.21 13.89L7 23l5-3 5 3-1.21-9.12"/>',
  layers: '<path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
  building: '<path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4M9 9v.01M9 12v.01M9 15v.01M9 18v.01"/>',
  clipboard: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  login: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/>',
  eye: '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M17.94 17.94A10.9 10.9 0 0 1 12 19c-7 0-11-7-11-7a19.8 19.8 0 0 1 5.06-5.94M9.9 4.24A10.9 10.9 0 0 1 12 5c7 0 11 7 11 7a19.8 19.8 0 0 1-3.17 4.19M14.12 14.12a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/>',
  trend: '<path d="M23 6l-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  print: '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  menu: '<path d="M3 12h18M3 6h18M3 18h18"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
  hash: '<path d="M4 9h16M4 15h16M10 3L8 21M16 3l-2 18"/>',
  key: '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  ban: '<circle cx="12" cy="12" r="10"/><path d="M4.93 4.93l14.14 14.14"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
};
function icon(name, size = "h-5 w-5") {
  const s = h("span", { class: "inline-flex shrink-0" });
  s.innerHTML = `<svg class="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ""}</svg>`;
  return s;
}

const TONES = {
  emerald: { pill: "bg-emerald-50 text-emerald-700 ring-emerald-600/20", soft: "bg-emerald-50 text-emerald-600", band: "bg-emerald-500", border: "border-emerald-500", tile: "bg-emerald-50/70" },
  rose: { pill: "bg-rose-50 text-rose-700 ring-rose-600/20", soft: "bg-rose-50 text-rose-600", band: "bg-rose-500", border: "border-rose-500", tile: "bg-rose-50/70" },
  amber: { pill: "bg-amber-50 text-amber-700 ring-amber-600/20", soft: "bg-amber-50 text-amber-600", band: "bg-amber-500", border: "border-amber-500", tile: "bg-amber-50/70" },
  blue: { pill: "bg-brand-50 text-brand-700 ring-brand-600/20", soft: "bg-brand-50 text-brand-600", band: "bg-brand-600", border: "border-brand-600", tile: "bg-brand-50/70" },
  violet: { pill: "bg-violet-50 text-violet-700 ring-violet-600/20", soft: "bg-violet-50 text-violet-600", band: "bg-violet-500", border: "border-violet-500", tile: "bg-violet-50/70" },
  slate: { pill: "bg-slate-100 text-slate-600 ring-slate-500/20", soft: "bg-slate-100 text-slate-600", band: "bg-slate-500", border: "border-slate-400", tile: "bg-slate-50" },
};
const STATUS_TONE = { VALID: "emerald", valid: "emerald", active: "emerald", anchored: "emerald", REVOKED: "rose", TAMPERED: "rose", NOT_FOUND: "rose", revoked: "rose", disabled: "rose", failed: "rose", EXPIRED: "amber", SUPERSEDED: "amber", INSTITUTION_SUSPENDED: "amber", superseded: "amber", pending: "amber", expired: "amber" };
const badge = (s) => h("span", { class: `inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${TONES[STATUS_TONE[s] || "slate"].pill}` }, cap(s));
const rolePill = (r) => h("span", { class: `inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${TONES[{ super_admin: "violet", institution_admin: "blue", issuer: "blue", student: "emerald", verifier: "amber" }[r] || "slate"].pill}` }, cap(r));

function toast(kind, text) {
  const t = h("div", { class: `pointer-events-auto flex max-w-sm items-start gap-3 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg ${kind === "err" ? "bg-rose-600" : "bg-slate-900"}` }, icon(kind === "err" ? "alert" : "check", "h-5 w-5 mt-0.5"), h("span", {}, text));
  let box = document.getElementById("toasts");
  if (!box) { box = h("div", { id: "toasts", class: "pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col gap-2" }); document.body.append(box); }
  box.append(t); setTimeout(() => t.remove(), 4500);
}
function alertBox(kind, ...kids) {
  const tone = { err: "bg-rose-50 text-rose-800 ring-rose-200", ok: "bg-emerald-50 text-emerald-800 ring-emerald-200", info: "bg-brand-50 text-brand-700 ring-brand-100", warn: "bg-amber-50 text-amber-800 ring-amber-200" }[kind];
  return h("div", { class: `flex items-start gap-3 rounded-xl px-4 py-3 text-sm ring-1 ${tone}` }, icon(kind === "ok" ? "check" : "alert", "h-5 w-5 mt-0.5"), h("div", { class: "min-w-0 break-words" }, kids));
}
function flash(host, kind, text) { host.querySelector("[data-flash]")?.remove(); const a = alertBox(kind, text); a.dataset.flash = "1"; a.classList.add("mb-4"); host.prepend(a); }
const loading = () => h("div", { class: "flex items-center justify-center py-24 text-slate-400" }, h("div", { class: "h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-brand-600" }));
function copy(text, el) { navigator.clipboard?.writeText(text); const o = el.textContent; el.textContent = "Copied ✓"; setTimeout(() => (el.textContent = o), 1200); }

/** Modal dialog. build(close) returns the body node. */
function modal(title, build) {
  const close = () => ov.remove();
  const ov = h("div", { class: "fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm", onclick: (e) => e.target === ov && close() },
    h("div", { class: "card w-full max-w-lg p-6" }, h("div", { class: "mb-4 flex items-center justify-between" }, h("h3", { class: "text-lg font-bold text-navy" }, title),
      h("button", { class: "rounded-lg p-1 text-slate-400 hover:bg-slate-100", onclick: close, "aria-label": "Close" }, icon("x"))), build(close)));
  document.body.append(ov); return close;
}

// form pieces
function field(label, input, hint) { return h("div", {}, h("label", { class: "lbl" }, label), input.type === "password" ? withEye(input) : input, hint ? h("p", { class: "mt-1 text-xs text-slate-400" }, hint) : null); }
function withEye(input) {
  input.classList.add("pr-11");
  const btn = h("button", { type: "button", class: "absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-brand-600", "aria-label": "Show password", title: "Show password" }, icon("eye"));
  btn.addEventListener("click", () => {
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    btn.replaceChildren(icon(show ? "eyeoff" : "eye"));
    btn.setAttribute("aria-label", show ? "Hide password" : "Show password"); btn.title = btn.getAttribute("aria-label");
  });
  return h("div", { class: "relative" }, input, btn);
}
const inp = (a = {}) => h("input", { class: "inp", ...a });
const sel = (opts, a = {}) => h("select", { class: "inp", ...a }, opts.map((o) => (Array.isArray(o) ? h("option", { value: o[0] }, o[1]) : h("option", {}, o))));
const grid = (...k) => h("div", { class: "grid gap-4 sm:grid-cols-2 lg:grid-cols-3" }, k);

function tbl(cols, rows, empty = "Nothing here yet.") {
  return h("div", { class: "overflow-x-auto" }, h("table", { class: "min-w-full" },
    h("thead", { class: "border-b border-slate-100" }, h("tr", {}, cols.map((c) => h("th", { class: "th" }, c)))),
    h("tbody", { class: "divide-y divide-slate-100" }, rows.length ? rows : h("tr", {}, h("td", { colspan: cols.length, class: "px-4 py-12 text-center text-sm text-slate-400" }, empty)))));
}
const tr = (...cells) => h("tr", { class: "transition hover:bg-slate-50/60" }, cells.map((c) => h("td", { class: "td" }, c)));
function panel(title, right, ...body) {
  return h("section", { class: "card" }, (title || right) && h("div", { class: "flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4" }, h("h2", { class: "text-base font-bold text-navy" }, title), right || null), body);
}
const pad = (...k) => h("div", { class: "p-5" }, k);
const filterBar = (...k) => h("div", { class: "flex flex-wrap items-center gap-2" }, k);

async function apiUpload(url, fd) {
  const r = await fetch(url, { method: "POST", body: fd });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}
const fmtSize = (n) => (n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(1) + " MB");
/** Drag-and-drop / click file picker. */
function dropZone() {
  const input = h("input", { type: "file", class: "hidden" }), hint = "Drag a file here or click to browse (max 10 MB)";
  const label = h("p", { class: "text-sm text-slate-500" }, hint);
  const state = { file: null };
  const zone = h("div", { class: "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center transition hover:border-brand-600 hover:bg-brand-50/40", onclick: () => input.click() },
    h("div", { class: "flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600" }, icon("upload", "h-6 w-6")), label, input);
  const set = (f) => { if (!f) return; state.file = f; label.replaceChildren(h("b", { class: "text-navy" }, f.name), " · " + fmtSize(f.size)); };
  input.addEventListener("click", (e) => e.stopPropagation());
  input.addEventListener("change", () => set(input.files[0]));
  zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("border-brand-600"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("border-brand-600"));
  zone.addEventListener("drop", (e) => { e.preventDefault(); zone.classList.remove("border-brand-600"); set(e.dataTransfer.files[0]); });
  return { el: zone, get file() { return state.file; } };
}
function secretDialog(title, intro, email, pw) {
  modal(title, (close) => { const b = h("button", { class: "btn-soft", onclick: () => copy(pw, b) }, icon("copy", "h-3.5 w-3.5"), "Copy password");
    return h("div", { class: "space-y-4" }, alertBox("ok", intro), h("div", { class: "rounded-xl bg-slate-50 p-4 font-mono text-sm" }, h("p", {}, email), h("p", { class: "mt-1 font-bold text-navy" }, pw)),
      h("p", { class: "text-xs text-slate-500" }, "This password is shown only once. The user must choose a new one at first sign-in."), h("div", { class: "flex justify-end gap-2" }, b, h("button", { class: "btn", onclick: close }, "Done"))); });
}

// ───────────────────────────── charts / widgets ─────────────────────────────
function smooth(pts) {
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    d += ` C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)},${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)},${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}
function areaChart(series, lines) {
  const W = 720, H = 270, L = 34, R = 12, T = 14, B = 30, iw = W - L - R, ih = H - T - B;
  const all = lines.flatMap((l) => series[l.key]), max = Math.max(5, Math.ceil(Math.max(...all) / 5) * 5);
  const X = (i) => L + (iw * i) / Math.max(1, series.months.length - 1), Y = (v) => T + ih - (ih * v) / max;
  const mon = series.months.map((m) => new Date(m + "-02").toLocaleString(undefined, { month: "short" }));
  let svg = `<defs>${lines.map((l, i) => `<linearGradient id="ag${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${l.color}" stop-opacity=".28"/><stop offset="1" stop-color="${l.color}" stop-opacity="0"/></linearGradient>`).join("")}</defs>`;
  for (let g = 0; g <= 4; g++) { const v = (max * g) / 4, y = Y(v); svg += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="#e8ecf4" stroke-dasharray="3 4"/><text x="${L - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="#94a3b8">${Math.round(v)}</text>`; }
  mon.forEach((m, i) => { svg += `<text x="${X(i)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="#94a3b8">${m}</text>`; });
  lines.forEach((l, i) => {
    const pts = series[l.key].map((v, j) => [X(j), Y(v)]), d = smooth(pts);
    svg += `<path d="${d} L${X(pts.length - 1)},${Y(0)} L${X(0)},${Y(0)} Z" fill="url(#ag${i})"/><path d="${d}" fill="none" stroke="${l.color}" stroke-width="2.5" stroke-linecap="round"/>`;
    pts.forEach((p, j) => { svg += `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="#fff" stroke="${l.color}" stroke-width="2"><title>${l.label}: ${series[l.key][j]} (${mon[j]})</title></circle>`; });
  });
  const box = h("div", {}); box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="h-auto w-full" role="img" aria-label="Activity over the last months">${svg}</svg>`; return box;
}
function legend(lines) { return h("div", { class: "flex items-center gap-4 text-xs text-slate-500" }, lines.map((l) => h("span", { class: "inline-flex items-center gap-1.5" }, h("span", { class: "h-2 w-2 rounded-full", style: `background:${l.color}` }), l.label))); }

function statCard(label, value, ic, tone, hint) {
  return h("div", { class: "card flex items-center justify-between p-5" },
    h("div", {}, h("p", { class: "text-3xl font-bold tracking-tight text-navy" }, String(value)), h("p", { class: "mt-1 text-sm font-medium text-slate-500" }, label), hint ? h("p", { class: "mt-0.5 text-xs text-slate-400" }, hint) : null),
    h("div", { class: `flex h-12 w-12 items-center justify-center rounded-2xl ${TONES[tone].soft}` }, icon(ic, "h-6 w-6")));
}
function statusTiles(by, extra) {
  const t = (label, v, tone, ic) => h("div", { class: `rounded-2xl p-4 ${TONES[tone].tile}` }, h("div", { class: `mb-3 flex h-9 w-9 items-center justify-center rounded-full ${TONES[tone].soft}` }, icon(ic, "h-4 w-4")), h("p", { class: "text-2xl font-bold text-navy" }, String(v)), h("p", { class: "text-xs font-medium text-slate-500" }, label));
  return h("div", { class: "grid grid-cols-2 gap-3" }, t("Valid", by.valid, "emerald", "check"), t("Revoked", by.revoked, "rose", "ban"), t("Superseded", by.superseded, "amber", "layers"), extra);
}
const ACTION_ICON = { login: "login", login_failed: "alert" };
function activityList(items) {
  if (!items.length) return h("p", { class: "px-5 py-10 text-center text-sm text-slate-400" }, "No activity yet.");
  return h("ul", { class: "divide-y divide-slate-100" }, items.map((a) => h("li", { class: "flex items-start gap-3 px-5 py-3.5" },
    h("div", { class: `mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${a.action.includes("fail") ? TONES.rose.soft : TONES.blue.soft}` }, icon(ACTION_ICON[a.action] || "activity", "h-4 w-4")),
    h("div", { class: "min-w-0 flex-1" }, h("p", { class: "truncate text-sm font-medium text-slate-800" }, cap(a.action)), h("p", { class: "truncate text-xs text-slate-400" }, [a.name || a.email, a.detail].filter(Boolean).join(" · "))),
    h("span", { class: "shrink-0 text-xs text-slate-400" }, ago(a.created_at)))));
}
function docRow(d) {
  return tr(h("div", {}, h("p", { class: "font-semibold text-slate-800" }, d.title), h("p", { class: "text-xs text-slate-400" }, d.institution || cap(d.doc_type || d.docType))),
    d.student || d.studentName || "-", h("span", { class: "font-mono text-xs" }, d.code), badge(d.status), h("span", { class: "text-xs text-slate-400" }, fmtDay(d.created_at || d.createdAt)));
}

// ───────────────────────────── shell ─────────────────────────────
const NAV = {
  super_admin: [["dashboard", "Dashboard", "grid"], ["institutions", "Institutions", "building"], ["users", "Users", "users"], ["audit", "Audit log", "clipboard"], ["verify", "Verify a document", "shield"]],
  institution_admin: [["dashboard", "Dashboard", "grid"], ["documents", "Documents", "file"], ["issue", "Issue certificate", "award"], ["batch", "Report cards", "layers"], ["files", "Upload to blockchain", "upload"], ["students", "Students", "users"], ["people", "Staff & access", "key"], ["verify", "Verify a document", "shield"]],
  issuer: [["dashboard", "Dashboard", "grid"], ["documents", "Documents", "file"], ["issue", "Issue certificate", "award"], ["batch", "Report cards", "layers"], ["files", "Upload to blockchain", "upload"], ["students", "Students", "users"], ["verify", "Verify a document", "shield"]],
  student: [["dashboard", "My documents", "file"], ["verify", "Verify a document", "shield"]],
  verifier: [["dashboard", "Dashboard", "grid"], ["verify", "Verify a document", "shield"]],
};
const SUBTITLE = {
  dashboard: "Overview of activity and status", institutions: "Register and manage institutions on the blockchain", users: "Accounts, approvals and access", audit: "Every sensitive action, recorded",
  documents: "Everything your institution has issued", issue: "Anchor a certificate on Ethereum", batch: "Issue a whole class in one transaction", students: "Your students and bulk import",
  people: "Issuers and student logins you can manage", files: "Register any file on Ethereum so other institutions can validate it", verify: "Check any document in seconds",
  account: "Your profile and password",
};
/** Available to every signed-in role, shown under the user card in the sidebar. */
const ACCOUNT_NAV = ["account", "My account", "user"];
const brandLogo = (cls = "h-9 w-9") => h("img", { src: "/logo.svg", alt: "", class: cls });

function banner() {
  if (!imp) return null;
  return h("div", { class: "flex flex-wrap items-center justify-between gap-3 bg-amber-400 px-4 py-2.5 text-sm font-medium text-amber-950" },
    h("span", { class: "flex items-center gap-2" }, icon("eye", "h-4 w-4"), `Viewing as ${me.name} (${cap(me.role)}) - you are signed in as ${imp.name}. Actions are logged to your account.`),
    h("button", { class: "inline-flex items-center gap-1.5 rounded-lg bg-amber-950 px-3 py-1.5 text-xs font-semibold text-white hover:bg-black", onclick: stopImpersonating }, icon("logout", "h-3.5 w-3.5"), "Return to my account"));
}
async function impersonate(u) {
  try { const r = await api("POST", `/api/auth/impersonate/${u.id}`); me = r.user; imp = r.impersonator; toast("ok", `Now viewing as ${u.name}`); location.hash = "#/app/dashboard"; route(); }
  catch (e) { toast("err", e.message); }
}
async function stopImpersonating() {
  try { const r = await api("POST", "/api/auth/stop-impersonation"); me = r.user; imp = null; location.hash = me.role === "super_admin" ? "#/app/users" : "#/app/people"; route(); }
  catch (e) { toast("err", e.message); }
}
async function signOut() { await api("POST", "/api/auth/logout").catch(() => {}); me = null; imp = null; location.hash = "#/login"; route(); }

function renderShell(active, title) {
  const nav = NAV[me.role] || NAV.verifier;
  const side = h("aside", { class: "fixed inset-y-0 left-0 z-40 hidden w-72 flex-col bg-navy p-5 text-white lg:sticky lg:top-0 lg:flex lg:h-screen" },
    h("a", { href: "#/app/dashboard", class: "mb-8 flex items-center gap-3 px-2" }, brandLogo("h-10 w-10"), h("span", { class: "text-xl font-bold tracking-tight" }, "Veri", h("span", { class: "text-emerald-400" }, "Doc"))),
    h("p", { class: "mb-2 px-3 text-[11px] font-semibold uppercase tracking-widest text-slate-400" }, "Main menu"),
    h("nav", { class: "flex flex-1 flex-col gap-1" }, nav.map(([k, label, ic]) => h("a", { href: `#/app/${k}`, class: `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${k === active ? "bg-white text-navy shadow" : "text-slate-300 hover:bg-white/10 hover:text-white"}`, onclick: () => side.classList.remove("!flex") }, icon(ic, "h-[18px] w-[18px]"), label))),
    h("div", { class: "mt-4 rounded-2xl bg-white/10 p-3" },
      h("div", { class: "flex items-center gap-3" }, h("div", { class: "flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-sm font-bold" }, initials(me.name)),
        h("div", { class: "min-w-0" }, h("p", { class: "truncate text-sm font-semibold" }, me.name), h("p", { class: "truncate text-xs text-slate-300" }, cap(me.role)))),
      h("div", { class: "mt-3 grid grid-cols-2 gap-2" },
        h("a", { href: "#/app/account", class: `flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition ${active === "account" ? "bg-white text-navy" : "bg-white/10 text-white hover:bg-white/20"}`, onclick: () => side.classList.remove("!flex") }, icon("user", "h-4 w-4"), "My account"),
        h("button", { class: "flex items-center justify-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/20", onclick: signOut }, icon("logout", "h-4 w-4"), "Sign out"))));
  const verifyInput = h("input", { class: "w-full bg-transparent text-sm text-white placeholder-slate-400 outline-none", placeholder: "Quick verify: paste a code e.g. VD-ABCDE-12345" });
  verifyInput.addEventListener("keydown", (e) => { if (e.key === "Enter" && verifyInput.value.trim()) location.hash = "#/verify/" + encodeURIComponent(verifyInput.value.trim()); });
  const top = h("header", { class: "mb-6 flex flex-wrap items-center gap-3" },
    h("button", { class: "rounded-xl bg-white p-2.5 text-navy shadow-card lg:hidden", "aria-label": "Menu", onclick: () => side.classList.toggle("!flex") }, icon("menu")),
    h("div", { class: "min-w-0 flex-1" }, h("h1", { class: "truncate text-2xl font-bold tracking-tight text-navy" }, title), h("p", { class: "truncate text-sm text-slate-500" }, SUBTITLE[active] || "")),
    h("div", { class: "hidden items-center gap-2 rounded-2xl bg-navy px-4 py-2.5 sm:flex sm:w-72 xl:w-96" }, icon("search", "h-4 w-4 text-slate-300"), verifyInput),
    rolePill(me.role));
  const main = h("div", { class: "space-y-6" }, loading());
  $root.replaceChildren(h("div", { class: "min-h-screen" }, banner(), h("div", { class: "flex" }, side, h("div", { class: "min-w-0 flex-1 p-4 sm:p-6 lg:p-8" }, top, main))));
  window.scrollTo(0, 0);
  return main;
}

// ───────────────────────────── verification ─────────────────────────────
const STATUS_TEXT = {
  VALID: "This document is authentic and currently valid.", REVOKED: "This document has been REVOKED by the issuing institution.",
  EXPIRED: "This document was authentic but has expired.", SUPERSEDED: "This document was replaced by a corrected version.",
  INSTITUTION_SUSPENDED: "The issuing institution is currently suspended. Treat with caution.", NOT_FOUND: "No such document is registered. It may be forged or the code is wrong.",
  TAMPERED: "The content does NOT match its blockchain fingerprint. Do not trust this document.",
};
const STATUS_HEAD = { VALID: "Verified", REVOKED: "Revoked", EXPIRED: "Expired", SUPERSEDED: "Superseded", INSTITUTION_SUSPENDED: "Institution suspended", NOT_FOUND: "Not found", TAMPERED: "Tampered" };
function resultCard(r) {
  const tone = TONES[STATUS_TONE[r.status] || "slate"], c = r.content, kv = [];
  const add = (k, v, mono) => v && kv.push(h("div", { class: "grid grid-cols-3 gap-3 py-2.5 text-sm" }, h("dt", { class: "text-slate-400" }, k), h("dd", { class: `col-span-2 break-all text-slate-800 ${mono ? "font-mono text-xs" : ""}` }, v)));
  add("Document", r.title); add("Type", r.docType && cap(r.docType)); add("Institution", r.institution); add("Description", r.description);
  add("File", r.fileName && (r.fileSize ? `${r.fileName} (${fmtSize(r.fileSize)})` : r.fileName)); add("Code", r.code && r.code.startsWith("VF-") ? r.code : null, true);
  add("Holder", r.holder && `${r.holder.name} (No. ${r.holder.studentNumber})`);
  add("Issued", r.issuedAt && fmt(r.issuedAt)); add("Expires", r.expiresAt && fmt(r.expiresAt)); add("Revocation reason", r.revokeReason);
  if (r.supersededBy) kv.push(h("div", { class: "grid grid-cols-3 gap-3 py-2.5 text-sm" }, h("dt", { class: "text-slate-400" }, "Replaced by"), h("dd", { class: "col-span-2" }, h("a", { class: "font-semibold text-brand-600 hover:underline", href: "#/verify/" + r.supersededBy }, r.supersededBy))));
  add("Fingerprint", r.hash, true);
  if (r.chain?.tx) kv.push(h("div", { class: "grid grid-cols-3 gap-3 py-2.5 text-sm" }, h("dt", { class: "text-slate-400" }, "Blockchain tx"), h("dd", { class: "col-span-2 break-all font-mono text-xs" }, r.chain.explorer ? h("a", { class: "text-brand-600 hover:underline", href: r.chain.explorer, target: "_blank", rel: "noopener" }, r.chain.tx) : r.chain.tx)));
  let body = null;
  if (c?.courses) body = h("div", { class: "mt-5" }, h("h3", { class: "mb-2 text-sm font-bold text-navy" }, `${c.term || ""} ${c.academicYear || ""} ${c.className ? "· " + c.className : ""}`),
    tbl(["Course", "Score", "Grade"], c.courses.map((x) => tr(x.name, String(x.score), h("b", {}, x.grade)))), h("p", { class: "mt-3 text-sm font-semibold text-slate-700" }, `Average ${c.average} · GPA ${c.gpa}`), c.remarks && h("p", { class: "text-sm text-slate-500" }, "Remarks: " + c.remarks));
  else if (c) body = h("p", { class: "mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-700" }, [c.program, c.completionDate && `completed ${c.completionDate}`, c.grade, c.description].filter(Boolean).join(" · "));
  return h("div", { class: "card overflow-hidden" },
    h("div", { class: `flex items-center gap-4 px-6 py-5 text-white ${tone.band}` }, h("div", { class: "flex h-12 w-12 items-center justify-center rounded-full bg-white/20" }, icon(r.status === "VALID" ? "check" : "alert", "h-7 w-7")),
      h("div", {}, h("p", { class: "text-xl font-bold" }, STATUS_HEAD[r.status] || cap(r.status)), h("p", { class: "text-sm text-white/90" }, r.message || STATUS_TEXT[r.status] || ""))),
    h("div", { class: "p-6" }, h("dl", { class: "divide-y divide-slate-100" }, kv), body,
      h("div", { class: "mt-5 flex flex-wrap gap-2" }, r.code && !r.code.startsWith("VF-") && r.status !== "NOT_FOUND" ? h("a", { class: "btn-brand-soft", href: "/d/" + r.code, target: "_blank" }, icon("print", "h-4 w-4"), "Open printable copy") : null,
        r.downloadUrl ? h("a", { class: "btn-brand-soft", href: r.downloadUrl }, icon("download", "h-4 w-4"), "Download original file") : null)));
}
function verifyBox(initialCode) {
  const out = h("div", { class: "mt-6" });
  const done = (r) => out.replaceChildren(resultCard(r));
  const guard = (fn) => async (e) => { e.preventDefault(); out.replaceChildren(alertBox("info", "Checking the blockchain…")); try { await fn(); } catch (er) { out.replaceChildren(alertBox("err", er.message)); } };
  const vdz = dropZone();
  const code = inp({ placeholder: "e.g. VD-ABCDE-12345", value: initialCode || "", autocomplete: "off" }), hash = inp({ placeholder: "0x…64 hex characters" }), file = h("input", { type: "file", accept: ".json,application/json", class: "block w-full cursor-pointer rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600 file:mr-4 file:rounded-lg file:border-0 file:bg-brand-600 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white" });
  const panes = {
    code: h("form", { class: "space-y-4", onsubmit: guard(async () => done(await api("GET", "/api/verify/code/" + encodeURIComponent(code.value.trim())))) }, field("Verification code printed on the document", code), h("button", { class: "btn" }, icon("shield", "h-4 w-4"), "Verify document")),
    upload: h("form", { class: "space-y-4", onsubmit: guard(async () => { if (!vdz.file) throw new Error("Choose a file to verify"); const fd = new FormData(); fd.append("file", vdz.file); done(await apiUpload("/api/verify/file", fd)); }) },
      vdz.el, h("p", { class: "text-xs text-slate-400" }, "The file is fingerprinted (keccak256) and checked against the blockchain. Even one changed byte fails."), h("button", { class: "btn" }, icon("upload", "h-4 w-4"), "Verify file")),
    hash: h("form", { class: "space-y-4", onsubmit: guard(async () => { const r = await api("POST", "/api/verify/hash", { hash: hash.value.trim() }); done({ ...r, institution: r.institutionName, hash: r.hash }); }) }, field("Document fingerprint", hash, "Direct blockchain lookup - does not use our database at all."), h("button", { class: "btn" }, icon("hash", "h-4 w-4"), "Check on-chain")),
    file: h("form", { class: "space-y-4", onsubmit: guard(async () => { const f = file.files[0]; if (!f) throw new Error("Choose a .veridoc.json file"); const pkg = JSON.parse(await f.text()); const r = await api("POST", "/api/verify/package", { package: pkg }); done({ ...r, institution: r.institutionName, content: pkg.payload.content }); }) }, field("Downloaded proof file (.veridoc.json)", file, "The fingerprint is recomputed from the file; any edit makes it fail."), h("button", { class: "btn" }, icon("upload", "h-4 w-4"), "Verify file")),
  };
  const tabs = h("div", { class: "mb-6 inline-flex rounded-xl bg-slate-100 p-1" }), holder = h("div");
  const pick = (k) => { [...tabs.children].forEach((b) => (b.className = `rounded-lg px-4 py-2 text-sm font-semibold transition ${b.dataset.k === k ? "bg-white text-navy shadow" : "text-slate-500 hover:text-slate-700"}`)); holder.replaceChildren(panes[k]); };
  [["code", "By code"], ["upload", "Upload a file"], ["hash", "By fingerprint"], ["file", "Proof file"]].forEach(([k, l]) => tabs.append(h("button", { "data-k": k, type: "button", onclick: () => pick(k) }, l)));
  pick("code");
  if (initialCode) setTimeout(() => panes.code.requestSubmit(), 0);
  return h("div", {}, h("div", { class: "card p-6" }, tabs, holder), out);
}

// ───────────────────────────── public pages ─────────────────────────────
function publicHeader() {
  return h("header", { class: "bg-navy text-white" }, h("div", { class: "mx-auto flex max-w-6xl items-center justify-between px-4 py-4" },
    h("a", { href: "#/", class: "flex items-center gap-3" }, brandLogo("h-9 w-9"), h("span", { class: "text-xl font-bold tracking-tight" }, "Veri", h("span", { class: "text-emerald-400" }, "Doc"))),
    h("nav", { class: "flex items-center gap-2 text-sm font-medium" },
      me ? h("a", { href: "#/app/dashboard", class: "rounded-lg bg-white px-4 py-2 font-semibold text-navy" }, "Open dashboard")
        : [h("a", { href: "#/register", class: "hidden rounded-lg px-4 py-2 text-slate-200 hover:bg-white/10 sm:block" }, "Register as verifier"), h("a", { href: "#/login", class: "rounded-lg bg-white px-4 py-2 font-semibold text-navy hover:bg-slate-100" }, "Sign in")])));
}
function pageVerifyPublic(code) {
  const feat = (ic, t, d) => h("div", { class: "flex items-start gap-3" }, h("div", { class: "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-emerald-300" }, icon(ic)), h("div", {}, h("p", { class: "font-semibold" }, t), h("p", { class: "text-sm text-slate-300" }, d)));
  $root.replaceChildren(publicHeader(),
    h("section", { class: "bg-gradient-to-b from-navy to-navy-800 pb-24 pt-12 text-white" }, h("div", { class: "mx-auto max-w-3xl px-4 text-center" },
      h("span", { class: "inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-emerald-300" }, icon("shield", "h-3.5 w-3.5"), "Anchored on Ethereum"),
      h("h1", { class: "mt-5 text-4xl font-extrabold tracking-tight sm:text-5xl" }, "Is this certificate or report card genuine?"),
      h("p", { class: "mx-auto mt-4 max-w-xl text-slate-300" }, "Embassies, schools, employers and e-learning platforms can check any document issued through VeriDoc in seconds - no account needed."))),
    h("main", { class: "mx-auto -mt-14 max-w-3xl px-4 pb-16" }, verifyBox(code),
      h("div", { class: "mt-10 grid gap-6 rounded-2xl bg-navy p-6 text-white sm:grid-cols-3" }, feat("shield", "Tamper-proof", "Any edit breaks the fingerprint."), feat("hash", "Private", "Only a salted hash is on-chain."), feat("clock", "Instant", "Seconds, not days.")),
      h("p", { class: "mt-8 text-center text-xs text-slate-400" }, "Documents are fingerprinted with keccak256 and anchored on Ethereum. No personal data is stored on-chain.")));
  window.scrollTo(0, 0);
}
function authLayout(title, subtitle, ...body) {
  $root.replaceChildren(h("div", { class: "grid min-h-screen lg:grid-cols-2" },
    h("div", { class: "relative hidden flex-col justify-between overflow-hidden bg-navy p-12 text-white lg:flex" },
      h("a", { href: "#/", class: "flex items-center gap-3" }, brandLogo("h-11 w-11"), h("span", { class: "text-2xl font-bold" }, "Veri", h("span", { class: "text-emerald-400" }, "Doc"))),
      h("div", {}, h("h2", { class: "text-4xl font-extrabold leading-tight" }, "Trust every credential.", h("br"), h("span", { class: "text-emerald-400" }, "Verify in seconds.")), h("p", { class: "mt-4 max-w-md text-slate-300" }, "Issue certificates and report cards that anyone can verify on the Ethereum blockchain - no phone calls, no paperwork, no forgery.")),
      h("p", { class: "text-sm text-slate-400" }, "Truth, anchored on-chain."),
      h("div", { class: "pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-brand-600/30 blur-3xl" }), h("div", { class: "pointer-events-none absolute -bottom-24 -left-16 h-72 w-72 rounded-full bg-emerald-500/20 blur-3xl" })),
    h("div", { class: "flex items-center justify-center p-6 sm:p-12" }, h("div", { class: "w-full max-w-md" },
      h("a", { href: "#/", class: "mb-8 flex items-center gap-2 lg:hidden" }, brandLogo("h-9 w-9"), h("span", { class: "text-xl font-bold text-navy" }, "VeriDoc")),
      h("h1", { class: "text-3xl font-extrabold tracking-tight text-navy" }, title), h("p", { class: "mb-8 mt-2 text-slate-500" }, subtitle), body))));
  window.scrollTo(0, 0);
}
function pageLogin() {
  const email = inp({ type: "email", required: true, autocomplete: "username", placeholder: "you@school.edu" }), pw = inp({ type: "password", required: true, autocomplete: "current-password", placeholder: "••••••••••" });
  const f = h("form", { class: "space-y-5", onsubmit: async (e) => {
    e.preventDefault(); btn.disabled = true;
    try { const r = await api("POST", "/api/auth/login", { email: email.value, password: pw.value }); me = r.user; imp = null; location.hash = "#/app/dashboard"; route(); }
    catch (er) { flash(f, "err", er.message); btn.disabled = false; }
  } });
  const btn = h("button", { class: "btn w-full py-3" }, "Sign in");
  f.append(field("Email", email), field("Password", pw), btn);
  authLayout("Welcome back", "Sign in to manage and verify documents.", f, h("p", { class: "mt-6 text-center text-sm text-slate-500" }, "Embassy or employer? ", h("a", { class: "font-semibold text-brand-600 hover:underline", href: "#/register" }, "Register as a verifier")),
    h("p", { class: "mt-2 text-center text-sm text-slate-500" }, "Just checking a document? ", h("a", { class: "font-semibold text-brand-600 hover:underline", href: "#/" }, "Verify without an account")));
}
function pageRegister() {
  const i = { name: inp({ required: true }), organization: inp({ required: true, placeholder: "e.g. Embassy of …" }), email: inp({ type: "email", required: true }), password: inp({ type: "password", required: true, minlength: 10 }) };
  const f = h("form", { class: "space-y-4", onsubmit: async (e) => {
    e.preventDefault();
    try { const r = await api("POST", "/api/auth/register-verifier", Object.fromEntries(Object.entries(i).map(([k, v]) => [k, v.value]))); f.replaceChildren(alertBox("ok", r.message), h("a", { class: "btn mt-4", href: "#/login" }, "Back to sign in")); }
    catch (er) { flash(f, "err", er.message); }
  } }, field("Your name", i.name), field("Organization", i.organization), field("Work email", i.email), field("Password", i.password, "10+ characters, letters and numbers"), h("button", { class: "btn w-full py-3" }, "Create account"));
  authLayout("Register as a verifier", "Keep a history of your checks. An administrator approves new accounts.", f, h("p", { class: "mt-6 text-center text-sm text-slate-500" }, "Already registered? ", h("a", { class: "font-semibold text-brand-600 hover:underline", href: "#/login" }, "Sign in")));
}
function pageChangePw() {
  const cur = inp({ type: "password", required: true }), nw = inp({ type: "password", required: true, minlength: 10 });
  const f = h("form", { class: "space-y-5", onsubmit: async (e) => {
    e.preventDefault();
    try { await api("POST", "/api/auth/change-password", { currentPassword: cur.value, newPassword: nw.value }); me.mustChangePassword = false; location.hash = "#/app/dashboard"; route(); }
    catch (er) { flash(f, "err", er.message); }
  } }, field("Temporary / current password", cur), field("New password", nw, "10+ characters, letters and numbers"), h("button", { class: "btn w-full py-3" }, "Save password"));
  authLayout("Set your password", "You signed in with a temporary password. Choose a new one to continue.", f, h("button", { class: "mt-6 w-full text-center text-sm text-slate-500 hover:underline", onclick: signOut }, "Sign out"));
}

// ───────────────────────────── dashboards ─────────────────────────────
const LINES = [{ key: "issued", label: "Documents issued", color: "#1D4ED8" }, { key: "verifications", label: "Verifications", color: "#F59E0B" }];
const chartPanel = (s) => panel("Activity history", legend(LINES), pad(areaChart(s, LINES)));

async function dashAdmin() {
  const s = await api("GET", "/api/admin/stats");
  const cards = h("div", { class: "grid gap-4 sm:grid-cols-2 xl:grid-cols-4" }, statCard("Institutions", s.institutions, "building", "blue", "registered on-chain"), statCard("Users", s.users, "users", "violet", s.pendingVerifiers ? `${s.pendingVerifiers} awaiting approval` : "all approved"),
    statCard("Documents anchored", s.documents, "file", "emerald", "immutable on Ethereum"), statCard("Verifications", s.verifications, "shield", "amber", "checked by the public"));
  const chain = panel("Blockchain connection", badge(s.chain.ok ? "active" : "failed"), pad(h("dl", { class: "divide-y divide-slate-100 text-sm" },
    [["Chain ID", s.chain.chainId ?? "-"], ["Latest block", s.chain.block ?? "-"], ["Contract", s.chain.contract], ["Owner key", s.chain.owner], ["Relayer key", s.chain.relayer]].map(([k, v]) => h("div", { class: "grid grid-cols-3 gap-3 py-2.5" }, h("dt", { class: "text-slate-400" }, k), h("dd", { class: "col-span-2 break-all font-mono text-xs text-slate-700" }, String(v)))))));
  return [cards, h("div", { class: "grid gap-6 xl:grid-cols-3" }, h("div", { class: "xl:col-span-2 [&>section]:h-full" }, chartPanel(s.series)), panel("Recent activity", h("a", { href: "#/app/audit", class: "text-xs font-semibold text-brand-600 hover:underline" }, "View all"), activityList(s.recentActivity))),
    h("div", { class: "grid gap-6 xl:grid-cols-3" }, h("div", { class: "xl:col-span-2 [&>section]:h-full" }, panel("Recent documents", null, tbl(["Document", "Holder", "Code", "Status", "Issued"], s.recentDocuments.map(docRow), "No documents issued yet."))),
      h("div", { class: "space-y-6" }, panel("Document status", null, pad(statusTiles(s.byStatus, h("div", { class: `rounded-2xl p-4 ${TONES.violet.tile}` }, h("div", { class: `mb-3 flex h-9 w-9 items-center justify-center rounded-full ${TONES.violet.soft}` }, icon("activity", "h-4 w-4")), h("p", { class: "text-2xl font-bold text-navy" }, String(s.verifications)), h("p", { class: "text-xs font-medium text-slate-500" }, "Verifications"))))), chain))];
}
async function dashInstitution() {
  const [s, docs] = await Promise.all([api("GET", "/api/institution/stats"), api("GET", "/api/documents")]);
  const cards = h("div", { class: "grid gap-4 sm:grid-cols-2 xl:grid-cols-4" }, statCard("Documents issued", s.documents, "file", "blue", "anchored on-chain"), statCard("Students", s.students, "users", "emerald"),
    statCard("Verifications", s.verifications, "shield", "amber", "of your documents"), statCard(me.role === "institution_admin" ? "Issuers" : "Valid documents", me.role === "institution_admin" ? s.issuers : s.byStatus.valid, me.role === "institution_admin" ? "key" : "check", "violet"));
  const rows = docs.slice(0, 6).map((d) => docRow({ title: d.title, doc_type: d.docType, student: d.studentName, code: d.code, status: d.chainStatus === "anchored" ? d.status : d.chainStatus, created_at: d.createdAt }));
  return [cards, h("div", { class: "grid gap-6 xl:grid-cols-3" }, h("div", { class: "xl:col-span-2 [&>section]:h-full" }, chartPanel(s.series)), panel("Recent activity", null, activityList(s.recentActivity))),
    h("div", { class: "grid gap-6 xl:grid-cols-3" }, h("div", { class: "xl:col-span-2 [&>section]:h-full" }, panel("Recent documents", h("a", { href: "#/app/documents", class: "text-xs font-semibold text-brand-600 hover:underline" }, "View all"), tbl(["Document", "Holder", "Code", "Status", "Issued"], rows, "No documents issued yet."))),
      panel("Document status", null, pad(statusTiles(s.byStatus, h("a", { href: "#/app/issue", class: "flex flex-col justify-between rounded-2xl bg-brand-600 p-4 text-white transition hover:bg-brand-700" }, h("div", { class: "flex h-9 w-9 items-center justify-center rounded-full bg-white/20" }, icon("plus", "h-4 w-4")), h("p", { class: "mt-3 text-sm font-semibold" }, "Issue a new certificate"))))))];
}
async function dashStudent() {
  const docs = await api("GET", "/api/documents/mine");
  const cards = h("div", { class: "grid gap-4 sm:grid-cols-3" }, statCard("My documents", docs.length, "file", "blue"), statCard("Valid", docs.filter((d) => d.status === "valid").length, "check", "emerald"), statCard("Institutions", new Set(docs.map((d) => d.institution)).size, "building", "violet"));
  const list = docs.length ? h("div", { class: "grid gap-5 lg:grid-cols-2" }, docs.map((d) => {
    const link = `${location.origin}/#/verify/${d.code}`, b = h("button", { class: "btn-soft", onclick: () => copy(link, b) }, icon("copy", "h-3.5 w-3.5"), "Copy link");
    return h("div", { class: "card p-5" }, h("div", { class: "flex items-start justify-between gap-3" }, h("div", {}, h("h3", { class: "font-bold text-navy" }, d.title), h("p", { class: "text-xs text-slate-400" }, `${d.institution} · issued ${fmtDay(d.createdAt)}`)), badge(d.status)),
      h("p", { class: "mt-4 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500" }, "Verification code ", h("b", { class: "font-mono text-navy" }, d.code)),
      h("div", { class: "mt-4 flex flex-wrap gap-2" }, h("a", { class: "btn-brand-soft", href: "/d/" + d.code, target: "_blank" }, icon("print", "h-3.5 w-3.5"), "Open / print"), b, h("a", { class: "btn-soft", href: `/api/documents/${d.id}/package` }, icon("download", "h-3.5 w-3.5"), "Proof file")));
  })) : alertBox("info", "No documents have been issued to you yet.");
  return [cards, alertBox("info", "Share the link or code with an embassy, employer or school. They can verify it instantly without seeing anything else about you."), list];
}
async function dashVerifier() {
  const hist = await api("GET", "/api/verify/history");
  const cards = h("div", { class: "grid gap-4 sm:grid-cols-3" }, statCard("Checks made", hist.length, "shield", "blue"), statCard("Valid", hist.filter((x) => x.result === "VALID").length, "check", "emerald"), statCard("Flagged", hist.filter((x) => x.result !== "VALID").length, "alert", "rose", "not valid / not found"));
  return [cards, panel("Verify a document", null, pad(verifyBox())), panel("My verification history", null, tbl(["When", "Query", "Result"], hist.map((x) => tr(fmt(x.created_at), h("span", { class: "font-mono text-xs" }, x.query), badge(x.result))), "No checks yet."))];
}

// ───────────────────────────── admin pages ─────────────────────────────
const credBox = (what, email, pw) => alertBox("ok", h("p", { class: "font-semibold" }, `${what} created.`), h("p", { class: "mt-1" }, "Share these credentials securely - the password is shown only once:"), h("p", { class: "mt-2 rounded-lg bg-white/70 px-3 py-2 font-mono text-xs" }, `${email}  /  ${pw}`));

// ── user editing (shared) ──
function editUserDialog(u, { scope = "admin", onSaved = () => route() } = {}) {
  modal(`Edit ${u.name}`, (close) => {
    const name = inp({ required: true, value: u.name }), email = inp({ type: "email", required: true, value: u.email });
    const org = u.role === "verifier" ? inp({ value: u.organization || "" }) : null;
    const canRole = scope === "admin" && ["issuer", "institution_admin"].includes(u.role);
    const role = canRole ? sel([["issuer", "Issuer"], ["institution_admin", "Institution admin"]]) : null; if (role) role.value = u.role;
    const f = h("form", { class: "space-y-4", onsubmit: async (e) => {
      e.preventDefault();
      const body = { name: name.value, email: email.value }; if (org) body.organization = org.value; if (role) body.role = role.value;
      try { await api("PATCH", scope === "admin" ? `/api/admin/users/${u.id}` : `/api/institution/staff/${u.id}`, body); close(); toast("ok", "Changes saved"); onSaved(); }
      catch (er) { flash(f, "err", er.message); }
    } }, field("Full name", name), field("Email (used to sign in)", email), org ? field("Organization", org) : null, role ? field("Role", role) : null,
      h("div", { class: "flex justify-end gap-2" }, h("button", { type: "button", class: "btn-soft px-4 py-2.5", onclick: close }, "Cancel"), h("button", { class: "btn" }, "Save changes")));
    return f;
  });
}
async function resetPassword(u) {
  if (!confirm(`Generate a new temporary password for ${u.name}? Their current password stops working.`)) return;
  try { const r = await api("POST", `/api/admin/users/${u.id}/reset-password`); secretDialog("Password reset", `A new temporary password was created for ${u.name}.`, r.email, r.temporaryPassword); }
  catch (e) { toast("err", e.message); }
}
const userCell = (u) => h("div", { class: "flex items-center gap-3" }, h("div", { class: "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-bold text-brand-700" }, initials(u.name)), h("div", {}, h("p", { class: "font-semibold text-slate-800" }, u.name), h("p", { class: "text-xs text-slate-400" }, u.email)));
function adminUserActions(u, onChange) {
  if (u.role === "super_admin") return "";
  const act = (fn) => async () => { try { await fn(); } catch (e) { toast("err", e.message); } };
  return h("div", { class: "flex flex-wrap justify-end gap-1.5" },
    h("button", { class: "btn-soft", onclick: () => editUserDialog(u, { onSaved: onChange }) }, "Edit"),
    u.status === "active" ? h("button", { class: "btn-brand-soft", title: "Open the app as this user - no password needed", onclick: () => impersonate(u) }, icon("login", "h-3.5 w-3.5"), "Sign in as") : null,
    h("button", { class: "btn-soft", title: "Generate a new temporary password", onclick: () => resetPassword(u) }, icon("key", "h-3.5 w-3.5"), "Reset"),
    h("button", { class: u.status === "active" ? "btn-danger" : "btn-ok", onclick: act(async () => { await api("PATCH", `/api/admin/users/${u.id}/status`, { status: u.status === "active" ? "disabled" : "active" }); toast("ok", "User updated"); onChange(); }) }, u.status === "active" ? "Disable" : u.status === "pending" ? "Approve" : "Enable"));
}

// ── institutions list ──
async function pageInstitutions(id) {
  if (id) return pageInstitutionDetail(id);
  const list = await api("GET", "/api/admin/institutions");
  const add = h("button", { class: "btn", onclick: newInstitutionDialog }, icon("plus", "h-4 w-4"), "New institution");
  const t = tbl(["Institution", "Type", "Users", "Documents", "Files", "Status", ""], list.map((i) => tr(
    h("a", { href: `#/app/institutions/${i.id}`, class: "group flex items-center gap-3" }, h("div", { class: "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600" }, icon("building", "h-5 w-5")),
      h("div", {}, h("p", { class: "font-semibold text-slate-800 group-hover:text-brand-600" }, i.name), h("p", { class: "font-mono text-xs text-slate-400" }, i.code + (i.country ? " · " + i.country : "")))),
    cap(i.type), String(i.users), String(i.documents), String(i.files), badge(i.active ? "active" : "disabled"),
    h("div", { class: "flex justify-end gap-1.5" }, h("a", { class: "btn-brand-soft", href: `#/app/institutions/${i.id}` }, "Open"),
      h("button", { class: i.active ? "btn-danger" : "btn-ok", onclick: async () => { try { await api("PATCH", `/api/admin/institutions/${i.id}/active`, { active: !i.active }); toast("ok", i.active ? "Institution suspended" : "Institution re-activated"); route(); } catch (e) { toast("err", e.message); } } }, i.active ? "Suspend" : "Re-activate")))));
  return [alertBox("info", "Open an institution to see - and manage - its users, issued documents and uploaded files in one place."), panel(`All institutions (${list.length})`, add, t)];
}
function newInstitutionDialog() {
  modal("Register institution", (close) => {
    const f = { code: inp({ placeholder: "ALU-RW", required: true }), name: inp({ required: true }), country: inp(), type: sel(["school", "university", "elearning", "other"]), adminName: inp({ required: true }), adminEmail: inp({ type: "email", required: true }) };
    const form = h("form", { class: "space-y-4", onsubmit: async (e) => {
      e.preventDefault();
      try { const r = await api("POST", "/api/admin/institutions", Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.value]))); close(); secretDialog("Institution registered", "Registered on the blockchain (tx " + short(r.chainTx) + ") and its first admin account was created.", r.admin.email, r.admin.temporaryPassword); route(); }
      catch (er) { flash(form, "err", er.message); }
    } }, grid2(field("Code", f.code, "A-Z, 0-9, dash"), field("Type", f.type)), field("Institution name", f.name), field("Country", f.country), grid2(field("Admin name", f.adminName), field("Admin email", f.adminEmail)),
      h("div", { class: "flex justify-end gap-2" }, h("button", { type: "button", class: "btn-soft px-4 py-2.5", onclick: close }, "Cancel"), h("button", { class: "btn" }, "Create institution & admin")));
    return form;
  });
}
const grid2 = (...k) => h("div", { class: "grid gap-4 sm:grid-cols-2" }, k);

// ── one institution ──
let detailTab = "documents";
async function pageInstitutionDetail(id) {
  const inst = await api("GET", `/api/admin/institutions/${id}`);
  const head = h("div", { class: "card p-5" }, h("a", { href: "#/app/institutions", class: "mb-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:underline" }, "← All institutions"),
    h("div", { class: "flex flex-wrap items-center justify-between gap-4" },
      h("div", { class: "flex items-center gap-4" }, h("div", { class: "flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600" }, icon("building", "h-7 w-7")),
        h("div", {}, h("h2", { class: "text-xl font-bold text-navy" }, inst.name), h("p", { class: "text-sm text-slate-500" }, [inst.code, cap(inst.type), inst.country].filter(Boolean).join(" · ")))),
      h("div", { class: "flex items-center gap-2" }, badge(inst.active ? "active" : "disabled"),
        h("button", { class: inst.active ? "btn-danger" : "btn-ok", onclick: async () => { try { await api("PATCH", `/api/admin/institutions/${inst.id}/active`, { active: !inst.active }); toast("ok", inst.active ? "Institution suspended" : "Institution re-activated"); route(); } catch (e) { toast("err", e.message); } } }, inst.active ? "Suspend" : "Re-activate"))));
  const c = inst.counts;
  const cards = h("div", { class: "grid gap-4 sm:grid-cols-2 xl:grid-cols-4" }, statCard("Users", c.users, "users", "violet"), statCard("Students", c.students, "user", "emerald"), statCard("Documents issued", c.documents, "file", "blue"), statCard("Uploaded files", c.files, "upload", "amber"));
  const body = h("div", { class: "space-y-6" }), bar = h("div", { class: "inline-flex flex-wrap rounded-xl bg-white p-1 shadow-card" });
  const TABS = { documents: ["Documents", () => instDocs(inst)], files: ["Uploaded files", () => instFiles(inst)], users: ["Users", () => instUsers(inst)], settings: ["Settings", () => instSettings(inst)] };
  const pick = async (k) => {
    detailTab = k;
    [...bar.children].forEach((b) => (b.className = `rounded-lg px-4 py-2 text-sm font-semibold transition ${b.dataset.k === k ? "bg-navy text-white shadow" : "text-slate-500 hover:text-slate-800"}`));
    body.replaceChildren(loading());
    try { body.replaceChildren(...[await TABS[k][1]()].flat()); } catch (e) { body.replaceChildren(alertBox("err", e.message)); }
  };
  Object.entries(TABS).forEach(([k, [label]]) => bar.append(h("button", { "data-k": k, onclick: () => pick(k) }, label)));
  pick(TABS[detailTab] ? detailTab : "documents");
  return [head, cards, bar, body];
}
async function instDocs(inst) {
  const { documents } = await api("GET", `/api/admin/institutions/${inst.id}/documents`);
  return panel(`Documents issued by ${inst.name}`, h("span", { class: "text-xs text-slate-400" }, `${documents.length} total`), tbl(["Holder", "Document", "Code", "Status", "Issued", ""], documents.map((d) => tr(
    h("div", {}, h("p", { class: "font-semibold text-slate-800" }, d.student), h("p", { class: "text-xs text-slate-400" }, d.student_number)), h("div", {}, h("p", {}, d.title), h("p", { class: "text-xs text-slate-400" }, cap(d.doc_type))),
    h("span", { class: "font-mono text-xs" }, d.code), badge(d.chain_status === "anchored" ? d.status : d.chain_status), h("span", { class: "text-xs text-slate-400" }, fmtDay(d.created_at)),
    d.chain_status === "anchored" ? h("div", { class: "flex justify-end gap-1.5" }, h("a", { class: "btn-brand-soft", href: `#/verify/${d.code}` }, "Verify"), h("a", { class: "btn-soft", href: "/d/" + d.code, target: "_blank" }, "Open")) : "")), "This institution has not issued any documents yet."));
}
async function instFiles(inst) {
  const { files } = await api("GET", `/api/admin/institutions/${inst.id}/documents`);
  return panel(`Files registered by ${inst.name}`, h("span", { class: "text-xs text-slate-400" }, `${files.length} total`), tbl(["File", "Code", "Status", "Uploaded by", "Registered", ""], files.map((f) => tr(
    h("div", {}, h("p", { class: "font-semibold text-slate-800" }, f.title), h("p", { class: "text-xs text-slate-400" }, `${f.original_name} · ${fmtSize(f.size)}`)), h("span", { class: "font-mono text-xs" }, f.code), badge(f.chain_status === "anchored" ? f.status : f.chain_status), f.uploader || "-", h("span", { class: "text-xs text-slate-400" }, fmtDay(f.created_at)),
    f.chain_status === "anchored" ? h("div", { class: "flex justify-end gap-1.5" }, h("a", { class: "btn-brand-soft", href: `#/verify/${f.code}` }, "Verify"), h("a", { class: "btn-soft", href: "/f/" + f.code }, "Download")) : "")), "No files have been uploaded to the blockchain yet."));
}
async function instUsers(inst) {
  const users = await api("GET", `/api/admin/institutions/${inst.id}/users`);
  const f = { name: inp({ required: true }), email: inp({ type: "email", required: true }), role: sel([["issuer", "Issuer"], ["institution_admin", "Institution admin"]]) };
  const form = h("form", { class: "p-5", onsubmit: async (e) => {
    e.preventDefault();
    try { const r = await api("POST", `/api/admin/institutions/${inst.id}/users`, { name: f.name.value, email: f.email.value, role: f.role.value }); secretDialog("User created", "The account was created.", r.email, r.temporaryPassword); route(); }
    catch (er) { flash(form, "err", er.message); }
  } }, h("div", { class: "grid items-end gap-4 sm:grid-cols-4" }, field("Name", f.name), field("Email", f.email), field("Role", f.role), h("button", { class: "btn" }, icon("plus", "h-4 w-4"), "Add user")));
  return [panel("Add a user to this institution", null, form), panel(`Users (${users.length})`, null, tbl(["User", "Role", "Status", ""], users.map((u) => tr(userCell(u), rolePill(u.role), badge(u.status), adminUserActions(u, route))), "No users yet."))];
}
function instSettings(inst) {
  const f = { name: inp({ required: true, value: inst.name }), country: inp({ value: inst.country || "" }), type: sel(["school", "university", "elearning", "other"]) }; f.type.value = inst.type;
  const form = h("form", { class: "max-w-2xl space-y-4 p-5", onsubmit: async (e) => {
    e.preventDefault();
    try { await api("PATCH", `/api/admin/institutions/${inst.id}`, { name: f.name.value, country: f.country.value, type: f.type.value }); toast("ok", "Institution updated"); route(); }
    catch (er) { flash(form, "err", er.message); }
  } }, field("Institution name", f.name, "Shown across the app. The name registered on the blockchain is permanent and is what verifiers see in on-chain results."), grid2(field("Country", f.country), field("Type", f.type)),
    h("dl", { class: "grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-4 text-sm" }, h("dt", { class: "text-slate-400" }, "Code (permanent)"), h("dd", { class: "col-span-2 font-mono text-xs" }, inst.code), h("dt", { class: "text-slate-400" }, "Registration tx"), h("dd", { class: "col-span-2 break-all font-mono text-xs" }, inst.chain_tx || "-")),
    h("button", { class: "btn" }, "Save changes"));
  return panel("Institution settings", null, form);
}
async function pageUsers() {
  const list = await api("GET", "/api/admin/users");
  const q = inp({ placeholder: "Search name, email or organization…", class: "inp max-w-xs" }), box = h("div");
  const draw = () => {
    const s = q.value.toLowerCase();
    box.replaceChildren(tbl(["User", "Role", "Organization", "Status", ""], list.filter((u) => !s || (u.name + u.email + (u.organization || u.institution || "")).toLowerCase().includes(s)).map((u) => tr(
      userCell(u), rolePill(u.role), u.organization || u.institution || "-", badge(u.status), adminUserActions(u, route)))));
  };
  q.addEventListener("input", draw); draw();
  return [alertBox("info", "Institution users are also listed inside each institution (Institutions → Open → Users). ", h("b", {}, "Sign in as "), "opens the app as that user without their password: 1-hour sessions, a visible banner, and audit-logged."), panel("All users", q, box)];
}

async function pageAudit() {
  const rows = await api("GET", "/api/admin/audit");
  return panel("Audit log", h("span", { class: "text-xs text-slate-400" }, "Latest 200 events"), tbl(["When", "User", "Action", "Detail"], rows.map((a) => tr(h("span", { class: "whitespace-nowrap text-xs text-slate-500" }, fmt(a.created_at)), a.email || "-", h("span", { class: `rounded-md px-2 py-0.5 text-xs font-semibold ${a.action.startsWith("impersonation") ? TONES.amber.pill : "bg-slate-100 text-slate-700"}` }, a.action), h("span", { class: "text-xs text-slate-500" }, a.detail || "")))));
}

// ───────────────────────────── institution pages ─────────────────────────────
async function pageDocuments() {
  const list = await api("GET", "/api/documents");
  let filter = "all";
  const q = inp({ placeholder: "Search student, title or code…", class: "inp max-w-xs" }), box = h("div"), chips = h("div", { class: "flex gap-1.5" });
  const draw = () => {
    const s = q.value.toLowerCase();
    [...chips.children].forEach((c) => (c.className = `rounded-lg px-3 py-1.5 text-xs font-semibold transition ${c.dataset.k === filter ? "bg-navy text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`));
    const rows = list.filter((d) => (filter === "all" || d.status === filter || d.chainStatus === filter) && (!s || (d.studentName + d.title + d.code).toLowerCase().includes(s)));
    box.replaceChildren(tbl(["Student", "Document", "Code", "Status", "Actions"], rows.map((d) => tr(
      h("div", {}, h("p", { class: "font-semibold text-slate-800" }, d.studentName), h("p", { class: "text-xs text-slate-400" }, d.studentNumber)), h("div", {}, h("p", {}, d.title), h("p", { class: "text-xs text-slate-400" }, cap(d.docType))), h("span", { class: "font-mono text-xs" }, d.code),
      badge(d.chainStatus === "anchored" ? d.status : d.chainStatus),
      d.chainStatus === "anchored" ? h("div", { class: "flex flex-wrap gap-1.5" }, h("a", { class: "btn-brand-soft", href: "/d/" + d.code, target: "_blank" }, "Open"), h("a", { class: "btn-soft", href: `/api/documents/${d.id}/package` }, "Proof"),
        d.status === "valid" ? [h("button", { class: "btn-soft", onclick: () => supersedeDialog(d) }, "Correct"), h("button", { class: "btn-danger", onclick: () => revokeDialog(d) }, "Revoke")] : "") : ""))));
  };
  [["all", "All"], ["valid", "Valid"], ["revoked", "Revoked"], ["superseded", "Superseded"]].forEach(([k, l]) => chips.append(h("button", { "data-k": k, onclick: () => { filter = k; draw(); } }, l)));
  q.addEventListener("input", draw); draw();
  return panel("Documents", filterBar(q, chips), box);
}
function revokeDialog(d, base = "documents") {
  modal(`Revoke ${d.code}`, (close) => {
    const reason = h("textarea", { class: "inp min-h-24", required: true, placeholder: "Public reason shown to anyone who verifies this document" });
    const f = h("form", { class: "space-y-4", onsubmit: async (e) => { e.preventDefault(); try { await api("POST", `/api/${base}/${d.id}/revoke`, { reason: reason.value }); close(); toast("ok", "Revoked on-chain"); route(); } catch (er) { flash(f, "err", er.message); } } },
      alertBox("warn", "Revocation is permanent and public. The reason will be visible to every verifier."), field("Reason", reason), h("div", { class: "flex justify-end gap-2" }, h("button", { type: "button", class: "btn-soft px-4 py-2.5", onclick: close }, "Cancel"), h("button", { class: "btn bg-rose-600 hover:bg-rose-700" }, "Revoke document")));
    return f;
  });
}
function supersedeDialog(d) {
  const isRC = d.docType === "report_card";
  modal(`Issue corrected version of ${d.code}`, (close) => {
    const courses = h("textarea", { class: "inp min-h-28 font-mono", placeholder: "Mathematics,80\nEnglish,75" }), program = inp({ placeholder: "Programme" }), date = inp({ type: "date" }), grade = inp({ placeholder: "Grade / classification" });
    const f = h("form", { class: "space-y-4", onsubmit: async (e) => {
      e.preventDefault();
      const content = isRC ? { courses: courses.value.split("\n").filter(Boolean).map((l) => { const [name, score] = l.split(","); return { name: name.trim(), score: +score }; }) } : { program: program.value, completionDate: date.value, grade: grade.value };
      try { const r = await api("POST", `/api/documents/${d.id}/supersede`, { content }); close(); toast("ok", "Corrected version issued: " + r.code); route(); } catch (er) { flash(f, "err", er.message); }
    } }, alertBox("info", "The old document will be flagged as superseded and point to the new one."), isRC ? field("Corrected courses (one per line: Course,score)", courses) : [field("Programme", program), field("Completion date", date), field("Grade", grade)],
      h("div", { class: "flex justify-end gap-2" }, h("button", { type: "button", class: "btn-soft px-4 py-2.5", onclick: close }, "Cancel"), h("button", { class: "btn" }, "Issue corrected version")));
    return f;
  });
}
async function pageIssue() {
  const students = await api("GET", "/api/institution/students");
  if (!students.length) return alertBox("info", "Add students first (Students page).");
  const f = { studentId: sel(students.map((s) => [s.id, `${s.full_name} (${s.student_number})`])), docType: sel(["certificate", "diploma", "transcript"]), title: inp({ required: true, placeholder: "Certificate of Completion - Cloud Fundamentals" }), program: inp({ required: true }), completionDate: inp({ type: "date" }), grade: inp(), description: h("textarea", { class: "inp min-h-20" }), expiresAt: inp({ type: "date" }) };
  const form = h("form", { class: "p-5", onsubmit: async (e) => {
    e.preventDefault(); btn.disabled = true;
    try { const r = await api("POST", "/api/documents", { studentId: +f.studentId.value, docType: f.docType.value, title: f.title.value, expiresAt: f.expiresAt.value || null, content: { program: f.program.value, completionDate: f.completionDate.value, grade: f.grade.value, description: f.description.value } });
      flash(form, "ok", `Issued and anchored on-chain. Verification code: ${r.code} (tx ${short(r.chainTx)})`); }
    catch (er) { flash(form, "err", er.message); }
    btn.disabled = false;
  } });
  const btn = h("button", { class: "btn" }, icon("award", "h-4 w-4"), "Issue & anchor on blockchain");
  form.append(h("div", { class: "space-y-4" }, grid(field("Student", f.studentId), field("Type", f.docType)), field("Title", f.title), grid(field("Programme / course", f.program), field("Completion date", f.completionDate), field("Grade / classification", f.grade)), field("Description (optional)", f.description), h("div", { class: "max-w-xs" }, field("Expires on (optional)", f.expiresAt)), btn));
  return panel("Issue a certificate", null, form);
}
async function pageBatch() {
  const students = await api("GET", "/api/institution/students");
  if (!students.length) return alertBox("info", "Add students first (Students page).");
  const term = inp({ value: "Term 1" }), year = inp({ value: String(new Date().getFullYear()) }), cls = inp({ placeholder: "e.g. Year 2 / Grade 8A" }), courses = inp({ placeholder: "Mathematics, English, Science", value: "Mathematics, English, Science" });
  const gridBox = h("div"), remarksFor = {};
  const build = () => {
    const names = courses.value.split(",").map((x) => x.trim()).filter(Boolean);
    gridBox.replaceChildren(tbl(["", "Student", ...names, "Remarks"], students.map((s) => {
      remarksFor[s.id] = inp({ placeholder: "optional", class: "inp min-w-40" });
      const r = h("tr", { "data-sid": s.id, class: "hover:bg-slate-50/60" }, [h("input", { type: "checkbox", checked: true, class: "h-4 w-4 rounded border-slate-300 text-brand-600" }), h("div", {}, h("p", { class: "font-semibold" }, s.full_name), h("p", { class: "text-xs text-slate-400" }, s.student_number)),
        ...names.map(() => h("input", { type: "number", min: 0, max: 100, class: "inp w-24" })), remarksFor[s.id]].map((c) => h("td", { class: "td" }, c)));
      return r;
    })));
    gridBox.dataset.names = JSON.stringify(names);
  };
  build();
  const body = h("div", { class: "space-y-5 p-5" }, alertBox("info", "One blockchain transaction anchors up to 100 report cards. Grades and GPA are computed automatically."), grid(field("Term", term), field("Academic year", year), field("Class", cls)),
    field("Courses (comma separated)", courses), h("div", {}, h("button", { type: "button", class: "btn-soft", onclick: build }, icon("layers", "h-3.5 w-3.5"), "Rebuild grid")), gridBox,
    h("button", { class: "btn", onclick: async (ev) => {
      const names = JSON.parse(gridBox.dataset.names), items = [];
      gridBox.querySelectorAll("tbody tr[data-sid]").forEach((row) => {
        if (!row.querySelector("input[type=checkbox]").checked) return;
        const scores = [...row.querySelectorAll("input[type=number]")].map((i) => i.value);
        if (scores.some((v) => v === "")) return;
        items.push({ studentId: +row.dataset.sid, remarks: row.querySelector("td:last-child input").value, courses: names.map((n, i) => ({ name: n, score: +scores[i] })) });
      });
      if (!items.length) return flash(body, "err", "Fill in scores for at least one selected student");
      ev.currentTarget.disabled = true; const b = ev.currentTarget;
      try { const r = await api("POST", "/api/documents/batch", { term: term.value, academicYear: year.value, className: cls.value, items }); flash(body, "ok", `${r.issued} report cards anchored on-chain. See Documents for the codes.`); }
      catch (er) { flash(body, "err", er.message); }
      b.disabled = false;
    } }, icon("layers", "h-4 w-4"), "Issue report cards"));
  return panel("Issue report cards for a class", null, body);
}
async function pageFiles() {
  const list = await api("GET", "/api/files");
  const title = inp({ required: true, maxlength: 200, placeholder: "e.g. Accreditation certificate 2026" }), desc = h("textarea", { class: "inp min-h-20", placeholder: "Optional notes shown to anyone who verifies this file" }), dz = dropZone();
  const btn = h("button", { class: "btn" }, icon("upload", "h-4 w-4"), "Anchor on blockchain");
  const form = h("form", { class: "space-y-4 p-5", onsubmit: async (e) => {
    e.preventDefault();
    if (!dz.file) return flash(form, "err", "Choose a file first");
    btn.disabled = true; btn.replaceChildren("Anchoring on the blockchain…");
    const fd = new FormData(); fd.append("file", dz.file); fd.append("title", title.value); fd.append("description", desc.value);
    try { const r = await apiUpload("/api/files", fd); toast("ok", `Registered on-chain. Verification code: ${r.code}`); route(); }
    catch (er) { flash(form, "err", er.message); btn.disabled = false; btn.replaceChildren(icon("upload", "h-4 w-4"), "Anchor on blockchain"); }
  } }, dz.el, grid2(field("Title", title), field("Notes (optional)", desc)), btn);
  const rows = list.map((f) => { const link = `${location.origin}/#/verify/${f.code}`, cp = h("button", { class: "btn-soft", onclick: () => copy(link, cp) }, icon("copy", "h-3.5 w-3.5"), "Copy link");
    return tr(h("div", {}, h("p", { class: "font-semibold text-slate-800" }, f.title), h("p", { class: "text-xs text-slate-400" }, `${f.fileName} · ${fmtSize(f.size)}`)), h("span", { class: "font-mono text-xs" }, f.code),
      badge(f.chainStatus === "anchored" ? f.status : f.chainStatus), h("span", { class: "text-xs text-slate-400" }, fmtDay(f.createdAt)),
      f.chainStatus === "anchored" ? h("div", { class: "flex flex-wrap justify-end gap-1.5" }, cp, h("a", { class: "btn-soft", href: `/api/files/${f.id}/download` }, icon("download", "h-3.5 w-3.5"), "Download"), f.status === "valid" ? h("button", { class: "btn-danger", onclick: () => revokeDialog({ id: f.id, code: f.code }, "files") }, "Revoke") : null) : ""); });
  return [alertBox("info", h("b", {}, "How it works: "), "upload any document (PDF, image, spreadsheet…). Its fingerprint is anchored on Ethereum under your institution's name. Any other institution, embassy or employer can then prove the file is genuine - and unmodified - by dropping the same file on the public Verify page, or by entering its code. Even one changed byte fails."),
    panel("Upload a document to the blockchain", null, form), panel(`Registered files (${list.length})`, null, tbl(["File", "Code", "Status", "Registered", ""], rows, "No files registered yet."))];
}
async function pageStudents() {
  const list = await api("GET", "/api/institution/students");
  const f = { studentNumber: inp({ required: true }), fullName: inp({ required: true }), email: inp({ type: "email" }), login: h("input", { type: "checkbox", class: "h-4 w-4 rounded border-slate-300 text-brand-600" }) };
  const one = h("form", { class: "space-y-4 p-5", onsubmit: async (e) => {
    e.preventDefault();
    try { const r = await api("POST", "/api/institution/students", { studentNumber: f.studentNumber.value, fullName: f.fullName.value, email: f.email.value, createLogin: f.login.checked }); flash(one, "ok", r.temporaryPassword ? `Student created. Login ${f.email.value} / ${r.temporaryPassword} - shown only once.` : "Student added."); }
    catch (er) { flash(one, "err", er.message); }
  } }, field("Student number", f.studentNumber), field("Full name", f.fullName), field("Email (for login)", f.email), h("label", { class: "flex items-center gap-2 text-sm text-slate-600" }, f.login, "Create a student login"), h("button", { class: "btn" }, icon("plus", "h-4 w-4"), "Add student"));
  const csv = h("textarea", { class: "inp min-h-28 font-mono text-xs", placeholder: "studentNumber,fullName,email\nS101,Jane Doe,jane@school.edu" }), cl = h("input", { type: "checkbox", class: "h-4 w-4 rounded border-slate-300 text-brand-600" });
  const impBox = h("div", { class: "space-y-4 p-5" }, csv, h("label", { class: "flex items-center gap-2 text-sm text-slate-600" }, cl, "Create logins for rows with an email"), h("button", { class: "btn", onclick: async () => {
    try { const r = await api("POST", "/api/institution/students/import", { csv: csv.value, createLogins: cl.checked }); impBox.querySelector(".res")?.remove();
      impBox.append(h("div", { class: "res space-y-2" }, alertBox(r.errors.length ? "warn" : "ok", `${r.created.length} imported, ${r.errors.length} errors`), r.errors.map((x) => alertBox("err", `Line ${x.line}: ${x.error}`)), r.created.filter((c) => c.temporaryPassword).map((c) => h("p", { class: "text-xs text-slate-500" }, `${c.fullName}: `, h("code", { class: "rounded bg-slate-100 px-1.5 py-0.5" }, c.temporaryPassword)))));
    } catch (er) { flash(impBox, "err", er.message); }
  } }, icon("upload", "h-4 w-4"), "Import CSV"));
  return [h("div", { class: "grid gap-6 xl:grid-cols-2" }, panel("Add student", null, one), panel("Bulk import (CSV)", null, impBox)),
    panel(`All students (${list.length})`, null, tbl(["No.", "Name", "Email", "Login"], list.map((s) => tr(h("span", { class: "font-mono text-xs" }, s.student_number), h("b", {}, s.full_name), s.email || "-", badge(s.has_login ? "active" : "pending")))))];
}
async function pagePeople() {
  const people = await api("GET", "/api/institution/people");
  const email = inp({ type: "email", required: true }), name = inp({ required: true });
  const form = h("form", { class: "p-5", onsubmit: async (e) => {
    e.preventDefault();
    try { const r = await api("POST", "/api/institution/staff", { email: email.value, name: name.value }); flash(form, "ok", `Issuer created. Login ${r.email} / ${r.temporaryPassword} - shown only once.`); }
    catch (er) { flash(form, "err", er.message); }
  } }, h("div", { class: "grid gap-4 sm:grid-cols-2" }, field("Name", name), field("Email", email)), h("button", { class: "btn mt-4" }, icon("plus", "h-4 w-4"), "Create issuer"));
  const t = tbl(["Person", "Role", "Status", ""], people.map((u) => tr(
    h("div", { class: "flex items-center gap-3" }, h("div", { class: "flex h-9 w-9 items-center justify-center rounded-full bg-brand-50 text-xs font-bold text-brand-700" }, initials(u.name)), h("div", {}, h("p", { class: "font-semibold text-slate-800" }, u.name), h("p", { class: "text-xs text-slate-400" }, u.email))),
    rolePill(u.role), badge(u.status),
    u.id === me.id || u.role === "institution_admin" ? "" : h("div", { class: "flex justify-end gap-2" },
      u.status === "active" ? h("button", { class: "btn-brand-soft", title: "Open the app as this person - no password needed", onclick: () => impersonate(u) }, icon("login", "h-3.5 w-3.5"), "Sign in as") : null,
      u.role === "issuer" ? h("button", { class: u.status === "active" ? "btn-danger" : "btn-ok", onclick: async () => { try { await api("PATCH", `/api/institution/staff/${u.id}/status`, { status: u.status === "active" ? "disabled" : "active" }); toast("ok", "Updated"); route(); } catch (e) { toast("err", e.message); } } }, u.status === "active" ? "Disable" : "Enable") : null))));
  return [alertBox("info", h("b", {}, "Sign in as "), "lets you see the app exactly as one of your issuers or students does, without their password. Sessions last 1 hour and are logged."), panel("Add issuer (registrar / teacher)", null, form), panel("People in your institution", null, t)];
}
// ───────────────────────────── my account ─────────────────────────────
function pageAccount() {
  const row = (k, v) => v ? h("div", { class: "grid grid-cols-3 gap-3 py-2.5 text-sm" }, h("dt", { class: "text-slate-400" }, k), h("dd", { class: "col-span-2 break-all text-slate-800" }, v)) : null;
  const profile = panel("Profile", rolePill(me.role), pad(h("dl", { class: "divide-y divide-slate-100" },
    row("Name", me.name), row("Email", me.email), row("Role", cap(me.role)), row("Organization", me.organization))));

  if (imp) {
    return [profile, panel("Change password", null, pad(alertBox("warn", `You are viewing as ${me.name}. Return to your own account to change a password; nobody can change another person's password from here.`)))];
  }

  const cur = inp({ type: "password", required: true, autocomplete: "current-password" });
  const nw = inp({ type: "password", required: true, minlength: 10, autocomplete: "new-password" });
  const again = inp({ type: "password", required: true, minlength: 10, autocomplete: "new-password" });
  const btn = h("button", { class: "btn" }, icon("key", "h-4 w-4"), "Change password");
  const f = h("form", { class: "max-w-md space-y-4", onsubmit: async (e) => {
    e.preventDefault();
    if (nw.value !== again.value) return flash(f, "err", "The two new passwords do not match.");
    if (nw.value === cur.value) return flash(f, "err", "The new password must be different from the current one.");
    btn.disabled = true;
    try {
      await api("POST", "/api/auth/change-password", { currentPassword: cur.value, newPassword: nw.value });
      f.reset(); flash(f, "ok", "Password changed. Use the new password next time you sign in.");
      toast("ok", "Password changed");
    } catch (er) { flash(f, "err", er.message); }
    btn.disabled = false;
  } }, field("Current password", cur), field("New password", nw, "At least 10 characters, with letters and numbers"), field("Confirm new password", again), btn);
  return [profile, panel("Change password", null, pad(f))];
}

async function pageVerify(arg) { return me.role === "verifier" ? [await dashVerifier()].flat() : [panel("Verify a document", null, pad(verifyBox(arg)))]; }

// ───────────────────────────── router ─────────────────────────────
const PAGES = {
  dashboard: () => ({ super_admin: dashAdmin, institution_admin: dashInstitution, issuer: dashInstitution, student: dashStudent, verifier: dashVerifier })[me.role](),
  institutions: pageInstitutions, users: pageUsers, audit: pageAudit, documents: pageDocuments, issue: pageIssue, batch: pageBatch, files: pageFiles, students: pageStudents, people: pagePeople, verify: pageVerify, account: pageAccount,
};
async function appPage(key, arg) {
  const nav = [...(NAV[me.role] || NAV.verifier), ACCOUNT_NAV];
  if (!nav.find((n) => n[0] === key)) key = "dashboard";
  const main = renderShell(key, nav.find((n) => n[0] === key)[1]);
  try { main.replaceChildren(...[await PAGES[key](arg)].flat()); }
  catch (e) { main.replaceChildren(alertBox("err", e.message)); }
}
async function route() {
  const [page, arg, arg2] = location.hash.replace(/^#\/?/, "").split("/");
  if (me?.mustChangePassword && !imp) return pageChangePw();
  if (page === "login") return me ? ((location.hash = "#/app/dashboard"), undefined) : pageLogin();
  if (page === "register") return pageRegister();
  if (page === "app" || page === "dashboard") { if (!me) { location.hash = "#/login"; return; } return appPage(arg || "dashboard", arg2); }
  if (page === "verify" && me) return appPage("verify", arg && decodeURIComponent(arg));
  pageVerifyPublic(arg && decodeURIComponent(arg));
}
window.addEventListener("hashchange", route);
(async () => { try { const r = await api("GET", "/api/auth/me"); me = r.user; imp = r.impersonator; } catch { me = null; } route(); })();
