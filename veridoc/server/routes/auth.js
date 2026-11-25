const router = require("express").Router();
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const { db, audit } = require("../db");
const { signIn, signOut, requireAuth, wrap, HttpError, publicUser } = require("../middleware");

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: +process.env.LOGIN_RATE_LIMIT || 30, standardHeaders: true, legacyHeaders: false });
const emailOk = (e) => typeof e === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const strong = (p) => typeof p === "string" && p.length >= 10 && /[a-z]/i.test(p) && /\d/.test(p);

router.post("/login", loginLimiter, wrap(async (req, res) => {
  const { email, password } = req.body || {};
  const u = db.prepare("SELECT * FROM users WHERE email = ?").get(String(email || "").toLowerCase());
  const fail = () => { throw new HttpError(401, "Invalid email or password"); };
  if (!u) { await bcrypt.compare("x", "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali"); return fail(); }
  if (u.locked_until && new Date(u.locked_until) > new Date()) throw new HttpError(429, "Account temporarily locked. Try again later.");
  if (!(await bcrypt.compare(String(password || ""), u.password_hash))) {
    const n = u.failed_attempts + 1;
    db.prepare("UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?")
      .run(n >= 5 ? 0 : n, n >= 5 ? new Date(Date.now() + 15 * 60000).toISOString() : null, u.id);
    audit(u.id, "login_failed");
    return fail();
  }
  if (u.status === "pending") throw new HttpError(403, "Your account is awaiting approval by the platform administrator.");
  if (u.status !== "active") throw new HttpError(403, "This account is disabled.");
  db.prepare("UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?").run(u.id);
  signIn(res, u);
  audit(u.id, "login");
  res.json({ user: publicUser(u) });
}));

router.post("/logout", (req, res) => { signOut(res); res.json({ ok: true }); });

router.get("/me", (req, res) => res.json({
  user: publicUser(req.user),
  impersonator: req.impersonator ? { id: req.impersonator.id, name: req.impersonator.name, email: req.impersonator.email, role: req.impersonator.role } : null,
}));

/**
 * "Sign in as" - lets an administrator act as another user WITHOUT knowing their password.
 *  - super_admin may act as any non-super-admin active user
 *  - institution_admin may act as issuers / students of their own institution only
 * The session is 1 hour, cannot be chained, blocks password changes and is audit-logged.
 */
router.post("/impersonate/:id", requireAuth, wrap(async (req, res) => {
  if (req.impersonator) throw new HttpError(403, "Return to your own account before switching user");
  const target = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!target || target.id === req.user.id) throw new HttpError(404, "User not found");
  const me = req.user;
  const allowed = me.role === "super_admin" ? target.role !== "super_admin"
    : me.role === "institution_admin" ? target.institution_id === me.institution_id && ["issuer", "student"].includes(target.role)
    : false;
  if (!allowed) throw new HttpError(403, "You are not allowed to act as this user");
  if (target.status !== "active") throw new HttpError(409, "This account is not active");
  signIn(res, target, me.id);
  audit(me.id, "impersonation_started", target.email);
  res.json({ user: publicUser(target), impersonator: { id: me.id, name: me.name, email: me.email, role: me.role } });
}));

router.post("/stop-impersonation", wrap(async (req, res) => {
  if (!req.impersonator) throw new HttpError(400, "You are not acting as another user");
  const admin = req.impersonator;
  signIn(res, admin);
  audit(admin.id, "impersonation_ended", req.user.email);
  res.json({ user: publicUser(admin), impersonator: null });
}));

router.post("/change-password", requireAuth, wrap(async (req, res) => {
  if (req.impersonator) throw new HttpError(403, "Passwords cannot be changed while acting as another user");
  const { currentPassword, newPassword } = req.body || {};
  if (!(await bcrypt.compare(String(currentPassword || ""), req.user.password_hash))) throw new HttpError(400, "Current password is incorrect");
  if (!strong(newPassword)) throw new HttpError(400, "New password must be 10+ characters with letters and numbers");
  if (newPassword === currentPassword) throw new HttpError(400, "New password must be different from the current one");
  db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?").run(await bcrypt.hash(newPassword, 10), req.user.id);
  audit(req.user.id, "password_changed");
  res.json({ ok: true });
}));

/** Embassies / employers / schools self-register as verifiers; super admin approves. */
router.post("/register-verifier", loginLimiter, wrap(async (req, res) => {
  const { email, name, organization, password } = req.body || {};
  if (!emailOk(email)) throw new HttpError(400, "Valid email required");
  if (!name || !organization) throw new HttpError(400, "Name and organization are required");
  if (!strong(password)) throw new HttpError(400, "Password must be 10+ characters with letters and numbers");
  try {
    db.prepare("INSERT INTO users (email, name, password_hash, role, organization, status) VALUES (?,?,?,?,?,'pending')")
      .run(email.toLowerCase(), name, await bcrypt.hash(password, 10), "verifier", organization);
  } catch (e) { if (String(e.message).includes("UNIQUE")) throw new HttpError(409, "Email already registered"); throw e; }
  audit(null, "verifier_registered", email);
  res.status(201).json({ ok: true, message: "Registered. An administrator must approve your account before you can sign in." });
}));

const tempPassword = () => crypto.randomBytes(9).toString("base64url") + "9a";
module.exports = router;
module.exports.tempPassword = tempPassword;
