---
work_id: titen-dashboard-memory-atlas-v0-2
status: active
stage: plan
outcome: pending
complexity: complex
created: 2026-07-27
updated: 2026-07-27
review_after: 2026-08-10
owner: titen-maintainers
---

# Titen Dashboard v0.2: Memory Atlas operator workspace

## Related contracts

- PRD: FR-11 Memory Atlas observability and FR-12 progressive dashboard
  information architecture;
- FRD: OBS-001 Memory Atlas authorized views and UI-001 progressive dashboard
  information architecture;
- [Product interface design](../../DESIGN.md);
- [ADR-0003](../../decisions/0003-memory-atlas-authorized-projection.md);
- [Memory Atlas architecture](../../architecture/memory-atlas.md);
- [REST view contract](../../reference/api.md#memory-atlas-operation);
- threat model: TM-11, TM-13, and TM-22.

## Problem

The API can explain evidence, relationships, conflicts, and freshness, but an
operator should not need to inspect JSON or open the canonical database to
answer “why did this agent remember this?” The first dashboard must make that
diagnosis legible without becoming a general administration suite, a second
memory engine, or a path around authorization.

## Intended outcome

Ship one optional, read-only `/dashboard/` workspace whose first and only
product area is Memory Atlas. An operator connects to a Titen endpoint, supplies
one exact focus record, selects one v0.2 lens, and inspects the authorized view
through a stable visual overview plus an accessible evidence/detail list.

This slice implements only **Memory > Atlas** from the progressive dashboard
map. Because it is the sole shipped area, it renders directly without a sidebar,
product switcher, locked menu, or placeholder route.

The same static artifact must work with Cloudflare and VPS deployments. The
dashboard is not required for headless REST/MCP and is not proof that the
underlying v0.2 server endpoint has shipped.

## Actors and primary journey

**Actor:** an operator principal whose API key has permission to compile one or
more Memory Atlas lenses. Ordinary agents do not receive the dashboard or an
additional MCP tool.

Primary journey:

1. open the dashboard through an operator/private route;
2. confirm the API origin and enter a scoped credential kept only in tab memory;
3. choose Evidence Trace, Memory Neighborhood, or Conflict & Freshness;
4. enter an authorized focus type and opaque record ID;
5. compile one bounded view;
6. select a node or accessible-list row;
7. inspect provenance, trust, lifecycle, validity, conflict, and truncation or
   degradation state;
8. disconnect, clearing the credential and rendered data.

## In scope

- one same-repository static dashboard artifact with no separate package;
- one `/dashboard/` route and one Memory Atlas workspace;
- direct Atlas rendering with no navigation for future dashboard areas;
- the three v0.2 lenses: `evidence_trace`, `memory_neighborhood`, and
  `conflict_freshness`;
- exact focus input for the record types accepted by
  `POST /v1/memory-views/compile`;
- a native SVG overview synchronized with an HTML evidence/detail list;
- deterministic layouts: layered evidence trace, breadth-layer radial
  neighborhood, and temporal conflict/freshness lanes;
- pan, zoom, reset, node selection, legend, and details inspector;
- loading, empty, error, unauthorized, degraded, truncated, and disconnected
  states;
- desktop and tablet workspace plus a single-column mobile inspection mode;
- local build/tests and optional Cloudflare/VPS static serving instructions.

## Out of scope

- memory creation, editing, deletion, approval, release activation, key
  administration, membership, retention, or backup controls;
- Memories, Context, Work, Audit & Events, System, Access, and Approvals &
  Releases dashboard areas;
- Scope Preview and Knowledge Release lenses before the v0.3 policy gate;
- dashboard overview metrics, global search, recent-memory browsing, or a new
  list/search API;
- persistent login/session exchange, SSO, OAuth, or browser-stored API keys;
- full-tenant constellation, 3D, force simulation, stored layout, WebSocket,
  live polling, time-machine playback, or view export/screenshot sharing;
- React/Next/Vue, a graph renderer, a state library, an icon library, analytics,
  remote fonts, or another runtime dependency unless this spec is revised from
  measured evidence;
- a separate repository, package, hosted control plane, or GitHub Actions.

## Implementation entry gate

This pair may move from `plan` to `implement` only when:

1. the root TypeScript/Bun/pnpm runtime scaffold exists;
2. a deterministic authorized fixture for the view response is frozen;
3. `POST /v1/memory-views/compile` is implemented or its separately tracked
   server work is scheduled in the same release;
4. the server declares effective limits and generic authorization errors;
5. the implementation owner records the supported current Chromium and Firefox
   versions used for local verification.

The visual shell may be developed against the frozen fixture, but this work
cannot be marked done or deployed as functional until the real authorized
endpoint passes the same contract.

## Information architecture

```text
/dashboard/
├── product header: Titen mark, endpoint host, connection state, disconnect
├── query rail: lens, focus type, opaque ID, bounded request controls
├── view workspace
│   ├── SVG overview
│   └── persistent degraded/truncated status
└── inspector
    ├── selected record summary
    ├── trust, lifecycle, validity, visibility
    ├── typed relationships and provenance
    └── synchronized accessible record list
```

No placeholder navigation is rendered for features that do not exist.
The future area map in [DESIGN](../../DESIGN.md) is documentation, not scope for
this implementation pair.

## Interaction and state model

| State         | Required presentation                                                        |
| ------------- | ---------------------------------------------------------------------------- |
| disconnected  | endpoint and password-style key fields; no remote request                    |
| ready         | lens/focus form and an honest empty workspace                                |
| loading       | layout-matched skeleton; duplicate compile disabled                          |
| success       | stable overview, list, legend, details, and response metadata                |
| empty         | explicit “no authorized records in this view”; no decorative fake nodes      |
| unauthorized  | generic denial/not-found message with no target existence or prior-view leak |
| degraded      | persistent capability notice while preserving safe authorized results        |
| truncated     | persistent limit notice with authorized-only counts and effective limits     |
| network/error | inline error and explicit retry; never relabel stale data as current         |

Changing selection is a client-side action and must not recompile the view.
Changing lens, focus, scope, or limits requires an explicit compile action.

## Visual and accessibility contract

- Follow the canonical brand guide: Gading background, Ink text, Soga as the
  single interactive/attention accent, and Wedel only for runtime information.
- Use Instrument Sans/system sans for interface text and JetBrains Mono/system
  monospace for opaque IDs, timestamps, and measurements; load no remote font.
- Use a desktop grid with the overview taking roughly two-thirds and the
  inspector one-third; below 768 px, collapse to one column with the accessible
  list before optional graph exploration.
- Prefer thin rules, grouping, and negative space over nested cards. The graph
  and inspector are the only elevated hierarchy.
- Encode record type with shape plus label, lifecycle with icon/text plus line
  style, and trust/visibility with separate labeled channels. Color alone never
  conveys meaning.
- Use restrained transform/opacity transitions only. No perpetual motion,
  physics simulation, flashing, custom cursor, glow, or relayout on selection.
- Provide visible focus, logical tab order, keyboard-operable controls, an HTML
  representation of every visible node/edge, and a text summary of the selected
  graph relationship.
- Honor `prefers-reduced-motion`, 200% zoom, high-contrast/forced-colors mode,
  and WCAG 2.2 AA contrast and target-size requirements.

## Technical boundary

The smallest implementation is browser-native TypeScript, HTML, CSS, and SVG.
It uses the root build rather than its own package and produces one static
`dist/dashboard/` artifact.

Planned source boundary:

```text
dashboard/
├── index.html
├── dashboard.ts     # state, API client, rendering, interaction
├── layout.ts        # pure deterministic coordinates for the three lenses
└── dashboard.css
```

Do not split files further until size or test boundaries require it. Layout is
deterministic and bounded; the client does not run a force engine or trust
server-provided coordinates. The browser calls only the authenticated REST
endpoint and never imports Titen SQL, D1, SQLite, vector, model, or runtime
bindings.

The API base defaults to same-origin. A custom origin is accepted only after an
explicit connect action and must be HTTPS, except loopback HTTP for local
development. Separately hosted deployments require an explicit CORS and CSP
allowlist; wildcard credentialed access is prohibited.

## Credential and privacy rules

- The API key lives only in a module-scoped in-memory connection object and is
  cleared on disconnect, page unload, or authentication failure.
- Never write credentials, focus IDs, response content, or view data to URL
  parameters/fragments, local/session storage, IndexedDB, service workers,
  analytics, console output, or error-reporting services.
- Use a password-style credential field with paste support and no value echo.
- Clear the previous view before a new focus compile and immediately on
  disconnect or authentication failure.
- Send `Cache-Control: no-store` for view responses and configure
  `Referrer-Policy: no-referrer`; the dashboard must use no third-party assets.
- A malformed or oversized response fails closed before layout work. The UI
  must not display raw hidden payload fragments in an error.

## Performance and resource budgets

- Initial dashboard JavaScript plus CSS must remain at or below 150 KiB gzip,
  excluding the existing logo SVG and optional locally served font files.
- The reference fixture contains 200 authorized nodes and 400 authorized edges.
- After fixture JSON is available, the first complete interactive view must
  render within 1,000 ms in the documented reference Chromium environment.
- During a scripted five-second pan/zoom interaction at the reference fixture,
  browser frame duration p95 must remain at or below 32 ms.
- Layout work is deterministic `O(nodes + edges)` for the accepted response and
  stops before rendering when the declared client cap is exceeded.
- No model, embedding request, graph database, WebGL, background timer, polling,
  or persistent cache is required by the dashboard.

These are dashboard-client budgets, not claims about server view compilation.
Measured commands, browser versions, machine details, and raw samples must be
recorded before the work closes.

## EARS acceptance criteria

- **AC-DASH-001 — Ubiquitous:** Titen shall ship the dashboard as an optional read-only static integration in the same repository, with no dashboard or renderer dependency in the memory kernel and no seventh ordinary-agent MCP tool.
- **AC-DASH-002 — Event-driven:** When an operator opens `/dashboard/`, Titen shall present a disconnected connection form and shall make no authenticated remote request until the operator explicitly connects.
- **AC-DASH-003 — Ubiquitous:** Titen shall keep API credentials, focus IDs, and returned view data out of URLs, browser storage, service workers, analytics, console logs, and third-party requests.
- **AC-DASH-004 — Unwanted behavior:** If authentication fails or the focus resource is unauthorized or foreign, then Titen shall clear any prior view and shall present one generic denial state without disclosing the resource's existence, topology, labels, or counts.
- **AC-DASH-005 — Event-driven:** When an authorized operator compiles a supported v0.2 lens, Titen shall issue one bounded `POST /v1/memory-views/compile` request and shall render only the nodes, edges, labels, provenance, and metadata returned by that authorized response.
- **AC-DASH-006 — State-driven:** While a view request is pending, Titen shall show a layout-matched loading state, shall disable duplicate compilation, and shall keep stale results from appearing current.
- **AC-DASH-007 — Unwanted behavior:** If an authorized view is empty, then Titen shall render an explicit empty state without fabricating example nodes, relationships, metrics, or evidence.
- **AC-DASH-008 — State-driven:** While a response is degraded or truncated, Titen shall keep a persistent labeled notice visible and shall describe only authorized-result limits and capabilities.
- **AC-DASH-009 — Event-driven:** When an operator selects a visible node or relationship, Titen shall preserve the overview layout and shall update a synchronized inspector and accessible HTML representation without another server request.
- **AC-DASH-010 — Optional feature:** Where the viewport is narrower than 768 CSS pixels, Titen shall provide a single-column inspection flow with no horizontal page overflow and shall keep every visible relationship available in the HTML list.
- **AC-DASH-011 — Optional feature:** Where reduced motion or forced colors are enabled, Titen shall remove nonessential motion and shall preserve focus, labels, relationships, lifecycle, trust, and selection meaning without relying on color alone.
- **AC-DASH-012 — Unwanted behavior:** If a response is malformed or exceeds the declared client node, edge, label, or byte cap, then Titen shall stop before unbounded layout work and shall render a bounded generic error without raw payload disclosure.
- **AC-DASH-013 — Event-driven:** When the reference 200-node and 400-edge fixture is available, Titen shall render the first interactive view within 1,000 ms and shall maintain pan/zoom frame duration p95 at or below 32 ms in the documented reference Chromium environment.
- **AC-DASH-014 — Ubiquitous:** Titen shall keep initial dashboard JavaScript plus CSS at or below 150 KiB gzip and shall require no frontend framework, graph renderer, remote font, analytics SDK, or runtime provider SDK.
- **AC-DASH-015 — Optional feature:** Where dashboard hosting is enabled on Cloudflare or VPS, Titen shall serve the same built static artifact behind the configured operator ingress while preserving identical authenticated REST behavior and complete headless operation when hosting is disabled.
- **AC-DASH-016 — Event-driven:** When an operator disconnects, closes the page, or receives an authentication failure, Titen shall clear the in-memory credential and all rendered private view data without mutating canonical memory.
- **AC-DASH-017 — Optional feature:** Where this first v0.2 dashboard slice is the only shipped area, Titen shall render Memory Atlas directly and shall expose no navigation, route, lock, disabled control, upgrade badge, or placeholder for a future dashboard area.

## Risks and mitigations

| Risk                               | Mitigation                                                                    |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| visual topology leaks hidden state | render only the authorized response; generic auth errors; no client inference |
| graph becomes visually noisy       | three task-specific deterministic layouts and an HTML list, not constellation |
| credential leaks from browser      | memory-only token, no URL/storage/logs/third-party requests                   |
| SVG stalls on a large response     | client cap, linear layouts, pre-layout validation, measured fixture           |
| accessibility depends on SVG       | synchronized semantic HTML list and inspector                                 |
| frontend expands into admin suite  | DESIGN emergence gate, direct Atlas rendering, and no future-area navigation  |
| Cloudflare/VPS behavior drifts     | one artifact and the same REST contract; hosting adapters only                |

## Done conditions

- every AC-DASH criterion has reproducible evidence mapped in the paired plan;
- the real server contract, not only a mock, passes authentication, foreign-ID,
  degraded, truncated, empty, and disconnect cases;
- keyboard, reduced-motion, forced-colors, 200% zoom, and mobile checks pass;
- bundle and performance budgets include raw measurements and environment data;
- the same artifact passes Cloudflare and VPS smoke when those hosts are in the
  release scope, or hosting remains explicitly disabled with headless smoke;
- documentation and rollback instructions match implemented behavior;
- no GitHub Action is enabled;
- spec and plan move together to `done/` only after implementation evidence is
  complete.
