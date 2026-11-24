export type DiscoveryMode = "LENDER" | "CUSTOMER";
export type E11MatchRule =
  | { value: string | number | string[]; weight?: number; required?: boolean }
  | { value: { min?: number; max?: number; currencyCode?: string }; weight?: number; required?: boolean };
export type E11FreshnessRule = { maxAgeDays: number; weight?: number; required?: boolean };
export type E11MatchCriteria = Partial<Record<
  "geography" | "type" | "ticket" | "instrument" | "collateral" | "stage" | "mandate",
  E11MatchRule
> & { evidence_freshness: E11FreshnessRule }>;

export interface WorkspaceDiscoveryCriteria {
  schemaVersion: 1;
  workspaceKey: string;
  mode: DiscoveryMode;
  targetClasses: string[];
  requiredFields: string[];
  sourceRequiredFields: string[];
  matchCriteria: E11MatchCriteria;
  preferredFields: string[];
  matchDimensions: string[];
  sourcePriorities: string[];
  guardrails: string[];
  disabledByPolicy: boolean;
}

export function getDefaultWorkspaceCriteria(workspaceKey: string, mode: DiscoveryMode): WorkspaceDiscoveryCriteria;
export function validateWorkspaceCriteria(value: unknown, workspaceKey: string, mode: DiscoveryMode): WorkspaceDiscoveryCriteria;
export function validateE11MatchCriteria(value: unknown): E11MatchCriteria;
export function getE11MatchCriteria(value: Partial<WorkspaceDiscoveryCriteria>): E11MatchCriteria;
export function buildDiscoveryQueryHints(criteria: Partial<WorkspaceDiscoveryCriteria>, filters?: { location?: string; sector?: string; product?: string }): string[];
export const E11_MATCH_CRITERIA: readonly string[];
export const DISCOVERY_WORKSPACE_KEYS: readonly string[];
