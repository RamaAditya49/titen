import type { ExtractionResponseMode as CoreExtractionResponseMode } from "../../src/core/extraction";
import type { SemanticDiagnostic as CoreSemanticDiagnostic } from "../../src/core/vectors";
import type {
  ClaimKind,
  CreatedKey,
  CreateKeyOptions,
  EnrichmentJobState,
  Readiness,
  ReadinessCapabilities,
  ReadinessChecks,
  ReadinessExtractionResponseMode,
  SemanticDiagnostic,
  Trust,
  ViewLens,
  Visibility,
} from "../../src/sdk";
import { CLAIM_KINDS, TRUST_LEVELS, VISIBILITIES } from "../../src/core/validate";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;

const claimKindsStayCanonical: Equal<ClaimKind, (typeof CLAIM_KINDS)[number]> = true;
const trustStaysCanonical: Equal<Trust, (typeof TRUST_LEVELS)[number]> = true;
const visibilityStaysCanonical: Equal<Visibility, (typeof VISIBILITIES)[number]> = true;
const atlasLensesStayComplete: Equal<
  ViewLens,
  "evidence_trace" | "neighborhood" | "conflict_freshness" | "review_queue" | "scope_preview" | "knowledge_release"
> = true;
type MembershipRole = "owner" | "admin" | "member" | "reader";
const createKeyRoleStaysCanonical: Equal<CreateKeyOptions["membership_role"], MembershipRole | undefined> = true;
const createdKeyMembershipStaysCanonical: Equal<
  Pick<CreatedKey, "membership_id" | "membership_role">,
  { membership_id?: string; membership_role?: MembershipRole }
> = true;
const diagnosticsStayCanonical: Equal<SemanticDiagnostic, CoreSemanticDiagnostic> = true;
const responseModesStayCanonical: Equal<
  ReadinessExtractionResponseMode,
  CoreExtractionResponseMode | "custom" | "disabled" | "configured_error"
> = true;

const checks = (state: EnrichmentJobState): ReadinessChecks => ({
  canonical_sql: "ok",
  migrations: "ok",
  signing_secrets: "ok",
  semantic_index: "index_projection_pending",
  extraction: "enabled",
  background_enrichment: "enabled",
  enrichment_jobs: { state },
});
const readinessChecksByJobState: Record<EnrichmentJobState, ReadinessChecks> = {
  configured_error: checks("configured_error"),
  terminal_error: checks("terminal_error"),
  backlog: checks("backlog"),
  idle: checks("idle"),
  disabled: checks("disabled"),
  unavailable: checks("unavailable"),
};
const capabilities: ReadinessCapabilities = {
  version: 1,
  fts: "enabled",
  vector: "enabled",
  embedding: "enabled",
  extraction: "enabled",
  extraction_response_mode: "json_schema",
  background_enrichment: "enabled",
  model: "enabled",
  background_repair: "enabled",
  export_import: "enabled",
};
const readiness: Readiness = {
  ready: true,
  runtime: "type-contract",
  revision: "type-contract",
  schema: { applied: 19, expected: 19, verified: true },
  checks: readinessChecksByJobState.idle,
  capabilities,
};

void [
  claimKindsStayCanonical,
  trustStaysCanonical,
  visibilityStaysCanonical,
  atlasLensesStayComplete,
  createKeyRoleStaysCanonical,
  createdKeyMembershipStaysCanonical,
  diagnosticsStayCanonical,
  responseModesStayCanonical,
  readiness,
];
