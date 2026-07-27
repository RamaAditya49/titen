# Titen product interface design

- Status: planned product contract; not implementation evidence
- Scope: optional operator dashboard and progressive information architecture
- First implementation slice: v0.2 Memory Atlas
- Target runtimes: Cloudflare Workers and Bun on a VPS

## 1. Design intent

Titen's interface helps an authorized operator answer three questions:

1. what memory or work state exists;
2. why an agent received or trusted it;
3. what the operator is allowed to inspect or change.

The dashboard is an optional client of Titen's authenticated REST contract. It
does not replace REST/MCP, become canonical storage, run agents, or grant
authority. A headless installation remains a complete Titen installation.

## 2. Product design principles

1. **Evidence before decoration.** Provenance, lifecycle, trust, validity, and
   conflict are more important than decorative graphs or aggregate counters.
2. **Truthful navigation.** The interface exposes only areas that exist and are
   authorized. It does not advertise unavailable features with locks, disabled
   controls, upgrade badges, or empty routes.
3. **Progressive capability.** Backend release, authorization, and a completed
   EARS UI work item precede the appearance of an area in navigation.
4. **Scope before content.** Organization, workspace, project, subject, agent,
   and run authority are resolved before private labels, counts, or records are
   rendered.
5. **Read and change are visibly different.** Read-only diagnosis never shares
   interaction treatment with mutations such as key revocation or release
   approval.
6. **Stable across runtimes.** The same static artifact and REST behavior work
   on Cloudflare and VPS; the browser never imports runtime bindings.
7. **Light by default.** Native HTML, CSS, TypeScript, and SVG are preferred.
   Dependencies require a measured accessibility, bundle, or maintenance need.
8. **Accessible evidence.** Every visual relationship has a synchronized text
   representation, keyboard path, visible focus, and non-color meaning.

## 3. Progressive information architecture

The long-term interface uses five product groups. These are a map of accepted
capabilities, not a promise that every area ships together.

```text
Titen Dashboard
├── Memory
│   ├── Atlas
│   ├── Memories
│   └── Context
├── Collaboration
│   └── Work
├── Operations
│   ├── Audit & Events
│   └── System
├── Administration
│   └── Access
└── Governance
    └── Approvals & Releases
```

### Area contract

| Group          | Area                 | Operator job                                                                      | Backing FRD                     | Earliest backend release |
| -------------- | -------------------- | --------------------------------------------------------------------------------- | ------------------------------- | ------------------------ |
| Memory         | Atlas                | Trace evidence, relationships, conflicts, freshness, scope, and release lineage   | `OBS-001`                       | v0.2                     |
| Memory         | Memories             | Inspect observations, claims, history, lifecycle, tags, and authorized retrieval  | `MEM-001`–`MEM-005`, `RET-001`  | v0.1                     |
| Memory         | Context              | Inspect compiled context, selection reasons, budgets, conflicts, and feedback     | `CTX-001`, `CTX-002`            | P0                       |
| Collaboration  | Work                 | Inspect checkpoints, leases, handoffs, ownership, and resumable progress          | `EXE-001`, `COL-001`–`COL-003`  | v0.2                     |
| Operations     | Audit & Events       | Reconstruct metadata activity and inspect event/webhook delivery                  | `AUD-001`, `EVT-001`            | v0.2                     |
| Operations     | System               | Inspect health, readiness, capabilities, portability, backup, and recovery state  | `FND-002`, `POR-001`, `OPS-001` | v0.1; recovery in v0.3   |
| Administration | Access               | Manage labeled scoped credentials, identities, memberships, and visibility        | `IAM-001`, `IAM-002`, `VIS-001` | v0.2                     |
| Governance     | Approvals & Releases | Review policy decisions, approvals, channels, releases, retention, and legal hold | `GOV-001`–`GOV-003`, `REL-001`  | v0.3                     |

An early backend release does not automatically create a dashboard area. The
area appears only after all emergence gates below pass.

## 4. Area emergence gate

A dashboard area or nested view may render only when:

1. its backing REST behavior is implemented and accepted for the current
   runtime;
2. the current build declares the capability enabled rather than planned;
3. an EARS work spec and paired plan for that UI slice are complete;
4. the authenticated principal may discover and use the area;
5. empty, unauthorized, degraded, and rollback behavior is verified;
6. documentation describes the area as shipped.

Until then, the area is absent. Documentation may describe its planned position
and earliest backend release, but the product must not render a placeholder.

## 5. Release shape

### v0.2 first dashboard slice

The active dashboard implementation exposes only **Memory > Atlas** at
`/dashboard/`. Because only one area exists, it renders directly without a
sidebar, product switcher, or empty navigation group.

Atlas provides:

- Evidence Trace;
- Memory Neighborhood;
- Conflict & Freshness;
- one exact authorized focus;
- a bounded SVG overview synchronized with an accessible evidence/detail list.

The exact implementation contract lives in the
[active Memory Atlas dashboard spec](./specs/active/2026-07-27-dashboard-memory-atlas-v0-2.md).

### Later capability-backed slices

Memories, Context, Work, Audit & Events, System, and Access receive separate UI
work items only after their operator journeys and authorized list/detail
contracts are stable. Governance appears no earlier than v0.3 and must keep
approval authority, release eligibility, retention, and internal visibility
separate.

No release is required to add all eligible areas at once.

## 6. Intentional non-menus

- **Categories and tags** are filters inside Memories or Atlas, not a top-level
  product area. They never alter scope, visibility, trust, or authority.
- **Webhooks** belong inside Audit & Events because they deliver post-commit
  metadata events; they are not a separate memory concept.
- **Export/import, backup, and recovery** belong inside System and remain
  capability- and authority-gated.
- **Runtime configuration** starts as read-only capability/readiness state.
  Browser mutations require a separate secure configuration contract.
- **Settings** do not exist until Titen defines a browser account/session,
  profile, or password lifecycle. API-key authentication alone does not justify
  an account-settings page.
- **Overview analytics** do not exist until a named operator job and bounded,
  privacy-safe metric contract justify them.

## 7. Application shell

When more than one area passes the emergence gate, the smallest useful shell
contains:

- Titen mark and current product area;
- non-secret endpoint/runtime identity and connection state;
- authorized organization/workspace/project scope when the area requires it;
- grouped navigation containing only discoverable shipped areas;
- a disconnect action that clears in-memory credentials and private data;
- persistent degraded or truncated state where applicable.

Navigation does not determine authorization. Every route and request performs
server-side authorization again, and a foreign resource returns a
non-disclosing response.

On small screens, area navigation may collapse behind one native disclosure
control. Content order, focus order, and labels remain available without
horizontal page scrolling.

## 8. Visual system

The interface follows the [brand guide](./BRAND.md):

- Gading is the base surface and Ink is the primary text color;
- Soga is the single interaction and attention accent;
- Wedel is reserved for runtime/system information;
- Instrument Sans or a system sans is used for interface text;
- JetBrains Mono or a system monospace is used for opaque IDs, timestamps, and
  measurements;
- thin rules, negative space, and typographic hierarchy replace nested cards;
- motion is limited to purposeful transform/opacity state changes.

Record type uses shape plus text. Lifecycle uses explicit status and line
treatment. Trust, visibility, and release eligibility remain separate labeled
channels. Color alone never carries meaning.

## 9. Interaction and accessibility

- Every control has a visible name, focus state, and keyboard operation.
- Every graph or relationship view has equivalent structured HTML.
- Loading preserves layout; empty states fabricate no records or metrics.
- Selection changes local detail without relabeling stale data as current.
- Destructive actions, when separately specified, require explicit target,
  impact, authority, and recovery context.
- The interface supports 200% zoom, reduced motion, forced colors, and WCAG 2.2
  AA contrast and target sizing.

## 10. Privacy and security

- Credentials live only in memory for the current tab unless a later session
  contract explicitly replaces this rule.
- Credentials, private IDs, response content, and view data never enter URLs,
  browser storage, analytics, third-party requests, service workers, or logs.
- Navigation, counts, search suggestions, and empty states must not reveal
  inaccessible resources or entitlements.
- The browser consumes authorized REST responses and never reads SQL, D1,
  SQLite, vector indexes, models, or provider bindings directly.
- Disabling the dashboard changes no canonical data and leaves headless
  REST/MCP behavior complete.

## 11. Design acceptance

- **AC-DESIGN-001 — State-driven:** While an area lacks an implemented authorized contract or completed UI work item, Titen shall omit it from dashboard navigation and direct routes.
- **AC-DESIGN-002 — Optional feature:** Where only Memory Atlas is shipped, Titen shall render Atlas directly as the sole dashboard area without placeholder navigation.
- **AC-DESIGN-003 — Event-driven:** When more than one area passes its emergence gate, Titen shall group only discoverable shipped areas under Memory, Collaboration, Operations, Administration, and Governance.
- **AC-DESIGN-004 — Unwanted behavior:** If a principal requests an unauthorized or foreign area or resource, then Titen shall return a non-disclosing state and shall clear any prior private content that could be mistaken for the current result.
- **AC-DESIGN-005 — Ubiquitous:** Titen shall keep categories and tags as filters, webhooks inside Audit & Events, portability and recovery inside System, and account settings absent until their own contracts exist.
- **AC-DESIGN-006 — Optional feature:** Where the dashboard is disabled or omitted, Titen shall preserve complete authorized REST/MCP behavior on Cloudflare and VPS.

These criteria define product design behavior. Each implemented slice must copy
the applicable behavior into its own active EARS work spec and evidence plan.
