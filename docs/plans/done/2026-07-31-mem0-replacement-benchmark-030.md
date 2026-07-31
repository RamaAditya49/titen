---
work_id: mem0-replacement-benchmark-030
status: done
stage: done
outcome: cancelled
complexity: complex
created: 2026-07-31
updated: 2026-07-31
owner: CADIS
spec: docs/specs/done/2026-07-31-mem0-replacement-benchmark-030.md
---
# Plan

- [x] Freeze release/package/server provenance and audit current Mem0/Titen
  capability boundaries. (AC-MRB-001, AC-MRB-004)
- [x] Build a versioned synthetic corpus, scorer, randomized trial manifest, and
  equivalent model/hardware configuration. (AC-MRB-005, AC-MRB-006, AC-MRB-007,
  AC-MRB-008, AC-MRB-011, AC-MRB-012)
- [x] Install Titen 0.3.0 as an isolated loopback-only sidecar with real
  `embeddinggemma`, explicit backup, rollback, and smoke. (AC-MRB-002,
  AC-MRB-003, AC-MRB-009, AC-MRB-010)
- [ ] Run end-to-end memory, equivalent-fact retrieval, adversarial isolation,
  dependency failure, restart, backup/restore, performance, and resource trials
  against both systems. (AC-MRB-003, AC-MRB-005 through AC-MRB-012)
- [x] Deduplicate and file evidence-backed issues for every confirmed failure or
  missing replacement gate. (AC-MRB-004, AC-MRB-013)
- [ ] Repeat focused trials after safe configuration corrections until results
  are stable; do not patch product defects under this benchmark work item.
  (AC-MRB-005, AC-MRB-009, AC-MRB-011, AC-MRB-012)
- [x] Run the embedding-only scale-S calibration lane at 10,000 statements and
  600 stable-hash-split queries, then retain the sanitized locked-holdout
  result and checksums. (AC-MRB-016)
- [x] Run one full challenger with EmbeddingGemma's documented asymmetric
  document/query retrieval prefixes and compare it with the immutable raw-input
  baseline. (AC-MRB-017)
- [x] Freeze and run a disjoint second 10,000-statement/600-query validation
  fixture against the already selected `embeddinggemma-retrieval-v1` profile
  and `0.737307171` threshold, with no recalibration on the new fixture and no
  claim of a universal default without revision attestation. (AC-MRB-019)
- [x] Run the exact enrichment prompt/schema against the locked 72-case corpus
  for five repeats, first preserving provider `json_schema` compatibility
  evidence and then evaluating only a predeclared fingerprinted compatibility
  mode when needed. (AC-MRB-018)
- [x] Run Luna through the unchanged 72-case, five-repeat `json_object` lane and
  treat its later, non-interleaved window only as an absolute gate. (AC-MRB-018)
- [x] Run the read-only Ponytail debt ledger and publish the replacement verdict,
  preserving every unmet cutover gate in the terminal record. (AC-MRB-014,
  AC-MRB-015)

## Evidence mapping

- AC-MRB-001: npm metadata/tarball, peeled tag, runtime manifests, configuration
  fingerprints, artifact checksums.
- AC-MRB-002: pre/post Mem0 state, exact isolated paths/port/service/user, local
  denial/public denial, rollback proof.
- AC-MRB-003: readiness, real vector dimensions, semantic retrieval, injected
  outage and FTS fallback.
- AC-MRB-004: source/package inspection, runtime request trace, issue URL.
- AC-MRB-005: corpus and trial manifest with equivalent-condition validator.
- AC-MRB-006: language-neutral proposition and lifecycle scorer outputs.
- AC-MRB-007: raw ranked candidate lists and retrieval metric report.
- AC-MRB-008: cross-scope/prompt-injection fixtures and unchanged row counts.
- AC-MRB-009: dependency failure/recovery traces, job/outbox state, duplicate
  count.
- AC-MRB-010: backup, disposable restore, integrity, recall, RPO/RTO record.
- AC-MRB-011: ten-plus raw trials with confidence intervals and host telemetry.
- AC-MRB-012: machine-evaluated gate summary with no hidden failed metric.
- AC-MRB-013: existing-issue search and created/reused issue URLs.
- AC-MRB-014: fresh Ponytail marker ledger and no-trigger count.
- AC-MRB-015: unchanged Mem0 production service and explicit blocked/ready state.
- AC-MRB-016: versioned generator/scorer self-test, live smoke, scale-S raw
  ranked-ID trials, threshold-selection record, holdout subgroup/Wilson report,
  disposable-vector cleanup proof, model fingerprint, and artifact checksums.
- AC-MRB-017: preprocessing-profile ID/templates/hash in the manifest plus one
  full checksummed challenger report against the unchanged fixture/split.
- AC-MRB-018: checksummed fixture/runner/manifest, immutable response-mode
  smokes, 360 no-retry trials for every full candidate, hard-gate summary,
  per-language/kind/safety metrics, repeat stability, latency, and an artifact
  preflight forbidden-content scan; scorer mutation checks cover negation,
  substring collisions, and unsupported timestamps under the production
  adapter's 30-second default timeout; provider-visible IDs are opaque; paired
  Sol/Terra outcomes use concept-clustered inference with the locked two-point
  margin; revision attestation and token-usage coverage are reported; lexical
  contract scores remain separate from unmeasured adjudicated semantic quality.
- AC-MRB-019: predeclared disjoint fixture version/salt, fixed selected
  profile/threshold, runner self-test, 10,000/600 manifest, sanitized validation
  report, subgroup/no-result metrics, model and endpoint fingerprints, artifact
  checksums, and a scan proving no raw text, embeddings, endpoint, or credential
  entered the retained artifacts.

Cycle-1 evidence is indexed by the
[replacement report](../../testing/2026-07-31-mem0-replacement-cycle1.md) and
its [checksummed raw artifacts](../../testing/results/2026-07-31-titen-030-vs-mem0-cycle1/).
Cycle-2 evidence is indexed by the
[concurrency, migration, and enrichment-audit report](../../testing/2026-07-31-mem0-replacement-cycle2.md).
It completes the 1/8/32 tiny-corpus matrix, container CPU/memory time series,
and one 20-record disposable direct-migration rehearsal. The unchecked steps
remain intentionally unmet in this terminal record: larger-corpus and exact
RSS/storage/cost evidence, product-native LLM management, production-shaped
bulk/delta migration, real
Cloudflare and local-computer smokes, sustained shadow soak, and final
replacement verdict.

The [S-calibration-v1 smoke report](../../testing/2026-07-31-embedding-s-calibration-v1-smoke.md)
records the live 600-statement/60-query harness check and sanitized artifacts.
The subsequent [full scale report](../../testing/2026-07-31-embedding-s-calibration-v1-full.md)
records the completed 10,000-statement/600-query lane. Its zero holdout
no-result false positives came with 82.08% Recall@5 overall and 5% Recall@5 in
the weakest cross-language stratum, so it closes the execution item without
passing the broader replacement-quality gate.

The [EmbeddingGemma retrieval-profile challenger](../../testing/2026-07-31-embeddinggemma-retrieval-profile-challenger.md)
keeps the fixture/split fixed and adds the primary-source document/query
prefixes. Holdout Recall@5 improves to 91.67% with zero no-result false
positives, but English-query/Javanese-in-Indonesian-statement Recall@5 remains
0/20, so the per-direction quality blocker remains open.

The [disjoint S-validation-v2 run](../../testing/2026-07-31-embedding-s-validation-v2-full.md)
then fixes that profile and its `0.737307171` cosine floor before evaluating a
new 10,000-statement/600-query fixture. It repeats 91.67% Recall@5 and zero
no-result false positives without tuning, while the same cross-language
direction remains 0/40 and the provider revision remains unattested. The result
therefore supports this measured deployment but not a bundled universal
threshold or a Mem0 replacement claim.

The dated [cycle-3](../../testing/2026-07-31-mem0-replacement-cycle3.md) and
[cycle-4](../../testing/2026-07-31-mem0-replacement-cycle4.md) reports preserve
the 0.3.0 canary and source-QA snapshots observed during the benchmark. Their
moving branch, issue, and pull-request status is historical rather than a claim
about current `main`.

The frozen Sol/Terra artifacts and the later
[Luna absolute gate](../../testing/2026-07-31-enrichment-model-gate-luna-full.md)
complete the model-evaluation item. No candidate passed the declared lexical
and safety gates; semantic adjudication, immutable revision attestation, and
dual-adapter persistence replay remain unmet. The terminal result is NO-GO,
not a model selection or cutover approval.

## Security, migration, deployment, smoke, and rollback

- Use synthetic tenants/content only; redact credentials and raw provider output
  from logs, artifacts, and issues.
- Capture Mem0 service/container/database hashes and health before and after each
  remote change; never restart it for Titen testing.
- Bind Titen to a distinct loopback port with a distinct service account,
  database, vector database, config, logs, and backup directory.
- Store the Wulan client key only in a root-readable mode-`0600` environment
  file and use server-local 9router endpoints.
- Stop/disable only the Titen sidecar and restore its isolated directory on
  rollback. Production Mem0 paths and DNS are outside this plan.
- A future Mem0 import/cutover requires a separate active spec after this work
  records passing migration and sustained-soak evidence.

## Closure reason

Cancelled with a terminal NO-GO for the evaluated 0.3.0 canary. The two
unchecked execution steps above intentionally preserve the quality, recovery,
resource, deployment, migration, and soak work that did not pass or did not run.
No cutover work is authorized by this record.
