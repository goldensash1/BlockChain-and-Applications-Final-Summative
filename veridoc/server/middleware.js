const jwt = require("jsonwebtoken");
const cfg = require("./config");
const { db } = require("./db");

const COOKIE = "cc_token";

/** Start a session. `impersonatorId` marks an "acting as" session (shorter lifetime, always reversible). */
function signIn(res, user, impersonatorId = null) {
  const hours = impersonatorId ? 1 : 8;
  const token = jwt.sign(impersonatorId ? { uid: user.id, imp: impersonatorId } : { uid: user.id }, cfg.jwtSecret, { expiresIn: `${hours}h` });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: "strict", secure: cfg.cookieSecure, maxAge: hours * 3600 * 1000 });
}
const signOut = (res) => res.clearCookie(COOKIE);

/** Loads req.user from the cookie (or null). Never fails. */
function loadUser(req, _res, next) {
  req.user = null; req.impersonator = null;
  const token = req.cookies?.[COOKIE];
  if (token) {
    try {
      const { uid, imp } = jwt.verify(token, cfg.jwtSecret);
      const u = db.prepare("SELECT * FROM users WHERE id = ?").get(uid);
      if (u && u.status === "active") {
        if (imp) { // acting-as session: the original admin must still be an active admin
          const a = db.prepare("SELECT * FROM users WHERE id = ?").get(imp);
          if (a && a.status === "active" && ["super_admin", "institution_admin"].includes(a.role)) { req.user = u; req.impersonator = a; }
        } else req.user = u;
      }
    } catch { /* invalid/expired token → anonymous */ }
  }
  next();
}

const requireAuth = (req, res, next) =>
  req.user ? next() : res.status(401).json({ error: "Please sign in" });

const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: "Please sign in" });
  if (req.user.must_change_password && !req.impersonator && !req.path.includes("change-password"))
    return res.status(403).json({ error: "You must change your temporary password first" });
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: "You do not have permission for this action" });
  next();
};

/** Wrap async handlers so errors reach the error middleware. */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

const publicUser = (u) => u && ({
  id: u.id, email: u.email, name: u.name, role: u.role, institutionId: u.institution_id,
  organization: u.organization, mustChangePassword: !!u.must_change_password, status: u.status,
});

module.exports = { signIn, signOut, loadUser, requireAuth, requireRole, wrap, HttpError, publicUser };
