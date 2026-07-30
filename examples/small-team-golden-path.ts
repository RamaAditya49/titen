#!/usr/bin/env bun
import { TitenClient, TitenError } from "../src/sdk";

const url = process.env.TITEN_URL;
const keys = {
  researcher: process.env.TITEN_RESEARCHER_KEY,
  writer: process.env.TITEN_WRITER_KEY,
  operator: process.env.TITEN_OPERATOR_KEY,
  reviewer: process.env.TITEN_REVIEWER_KEY,
};

function fail(message: string): never {
  console.error(`golden-path: ${message}`);
  process.exit(1);
}
if (!url) fail("TITEN_URL is required; start a real Titen service first.");
for (const [role, key] of Object.entries(keys))
  if (!key) fail(`TITEN_${role.toUpperCase()}_KEY is required; no synthetic service fallback is used.`);

const client = (key: string | undefined) => new TitenClient({ url, key: key! });
const researcher = client(keys.researcher);
const writer = client(keys.writer);
const operator = client(keys.operator);
const reviewer = client(keys.reviewer);
const subject = process.env.TITEN_SUBJECT_ID ?? `brief-${Date.now()}`;
const workspaceId = process.env.TITEN_WORKSPACE_ID;
if (!workspaceId) fail("TITEN_WORKSPACE_ID is required for team-visible memory.");

try {
  await researcher.health();
  const project = await researcher.resolveProject(process.env.TITEN_PROJECT ?? "github.com/example/research-brief", true);
  const projectId = project.project_id;
  const sourceA = await researcher.observe({ subject_id: subject, workspace_id: workspaceId, project_id: projectId, kind: "imported_source", content: "Measured onboarding completion was 62% in the sampled cohort.", source: { type: "report", ref: "study-a" }, trust: "verified", visibility: "team" });
  const sourceB = await researcher.observe({ subject_id: subject, workspace_id: workspaceId, project_id: projectId, kind: "imported_source", content: "A later sample measured onboarding completion at 71%.", source: { type: "report", ref: "study-b" }, trust: "asserted", visibility: "team" });
  const consolidation = await researcher.consolidate(subject, [
    { kind: "semantic_fact", statement: "Onboarding completion is 62%.", confidence: 0.9, visibility: "team", sources: [{ observation_id: sourceA.observation_id, relation: "supports" }, { observation_id: sourceB.observation_id, relation: "contradicts" }] },
    { kind: "semantic_fact", statement: "Onboarding completion may be 71% in the later sample.", confidence: 0.7, visibility: "team", sources: [{ observation_id: sourceB.observation_id, relation: "supports" }, { observation_id: sourceA.observation_id, relation: "contradicts" }] },
  ], projectId, { workspaceId });
  const context = await writer.compile({ subject_id: subject, project_id: projectId, task: "Draft a brief that states the measured outcome and unresolved disagreement.", max_tokens: 500 });
  const checkpoint = await operator.saveCheckpoint({ subject_id: subject, kind: "workflow", state: { stage: "review", project_id: projectId }, ttl_seconds: 3600, agent_id: "operator" });
  const lease = await operator.acquireLease({ resource_type: "brief", resource_id: subject, purpose: "review handoff", ttl_seconds: 300 });
  const handoff = await operator.createHandoff({ to_principal: "reviewer", subject_id: subject, context_id: context.context_id, checkpoint_id: checkpoint.checkpoint_id, message: "Review the sourced metric conflict before publication." });
  await reviewer.resolveHandoff(handoff.handoff_id, "accepted");
  await reviewer.feedback(context.context_id, { outcome: "useful", reason_code: "sources_and_conflict_visible" });
  const claimIds: string[] = consolidation.claims?.map((claim: { claim_id: string }) => claim.claim_id) ?? [];
  const traces = await Promise.all(claimIds.map((id) => reviewer.evidence(id)));
  const conflict = await reviewer.compileView("conflict_freshness", { subject_id: subject, limit: 20 });
  await operator.releaseLease(lease.lease_id);
  const evidence = traces.map((trace: any, index) => ({
    claim_id: claimIds[index],
    citations: trace.citations ?? trace.sources ?? trace,
  }));
  const conflictNodes = conflict.nodes ?? [];
  const conflictEdges = conflict.edges ?? [];
  if (!claimIds.length || !context.context_id || !checkpoint.checkpoint_id || !handoff.handoff_id)
    fail("the service returned an incomplete golden-path result");
  if (!conflictEdges.some((edge: any) => edge.relation === "contradicts"))
    fail("the subject-scoped conflict view did not preserve a contradiction");
  console.log(JSON.stringify({
    ok: true,
    project_id: projectId,
    subject_id: subject,
    ids: {
      observations: [sourceA.observation_id, sourceB.observation_id],
      claims: claimIds,
      context: context.context_id,
      checkpoint: checkpoint.checkpoint_id,
      lease: lease.lease_id,
      handoff: handoff.handoff_id,
    },
    evidence,
    context_items: context.items,
    conflict_freshness: { nodes: conflictNodes, edges: conflictEdges, metadata: conflict.metadata },
    handoff_status: "accepted",
    feedback_outcome: "useful",
  }, null, 2));
} catch (error) {
  if (error instanceof TitenError) fail(`${error.code} (${error.status}): ${error.message}`);
  fail(error instanceof Error ? error.message : String(error));
}
