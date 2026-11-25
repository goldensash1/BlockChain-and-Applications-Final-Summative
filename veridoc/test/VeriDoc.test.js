const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

// Status enum values, mirrors the contract
const S = { NotFound: 0, Valid: 1, Revoked: 2, Expired: 3, Superseded: 4, InstitutionSuspended: 5 };
const T = { Certificate: 0, ReportCard: 1, Transcript: 2, Diploma: 3 };
const id = (s) => ethers.id(s);
const h = (s) => ethers.id("doc:" + s);

describe("VeriDoc", () => {
  let c, owner, instAdmin, issuer, issuer2, stranger;
  const INST = id("ALU-RW");

  beforeEach(async () => {
    [owner, instAdmin, issuer, issuer2, stranger] = await ethers.getSigners();
    c = await (await ethers.getContractFactory("VeriDoc")).deploy(owner.address);
    await c.registerInstitution(INST, "African Leadership University", instAdmin.address);
    await c.connect(instAdmin).authorizeIssuer(INST, issuer.address);
  });

  describe("Institutions", () => {
    it("TC01 owner registers an institution", async () => {
      const i = await c.getInstitution(INST);
      expect(i.name).to.equal("African Leadership University");
      expect(i.active).to.equal(true);
    });
    it("TC02 non-owner cannot register", async () => {
      await expect(c.connect(stranger).registerInstitution(id("X"), "X", stranger.address))
        .to.be.revertedWithCustomError(c, "OwnableUnauthorizedAccount");
    });
    it("TC03 duplicate institution rejected", async () => {
      await expect(c.registerInstitution(INST, "Dup", instAdmin.address)).to.be.revertedWithCustomError(c, "InstitutionExists");
    });
    it("TC04 zero admin / empty name rejected", async () => {
      await expect(c.registerInstitution(id("A"), "A", ethers.ZeroAddress)).to.be.revertedWithCustomError(c, "ZeroAddress");
      await expect(c.registerInstitution(id("A"), "", stranger.address)).to.be.revertedWithCustomError(c, "EmptyName");
    });
  });

  describe("Issuers", () => {
    it("TC05 only institution admin (or owner) manages issuers", async () => {
      await expect(c.connect(stranger).authorizeIssuer(INST, stranger.address)).to.be.revertedWithCustomError(c, "NotInstitutionAdmin");
      await c.connect(instAdmin).authorizeIssuer(INST, issuer2.address);
      expect(await c.isIssuer(INST, issuer2.address)).to.equal(true);
      await c.connect(instAdmin).removeIssuer(INST, issuer2.address);
      expect(await c.isIssuer(INST, issuer2.address)).to.equal(false);
    });
    it("TC06 unauthorised address cannot issue", async () => {
      await expect(c.connect(stranger).issue(INST, h("a"), T.Certificate, 0)).to.be.revertedWithCustomError(c, "NotAuthorizedIssuer");
    });
    it("TC07 issuer of institution A cannot issue for institution B", async () => {
      await c.registerInstitution(id("B"), "B Uni", instAdmin.address);
      await expect(c.connect(issuer).issue(id("B"), h("a"), T.Certificate, 0)).to.be.revertedWithCustomError(c, "NotAuthorizedIssuer");
    });
  });

  describe("Issue & verify", () => {
    it("TC08 issued certificate verifies as Valid", async () => {
      await expect(c.connect(issuer).issue(INST, h("cert1"), T.Certificate, 0)).to.emit(c, "DocumentIssued");
      const v = await c.verify(h("cert1"));
      expect(v.status).to.equal(S.Valid);
      expect(v.institutionName).to.equal("African Leadership University");
      expect(v.docType).to.equal(T.Certificate);
      expect(await c.totalRecords()).to.equal(1);
    });
    it("TC09 unknown / forged hash verifies as NotFound", async () => {
      expect((await c.verify(h("forged"))).status).to.equal(S.NotFound);
    });
    it("TC10 duplicate hash rejected", async () => {
      await c.connect(issuer).issue(INST, h("d"), T.ReportCard, 0);
      await expect(c.connect(issuer).issue(INST, h("d"), T.ReportCard, 0)).to.be.revertedWithCustomError(c, "AlreadyIssued");
    });
    it("TC11 past expiry rejected at issue time", async () => {
      await expect(c.connect(issuer).issue(INST, h("e"), T.Certificate, 1)).to.be.revertedWithCustomError(c, "InvalidExpiry");
    });
    it("TC12 document becomes Expired after expiry", async () => {
      const exp = (await time.latest()) + 1000;
      await c.connect(issuer).issue(INST, h("exp"), T.Certificate, exp);
      expect((await c.verify(h("exp"))).status).to.equal(S.Valid);
      await time.increase(1001);
      expect((await c.verify(h("exp"))).status).to.equal(S.Expired);
    });
    it("TC13 batch issue anchors every report card", async () => {
      const hashes = Array.from({ length: 30 }, (_, i) => h("rc" + i));
      await c.connect(issuer).issueBatch(INST, hashes, T.ReportCard, 0);
      expect(await c.totalRecords()).to.equal(30);
      expect((await c.verify(hashes[29])).status).to.equal(S.Valid);
    });
    it("TC14 empty and oversize batches rejected", async () => {
      await expect(c.connect(issuer).issueBatch(INST, [], T.ReportCard, 0)).to.be.revertedWithCustomError(c, "EmptyBatch");
      const big = Array.from({ length: 101 }, (_, i) => h("b" + i));
      await expect(c.connect(issuer).issueBatch(INST, big, T.ReportCard, 0)).to.be.revertedWithCustomError(c, "BatchTooLarge");
    });
  });

  describe("Revoke & supersede", () => {
    beforeEach(async () => { await c.connect(issuer).issue(INST, h("r"), T.Diploma, 0); });

    it("TC15 issuer revokes with a reason", async () => {
      await c.connect(issuer).revoke(h("r"), "Academic misconduct");
      const v = await c.verify(h("r"));
      expect(v.status).to.equal(S.Revoked);
      expect(v.revokeReason).to.equal("Academic misconduct");
    });
    it("TC16 stranger cannot revoke", async () => {
      await expect(c.connect(stranger).revoke(h("r"), "x")).to.be.revertedWithCustomError(c, "NotAuthorizedIssuer");
    });
    it("TC17 cannot revoke twice or revoke unknown", async () => {
      await c.connect(issuer).revoke(h("r"), "x");
      await expect(c.connect(issuer).revoke(h("r"), "x")).to.be.revertedWithCustomError(c, "AlreadyRevoked");
      await expect(c.connect(issuer).revoke(h("none"), "x")).to.be.revertedWithCustomError(c, "UnknownDocument");
    });
    it("TC18 supersede links old to corrected version", async () => {
      await c.connect(issuer).supersede(h("r"), h("r-v2"), T.Diploma, 0);
      const old = await c.verify(h("r"));
      expect(old.status).to.equal(S.Superseded);
      expect(old.supersededBy).to.equal(h("r-v2"));
      expect((await c.verify(h("r-v2"))).status).to.equal(S.Valid);
    });
    it("TC19 cannot supersede twice", async () => {
      await c.connect(issuer).supersede(h("r"), h("r-v2"), T.Diploma, 0);
      await expect(c.connect(issuer).supersede(h("r"), h("r-v3"), T.Diploma, 0)).to.be.revertedWithCustomError(c, "AlreadySuperseded");
    });
  });

  describe("Suspension & pause", () => {
    it("TC20 suspending institution blocks issuing and flags existing docs", async () => {
      await c.connect(issuer).issue(INST, h("s"), T.Certificate, 0);
      await c.setInstitutionActive(INST, false);
      expect((await c.verify(h("s"))).status).to.equal(S.InstitutionSuspended);
      await expect(c.connect(issuer).issue(INST, h("s2"), T.Certificate, 0)).to.be.revertedWithCustomError(c, "InstitutionInactive");
      await c.setInstitutionActive(INST, true);
      expect((await c.verify(h("s"))).status).to.equal(S.Valid);
    });
    it("TC21 pause stops issuing; unpause restores it", async () => {
      await c.pause();
      await expect(c.connect(issuer).issue(INST, h("p"), T.Certificate, 0)).to.be.revertedWithCustomError(c, "EnforcedPause");
      await c.unpause();
      await c.connect(issuer).issue(INST, h("p"), T.Certificate, 0);
    });
    it("TC22 only owner can pause / suspend", async () => {
      await expect(c.connect(stranger).pause()).to.be.revertedWithCustomError(c, "OwnableUnauthorizedAccount");
      await expect(c.connect(instAdmin).setInstitutionActive(INST, false)).to.be.revertedWithCustomError(c, "OwnableUnauthorizedAccount");
    });
    it("TC23 two-step ownership transfer", async () => {
      await c.transferOwnership(stranger.address);
      expect(await c.owner()).to.equal(owner.address);
      await c.connect(stranger).acceptOwnership();
      expect(await c.owner()).to.equal(stranger.address);
    });
  });
});
