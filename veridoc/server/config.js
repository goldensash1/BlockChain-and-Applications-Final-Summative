require("dotenv").config();
const fs = require("fs");
const path = require("path");

function contractAddress() {
  if (process.env.CONTRACT_ADDRESS) return process.env.CONTRACT_ADDRESS;
  const net = process.env.DEPLOY_NETWORK || (process.env.CHAIN_RPC_URL?.includes("127.0.0.1") ? "localhost" : "sepolia");
  const f = path.join(__dirname, "..", "deployments", `${net}.json`);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf8")).address;
  return null;
}

const cfg = {
  port: +process.env.PORT || 3000,
  jwtSecret: process.env.JWT_SECRET || "dev-insecure-secret-change-me-please-0123456789",
  cookieSecure: process.env.COOKIE_SECURE === "true",
  publicUrl: process.env.PUBLIC_URL || "http://localhost:3000",
  dbPath: process.env.DB_PATH || "./data/veridoc.db",
  superAdmin: { email: process.env.SUPER_ADMIN_EMAIL, password: process.env.SUPER_ADMIN_PASSWORD },
  chain: {
    rpc: process.env.CHAIN_RPC_URL || "http://127.0.0.1:8545",
    ownerKey: process.env.OWNER_PRIVATE_KEY,
    relayerKey: process.env.RELAYER_PRIVATE_KEY,
    explorerTx: process.env.EXPLORER_TX_URL || "",
    get address() { return contractAddress(); },
  },
};
if (process.env.NODE_ENV === "production" && cfg.jwtSecret.startsWith("dev-insecure")) {
  throw new Error("Set JWT_SECRET in production");
}
module.exports = cfg;
