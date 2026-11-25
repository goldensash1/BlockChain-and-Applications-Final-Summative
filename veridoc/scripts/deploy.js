// Deploys VeriDoc and records the address in deployments/<network>.json
// Usage: npx hardhat run scripts/deploy.js --network localhost|sepolia
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  // OWNER_ADDRESS lets you hand ownership to a different (e.g. hardware-wallet) address.
  const owner = process.env.OWNER_ADDRESS || deployer.address;
  console.log("Network  :", hre.network.name);
  console.log("Deployer :", deployer.address);
  console.log("Owner    :", owner);

  const factory = await hre.ethers.getContractFactory("VeriDoc");
  const c = await factory.deploy(owner);
  await c.waitForDeployment();
  const address = await c.getAddress();
  const tx = c.deploymentTransaction();
  console.log("VeriDoc deployed to:", address);
  console.log("Deploy tx hash       :", tx.hash);

  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${hre.network.name}.json`),
    JSON.stringify({ network: hre.network.name, address, owner, deployTx: tx.hash, deployedAt: new Date().toISOString() }, null, 2)
  );
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
