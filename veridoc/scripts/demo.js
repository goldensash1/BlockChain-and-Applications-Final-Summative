// End-to-end contract walkthrough that works on ANY network (localhost or sepolia).
// Uses the single deployer account as owner + institution admin + issuer, so it
// needs only ONE funded key. Prints every tx hash (and Etherscan link on Sepolia)
// - perfect terminal evidence for the report.
// Usage: npx hardhat run scripts/demo.js --network localhost|sepolia
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const { ethers } = hre;

const STATUS = ["NotFound", "Valid", "Revoked", "Expired", "Superseded", "InstitutionSuspended"];
const link = (h) => (hre.network.name === "sepolia" ? `  https://sepolia.etherscan.io/tx/${h}` : "");

// Public RPCs are pools of nodes that can lag a block behind each other, so on a live
// network a call that depends on the previous tx may "revert" during gas estimation for
// a few seconds. Retry those, and wait one extra block so the reads that follow are fresh.
const LIVE = !["hardhat", "localhost"].includes(hre.network.name);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function step(label, send) {
  let tx;
  for (let attempt = 0; ; attempt++) {
    try { tx = await send(); break; }
    catch (e) {
      if (!LIVE || attempt >= 4 || !/revert/i.test(e.message || "")) throw e;
      console.log(`  (${label}: RPC node not caught up yet, retrying in 3s)`);
      await sleep(3000);
    }
  }
  const rc = await tx.wait(LIVE ? 2 : 1);
  console.log(`✔ ${label}\n  tx ${rc.hash}  (block ${rc.blockNumber}, gas ${rc.gasUsed})${link(rc.hash)}`);
  return rc;
}
async function show(c, label, hash) {
  const v = await c.verify(hash);
  console.log(`  verify(${label}) -> ${STATUS[Number(v.status)]}${v.revokeReason ? ` ("${v.revokeReason}")` : ""}  institution="${v.institutionName}"`);
}

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("Network :", hre.network.name, "| Account:", signer.address);
  const file = path.join(__dirname, "..", "deployments", `${hre.network.name}.json`);
  let address;
  if (fs.existsSync(file)) address = JSON.parse(fs.readFileSync(file)).address;
  const c = address
    ? await ethers.getContractAt("VeriDoc", address)
    : await (await ethers.getContractFactory("VeriDoc")).deploy(signer.address);
  await c.waitForDeployment?.();
  console.log("Contract:", await c.getAddress(), "\n");

  const instId = ethers.id("demo-univ-" + Date.now()); // unique per run
  await step("registerInstitution", () => c.registerInstitution(instId, "Demo University of Kigali", signer.address));
  await step("authorizeIssuer", () => c.authorizeIssuer(instId, signer.address));

  // Document fingerprint = keccak256(canonical JSON incl. random salt)
  const doc = { institution: "Demo University of Kigali", holder: "Aline Uwase", title: "BSc Software Engineering", salt: ethers.hexlify(ethers.randomBytes(16)) };
  const h = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(doc, Object.keys(doc).sort())));
  console.log("\nDocument fingerprint:", h);
  await show(c, "before issue", h);

  await step("issue (Certificate, no expiry)", () => c.issue(instId, h, 0, 0));
  await show(c, "after issue", h);

  const forged = ethers.keccak256(ethers.toUtf8Bytes("forged certificate"));
  await show(c, "forged document", forged);

  await step("revoke", () => c.revoke(h, "Issued in error - demo"));
  await show(c, "after revoke", h);
  console.log("\nDemo complete.");
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
