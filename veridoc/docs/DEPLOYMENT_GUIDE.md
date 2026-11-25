# Deployment & Interaction Guide

## 0. Prerequisites
- Node.js 20+ and npm
- For Sepolia: a wallet with test ETH ([Sepolia faucet](https://sepoliafaucet.com) or Alchemy/Infura faucet) and an RPC URL from Alchemy, Infura or similar
- **Use a throw-away test wallet. Never put a real-funds private key in `.env`.**

## 1. Install
```bash
cd veridoc
npm install
cp .env.example .env          # then edit values
npx hardhat compile
npm test                      # 23 contract tests
```
> If Hardhat cannot download the Solidity compiler (restricted network), the included `hardhat.config.js` automatically uses the bundled `solc` package. Set `USE_NATIVE_SOLC=1` to force the native compiler.

## 2. Run everything locally (fastest way to see it work)
Open **three terminals** in the project folder:
```bash
# Terminal 1 - local Ethereum node (prints 20 funded test accounts)
npm run chain

# Terminal 2 - deploy the contract, then start the web app
npm run deploy:local          # prints contract address, writes deployments/localhost.json
npm start                     # http://localhost:3000

# Terminal 3 - create demo institution, students, certificate and report cards
npm run seed
npm run e2e                   # 83 API tests
```
Sign in at http://localhost:3000/#/login with the demo accounts printed by `npm run seed`.
(Set `LOGIN_RATE_LIMIT=1000` when starting the server if you run the tests repeatedly.)

## 3. Deploy to Ethereum Sepolia testnet
1. Edit `.env`:
   ```
   SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/<your-key>
   DEPLOYER_PRIVATE_KEY=0x<throwaway-funded-key>
   OWNER_PRIVATE_KEY=0x<same key as deployer, or the owner key>
   RELAYER_PRIVATE_KEY=0x<second throwaway key, also funded with a little test ETH>
   CHAIN_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/<your-key>   # same URL again (.env does not expand variables)
   DEPLOY_NETWORK=sepolia
   ```
2. Deploy:
   ```bash
   npx hardhat run scripts/deploy.js --network sepolia
   ```
   **Screenshot/copy:** the printed `VeriDoc deployed to: 0x…` and `Deploy tx hash`.
3. Look the contract up on https://sepolia.etherscan.io/address/<address> and screenshot the *Contract creation* transaction.
4. (Optional) verify source on Etherscan: `npx hardhat verify --network sepolia <address> <ownerAddress>`.
5. Start the app: `npm start`. The server log should say `connected (chainId 11155111 …)`.
6. Interact:
   - Sign in as super admin → **Institutions → Register institution** (this sends `registerInstitution` + `authorizeIssuer` transactions; the response shows the tx hash).
   - Sign in as the new institution admin → add a student → **Issue certificate**. The success message shows the `issue` transaction.
   - Open the Etherscan link for that tx → **Logs** tab shows the `DocumentIssued` event.
   - Open the public page, enter the code → **VALID**.
   - Revoke the document → verify again → **REVOKED** (screenshot both).

## 4. Interacting with the contract directly (optional, no web app)
```bash
npx hardhat console --network sepolia
> const c = await ethers.getContractAt("VeriDoc", "<address>")
> await c.verify("0x<document hash>")
```

## 5. Screenshots / outputs to capture for your report
| # | What | Where |
|---|---|---|
| 1 | `npm test` - 23 passing | terminal |
| 2 | Deploy output with address + tx hash | terminal |
| 3 | Contract + deployment tx on Etherscan | browser |
| 4 | Institution registration (admin UI) | web app |
| 5 | Issuing a certificate and the success message | web app |
| 6 | `DocumentIssued` event on Etherscan | browser |
| 7 | Verify page: VALID / REVOKED / NOT FOUND / TAMPERED | web app |
| 8 | Printable certificate with QR | web app |
| 9 | `npm run e2e` - 39 passed | terminal |

## 6. Production hardening checklist
- Strong `JWT_SECRET`, `COOKIE_SECURE=true`, serve behind HTTPS (Nginx/Caddy)
- Owner key in a hardware wallet / multisig; relayer key in a secrets manager
- Back up `data/veridoc.db` (or move to PostgreSQL)
- Consider an Ethereum L2 (Base, Arbitrum, Optimism) for lower fees
- Get an independent smart-contract audit before mainnet use

## 7. Hosting on a server (CloudPanel / Ubuntu) and updating it
Live site: https://veridoc.msilabtester.site, a CloudPanel **Node.js site** on port 3000. CloudPanel provides Nginx and the Let's Encrypt certificate.

### First-time setup (as the site user, e.g. `su - veridoc`)
```bash
cd ~/htdocs/veridoc.msilabtester.site
git clone https://github.com/goldensash1/BlockChain-and-Applications-Final-Summative.git repo
cd repo/veridoc && npm ci
cp .env.example .env    # set JWT_SECRET, COOKIE_SECURE=true, PUBLIC_URL, super-admin login, chain settings
npm i -g pm2
npm run update:server   # compiles, starts the app under PM2, saves the process list
(crontab -l 2>/dev/null; echo "@reboot PATH=$(dirname $(which node)):\$PATH $(which pm2) resurrect") | crontab -
```

### Every update afterwards
```bash
# on your computer
git add -A && git commit -m "..." && git push
# on the server
cd ~/htdocs/veridoc.msilabtester.site/repo/veridoc && npm run update:server
```
`update:server` runs `git pull --ff-only`, runs `npm ci` only when `package-lock.json` changed, compiles the contract ABI, reloads PM2 and prints the latest log lines.

**Rules that keep `git pull` conflict-free:**
- Never edit tracked files on the server. Change them locally and push. Server-only settings belong in `.env`, which git ignores.
- `data/` (the SQLite database and uploaded files) and `.env` are ignored by git and are never overwritten by a pull. Back up `data/` yourself.
- Deploy to **Sepolia from your own computer**, then commit `deployments/sepolia.json` and push. The server reads the contract address from that file, so it needs no `CONTRACT_ADDRESS` in `.env`.
- If you change `contracts/VeriDoc.sol`, the live contract does **not** change. Redeploy it (`npm run deploy:sepolia`), commit the new `deployments/sepolia.json` and push. The new contract starts empty, so documents issued on the old contract must be issued again.
