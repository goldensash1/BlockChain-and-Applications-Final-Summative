# VERIDOC

Blockchain-based verification of **certificates and report cards** for embassies, schools and e-learning platforms.
Documents are fingerprinted (keccak256) and anchored on Ethereum; anyone can verify them in seconds.

## Quick start (local)
```bash
npm install && cp .env.example .env
npm test                 # 23 smart-contract tests
npm run chain            # terminal 1: local Ethereum node
npm run deploy:local     # terminal 2
npm run build:css        # (only if you edit the UI) rebuild Tailwind CSS
npm start                # http://localhost:3000
npm run seed             # demo institution, students, documents + logins
npm run e2e              # 90 API tests
npm run demo:local       # issue -> verify -> revoke walkthrough (also: demo:sepolia)
```

## Roles
`super_admin` · `institution_admin` · `issuer` · `student` · `verifier` · anonymous public verification

## Layout
```
contracts/VeriDoc.sol     Solidity registry (OpenZeppelin Ownable2Step + Pausable)
test/VeriDoc.test.js      Hardhat tests
scripts/                    deploy.js, seed.js, e2e.js
server/                     Express API (auth, roles, documents, verification, chain wrapper)
public/                     Tailwind-styled single-page app (app.js, tailwind.css) + printable styles
src/input.css               Tailwind source; `npm run build:css` compiles it
docs/                       VERIDOC_Project_Report.docx, VERIDOC_Presentation.pptx, brand/ (logo), CONCEPT, DEPLOYMENT_GUIDE, TEST_CASES
```
See `docs/DEPLOYMENT_GUIDE.md` for Sepolia deployment. Never commit `.env` or real private keys.

## Sign in as (impersonation)
Super admins can open the app as any user, and institution admins as their own issuers/students, with one click on **Sign in as** (Users / Staff & access pages) - no password typed. Sessions last 1 hour, show a yellow banner with a **Return to my account** button, block password changes and are written to the audit log.

## Institutions, editing and the file registry
- **Institutions page** (super admin): open any institution to manage its **users**, **issued documents** and **uploaded files** in one place; edit the institution (name, country, type) and any user (name, email, role, organization), add users, and reset passwords.
- **Upload to blockchain** (institution admin / issuer): register ANY file (PDF, image, ...; max 10 MB). Its keccak256 fingerprint is anchored on Ethereum under the institution's name. Any other institution or person validates it by dropping the same file on the public **Verify -> Upload a file** tab, or by entering its `VF-` code. One changed byte fails.
