# VERIDOC: Truth, Anchored On-Chain

**Developing a Blockchain-Based Solution for Fake Certificate and Report-Card Fraud in Education**
Final Summative · Blockchain and Applications

VERIDOC lets schools, universities and online-learning platforms issue certificates and report cards whose cryptographic fingerprints are anchored on Ethereum. An embassy, employer or admissions office can confirm that a document is genuine in seconds, with no phone call to the issuer, no fee and no account. Only a salted `keccak256` hash goes on-chain, so no personal data is ever published.

## Live deployment
| | |
|---|---|
| Network | Ethereum **Sepolia** testnet (chainId 11155111) |
| Contract | [`0x8DAEB0d204A30F4e712e701033Df992AdC333c52`](https://sepolia.etherscan.io/address/0x8DAEB0d204A30F4e712e701033Df992AdC333c52) |
| Deploy transaction | [`0xfc67eb77…e966a`](https://sepolia.etherscan.io/tx/0xfc67eb7762f18e50c88374f159dbac107ec51d97a9e242894a6dc52fc13e966a) (block 12210208) |
| Demo on Sepolia | register → authorize → issue → verify (Valid / forged: NotFound) → revoke (Revoked): [`veridoc/docs/results-demo-sepolia.txt`](veridoc/docs/results-demo-sepolia.txt) |
| Web app | https://veridoc.msilabtester.site |

## The problem
Checking an academic document today usually means phoning or emailing the school that issued it. That takes days, can cost money, and fails when the office is closed or has lost its records. Paper documents and PDFs are easy to edit, so honest graduates get doubted and forged documents get through.

## How it works
1. **Issue:** an institution creates a certificate or a whole class's report cards.
2. **Fingerprint:** the system computes `keccak256` of the document's canonical JSON plus a random salt.
3. **Anchor:** the fingerprint is written to the `VeriDoc` smart contract along with the institution, type, issue date and expiry.
4. **Verify:** anyone scans the QR code or enters the code. The result is **VALID**, **REVOKED**, **EXPIRED**, **SUPERSEDED**, **INSTITUTION SUSPENDED**, **TAMPERED** or **NOT FOUND**.

## Smart contract
[`veridoc/contracts/VeriDoc.sol`](veridoc/contracts/VeriDoc.sol) is written in Solidity 0.8.24 and uses OpenZeppelin's `Ownable2Step` and `Pausable`.

| Function | Who can call it | Purpose |
|---|---|---|
| `registerInstitution`, `setInstitutionActive`, `changeInstitutionAdmin` | Platform owner | Register a school, suspend or re-activate it, rotate its admin |
| `authorizeIssuer`, `removeIssuer` | Institution admin | Manage who may issue documents |
| `issue`, `issueBatch` (up to 100) | Issuer | Anchor one document, or a whole class in one transaction |
| `revoke(hash, reason)` | Issuer of that institution | Flag a document with a public reason |
| `supersede(old, new)` | Issuer of that institution | Issue a corrected version and flag the old one |
| `verify(hash)` | Anyone (free view call) | Status, institution, type, dates, reason, replacement |
| `pause`, `unpause` | Platform owner | Emergency stop |

**Security measures:**
- Two-step ownership transfer
- Pausable emergency stop
- Custom errors
- Batches capped at 100
- Issuers of one institution can never touch another institution's documents
- No external calls, so there is no re-entrancy surface
- No personal data on-chain

## Testing
| Suite | Command | Result |
|---|---|---|
| Smart-contract tests | `npm test` | 23 / 23 passing |
| End-to-end API tests | `npm run e2e` | 90 / 90 passing |

The test cases, with their expected and actual results, are in [`veridoc/docs/TEST_CASES.md`](veridoc/docs/TEST_CASES.md). The raw outputs are the `veridoc/docs/results-*.txt` files.

## Run it locally
Requires Node.js 20+. Run each command from the `veridoc` folder.

```bash
cd veridoc && npm install && cp .env.example .env
```
```bash
npm run chain          # terminal 1: local Ethereum node
```
```bash
npm run deploy:local   # terminal 2: deploy VeriDoc
```
```bash
npm start              # web app on http://localhost:3000
```
```bash
npm run seed           # terminal 3: demo institution, students, documents and logins
```

The full setup steps, including how to deploy to the **Sepolia testnet**, are in [`veridoc/docs/DEPLOYMENT_GUIDE.md`](veridoc/docs/DEPLOYMENT_GUIDE.md).

## Repository layout
```
VERIDOC_Project_Report.docx   Full project report
VERIDOC_Presentation.pptx     Presentation slides
CONCEPT.md                    Original concept note
veridoc/
  contracts/VeriDoc.sol       Solidity smart contract
  test/VeriDoc.test.js        Hardhat contract tests
  scripts/                    deploy, demo, seed and end-to-end test scripts
  server/                     Node/Express API, auth, roles, chain wrapper (ethers.js)
  public/                     Web app (Tailwind CSS)
  docs/                       Deployment guide, test cases, test outputs, screenshots, brand
```

## Tech stack
Solidity · Hardhat · OpenZeppelin · ethers.js · Node.js / Express · SQLite · Tailwind CSS

## Known limits and future work
- The contract has not had an independent audit; it needs one before any mainnet use.
- Today the server's relayer key signs transactions on behalf of institutions. Next steps:
  - institution-held wallets with EIP-712 signed issuance
  - zero-knowledge selective disclosure
  - a mobile QR scanner
  - deployment on a low-cost Ethereum L2
