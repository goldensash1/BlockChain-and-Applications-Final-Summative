# CertChain - Blockchain-Based Verification of Certificates and Report Cards

**Application area:** Education (with Identity Management and Social Impact overlap)
**Platform:** Ethereum (Solidity smart contract, deployed on the Sepolia testnet)

## 1. Problem

Fake certificates and altered report cards are a global problem. Today a document is "verified" by phoning or emailing the issuing school, which takes days, costs money, and often fails when the school is closed, has lost records, or is in another country.

- **Embassies** reviewing visa and scholarship applications cannot quickly tell a genuine transcript from a forged one.
- **Schools and universities** admitting transfer students rely on paper copies that are easy to edit.
- **Online learning platforms** issue thousands of certificates that anyone can screenshot, edit and re-share.
- **Students** with genuine documents are slowed down or doubted because verification is slow.

## 2. Alignment with personal mission

*(Edit this paragraph to your own words.)* My mission is to use technology to make trustworthy digital services accessible in Rwanda and across Africa. Credential fraud harms honest graduates, erodes trust in local institutions, and blocks opportunity abroad. A verification system that any embassy, employer or school can use in seconds - without depending on the issuer's office being reachable - gives genuine students a fair chance and strengthens confidence in African qualifications.

## 3. Solution overview

CertChain lets an institution **issue** a certificate or report card, which produces a printable document with a **verification code and QR code**. The document's cryptographic fingerprint is **anchored on Ethereum**. Anyone can then **verify** the document in seconds.

### Why blockchain?
| Need | How the blockchain meets it |
|---|---|
| Records cannot be quietly edited | Fingerprints on Ethereum are immutable; any change to a document changes its hash and fails verification |
| Works even if the school is offline or closes | The registry is public and independent of any one server |
| No single party to trust | The smart contract, not an administrator, enforces who may issue and revoke |
| Public auditability | Every issue, revoke and suspension is a permanent on-chain event |
| Privacy | Only a salted hash is stored on-chain - never names or grades |

### How a document is protected
1. The system builds a canonical JSON of the document (institution, holder, grades, expiry, random salt).
2. `keccak256(JSON)` = the document fingerprint.
3. The fingerprint is written to the `CertChain` contract with the institution, issue time, expiry and type.
4. Verification recomputes the fingerprint from the stored data and asks the contract. A mismatch is reported as **TAMPERED**; an unknown hash as **NOT FOUND**.

## 4. Users and roles

| Role | Who | Can do |
|---|---|---|
| **Super admin** | Platform operator | Register / suspend institutions, approve verifier accounts, view audit log and chain health |
| **Institution admin** | Registrar, e-learning platform owner | Manage issuers and students, issue / revoke / correct documents |
| **Issuer** | Teacher, exams office | Issue certificates and class report cards, revoke, correct |
| **Student** | Document holder | View own documents, share link/QR, download proof file |
| **Verifier** | Embassy, employer, school (account optional) | Verify by code, by fingerprint or by uploading a proof file; keeps history when signed in |
| **Anyone** | Public | Verify without login |

## 5. Key features
- Secure login (bcrypt, JWT in httpOnly cookie, lock-out after repeated failures, forced password change on first login)
- Role-based access, with each institution isolated from the others
- Single and **batch issuance** (a whole class of report cards in one transaction)
- Printable certificate / report card with QR code
- **Revocation** with a public reason, and **supersede** (issue corrected version; old one is flagged)
- **Expiry** dates for time-limited credentials
- **Institution suspension** that instantly flags all of its documents
- Three ways to verify, including a **trust-minimised path** that talks only to the blockchain
- **Tamper detection** even if our own database is edited
- Audit log and verification history

## 6. Smart contract design (`contracts/CertChain.sol`)

- `Ownable2Step` + `Pausable` from OpenZeppelin; custom errors for cheap, clear reverts.
- **Institutions:** `registerInstitution`, `setInstitutionActive`, `changeInstitutionAdmin` (owner only).
- **Issuers:** `authorizeIssuer`, `removeIssuer` (institution admin).
- **Documents:** `issue`, `issueBatch` (≤ 100), `revoke`, `supersede`.
- **Verification:** `verify(hash)` returns status (`Valid`, `Revoked`, `Expired`, `Superseded`, `InstitutionSuspended`, `NotFound`), institution, type, dates, reason.
- **Events** for every state change; `pause()` as an emergency stop.

## 7. Architecture

```
 Browser (SPA)  ──►  Node/Express API  ──►  SQLite (people, documents, logs)
                        │  ethers.js
                        ▼
                  Ethereum (Sepolia / local Hardhat)  ── CertChain.sol
```
The API holds a **relayer key** that signs issue/revoke transactions on behalf of institutions, so schools and students never need a crypto wallet. The **owner key** (kept separate) registers institutions.

## 8. Security considerations
- No personal data on-chain; salted hashes prevent guessing.
- Parameterised SQL, output escaping, rate limits, Helmet headers, SameSite-strict cookies.
- Separate owner and relayer keys; use a hardware wallet / multisig as owner in production.
- The verification code acts as a bearer secret for viewing a document's content - holders choose who gets it.
- Known limits: the relayer is a trusted operator for *who gets issued*; the chain guarantees *what was issued cannot be altered*. A production deployment should add institution-held signing keys or multisig approval.

## 9. Impact
Verification drops from days to seconds, at near-zero cost, for embassies, schools and platforms in any country. Genuine students gain portable, instantly checkable proof of achievement.

## 10. Future work
Institution-held wallets (EIP-712 signed issuance), zero-knowledge selective disclosure (prove "GPA > 3.0" only), mobile QR scanner, integration with national qualification authorities, deployment on a low-cost Ethereum L2.
