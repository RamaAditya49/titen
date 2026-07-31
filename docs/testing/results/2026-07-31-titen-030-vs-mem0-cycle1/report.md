# Titen 0.3.0 versus Mem0 — titen-mem0-cycle1-v1

Run: `bench_ba1df12e15d849088765`
Verdict: **BLOCKED_NOT_READY_TO_REPLACE_MEM0**

## Controlled retrieval

| Product | Recall@1 | Recall@5 | MRR@10 | nDCG@10 | No-result FP | p50 | p95 | p99 | Errors |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Titen | 85.7% | 100.0% | 0.886 | 0.912 | 100.0% | 170.27 ms | 200.678 ms | 307.451 ms | 0 |
| Mem0 | 85.7% | 100.0% | 0.929 | 0.947 | 100.0% | 444.158 ms | 514.114 ms | 721.697 ms | 0 |

## Native memory management

- Titen: unsupported (NO_AUTOMATIC_DERIVATION_OR_REFLECTION_RUNTIME_IN_0_3_0)
- Mem0: ok (INFER_TRUE_CREATED_AND_RETRIEVED_MEMORY)

## Replacement gate

- Titen 0.3.0 has no automatic derivation/reflection runtime.
- Embedding revision equivalence requires separate deployment evidence because neither search API proves it.
- This runner does not prove isolation, recovery, migration, service-resource, or sustained-soak gates.

This cycle measures controlled retrieval only. Safety, recovery, migration, service resource, and sustained-soak gates remain separate evidence.
