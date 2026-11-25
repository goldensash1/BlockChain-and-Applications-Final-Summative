// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title VeriDoc
 * @notice A tamper-proof registry for academic certificates and report cards.
 *
 * HOW IT WORKS
 *  - No personal data is stored on-chain. Only a salted keccak256 fingerprint
 *    (`docHash`) of each document is anchored, together with who issued it,
 *    when, its type, expiry and status.
 *  - Anyone (embassy, employer, school, e-learning platform) can call
 *    `verify(docHash)` for free to learn whether a document is authentic,
 *    revoked, expired or superseded by a corrected version.
 *
 * ROLES
 *  - Platform owner (Ownable2Step): registers / suspends institutions, can pause.
 *  - Institution admin (one address per institution): authorises / removes issuers.
 *  - Issuer (many per institution): issues, revokes and supersedes documents.
 *  - Verifier: anyone; read-only.
 */
contract VeriDoc is Ownable2Step, Pausable {
    // ───────────────────────────── Types ─────────────────────────────

    /// @notice Kind of document that was anchored.
    enum DocType { Certificate, ReportCard, Transcript, Diploma }

    /// @notice Result returned by `verify`.
    enum Status { NotFound, Valid, Revoked, Expired, Superseded, InstitutionSuspended }

    struct Institution {
        string name;
        address admin;
        bool active;
        uint64 registeredAt;
    }

    struct Record {
        bytes32 institutionId;
        address issuer;
        DocType docType;
        uint64 issuedAt;
        uint64 expiresAt;   // 0 = never expires
        uint64 revokedAt;   // 0 = not revoked
        bytes32 supersededBy; // 0 = not superseded
        string revokeReason;
    }

    // ──────────────────────────── Storage ────────────────────────────

    uint256 public constant MAX_BATCH = 100;

    mapping(bytes32 => Institution) private _institutions;
    mapping(bytes32 => mapping(address => bool)) public isIssuer;
    mapping(bytes32 => Record) private _records;
    uint256 public totalRecords;

    // ──────────────────────────── Events ─────────────────────────────

    event InstitutionRegistered(bytes32 indexed institutionId, string name, address admin);
    event InstitutionStatusChanged(bytes32 indexed institutionId, bool active);
    event InstitutionAdminChanged(bytes32 indexed institutionId, address newAdmin);
    event IssuerAuthorized(bytes32 indexed institutionId, address indexed issuer);
    event IssuerRemoved(bytes32 indexed institutionId, address indexed issuer);
    event DocumentIssued(bytes32 indexed docHash, bytes32 indexed institutionId, address indexed issuer, DocType docType, uint64 expiresAt);
    event DocumentRevoked(bytes32 indexed docHash, bytes32 indexed institutionId, string reason);
    event DocumentSuperseded(bytes32 indexed oldHash, bytes32 indexed newHash);

    // ──────────────────────────── Errors ─────────────────────────────

    error InstitutionExists();
    error UnknownInstitution();
    error InstitutionInactive();
    error NotInstitutionAdmin();
    error NotAuthorizedIssuer();
    error ZeroAddress();
    error EmptyName();
    error AlreadyIssued();
    error UnknownDocument();
    error WrongInstitution();
    error AlreadyRevoked();
    error InvalidExpiry();
    error BatchTooLarge();
    error EmptyBatch();
    error AlreadySuperseded();

    // ──────────────────────────── Modifiers ──────────────────────────

    modifier onlyInstitutionAdmin(bytes32 id) {
        if (_institutions[id].admin == address(0)) revert UnknownInstitution();
        if (msg.sender != _institutions[id].admin && msg.sender != owner()) revert NotInstitutionAdmin();
        _;
    }

    modifier onlyIssuer(bytes32 id) {
        Institution storage inst = _institutions[id];
        if (inst.admin == address(0)) revert UnknownInstitution();
        if (!inst.active) revert InstitutionInactive();
        if (!isIssuer[id][msg.sender]) revert NotAuthorizedIssuer();
        _;
    }

    constructor(address initialOwner) Ownable(initialOwner) {}

    // ───────────────────── Platform owner functions ──────────────────

    /// @notice Register a new institution (school, university, e-learning platform...).
    /// @param id        Unique id, e.g. keccak256("ALU-RW").
    /// @param name      Human readable name shown to verifiers.
    /// @param admin     Address allowed to manage this institution's issuers.
    function registerInstitution(bytes32 id, string calldata name, address admin) external onlyOwner {
        if (_institutions[id].admin != address(0)) revert InstitutionExists();
        if (admin == address(0)) revert ZeroAddress();
        if (bytes(name).length == 0) revert EmptyName();
        _institutions[id] = Institution(name, admin, true, uint64(block.timestamp));
        emit InstitutionRegistered(id, name, admin);
    }

    /// @notice Suspend or re-activate an institution. Suspended institutions cannot issue,
    ///         and their documents verify as `InstitutionSuspended`.
    function setInstitutionActive(bytes32 id, bool active) external onlyOwner {
        if (_institutions[id].admin == address(0)) revert UnknownInstitution();
        _institutions[id].active = active;
        emit InstitutionStatusChanged(id, active);
    }

    /// @notice Replace an institution's admin (e.g. key rotation).
    function changeInstitutionAdmin(bytes32 id, address newAdmin) external onlyOwner {
        if (_institutions[id].admin == address(0)) revert UnknownInstitution();
        if (newAdmin == address(0)) revert ZeroAddress();
        _institutions[id].admin = newAdmin;
        emit InstitutionAdminChanged(id, newAdmin);
    }

    /// @notice Emergency stop for all issuing / revoking.
    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // ─────────────────── Institution admin functions ─────────────────

    function authorizeIssuer(bytes32 id, address issuer) external onlyInstitutionAdmin(id) {
        if (issuer == address(0)) revert ZeroAddress();
        isIssuer[id][issuer] = true;
        emit IssuerAuthorized(id, issuer);
    }

    function removeIssuer(bytes32 id, address issuer) external onlyInstitutionAdmin(id) {
        isIssuer[id][issuer] = false;
        emit IssuerRemoved(id, issuer);
    }

    // ───────────────────────── Issuer functions ──────────────────────

    /// @notice Anchor one document fingerprint.
    function issue(bytes32 id, bytes32 docHash, DocType docType, uint64 expiresAt)
        external whenNotPaused onlyIssuer(id)
    {
        _issue(id, docHash, docType, expiresAt);
    }

    /// @notice Anchor many fingerprints in one transaction (e.g. a whole class's report cards).
    function issueBatch(bytes32 id, bytes32[] calldata docHashes, DocType docType, uint64 expiresAt)
        external whenNotPaused onlyIssuer(id)
    {
        uint256 n = docHashes.length;
        if (n == 0) revert EmptyBatch();
        if (n > MAX_BATCH) revert BatchTooLarge();
        for (uint256 i = 0; i < n; ++i) _issue(id, docHashes[i], docType, expiresAt);
    }

    /// @notice Revoke a document (fraud discovered, degree withdrawn, error...).
    function revoke(bytes32 docHash, string calldata reason) external whenNotPaused {
        Record storage r = _records[docHash];
        if (r.issuedAt == 0) revert UnknownDocument();
        _requireIssuerFor(r.institutionId);
        if (r.revokedAt != 0) revert AlreadyRevoked();
        r.revokedAt = uint64(block.timestamp);
        r.revokeReason = reason;
        emit DocumentRevoked(docHash, r.institutionId, reason);
    }

    /// @notice Replace a document with a corrected version. The old hash then verifies as
    ///         `Superseded` and points to the new one.
    function supersede(bytes32 oldHash, bytes32 newHash, DocType docType, uint64 expiresAt)
        external whenNotPaused
    {
        Record storage old = _records[oldHash];
        if (old.issuedAt == 0) revert UnknownDocument();
        _requireIssuerFor(old.institutionId);
        if (old.supersededBy != bytes32(0)) revert AlreadySuperseded();
        if (old.revokedAt != 0) revert AlreadyRevoked();
        _issue(old.institutionId, newHash, docType, expiresAt);
        old.supersededBy = newHash;
        emit DocumentSuperseded(oldHash, newHash);
    }

    // ─────────────────────────── Public reads ────────────────────────

    /// @notice Verify a document fingerprint. Free to call; no account required.
    function verify(bytes32 docHash)
        external view
        returns (
            Status status,
            bytes32 institutionId,
            string memory institutionName,
            DocType docType,
            uint64 issuedAt,
            uint64 expiresAt,
            bytes32 supersededBy,
            string memory revokeReason
        )
    {
        Record storage r = _records[docHash];
        if (r.issuedAt == 0) return (Status.NotFound, bytes32(0), "", DocType.Certificate, 0, 0, bytes32(0), "");
        Institution storage inst = _institutions[r.institutionId];

        if (r.revokedAt != 0) status = Status.Revoked;
        else if (r.supersededBy != bytes32(0)) status = Status.Superseded;
        else if (r.expiresAt != 0 && block.timestamp >= r.expiresAt) status = Status.Expired;
        else if (!inst.active) status = Status.InstitutionSuspended;
        else status = Status.Valid;

        return (status, r.institutionId, inst.name, r.docType, r.issuedAt, r.expiresAt, r.supersededBy, r.revokeReason);
    }

    function getInstitution(bytes32 id) external view returns (string memory name, address admin, bool active, uint64 registeredAt) {
        Institution storage i = _institutions[id];
        if (i.admin == address(0)) revert UnknownInstitution();
        return (i.name, i.admin, i.active, i.registeredAt);
    }

    // ───────────────────────────── Internals ─────────────────────────

    function _issue(bytes32 id, bytes32 docHash, DocType docType, uint64 expiresAt) private {
        if (_records[docHash].issuedAt != 0) revert AlreadyIssued();
        if (expiresAt != 0 && expiresAt <= block.timestamp) revert InvalidExpiry();
        _records[docHash] = Record({
            institutionId: id,
            issuer: msg.sender,
            docType: docType,
            issuedAt: uint64(block.timestamp),
            expiresAt: expiresAt,
            revokedAt: 0,
            supersededBy: bytes32(0),
            revokeReason: ""
        });
        unchecked { ++totalRecords; }
        emit DocumentIssued(docHash, id, msg.sender, docType, expiresAt);
    }

    function _requireIssuerFor(bytes32 id) private view {
        if (!_institutions[id].active) revert InstitutionInactive();
        if (!isIssuer[id][msg.sender]) revert NotAuthorizedIssuer();
    }
}
