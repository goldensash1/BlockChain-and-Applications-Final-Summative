// Hardhat config. The compiler override below makes Hardhat use the bundled
// `solc` npm package (solc-js), so compilation works without downloading
// a native compiler binary (useful in locked-down / offline networks).
require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();
const { subtask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require("hardhat/builtin-tasks/task-names");

subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args, hre, runSuper) => {
  if (process.env.USE_NATIVE_SOLC === "1") return runSuper();
  const solcPath = require.resolve("solc/soljson.js");
  return {
    compilerPath: solcPath,
    isSolcJs: true,
    version: require("solc/package.json").version,
    longVersion: require("solc").version(),
  };
});

const { SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY } = process.env;

module.exports = {
  solidity: { version: "0.8.24", settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" } },
  networks: {
    hardhat: {},
    localhost: { url: "http://127.0.0.1:8545" },
    ...(SEPOLIA_RPC_URL && DEPLOYER_PRIVATE_KEY
      ? { sepolia: { url: SEPOLIA_RPC_URL, accounts: [DEPLOYER_PRIVATE_KEY] } }
      : {}),
  },
};
