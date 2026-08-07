# Agent-memory landscape, 2026-08-07

**Survey date: 2026-08-07.** **Expires 2026-11-07.** After that date this
document is evidence of what was true in August 2026 and nothing more. The
2026-08-04 survey needed three corrections within three days; a competitor
list without a date is worse than no list.

This survey **supersedes
[2026-08-04-memory-agent-landscape.md](./2026-08-04-memory-agent-landscape.md)**
on the fame roster (which had eight significant holes, including the
most-starred system in the field), on Letta's retrieval surface (the 08-04
claim was wrong and is corrected in §3), and on the claim that scale
degradation is "completely unmeasured by anyone" (now only partly true — BEAM
exists; the precise accounting is §2). The 08-04 survey's Zep, Mem0-footnote,
MemPalace, Honcho, Supermemory, and LangMem findings are confirmed and
sharpened, not contradicted.

Method: ten parallel verification passes against primary sources (GitHub API,
PyPI/npm registries, raw READMEs and LICENSE files, arXiv, vendor docs and
blogs) on 2026-08-07, synthesized with every load-bearing figure carrying its
source. Verification limits are recorded in §3.9 rather than smoothed over.

## 1. Famous agent-memory systems, ranked by fame (stars as primary proxy)

**Δ** = changed since 2026-08-04. **NEW** = famous but absent from the 08-04 survey.

| # | System | Stars (08-07) | One-line status | Since 08-04 |
|---|--------|--------------|-----------------|-------------|
| 1 | **claude-mem** (thedotmack) | 89,944 | The most-starred system in the entire field — Claude Code session memory, fully local (SQLite + Bun), yet publishes **zero** accuracy numbers. | **NEW** — missed entirely by the 08-04 survey despite outranking Mem0. |
| 2 | **Mem0** | 62,754 | Very active; OSS 2.0.17 (Aug 5); headline numbers (LoCoMo 92.5, LongMemEval 94.4) are **platform-only** per a verbatim README footnote — no OSS-SDK numbers exist; OSS v3 implied by a migration-guide link but not shipped. | **Δ** — "Dream" background consolidation launched Aug 4-5 (Merge/Supersede/Synthesize, weekly, **Pro/Enterprise platform-only**, widening the OSS gap); v2.0.16 (Aug 4) fixed a scope-injection bug; v2.0.17 (Aug 5); n8n node relicensed MIT. |
| 3 | **MemPalace** | 58,172 | Active; rigorous, self-retracting recall benchmarking (held-out 98.4% R@5) paired with **zero** published scale/latency data — its own scale-suite README admits "no empirical data on how it behaves at scale"; ongoing impostor-domain problem (mempalace.net poses as "Independent Analysis" — do not cite). | Confirms 08-04's 58k figure (58,047→58,172); no commits in window, only stars + a dependabot branch deletion; README badge 3.7.0 still ahead of real latest release 3.6.0. |
| 4 | **Cognee** | 29,846 | Active self-hosted knowledge-graph engine; best externally-authored BEAM scores (0.79@100K, 0.67@10M — ICLR 2026, default settings). | **NEW** to the survey (repo dates to 2023, not a new entrant). **Δ** — two dev releases in-window (v1.4.1.dev0 Aug 5, dev1 Aug 6). |
| 5 | **Zep / Graphiti** | 29,648 (Graphiti) / 4,812 (zep) | Zep Cloud is closed (proprietary "Context Graph Engine"); getzep/zep is now just examples/harnesses with Community Edition dead in `legacy/`; Graphiti (Apache-2.0, 1.53M PyPI dl/mo) is the real OSS asset and publishes no benchmarks of its own. | Confirms 08-04 "no longer self-hostable." Nothing material in window (CLA-bot commits only). |
| 6 | **Supermemory** | 28,803 | Active; MIT covers only the app/SDK monorepo — the engine ships **binary-only** (server-v0.0.7-rc.2, Jul 22), no engine source anywhere in the org despite docs calling it "open source"; claims #1 on LoCoMo/ConvoMem with **no primary-source scores** for either. | Confirms 08-04 "engine closed." **Δ** — app/docs commits only (Aug 4-7); no engine release. |
| 7 | **OpenViking** (ByteDance/Volcengine) | 28,051 | Self-evolving context database (viking:// virtual filesystem, L0/L1/L2 tiers); AGPL-3.0 core; LoCoMo 80-83% vs 24-57% native baselines. | **NEW** — famous since spring, absent from 08-04 survey. |
| 8 | **agentmemory** (rohitg00) | 26,680 | Tripled from ~8.9k stars since mid-May; claims "#1 based on real-world benchmarks" but its headline LongMemEval-S metrics (R@5 95.2 / R@10 98.6) are exactly the metrics titen's EVALS.md shows are saturated on that corpus. | **NEW** — clean in-window fast riser, missed on 08-04. |
| 9 | **Letta** (ex-MemGPT) | 24,139 | Core repo is now explicitly the **legacy** server (PyPI frozen at 0.16.8 since May); dev moved to letta-code CLI (npm shipping near-daily) + Letta Cloud; classic Docker self-host deprecated in docs; the app-server-deployment repo is a cloud-tethered shim with **no license file**. | **Δ** — letta-code v0.30.5→v0.30.9 automated bumps (Aug 4-7). **Contradicts 08-04 — see §3: a real retrieval surface exists.** |
| 10 | **TencentDB Agent Memory** | 17,143 | 0→17.1k stars in four months; #1 GitHub Trending Jul 8; team-level memory hub (Chat Memory/Skill/LLM-Wiki/Code-Graph); license is Tencent's wrapper over an MIT badge — SPDX NOASSERTION, read before any license gate. | **NEW** — ~5k stars added in early August around v2.0.0; missed on 08-04. |
| 11 | **Memori** (MemoriLabs, ex-GibsonAI) | 15,687 | Repositioned enterprise ("cloud/VPC/on-prem"); LoCoMo 87% @ 721 tokens/query claim; license text Apache-2.0 but GitHub reports NOASSERTION. | No activity in window (last push Jul 31). |
| 12 | **Second-Me** | 15,648 | Frozen ~10 months (last push 2025-09-30); trains a personal model, no benchmarkable store API; product energy moved to closed home.second.me. | No change. |
| 13 | **memU** | 14,267 | Pivoted (v2.0.0-beta) from companion-memory framework to cross-agent "memory harness" CLI; quietly dropped its 92.09% LoCoMo table from the README; license NOASSERTION despite Apache text. | Active pushes in window but no benchmark/engine changes. |
| 14 | **MemOS** (MemTensor) | 10,639 | Active; vendor-authored OmniMemEval harness (LoCoMo 88.83, LongMemEval 89.20, BEAM-10M 56.75); same group released **Metis** memory-foundation-model paper (Jul 2026) — a category threat to external memory layers. | **Δ** — memos-local-plugin v2.0.13 (Aug 5), v2.0.14 (Aug 7) for Hermes Agent/OpenClaw. |
| 15 | **Honcho** (Plastic Labs) | 6,497 | Fully open AGPL-3.0 server (the engine-source counterpoint to Supermemory); best benchmark hygiene in the field (judge/ingestion/config/cost published per number); BEAM curve 0.63@100K→0.406@10M is the only vendor long-horizon degradation curve published with full config. | Confirms 08-04 "AGPL." **Δ** — steady fix/docs merges Aug 4-6 (pgvector docs, podman build, embedding batch size). |
| 16 | **LangMem** | 1,596 (but 721,010 PyPI dl/mo) | Freeze **confirmed**: last release 0.0.30 (2025-10-27); every Jun-Aug 2026 commit is dependabot — yet it still ships 721k downloads/month via transitive LangChain installs. | Confirms 08-04 "frozen" (latest dependabot bump Aug 5). Cite commits+releases for "dead," never downloads. |

### Platform vendors (famous, not star-rankable)

- **OpenAI** — **Assistants API dies 2026-08-26, now 19 days out; no extension as of 08-07** (unchanged since 08-04). Migration: Responses + Conversations. Consumer "Dreaming" memory (Jun 4) is product-only; still the only major platform with **no first-party long-term memory API**.
- **Anthropic** — memory tool (`memory_20250818`) GA, client-side by design (you own storage); published numbers are internal only (+39% agentic search w/ context editing; 84% token cut). A rumored `agent-memory-2026-07-22` beta header is **unverified** (single secondary source, absent from official docs).
- **Google** — Vertex Agent Engine Memory Bank GA (Dec 2025), billed since Jan 2026; retrieve-memories API exists but Google publishes **zero** accuracy numbers.
- **Microsoft** — M365 Copilot Memory GA rollout through Jul 2026; Copilot Studio Memory preview (per-user file folders, 28-day inactivity TTL); Work IQ API preview; **zero** published benchmarks.
- Adjacent: AWS Bedrock AgentCore Memory (GA), Cloudflare Agent Memory (private beta since Apr 2026).

### Below the fame bar but survey-relevant
**deja-vu** (592 stars, HN front page Jul 15) — the closest published competitor to titen's zero-provider lane: 84.9% hit@1 on LongMemEval-S with **no LLM, no embeddings**, and one of the field's only real store-size-relative disclosures (~1.5ms median search on a 1,250-session/3.3GB corpus, index ~2.3% of corpus). **Metis** (101 stars, arXiv 2607.26760) — memory inside frozen-weight model state; famous as a paper. **EverOS** (11,856 stars) — possible survey miss, but coverage is largely self-marketing; unverified depth. **Memobase** (2,833, dormant since Jan), **MemoRAG** (2,263, frozen since Sep 2025).

---

## 2. The open axis: who publishes (a) quality-vs-store-size, (b) latency at 10^5+ items, (c) write-side rot

### (a) Quality vs store size — EXISTS, but thin and never OSS-reproducible

Every instance found:

1. **BEAM** (arXiv 2510.27246, ICLR 2026) — the only agent-memory benchmark with explicit size buckets (128K/500K/1M/10M conversation tokens). Published per-bucket degradation:
   - Mem0: 64.1@1M → 48.6@10M (README, Top-200) — but **platform-only** per its own footnote; blog variant 62@1M → 48.6@10M (config discrepancy unexplained by Mem0).
   - Honcho: 0.630@100K / 0.649@500K / 0.631@1M / **0.406@10M** — fullest config disclosure in the field.
   - Cognee: 0.79@100K → 0.67@10M (externally authored, default settings).
   - MemOS: 56.75@10M (vendor harness).
   - Hindsight: 73.4/71.1/73.9/64.1 across buckets (own blog).
   - LIGHT baseline 35.8→26.6; RAG baseline 32.3→24.9.
   - Caveat: "size" = input-history tokens, **not post-ingestion stored-item count**.
2. **LongMemEval S vs M** (~115K vs ~1.5M tokens) — a 2-point curve; papers consistently show S→M drops.
3. **VectorDBBench streaming cases** — recall/nDCG/p99 at successive insert fill stages, but for **vector databases**, not memory systems.
4. **MINTEval** (arXiv 2605.18565) — accuracy degrades ~27.9% avg as intervening updates increase (degradation vs update count, not raw size).

**What remains open:** every published scale number is a managed-stack or paper number. No self-hosted/OSS configuration has a published quality-vs-store-size curve. None.

### (b) p95 latency at 10^5+ stored items — NO memory system publishes this. Full accounting of near-misses:

- **Mem0 paper** (arXiv 2504.19413): real p50/p95 (search p95 0.200s, total p95 1.44s) — but on LoCoMo-sized stores, orders of magnitude below 10^5 items. Its BEAM p50 (~1.0s flat 1M→10M) is platform-only, no p95, size in tokens not items.
- **HiGMem** (arXiv 2604.18349v2, Table 13): the only paper found reporting retrieval latency at ≥10^5 items (4.8ms at 100K turns; tested up to 1M) — but it is **mean** vector-only latency, not p95, excluding LLM calls.
- **vstash** (2604.15484): 20.9ms **median** at 50K chunks — below threshold.
- **deja-vu**: ~1.5ms median at 1,250+ sessions/3.3GB — median, corpus below 10^5 items.
- **agentmemory**: single p50 (14ms) on its own benchmark, no store-size axis.
- Marketing claims with no methodology: Zep "sub-200ms" + a "p50 unchanged from a thousand graphs to a million" chart (no query mix/graph composition/hardware); Supermemory "~50ms user profiles" and "under 300ms across 100B+ tokens monthly" (monthly volume ≠ store size); Memobase "<100ms" (design claim); MemOS "millisecond-level" (asserted); Memori "no latency" (background augmentation, qualitative).
- **VectorDBBench** is the only harness anywhere publishing p95/p99 at 10^5–10^8 stored items — and it benchmarks vector DBs, not memory systems.

**Verdict: zero memory systems publish tail latency at 10^5+ stored items. The axis is fully open.**

### (c) Write-side rot / junk accumulation — NOBODY publishes it as a benchmark metric. Plainly: none. Closest artifacts:

- **ForgetEval** (arXiv 2606.15903, MIT): deletion **failure** / junk retention on 385 adversarial cases (best 91.7-93.2% at ~36x mutation-latency cost) — junk that won't leave, not junk that accumulates.
- **MINTEval**: read-side interference from accumulated updates — adjacent, not rot.
- **Mem0's own admissions**: Dream launch post (Aug 5) concedes "the median active project carries a few hundred memories that duplicate or contradict other memories" — **qualitative only, no quantified impact**; its 2026-07-31 blog explicitly lists memory write quality, "forgetting, eviction, and consolidation," per-user isolation, and production-scale cross-session continuity as un-benchmarked.
- **"Ground Truth First"** (arXiv 2607.21962): a longitudinal eval instrument for long-horizon rot — an instrument exists in the literature now, but no industry numbers on it.
- MemoryBench (2510.17281), MemGym, LongMemEval-V2: none measure it.

**Summary:** (a) partially closed by BEAM (accuracy only, managed stacks, token-denominated); (b) and (c) fully open. A benchmark publishing (a)+(b)+(c) together, OSS-reproducible, would be first in the field.

---

## 3. Contradictions and corrections to the 2026-08-04 survey

1. **"Letta has no retrieval surface" is WRONG.** `POST /v1/passages/search` (operation_id `search_passages`, verified in `letta/server/rest_api/routers/v1/passages.py`) does scored semantic search with org/agent/archive scoping, tag any/all filters, date ranges, limit ≤100 — drivable independently of the agent loop on a self-hosted instance. The accurate claim: Letta *chooses not to benchmark* its store (its headline LoCoMo 74.0% uses filesystem tools to argue memory stores are unnecessary), and the self-hosted server it exposes is de-facto frozen (0.16.8 since May, Docker image deprecated).
2. **"Whether competitors degrade at scale is completely unmeasured by anyone" is now only PARTLY true** and needs rewording before publication. BEAM per-bucket accuracy degradation is published by Mem0, Cognee, MemOS, Honcho, and Hindsight (see §2a). What survives intact: no latency-vs-store-size, no OSS-config scale numbers, no rot metrics.
3. **"LongMemEval-Pooled" does not exist.** Targeted search (quoted phrase + HF dataset search) found no such variant. If the 08-04 outline references it, remove or re-source. Real variants: oracle / S / M / -cleaned / community 24k / V2 (arXiv 2605.12493).
4. **The survey's fame roster had major holes.** claude-mem (89.9k — now the most-starred system in the field), agentmemory (26.7k), TencentDB Agent Memory (17.1k), OpenViking (28.1k), Cognee (29.8k), MemOS, memU, and Memori were all absent. Two are clean in-window 10k-crossers (TencentDB, agentmemory).
5. **Titen's zero-provider positioning is not unique.** deja-vu claims 84.9% hit@1 on LongMemEval-S with no LLM/no embeddings (vs titen FTS-only recall@1 0.817, FTS+vector 0.883 on the n=60 slice — different n/config, same corpus and class). It deserves a bench lane before quoting the zero-provider position as unique.
6. **The authorization-boundary "only clear lead" claim needs a read-first.** MutMem, "Cryptographically Authorized Mutation in Persistent Agent Memory" (arXiv 2608.02843, 2026-08-03), lands directly on that axis.
7. **Confirmed, with sharpening (not contradictions):** Zep not self-hostable (CE dead in `legacy/`; Graphiti is the OSS piece); MemPalace ~58k (58,172); Supermemory engine closed (binary-only distribution verified via install script + full org-repo enumeration — docs' "open source" claim is unsubstantiated); Honcho AGPL (server; SDKs Apache-2.0); LangMem frozen (with the 721k dl/mo twist); Assistants shutdown 2026-08-26 unchanged, 19 days out.
8. **License traps multiplied.** LoCoMo is CC BY-NC 4.0 (verified LICENSE.txt) yet quoted commercially by Mem0, Zep, Letta, Supermemory, Memori, Memobase, memU — avoiding it remains correct and is now a differentiator. Same SPDX-NOASSERTION pattern as LoCoMo now applies to memU, Memori, TencentDB, and Metis; letta-app-server-deployment has **no license at all**.
9. **Verification limits this pass:** GitHub stargazer-timestamp API now auth-gated (star curves undatable directly); pypistats rate-limited for mem0ai and zep-cloud; openai.com 403'd direct fetch (Dreaming percentages are secondary-source extrapolations from chart visuals); Semantic Scholar rate-limited (MemDelta citation count is search-based, found 0; still no code release).

---

## Sources

**Systems — repos and registries**
- https://github.com/mem0ai/mem0 · https://raw.githubusercontent.com/mem0ai/mem0/main/README.md · https://pypi.org/pypi/mem0ai/json · https://github.com/mem0ai/mem0/releases/tag/v2.0.16 · https://github.com/mem0ai/mem0/releases/tag/v2.0.17
- https://mem0.ai/blog/dream-background-memory-consolidation-for-ai-agents · https://mem0.ai/research · https://mem0.ai/blog/ai-memory-benchmarks-in-2026 · https://github.com/mem0ai/memory-benchmarks · https://raw.githubusercontent.com/mem0ai/memory-benchmarks/main/README.md · https://arxiv.org/html/2504.19413v1 · https://www.prnewswire.com/news-releases/mem0-raises-24m-series-a-to-build-memory-layer-for-ai-agents-302597157.html
- https://github.com/MemPalace/mempalace · https://pypi.org/pypi/mempalace/json · https://github.com/MemPalace/mempalace/blob/main/benchmarks/BENCHMARKS.md · https://github.com/MemPalace/mempalace/blob/main/docs/HISTORY.md · https://github.com/MemPalace/mempalace/blob/main/tests/benchmarks/README.md · https://github.com/MemPalace/mempalace/issues/875 · https://github.com/MemPalace/mempalace/issues/29 · https://github.com/MemPalace/mempalace/discussions/1388 · https://arxiv.org/abs/2604.21284 · https://vectorize.io/articles/mempalace-review · https://pypistats.org/api/packages/mempalace/recent
- https://github.com/getzep/zep · https://github.com/getzep/graphiti · https://github.com/getzep/graphiti/releases/tag/v0.29.3 · https://pypi.org/pypi/graphiti-core/json · https://pypistats.org/api/packages/graphiti-core/recent · https://pypi.org/pypi/zep-cloud/json · https://blog.getzep.com/announcing-a-new-direction-for-zeps-open-source-strategy/ · https://blog.getzep.com/state-of-the-art-agent-memory/ · https://blog.getzep.com/lies-damn-lies-statistics-is-mem0-really-sota-in-agent-memory/ · https://www.getzep.com/platform/context-graph-engine/ · https://arxiv.org/abs/2501.13956 · https://github.com/getzep/zep-papers/issues/5 · https://help.getzep.com/graphiti/getting-started/welcome
- https://github.com/letta-ai/letta · https://github.com/letta-ai/letta-code · https://github.com/letta-ai/letta-app-server-deployment · https://docs.letta.com/guides/selfhosting · https://docs.letta.com/api-reference/agents/passages/list · https://www.letta.com/blog/benchmarking-ai-agent-memory/ · https://www.letta.com/blog/letta-leaderboard/ · https://www.letta.com/blog/context-bench/ · https://www.letta.com/blog/context-bench-skills/ · https://leaderboard.letta.com/ · https://github.com/letta-ai/letta-leaderboard · https://github.com/letta-ai/letta/issues/3115 · https://arxiv.org/abs/2310.08560 · https://pypi.org/pypi/letta/json · https://registry.npmjs.org/@letta-ai/letta-code · https://aws.amazon.com/blogs/database/how-letta-builds-production-ready-ai-agents-with-amazon-aurora-postgresql/
- https://github.com/supermemoryai/supermemory · https://github.com/supermemoryai/supermemory/releases · https://supermemory.ai/install · https://supermemory.ai/research · https://supermemory.ai/docs/self-hosting/local-vs-enterprise · https://supermemory.ai/docs/memorybench/overview · https://api.npmjs.org/downloads/point/last-week/supermemory · https://pypi.org/pypi/supermemory/json
- https://github.com/plastic-labs/honcho · https://honcho.dev/evals/ · https://plasticlabs.ai/blog/research/Benchmarking-Honcho · https://pypi.org/pypi/honcho-ai/json · https://api.npmjs.org/downloads/point/last-week/@honcho-ai/sdk · https://api.github.com/repos/plastic-labs/honcho
- https://github.com/topoteretes/cognee · https://arxiv.org/abs/2505.24478
- https://github.com/langchain-ai/langmem · https://pypi.org/pypi/langmem/json · https://pypistats.org/api/packages/langmem/recent
- https://github.com/memodb-io/memobase · https://raw.githubusercontent.com/memodb-io/memobase/main/docs/experiments/locomo-benchmark/README.md
- https://github.com/qhjqhj00/MemoRAG · https://arxiv.org/abs/2409.05591
- https://github.com/mindverse/Second-Me · https://arxiv.org/abs/2503.08102
- https://github.com/MemTensor/MemOS · https://arxiv.org/abs/2507.03724 · https://github.com/MemTensor/OmniMemEval · https://github.com/MemTensor/Metis · https://arxiv.org/abs/2607.26760 · https://huggingface.co/papers/2607.26760
- https://github.com/NevaMind-AI/memU · https://medium.com/@memU_ai/memu-let-ai-truly-memorize-you-c3e4cef3c0aa
- https://github.com/MemoriLabs/Memori · https://arxiv.org/abs/2603.19935 · https://memorilabs.ai/benchmark
- https://github.com/rohitg00/agentmemory · https://www.coddykit.com/pages/blog-detail?id=512765&slug=persistent-memory-for-ai-agents-why-agentmemory-is-trending-on-github · https://www.producthunt.com/products/agent-memory-dev
- https://github.com/TencentCloud/TencentDB-Agent-Memory · https://trendshift.io/repositories/29310 · https://www.marktechpost.com/2026/05/23/tencent-open-sources-tencentdb-agent-memory-a-4-tier-local-memory-pipeline-for-ai-agents/ · https://www.explainx.ai/blog/tencentdb-agent-memory-v2-team-hub-august-2026
- https://github.com/volcengine/OpenViking · https://ossinsight.io/blog/agent-memory-race-2026 · https://pypi.org/pypi/openviking/json
- https://github.com/thedotmack/claude-mem · https://preuve.ai/blog/ai-memory-systems-statistics-2026
- https://github.com/vshulcz/deja-vu · https://hn.algolia.com/api/v1/search?query=deja-vu%20memory&tags=story
- https://github.com/EverMind-AI/EverOS · https://evermind.ai/blogs/best-open-source-agent-memory-frameworks-2026

**Platform vendors**
- https://developers.openai.com/api/docs/deprecations · https://community.openai.com/t/assistants-api-beta-deprecation-august-26-2026-sunset/1354666 · https://openai.com/index/chatgpt-memory-dreaming/ · https://www.engadget.com/2187811/chatgpt-s-memory-is-getting-better-especially-if-you-re-on-the-free-tier/ · https://www.digitalapplied.com/blog/chatgpt-memory-dreaming-v3-openai-2026-guide · https://learn.microsoft.com/en-us/answers/questions/5571874/openai-assistants-api-will-be-deprecated-in-august
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool · https://claude.com/blog/context-management · https://blog.memoryplugin.com/how-claude-memory-works/ · https://releasebot.io/updates/anthropic/claude-developer-platform
- https://docs.cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/overview · https://docs.cloud.google.com/vertex-ai/generative-ai/docs/release-notes · https://cloud.google.com/blog/products/ai-machine-learning/vertex-ai-memory-bank-in-public-preview · https://blog.google/products-and-platforms/products/gemini/temporary-chats-privacy-controls/ · https://support.google.com/gemini/answer/16598469
- https://learn.microsoft.com/en-us/microsoft-copilot-studio/agents-experience/memory-overview · https://techcommunity.microsoft.com/blog/microsoft365copilotblog/introducing-copilot-memory-a-more-productive-and-personalized-ai-for-the-way-you/4432059 · https://mc.merill.net/message/MC1158329 · https://learn.microsoft.com/en-us/microsoft-365/copilot/copilot-personalization-memory · https://www.microsoft.com/en-us/microsoft-copilot/blog/copilot-studio/new-and-improved-computer-using-agents-a-new-workflows-experience-and-real-time-voice-experiences/

**Benchmarks and evaluation literature**
- https://github.com/xiaowu0162/LongMemEval · https://arxiv.org/abs/2410.10813 · https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned · https://arxiv.org/abs/2605.12493 · https://huggingface.co/datasets/xiaowu0162/longmemeval-v2 · https://xiaowu0162.github.io/long-mem-eval/
- https://github.com/snap-research/locomo · https://raw.githubusercontent.com/snap-research/locomo/main/LICENSE.txt · https://github.com/dial481/locomo-audit
- https://github.com/mohammadtavakoli78/BEAM · https://arxiv.org/abs/2510.27246 · https://hindsight.vectorize.io/blog/2026/04/02/beam-sota
- https://arxiv.org/abs/2606.29914 · https://arxiv.org/abs/2606.29914v1 (MemDelta)
- https://github.com/zilliztech/VectorDBBench · https://raw.githubusercontent.com/zilliztech/VectorDBBench/main/vectordb_bench/metric.py · https://pypi.org/pypi/vectordb-bench/json
- https://arxiv.org/pdf/2507.05257 · https://arxiv.org/html/2601.21714 · https://arxiv.org/pdf/2606.00619 (HotpotQA-as-memory-eval lineage)
- arXiv papers on the open axes: 2608.02843 (MutMem) · 2606.15903 (ForgetEval) · 2605.18565 (MINTEval) · 2607.21962 (Ground Truth First) · 2604.18349 (HiGMem) · 2604.15484 (vstash) · 2510.17281 (MemoryBench) · 2605.20833 (MemGym) · 2607.27834 (MemTxn) · 2607.23929 (MemTX) · 2607.27773 (ChronoMem) · 2607.27080 (MemSecBench) · 2607.16716 (RECON) · 2607.13157 (Oracle enterprise memory substrate)