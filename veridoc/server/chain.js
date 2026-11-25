// Thin wrapper around the VeriDoc contract (ethers v6).
const { ethers } = require("ethers");
const cfg = require("./config");
const artifact = require("../artifacts/contracts/VeriDoc.sol/VeriDoc.json");

const STATUS = ["NOT_FOUND", "VALID", "REVOKED", "EXPIRED", "SUPERSEDED", "INSTITUTION_SUSPENDED"];
const DOC_TYPES = ["certificate", "report_card", "transcript", "diploma"];

let provider, ownerC, relayerC, readC;
let ownerAddr, relayerAddr, singleSigner = false;
const signers = {}; // key -> NonceManager, so a failed send can reset its nonce counter

// Public RPC endpoints are pools of nodes; the node that estimates gas can be a block
// behind the node that mined our previous tx, so a call that depends on it (e.g.
// authorizeIssuer right after registerInstitution) "reverts" for a few seconds.
// On public networks, retry those pre-flight reverts. Local Hardhat never lags.
const isLocalRpc = () => /127\.0\.0\.1|localhost/.test(cfg.chain.rpc);
const LAG_RETRIES = 4, LAG_DELAY_MS = 3000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Serialise transactions per signer so nonces never collide.
const queues = new Map();
function enqueue(key, fn) {
  const prev = queues.get(key) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  queues.set(key, next);
  return next;
}

function init() {
  if (!cfg.chain.address) throw new Error("CONTRACT_ADDRESS not set and no deployments/<network>.json found. Deploy the contract first.");
  // cacheTimeout -1: ethers otherwise reuses identical RPC answers for 250 ms, which
  // would hand back a stale nonce right after a failed send resets the NonceManager.
  provider = new ethers.JsonRpcProvider(cfg.chain.rpc, undefined, { cacheTimeout: -1 });
  ownerAddr = new ethers.Wallet(cfg.chain.ownerKey).address;
  relayerAddr = new ethers.Wallet(cfg.chain.relayerKey).address;
  // One wallet may play both roles (e.g. a single funded testnet key). It then gets ONE
  // signer and ONE queue, otherwise two NonceManagers would hand out the same nonce.
  singleSigner = ownerAddr === relayerAddr;
  const owner = new ethers.NonceManager(new ethers.Wallet(cfg.chain.ownerKey, provider));
  const relayer = singleSigner ? owner : new ethers.NonceManager(new ethers.Wallet(cfg.chain.relayerKey, provider));
  signers.owner = owner; signers.relayer = relayer;
  readC = new ethers.Contract(cfg.chain.address, artifact.abi, provider);
  ownerC = new ethers.Contract(cfg.chain.address, artifact.abi, owner);
  relayerC = new ethers.Contract(cfg.chain.address, artifact.abi, relayer);
}

const instId = (code) => ethers.id(code);
const typeIdx = (t) => { const i = DOC_TYPES.indexOf(t); if (i < 0) throw new Error("Unknown doc type"); return i; };
const toUnix = (iso) => (iso ? Math.floor(new Date(iso).getTime() / 1000) : 0);

async function send(key, fn) {
  const q = singleSigner ? "owner" : key;
  return enqueue(q, async () => {
    const retries = isLocalRpc() ? 0 : LAG_RETRIES;
    for (let attempt = 0; ; attempt++) {
      let tx;
      try {
        tx = await fn();
      } catch (e) {
        // Nothing was broadcast. ethers' NonceManager already counted this nonce, so
        // reset it - otherwise every later tx would carry a nonce that leaves a gap.
        signers[q].reset();
        const preflightRevert = e.code === "CALL_EXCEPTION" || /execution reverted/i.test(e.message || "");
        if (!preflightRevert || attempt >= retries) throw e;
        await sleep(LAG_DELAY_MS);
        continue;
      }
      const rc = await tx.wait();
      return rc.hash;
    }
  });
}

module.exports = {
  STATUS, DOC_TYPES, init, instId,
  info: () => ({ contract: cfg.chain.address, owner: ownerAddr, relayer: relayerAddr, rpc: cfg.chain.rpc }),

  async health() {
    const [net, block] = await Promise.all([provider.getNetwork(), provider.getBlockNumber()]);
    return { ok: true, chainId: Number(net.chainId), block, contract: cfg.chain.address };
  },

  /** Register institution on-chain and authorise the relayer as its issuer. */
  async registerInstitution(code, name) {
    const id = instId(code);
    const tx1 = await send("owner", () => ownerC.registerInstitution(id, name, ownerAddr));
    await send("owner", () => ownerC.authorizeIssuer(id, relayerAddr));
    return tx1;
  },
  setInstitutionActive: (code, active) => send("owner", () => ownerC.setInstitutionActive(instId(code), active)),

  issue: (code, hash, type, expiresAt) => send("relayer", () => relayerC.issue(instId(code), hash, typeIdx(type), toUnix(expiresAt))),
  issueBatch: (code, hashes, type, expiresAt) => send("relayer", () => relayerC.issueBatch(instId(code), hashes, typeIdx(type), toUnix(expiresAt))),
  revoke: (hash, reason) => send("relayer", () => relayerC.revoke(hash, reason)),
  supersede: (oldHash, newHash, type, expiresAt) => send("relayer", () => relayerC.supersede(oldHash, newHash, typeIdx(type), toUnix(expiresAt))),

  /** Read-only verification straight from the chain. */
  async verify(hash) {
    const r = await readC.verify(hash);
    return {
      status: STATUS[Number(r.status)],
      institutionName: r.institutionName || null,
      docType: r.institutionName ? DOC_TYPES[Number(r.docType)] : null,
      issuedAt: Number(r.issuedAt) ? new Date(Number(r.issuedAt) * 1000).toISOString() : null,
      expiresAt: Number(r.expiresAt) ? new Date(Number(r.expiresAt) * 1000).toISOString() : null,
      supersededBy: r.supersededBy === ethers.ZeroHash ? null : r.supersededBy,
      revokeReason: r.revokeReason || null,
    };
  },
};
