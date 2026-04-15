# EscrowFlow IPFS Strategy

This document defines where escrow data lives and how IPFS metadata is structured for production.

## Data placement model

| Data domain | On-chain (`EscrowFlowRegistry`) | PostgreSQL (app backend) | IPFS |
|---|---|---|---|
| Core escrow state | Project/milestone status, token amounts, dispute outcomes | Cached projections, query indexes | Not required |
| User identity/profile | Wallet addresses only (as participants) | Username, email, role, bio, avatar, onboarding flags | Not required |
| Project agreement/SOW | `metadataURI` pointer only | Parsed summary/search columns, moderation flags | Full agreement metadata JSON + optional attachments |
| Milestone submissions | `submissionURI` pointer only | Submission rows, review status, timeline | Submission metadata JSON + deliverable file CIDs |
| Dispute evidence | `reasonURI` pointer only | Dispute workflow, admin notes, resolution drafts | Evidence metadata JSON + evidence files |
| Notifications / dashboards | Events only | Full read models and denormalized dashboard tables | Not required |

### Principle

- **On-chain**: trust-minimized financial truth and permissions.
- **PostgreSQL**: relational query layer, product workflows, moderation, UX projections.
- **IPFS**: large immutable blobs and versioned metadata documents referenced by URI.

## Metadata schema strategy

Shared types live in `packages/types/src/ipfs.ts`.

### Common envelope

- `schemaVersion: 1`
- `schema`: namespaced type id
- `createdAt`, `createdByWallet`
- `app: "escrowflow"`

### 1) Project agreement metadata

Type: `ProjectAgreementMetadata`

- parties: `clientWallet`, `freelancerWallet`
- legal/project context: `title`, `summary`, optional `governingLaw`
- milestone terms: array of `index`, `amountWei`, `deadline`, optional acceptance criteria
- optional attachment refs (`IpfsFileRef`)

Schema id: `escrowflow.project-agreement.v1`

### 2) Milestone submission metadata

Type: `MilestoneSubmissionMetadata`

- references: `projectId?`, `milestoneId`, `milestoneIndex?`
- `submissionRound?`
- submitter wallet and notes
- deliverables list (`IpfsFileRef[]`)

Schema id: `escrowflow.milestone-submission.v1`

### 3) Dispute evidence metadata

Type: `DisputeEvidenceMetadata`

- references: `disputeId?`, `projectId?`, `milestoneId?`
- role-aware evidence submitter (`CLIENT`, `FREELANCER`, `ADMIN`)
- `claimSummary`, long-form `statement`
- `evidenceFiles` and optional related submission URIs

Schema id: `escrowflow.dispute-evidence.v1`

## Server-side IPFS utilities

Implemented in `apps/web/src/lib/ipfs` and marked server-only.

- `uploadFileToIpfs(...)`: multipart upload to Pinata, returns `{ cid, uri, gatewayUrl, sizeBytes, contentType }`
- `uploadJsonToIpfs(...)`: JSON metadata upload, same normalized return shape
- `toIpfsUri(cid, path?)`: canonical URI builder
- `parseIpfsUri(...)`, `cidFromIpfsUri(...)`: strict URI parsing
- `toGatewayUrl(...)`: safe gateway URL construction from CID or `ipfs://` URI

## Validation and safety

- MIME allowlist + file size max: `validateIpfsFile(...)`
- JSON payload max size: `validateIpfsJsonSize(...)`
- CID validation (CIDv0 + CIDv1 lowercase)
- URI length limit in contract and server-side max payload limits
- IPFS credentials (`IPFS_PINATA_JWT`) are loaded only from server env (`import "server-only"` modules)

## Environment variables

`apps/web/.env.local`:

- `IPFS_PINATA_JWT`
- `IPFS_PINATA_API_BASE_URL` (default `https://api.pinata.cloud`)
- `IPFS_GATEWAY_HOST` (default `gateway.pinata.cloud`)
- optional tuning:
  - `IPFS_MAX_FILE_BYTES`
  - `IPFS_MAX_JSON_BYTES`
  - `IPFS_ALLOWED_MIME_TYPES`
  - `IPFS_UPLOAD_TIMEOUT_MS`

## Integration notes

- Persist canonical `ipfs://` URIs in DB and contract references.
- Use gateway URLs only for rendering/download in clients.
- For deterministic backend/indexer behavior, always store:
  - `cid`
  - `uri`
  - `schema`
  - `schemaVersion`
