# Agent-memory landscape, 2026-08-04

**Survey date: 2026-08-04. Re-verified: 2026-08-05.**
**Expires 2026-11-04.** After that date this document is evidence of what was
true in August 2026 and nothing more — do not cite it in launch material without
re-running the checks below. That expiry is not boilerplate: between April and
August 2026 one competitor stopped shipping a self-hostable server, another was
created from nothing and passed 58,000 stars, and an independent audit landed
that changes how every published number in this field should be read. A
competitor list without a date is worse than no list.

This note exists so a launch can cite something. Every claim below carries a URL
or a command that reproduces it. Where a check contradicted what we believed
going in, the contradiction is recorded rather than smoothed over — including
where it goes against Titen.

## How to re-verify

Repository facts:

```bash
gh api repos/getzep/zep        --jq '{description, license: .license.spdx_id}'
gh api repos/MemPalace/mempalace --jq '{license: .license.spdx_id, created_at, stars: .stargazers_count}'
gh api repos/plastic-labs/honcho --jq '.license.spdx_id'
gh api repos/letta-ai/letta-app-server-deployment --jq '.license'
curl -s https://pypi.org/pypi/mempalace/json | jq -r '.info.version, .info.requires_dist[]'
```

License facts — **read the file, not the SPDX field**:

```bash
gh api repos/snap-research/locomo --jq .license.spdx_id            # NOASSERTION
gh api repos/snap-research/locomo/contents/LICENSE.txt \
  -H "Accept: application/vnd.github.raw" | head -1                # CC BY-NC 4.0
```

`NOASSERTION` means **unknown, not permissive**. An SPDX-based license gate
passes LoCoMo; the restriction is only visible in the file. See
[`docs/testing/EVALS.md`](../testing/EVALS.md#third-party-references-and-licenses).

Our own measurements: `~/titen-bench-20260804/results/*.json` on `benchmark-host`, one
shared scorer, failures kept in the denominator.

## Zep is no longer self-hostable

This is the single most likely thing to be wrong in an old internal list.

- `getzep/zep`'s description is now **"Zep | Examples, Integrations, & More"**.
- Its README states: *"Zep Community Edition is no longer supported. Its code has
  been moved to the [`legacy/`](legacy/) folder."* The repository's own component
  table lists `legacy/` as **"Deprecated Zep Community Edition (unsupported)"**.
- `legacy/` is where the server lives: `Dockerfile.ce`, `docker-compose.ce.yaml`,
  `zep.yaml`, `go.work`.
- The repository is still Apache-2.0, and that badge is what misleads. The
  licence covers examples, integrations, an eval harness, and unsupported legacy
  code. **It does not cover a maintained self-hostable server, because there
  isn't one.**

**[Graphiti](https://github.com/getzep/graphiti)** (Apache-2.0, 29,557 stars) is
the part of that stack still open and still developed. Compare against Graphiti,
not against "Zep". Graphiti's bitemporal edge model remains ahead of Titen's
validity windows; see strategic debt item 4 in `PONYTAIL-DEBT.md`.

Do not write "Zep is a self-hostable competitor". It was true; it is not.

## Mem0's headline numbers are platform-only, by their own README

Mem0's README reports **LoCoMo 92.5** and **LongMemEval 94.4**. Immediately
below the table, verbatim:

> All benchmarks run on the same production-representative model stack.
> Single-pass retrieval (one call, no agentic loops) at a top_200 retrieval
> budget. Scores reflect Mem0's managed platform, which includes proprietary
> optimizations not available in the open-source SDK; open-source users should
> expect directionally similar gains but not identical numbers.

Two rules follow, and they are not optional:

1. **Always write "Mem0 OSS 2.0.x", never bare "Mem0".** The open-source SDK and
   the managed platform are different products with different numbers.
2. **Quote the concession ourselves.** It is in their README. If we omit it and
   someone else surfaces it, we look like we were hiding it; if we quote it, we
   are simply reading the documentation.

Note also what a plain `pip install mem0ai==2.0.15` actually gives you: the
sparse/BM25 half of Mem0 2.0.x hybrid search is **off**, because `fastembed` is
not a base dependency. Any OSS Mem0 measurement — ours included — is of that
configuration unless stated otherwise.

## MemPalace is real, large, and was missing from every internal list

[`MemPalace/mempalace`](https://github.com/MemPalace/mempalace):

| Fact | Value |
| --- | --- |
| License | MIT |
| Created | 2026-04-05 |
| Stars | 58,047 (2026-08-04) → 58,068 (2026-08-05) |
| PyPI | `mempalace` 3.6.0 |
| LLM dependency | **none** — no `openai`, no `anthropic` in `requires_dist` |

Its runtime dependency set is `chromadb`, `huggingface-hub`, `numpy`,
`python-dateutil`, `pyyaml`, `tokenizers`. No API key, no model provider, no
server process, one `pip install`.

That is the same pitch as Titen's low-operational-floor claim, from a project
four months old with more stars than Mem0 had at the same age. Treat it as the
direct competitor on that axis. It measures well too — see below, where its
plain vector mode beat its own reranked mode and beat our FTS-only lane.

The star delta over one day is left in the table deliberately: it is the
cheapest available evidence that this field's numbers decay.

## The independent audit: MemDelta

**[arXiv:2606.29914v1](https://arxiv.org/abs/2606.29914)**, *MemDelta: Controlled
Baselines and Hidden Confounds in Agent Memory Evaluation*, Kuan Wang,
submitted 2026-06-29 (cs.CL, cs.LG).

This is the most important citation in the space and it should be ours before it
is anyone else's. From the abstract, verbatim:

> on 2 of 6 question types (n = 88), Mem0 matches cloud RAG (72.7% vs. 73.9%,
> p = 1.0) at 50x the cost, suggesting narrow rather than general gains

and:

> swapping only the embedding model in an identical pipeline shifts accuracy by
> +6.2pp at n = 500 (p = 0.004), and Mem0 beats MiniLM-RAG by +11pp but loses to
> cloud-RAG by 1.2pp, so one variable flips the conclusion

The paper's introduction states the conclusion plainly: *"The apparent '+11pp
memory gain' was not a property of the memory architecture. It was an embedding
confound."* Its §4.4 write-path table puts verbatim RAG at ~60 s ingest, 0 LLM
calls, ~$0.01, against Mem0 at ~120 min, 1,000+ LLM calls, ~$0.50+.

Precision matters when citing this: the 72.7 / 73.9 comparison is over **2 of 6
question types, n = 88** — not all of LongMemEval-S. Overstating it is the same
error the paper is about.

### Our run reproduces the direction, and it is not flattering to Titen either

2026-08-04, `benchmark-host`, LongMemEval-S, the same 60 instances for every lane
(10 per question type, deterministically stratified), one shared scorer, zero
failures anywhere. Session retrieval against `answer_session_ids`.

| Lane, matched n=60 | recall@1 | MRR@10 | LLM calls | embed calls | ingest |
| --- | ---: | ---: | ---: | ---: | ---: |
| Titen 0.6.0, FTS+vector | 0.883 | 0.934 | 0 | 595 | 57.7 s |
| MemPalace 3.6.0, vector | 0.867 | 0.921 | 0 | — | 6,065.8 s |
| verbatim-RAG control | 0.850 | 0.899 | 0 | 122 | 173.9 s |
| **Mem0 OSS 2.0.15** | **0.833** | 0.888 | **2,981** | 5,883 | **288,020.8 s** |
| Titen 0.6.0, FTS-only | 0.817 | 0.862 | 0 | 0 | 47.5 s |

Paired sign tests on recall@1 over those 60 instances:

| Comparison | W/L/T | two-sided p |
| --- | ---: | ---: |
| Titen FTS+vector vs Mem0 OSS | 5/2/53 | 0.453 |
| verbatim-RAG control vs Mem0 OSS | 4/3/53 | 1.000 |
| Titen FTS-only vs Mem0 OSS | 3/4/53 | 1.000 |
| Titen FTS+vector vs verbatim-RAG control | 3/1/56 | 0.625 |

**Read this honestly.** No lane separates from Mem0 on accuracy — not one
p-value is close to significant. Titen's zero-provider FTS-only lane scores
**below** Mem0 on this subsample (0.817 against 0.833), and Titen's best lane
needs an embedding provider to get above it. On accuracy, the correct claim is
*parity, unmeasurable difference*, and nothing stronger.

The **cost axis** is where the separation is real and it is enormous. Mem0 spent
2,981 LLM calls and 288,021 s of summed worker ingest time — 80 hours across 60
workers, 1.6 h wall-clock — to land *between* Titen's two lanes and below a
~100-line verbatim-RAG control that spent 122 embedding calls and 174 seconds.
Extraction bought no measurable retrieval advantage at roughly 1,600x the ingest
cost of the control. That is MemDelta's finding, reproduced on a different
subsample with a different scorer.

Two caveats that must travel with this table:

- n=60 is small; every p-value above reflects that. The 500-instance run exists
  only for the lanes that could afford it, and Titen's FTS+vector lane is not
  one of them (#266).
- recall@5 and recall@10 are **saturated** on this corpus. Only k=1 and MRR@10
  discriminate. See
  [`EVALS.md`](../testing/EVALS.md#recall10-is-saturated-on-longmemeval-s-k1-and-mrr10-are-the-primary-metrics).

### Correction to earlier internal summaries

`PONYTAIL-DEBT.md` and issue #271 both state that Titen scored **0.883 against
Mem0's 0.833 with zero LLM calls**, implying the zero-provider lane won. Checked
against the artifacts: 0.883 is the **FTS+vector** lane, which uses 595
embedding calls. The zero-provider FTS-only lane scored **0.817**, below Mem0.
The debt ledger's sign test ("2 wins, 5 losses, 53 ties, p = 0.45") also does not
match the artifact, which gives **3W/4L/53T, p = 1.0** for FTS-only versus Mem0
and 5W/2L/53T, p = 0.453 for FTS+vector. Recomputing every lane from its raw
`.ranked.json` reproduces the stored scores exactly, so the artifacts are
trustworthy and the summaries drifted. Do not requote the ledger's version.

## Not viable to benchmark, and why

Recorded so these are not re-litigated. Each one was checked, not assumed.

| System | Why not | Verification |
| --- | --- | --- |
| **Letta** | No retrieval surface to benchmark. The Agent SDK's documented API is agent-centric — `createAgent`, `createSession`, `send` — with no `search(query)` returning ranked memories. Self-hosting now routes through [`letta-app-server-deployment`](https://github.com/letta-ai/letta-app-server-deployment), which ships a Dockerfile, `docker-compose.yml`, `fly.toml` and `railway.json` and **no licence file at all**. | `gh api repos/letta-ai/letta-app-server-deployment --jq .license` → `null`; `/license` → 404. The main `letta-ai/letta` repo is Apache-2.0 but its README calls itself "the legacy Letta server". |
| **Honcho** | AGPL-3.0, including the network clause. A valid licence, but it imposes obligations incompatible with how we would need to run a comparison lane in a commercial context. | `gh api repos/plastic-labs/honcho --jq .license.spdx_id` → `AGPL-3.0` |
| **Supermemory** | No engine source. The repository (MIT, 28,779 stars) ships SDKs, plugins, browser/Raycast extensions, an MCP app, docs, and `@supermemory/memory-graph` — a *"graph visualization component"*. The engine itself arrives as a prebuilt binary via `curl https://supermemory.ai/install \| bash`. Their README is candid: *"We are a research lab building the engine, plugins and tools around it."* | Inspect `packages/` and `apps/`; read `packages/memory-graph/package.json`. |
| **LangMem** | Effectively frozen. Last PyPI release **0.0.30 on 2025-10-27**; every repository commit since at least 2026-06-23 is a Dependabot bump; 59 open issues; not archived, but no feature work in ~9 months. | `curl -s https://pypi.org/pypi/langmem/json \| jq '.info.version'`; `gh api repos/langchain-ai/langmem/commits` |
| **OpenAI Assistants** | Shut down **2026-08-26** — three weeks after this survey. Benchmarking it would produce a number that expires before it could be published. | [OpenAI deprecations](https://developers.openai.com/api/docs/deprecations) |

Two corrections to the assumptions this survey started from:

- LangMem was believed to be stale because *"its last release predates the
  LangChain 1.x line"*. **That is false.** LangChain 1.0.0 shipped 2025-10-17 and
  LangMem 0.0.30 shipped 2025-10-27, ten days later. The freeze is real, but the
  reason is the nine-month release gap and the all-Dependabot commit log, not the
  ordering against LangChain 1.x. LangMem 0.0.30 does still pin
  `langchain>=0.3.15`, i.e. it was built against the 0.3 line and never moved.
- The claim that LangMem's *"read and write paths disagree"* **was not
  verified** and is not asserted here. If it is needed for positioning, someone
  must reproduce it first.

## What this supports, and what it does not

Supported by the evidence above:

- Titen's operational floor — no LLM, no embedding provider, no external service
  — is a genuinely differentiated position, but **MemPalace occupies the same
  ground** with a larger community and a Python-native install.
- Extraction-based memory has not demonstrated a retrieval advantage over
  embedding raw sessions, in an independent audit or in our own run. That is a
  claim about the category, not about Titen.
- Coordination primitives (leases, handoffs, checkpoints) inside the memory's
  authorization boundary remain unmatched by everything surveyed. This is the
  only axis where Titen leads rather than matches.

**Not** supported, and not to be claimed:

- that Titen beats Mem0, MemPalace, or a verbatim-RAG baseline on retrieval
  accuracy — no comparison reached significance, and the zero-provider lane lost
  to Mem0 on the matched subsample;
- any LongMemEval-S recall@5 or recall@10 figure without the saturation caveat;
- that Zep is a beaten competitor. It exited the self-hosted category on its own;
  we did not displace it.

## Sources

- [getzep/zep](https://github.com/getzep/zep) · [getzep/graphiti](https://github.com/getzep/graphiti)
- [mem0ai/mem0](https://github.com/mem0ai/mem0)
- [MemPalace/mempalace](https://github.com/MemPalace/mempalace) · [`mempalace` on PyPI](https://pypi.org/project/mempalace/)
- [MemDelta, arXiv:2606.29914](https://arxiv.org/abs/2606.29914)
- [letta-ai/letta](https://github.com/letta-ai/letta) · [letta-app-server-deployment](https://github.com/letta-ai/letta-app-server-deployment)
- [plastic-labs/honcho](https://github.com/plastic-labs/honcho)
- [supermemoryai/supermemory](https://github.com/supermemoryai/supermemory)
- [langchain-ai/langmem](https://github.com/langchain-ai/langmem)
- [OpenAI API deprecations](https://developers.openai.com/api/docs/deprecations)
- [LongMemEval](https://github.com/xiaowu0162/LongMemEval) (MIT) · [LoCoMo](https://github.com/snap-research/locomo) (CC BY-NC, not used)
- Prior internal note: [`competitive-landscape.md`](./competitive-landscape.md), 2026-07-26 — superseded on Zep and Mem0 by this document.
