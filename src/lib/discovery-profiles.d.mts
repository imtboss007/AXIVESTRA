export type DiscoveryMode = "LENDER" | "CUSTOMER";

export interface WorkspaceDiscoveryCriteria {
  schemaVersion: 1;
  workspaceKey: string;
  mode: DiscoveryMode;
  targetClasses: string[];
  requiredFields: string[];
  sourceRequiredFields: string[];
  preferredFields: string[];
  matchDimensions: string[];
  sourcePriorities: string[];
  guardrails: string[];
  disabledByPolicy: boolean;
}

export function getDefaultWorkspaceCriteria(workspaceKey: string, mode: DiscoveryMode): WorkspaceDiscoveryCriteria;
export function validateWorkspaceCriteria(
  value: unknown,
  workspaceKey: string,
  mode: DiscoveryMode
): WorkspaceDiscoveryCriteria;
export function buildDiscoveryQueryHints(
  criteria: Partial<WorkspaceDiscoveryCriteria>,
  filters?: { location?: string; sector?: string; product?: string }
): string[];
export const DISCOVERY_WORKSPACE_KEYS: readonly string[];
