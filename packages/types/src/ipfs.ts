import type { EntityId, IpfsUri, IsoDateTimeString, WalletAddress } from "./primitives.js";

/**
 * Versioned JSON payloads persisted to IPFS.
 * Keep this file additive and backwards-compatible where possible.
 */

export type IpfsMetadataSchema =
  | "escrowflow.project-agreement.v1"
  | "escrowflow.milestone-submission.v1"
  | "escrowflow.dispute-evidence.v1";

export type IpfsJsonBase = {
  schemaVersion: 1;
  schema: IpfsMetadataSchema;
  createdAt: IsoDateTimeString;
  createdByWallet: WalletAddress;
  app: "escrowflow";
};

export type IpfsFileRef = {
  cid: string;
  uri: IpfsUri;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256?: string;
};

export type AgreementMilestoneTerm = {
  index: number;
  amountWei: string;
  deadline: IsoDateTimeString;
  title?: string;
  acceptanceCriteria?: string;
};

/** Project agreement / SOW metadata (legal terms + referenced docs). */
export type ProjectAgreementMetadata = IpfsJsonBase & {
  schemaVersion: 1;
  schema: "escrowflow.project-agreement.v1";
  projectId?: EntityId;
  chainId?: number;
  title: string;
  summary?: string;
  governingLaw?: string;
  clientWallet: WalletAddress;
  freelancerWallet: WalletAddress;
  milestones: AgreementMilestoneTerm[];
  attachments?: IpfsFileRef[];
};

/** Freelancer submission package for a project milestone. */
export type MilestoneSubmissionMetadata = IpfsJsonBase & {
  schemaVersion: 1;
  schema: "escrowflow.milestone-submission.v1";
  projectId?: EntityId;
  milestoneId: EntityId;
  milestoneIndex?: number;
  submissionRound?: number;
  notes?: string;
  deliverables: IpfsFileRef[];
};

/** Evidence packet uploaded by one party during dispute handling. */
export type DisputeEvidenceMetadata = IpfsJsonBase & {
  schemaVersion: 1;
  schema: "escrowflow.dispute-evidence.v1";
  disputeId?: EntityId;
  projectId?: EntityId;
  milestoneId?: EntityId;
  submittedByRole: "CLIENT" | "FREELANCER" | "ADMIN";
  claimSummary: string;
  statement: string;
  evidenceFiles: IpfsFileRef[];
  relatedSubmissionUris?: IpfsUri[];
};

export type IpfsTypedMetadata =
  | ProjectAgreementMetadata
  | MilestoneSubmissionMetadata
  | DisputeEvidenceMetadata;

/**
 * Lightweight DTO for API responses and DB rows that persist IPFS references.
 */
export type IpfsObjectRef = {
  uri: IpfsUri;
  cid?: string;
  contentType?: string;
  metadata?: IpfsTypedMetadata;
};

/**
 * Backward-compatible aliases used in earlier modules.
 */
export type AgreementMetadata = ProjectAgreementMetadata;
export type DeliverableFileRef = IpfsFileRef;
export type DeliverablesManifest = MilestoneSubmissionMetadata;
export type DisputeEvidenceManifest = DisputeEvidenceMetadata;
