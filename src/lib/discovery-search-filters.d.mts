export type DiscoveryCoverageScope = "state" | "india" | "international";
export type DiscoverySearchFilterField = {
  key: string;
  label: string;
  type: "text" | "number" | "select";
  placeholder?: string;
  min?: number;
  options?: string[];
};
export type DiscoverySearchFilterDraft = {
  coverageScope: DiscoveryCoverageScope;
  state: string;
  country: string;
  currency: string;
  fields: Record<string, string>;
  keywords?: string;
};
export const INDIA_STATES_AND_UTS: readonly string[];
export const DISCOVERY_SEARCH_FILTER_WORKSPACES: readonly string[];
export function getWorkspaceSearchFilterFields(workspaceKey: string, mode: "LENDER" | "CUSTOMER"): DiscoverySearchFilterField[];
export function createDefaultDiscoverySearchFilters(): DiscoverySearchFilterDraft;
export function normalizeDiscoverySearchFilters(workspaceKey: string, mode: "LENDER" | "CUSTOMER", input?: Partial<DiscoverySearchFilterDraft>): {
  coverageScope: DiscoveryCoverageScope;
  state: string;
  country: string;
  currency: string;
  location: string;
  sector: string;
  product: string;
  stage: string;
  instrument: string;
  searchTerms: string;
  fields: Record<string, string>;
};
