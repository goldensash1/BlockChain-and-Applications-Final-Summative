const bcrypt = require("bcryptjs");
const cfg = require("./config");
const { db } = require("./db");
const chain = require("./chain");

function seedSuperAdmin() {
  if (db.prepare("SELECT 1 FROM users LIMIT 1").get()) return;
  const { email, password } = cfg.superAdmin;
  if (!email || !password) return console.warn("No users exist and SUPER_ADMIN_EMAIL/PASSWORD not set.");
  db.prepare("INSERT INTO users (email,name,password_hash,role) VALUES (?,?,?,?)").run(email.toLowerCase(), "Platform Admin", bcrypt.hashSync(password, 10), "super_admin");
  console.log("Created super admin:", email);
}

(async () => {
  seedSuperAdmin();
  chain.init();
  const h = await chain.health().catch((e) => ({ ok: false, error: e.message }));
  console.log("Chain:", h.ok ? `connected (chainId ${h.chainId}, block ${h.block}), contract ${h.contract}` : "NOT reachable - " + h.error);
  require("./app").listen(cfg.port, () => console.log(`VeriDoc running on ${cfg.publicUrl}`));
})();
