export type OfficialSourceStarter = {
  id: string;
  name: string;
  canonicalUrl: string;
  domain: string;
  sourceType: "official_api" | "licensed_api" | "open_dataset" | "permitted_public_page" | "manual_research";
  renderMode: "http" | "browser";
  jurisdiction: string;
  allowedPaths: string[];
  allowedPurposes: string[];
  allowedFields: string[];
  fieldSchema: Record<string, { type: string; aliases?: string[]; required?: boolean; entityKind?: "organization" | "person" | "location" }>;
  attribution: string;
  policyNotes: string;
  category: "LENDER" | "CUSTOMER";
  description: string;
};

export const OFFICIAL_SOURCE_STARTERS: readonly OfficialSourceStarter[];
export function toSourceDraft(starter: OfficialSourceStarter): {
  name: string;
  canonicalUrl: string;
  sourceType: OfficialSourceStarter["sourceType"];
  renderMode: OfficialSourceStarter["renderMode"];
  jurisdiction: string;
  termsUrl: string;
  licenseRef: string;
  allowedPaths: string;
  allowedPurposes: string;
  allowedFields: string;
  fieldSchemaJson: string;
  attribution: string;
  policyNotes: string;
};
