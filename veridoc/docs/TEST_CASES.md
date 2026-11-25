# Test Cases and Results

Run on a local Hardhat chain. Raw output: `results-contract-tests.txt`, `results-api-tests.txt`.

## A. Smart contract tests (`npm test`) - 23 / 23 passed

| ID | Test case (expected behaviour) | Result |
|---|---|---|
| TC01 | owner registers an institution | PASS |
| TC02 | non-owner cannot register | PASS |
| TC03 | duplicate institution rejected | PASS |
| TC04 | zero admin / empty name rejected | PASS |
| TC05 | only institution admin (or owner) manages issuers | PASS |
| TC06 | unauthorised address cannot issue | PASS |
| TC07 | issuer of institution A cannot issue for institution B | PASS |
| TC08 | issued certificate verifies as Valid | PASS |
| TC09 | unknown / forged hash verifies as NotFound | PASS |
| TC10 | duplicate hash rejected | PASS |
| TC11 | past expiry rejected at issue time | PASS |
| TC12 | document becomes Expired after expiry | PASS |
| TC13 | batch issue anchors every report card | PASS |
| TC14 | empty and oversize batches rejected | PASS |
| TC15 | issuer revokes with a reason | PASS |
| TC16 | stranger cannot revoke | PASS |
| TC17 | cannot revoke twice or revoke unknown | PASS |
| TC18 | supersede links old to corrected version | PASS |
| TC19 | cannot supersede twice | PASS |
| TC20 | suspending institution blocks issuing and flags existing docs | PASS |
| TC21 | pause stops issuing; unpause restores it | PASS |
| TC22 | only owner can pause / suspend | PASS |
| TC23 | two-step ownership transfer | PASS |

## B. End-to-end API tests (`npm run e2e`) - 90 / 90 passed

| ID | Test case (expected behaviour) | Result |
|---|---|---|
| E01 | wrong password rejected (401) | PASS |
| E02 | unauthenticated request to protected route (401) | PASS |
| E03 | weak password refused on verifier registration | PASS |
| E04 | verifier registers as pending | PASS |
| E05 | pending verifier cannot log in (403) | PASS |
| E06 | student wrong pw rejected | PASS |
| E07 | verifier cannot issue documents (403) | PASS |
| E08 | institution admin cannot create institutions (403) | PASS |
| E09 | super admin cannot be reached by verifier (403) | PASS |
| E10 | super admin stats include live chain | PASS |
| E11 | issue certificate -> 201 with tx hash | PASS |
| E12 | public verify (no login) -> VALID | PASS |
| E13 | lower-case code also works | PASS |
| E14 | unknown code -> NOT_FOUND | PASS |
| E15 | hash lookup straight from chain -> VALID | PASS |
| E16 | random hash -> NOT_FOUND | PASS |
| E17 | invalid hash format -> 400 | PASS |
| E18 | downloaded package verifies VALID | PASS |
| E19 | forged package (grade edited) -> TAMPERED | PASS |
| E20 | forged package without hash -> NOT_FOUND | PASS |
| E21 | database record edited behind our back -> TAMPERED | PASS |
| E22 | restoring the record -> VALID again | PASS |
| E23 | student sees only own documents | PASS |
| E24 | student cannot list institution docs (403) | PASS |
| E25 | student cannot download another student's package (404) | PASS |
| E26 | revoke without reason -> 400 | PASS |
| E27 | revoke OK | PASS |
| E28 | revoked doc verifies REVOKED with reason | PASS |
| E29 | revoking twice -> 409 | PASS |
| E30 | supersede issues corrected version | PASS |
| E31 | old version -> SUPERSEDED pointing to new code | PASS |
| E32 | new version -> VALID | PASS |
| E33 | batch with unknown student -> 404 | PASS |
| E34 | invalid score rejected (400) | PASS |
| E35 | suspended institution's documents -> INSTITUTION_SUSPENDED | PASS |
| E36 | suspended institution cannot issue (403) | PASS |
| E37 | re-activated -> VALID again | PASS |
| E38 | verifier history endpoint reachable | PASS |
| E39 | printable document page renders | PASS |
| E40 | super admin can act as a student without a password | PASS |
| E41 | /me reports the acted-as user plus the real administrator | PASS |
| E42 | acting-as student sees own documents | PASS |
| E43 | acting-as student has NO admin rights (403) | PASS |
| E44 | impersonation cannot be chained (403) | PASS |
| E45 | passwords cannot be changed while acting as someone (403) | PASS |
| E46 | stop-impersonation returns to the administrator | PASS |
| E47 | after returning, admin rights work again | PASS |
| E48 | institution admin can act as own issuer | PASS |
| E49 | institution admin cannot act as a verifier (403) | PASS |
| E50 | a verifier cannot impersonate anyone (403) | PASS |
| E51 | inactive (pending) account cannot be impersonated (409) | PASS |
| E52 | unknown user id -> 404 | PASS |
| E53 | impersonation start and end are audit-logged | PASS |
| E54 | institution uploads a file -> anchored with a VF- code | PASS |
| E55 | another party verifies the same file by upload -> VALID | PASS |
| E56 | a single changed byte -> NOT_FOUND (anonymous) | PASS |
| E57 | file verifies by VF- code with a download link | PASS |
| E58 | public download returns the exact original bytes | PASS |
| E59 | uploading the same file again -> 409 | PASS |
| E60 | verifier cannot upload files (403) | PASS |
| E61 | anonymous cannot upload files (401) | PASS |
| E62 | title is required (400) | PASS |
| E63 | institution lists its own files | PASS |
| E64 | file revoke requires a reason (400) | PASS |
| E65 | institution revokes its file | PASS |
| E66 | revoked file verifies as REVOKED with the reason | PASS |
| E67 | institution detail has counts (users, documents, files) | PASS |
| E68 | institution page lists its documents and uploaded files | PASS |
| E69 | institution page lists only its own users | PASS |
| E70 | institution detail forbidden to non-super-admin (403) | PASS |
| E71 | super admin edits institution country and type | PASS |
| E72 | invalid institution type rejected (400) | PASS |
| E73 | institution name can be edited | PASS |
| E74 | super admin edits a user's name | PASS |
| E75 | duplicate email on edit -> 409 | PASS |
| E76 | invalid email on edit -> 400 | PASS |
| E77 | issuer promoted to institution admin | PASS |
| E78 | ...and demoted back to issuer | PASS |
| E79 | a student's role cannot be changed (400) | PASS |
| E80 | reset password issues a working one-time temp password | PASS |
| E81 | super admin adds a user inside an institution | PASS |
| E82 | institution admin edits their own issuer | PASS |
| E83 | institution admin cannot use the admin edit endpoint (403) | PASS |
| E84 | change password: wrong current password -> 400 | PASS |
| E85 | change password: weak new password -> 400 | PASS |
| E86 | change password: same as current -> 400 | PASS |
| E87 | change password: not signed in -> 401 | PASS |
| E88 | signed-in user changes own password | PASS |
| E89 | old password stops working, new one works | PASS |
| E90 | password changed back (keeps the demo login stable) | PASS |
