export type PublicApiReviewState =
  | "catalogue_only"
  | "approval_required"
  | "research_only"
  | "legal_review_required"
  | "legal_and_provider_review_required";

export interface PublicApiCatalogueSource {
  readonly name: string;
  readonly repositoryUrl: string;
  readonly readmeUrl: string;
  readonly contributingUrl: string;
  readonly license: "MIT";
  readonly upstreamReadmeBlobSha: string;
  readonly snapshotDate: string;
  readonly useBoundary: string;
}

export interface PublicApiCandidate {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly providerUrl: string;
  readonly docsUrl: string;
  readonly termsUrl?: string;
  readonly sourceType: string;
  readonly jurisdiction: string;
  readonly authAsListed: string;
  readonly httpsAsListed: boolean;
  readonly corsAsListed: string;
  readonly modeFit: readonly ("LENDER" | "CUSTOMER")[];
  readonly workspaceFit: readonly string[];
  readonly relevance: string;
  readonly guardrails: readonly string[];
  readonly reviewState: PublicApiReviewState;
  readonly evidence: string;
}

export const PUBLIC_API_CATALOGUE_SOURCE: PublicApiCatalogueSource;
export const PUBLIC_API_CANDIDATES: readonly PublicApiCandidate[];

export function findPublicApiCandidates(filters?: {
  query?: string;
  workspaceKey?: string;
  mode?: "LENDER" | "CUSTOMER" | "";
}): PublicApiCandidate[];
