# Titen 0.3.0 versus Mem0 — titen-mem0-cycle1-v1

Run: `bench_968cb18b291f4bb89c8b`
Verdict: **BLOCKED_NOT_READY_TO_REPLACE_MEM0**

## Controlled retrieval

| Product | Recall@1 | Recall@5 | MRR@10 | nDCG@10 | No-result FP | p50 | p95 | p99 | Errors |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Titen | 85.7% | 100.0% | 0.886 | 0.912 | 100.0% | 311.754 ms | 441.118 ms | 471.353 ms | 0 |
| Mem0 | 85.7% | 100.0% | 0.929 | 0.947 | 100.0% | 6255.665 ms | 10104.38 ms | 10147.187 ms | 0 |

## Native memory management

- Titen: unsupported (NO_AUTOMATIC_DERIVATION_OR_REFLECTION_RUNTIME_IN_0_3_0)
- Mem0: not_run (OPTIONAL_INFER_TRUE_PROBE_NOT_REQUESTED)

## Replacement gate

- Titen 0.3.0 has no automatic derivation/reflection runtime.
- Embedding revision equivalence requires separate deployment evidence because neither search API proves it.
- This runner does not prove isolation, recovery, migration, service-resource, or sustained-soak gates.

This cycle measures controlled retrieval only. Safety, recovery, migration, service resource, and sustained-soak gates remain separate evidence.
