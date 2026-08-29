# Titen product interface design

- Status: live fifteen-destination operator dashboard implemented
- Scope: optional operator dashboard and progressive information architecture
- Product map: Atlas, Memories, Context, Subjects, Work, Audit & Events,
  System, Models, Federation, Access, API & Keys, Projects, Approvals, Releases,
  Profile
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
2. **Truthful navigation.** Only implemented areas become links, controls, or
   routes. The approved reference shell may show the canonical area map as
   non-interactive orientation, but it cannot style those labels as locked,
   disabled, paid, or shipped capability.
3. **Progressive capability.** Backend release, authorization, and a completed
   EARS UI work item precede an area's conversion from orientation label into a
   discoverable control or route.
4. **Scope before content.** Organization, workspace, project, subject, agent,
   and run authority are resolved before private labels, counts, or records are
   rendered.
5. **Read and change are visibly different.** Read-only diagnosis never shares
   interaction treatment with mutations such as key revocation or release
   approval.
6. **Stable across runtimes.** The same static artifact and REST behavior work
   on Cloudflare and VPS; the browser never imports runtime bindings.
7. **Light by default.** Astro generates static HTML; native CSS, browser
   JavaScript, dialog, and SVG provide the interface. Dependencies require a
   measured accessibility, bundle, typography, test, or maintenance need.
8. **Accessible evidence.** Every visual relationship has a synchronized text
   representation, keyboard path, visible focus, and non-color meaning.

## 3. Progressive information architecture

The operator interface uses fifteen destinations. Each is backed by a current
authenticated REST contract and remains hidden when the principal lacks every
read capability for it.

```text
Titen Dashboard
├── Memory         # Atlas, Memories, Context, Subjects
├── Collaboration  # Work
├── Operations     # Audit & Events, System, Models, Federation
├── Administration # Access, API & Keys, Projects
├── Governance     # Approvals, Releases
└── Operator       # Profile
```

### Area contract

| Area | Operator job | Backing contract |
| --- | --- | --- |
| Atlas | Trace evidence, neighborhoods, conflicts, workspace graph, review work, scope, and release lineage | `POST /v1/memory-views/compile` |
| Memories | Search/filter/page authorized canonical claims without compilation | `GET /v1/memories` |
| Context | Compile one bounded, cited context pack for a subject and task | `POST /v1/context/compile` |
| Subjects / Projects | Inspect authorized identities/scopes and canonical references | directory/reference reads |
| Work | Inspect/release leases, resolve received handoffs, and find an exact checkpoint | collaboration routes |
| Audit | Reconstruct bounded metadata activity and visible domain events | `GET /v1/audit`, `GET /v1/events` |
| System / Models | Inspect readiness and immutable masked model configuration; probe without canonical writes | health/readiness and model diagnostics |
| Federation | Inspect owned signed peers and their bounded exchange log | `GET /v1/federation/peers`, `GET /v1/federation/log` |
| Access / API & Keys | Inspect principals/grants/key clamps, simulate gates, and manage bounded credentials | directory, grant, simulation, and key routes |
| Approvals / Releases | Inspect and perform reasoned, version-fenced governance transitions | policy, approval, and release routes |
| Profile | Inspect the principal and rotate a session password | principal/session routes |

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

Until then, the area has no route or interactive control. The final reference
shell may render its plain label solely to preserve the accepted information
map only when public documentation calls the label non-interactive rather than
shipped.

## 5. Release shape

### Live product map

The implemented Astro dashboard exposes the fifteen live destinations at `/dashboard/` in
one static application shell. Area changes do not create domain authority or
retain a previous principal's result.

Atlas provides live authorized:

- Evidence Trace;
- Memory Neighborhood;
- Conflict & Freshness;
- Review Queue;
- bounded subject or focus input;
- health and readiness state;
- responsive result lists and selected-record inspectors.

The exact implementation contract lives in the
[Astro dashboard spec](./specs/done/2026-07-29-dashboard-final-astro-v0-3.md),
and the operational boundary lives in the [dashboard guide](./dashboard.md).

Every visible record comes from the authorized view compiler through the
same-origin adapter. Credentials remain server-only; disconnected or failed
integration displays no fixture data.

Context compilation changes no canonical memory. Access and API & Keys expose
confirmed grant/key/user mutations; Work exposes lease/handoff transitions;
Approvals and Releases expose reasoned version-fenced lifecycle actions. Every
mutation re-renders server state, and destructive actions require confirmation.

### Collection presentation

Operational data uses one stable hierarchy:

1. The area heading states the operator job.
2. The collection heading states the authorized record count.
3. Task-specific columns expose the fields needed for a decision.
4. Row actions target only the record in that row.
5. Selection opens an inspector in the same area.
6. A closed technical disclosure preserves the authorized response.

The main view never uses generated labels such as `Record 1`. A schema maps
known response collections to stable titles and columns. Unknown collections
use scalar fields as a safe fallback. They use `Item N` only when no identity
field exists.

The inspector does not request hidden data. Projects and Subjects may request
their existing authorized reference routes after selection. All rendered text
uses DOM text nodes. The dashboard does not render response HTML.

## 6. Intentional non-menus

- **Categories and tags** are filters inside Memories or Atlas, not a top-level
  product area. They never alter scope, visibility, trust, or authority.
- **Webhooks** belong inside Audit & Events because they deliver post-commit
  metadata events; they are not a separate memory concept.
- **Export/import, backup, and recovery** belong inside System and remain
  capability- and authority-gated.
- **Runtime configuration** starts as read-only capability/readiness state.
  Browser mutations require a separate secure configuration contract.
- **General settings** remain absent; Profile contains only identity and
  password rotation. The implemented adapter verifies an operator
  account and AES-GCM seals its short-lived server-side key in an opaque cookie;
  only required first-login/current password replacement exists. Recovery and
  profile settings remain separate product work.
- **Overview analytics** do not exist until a named operator job and bounded,
  privacy-safe metric contract justify them.

## 7. Application shell

The final reference shell contains:

- Titen mark and current product area;
- non-secret endpoint/runtime identity and connection state;
- authorized organization/workspace/project scope when the area requires it;
- grouped information architecture where only discoverable shipped areas are
  interactive;
- a logout action that removes the adapter session and clears private data;
- persistent degraded or truncated state where applicable.

Navigation does not determine authorization. Every route and request performs
server-side authorization again, and a foreign resource returns a
non-disclosing response.

On small screens, navigation moves into a labelled off-canvas rail. Content order,
focus order, and labels remain available without horizontal page scrolling;
phone layouts linearize graphs and tables, while wider bounded views may scroll
inside their labelled regions.

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
- Technical payload disclosures stay closed until an operator opens them.
- Mobile tables become linear records without horizontal page scrolling.
- Destructive actions, when separately specified, require explicit target,
  impact, authority, and recovery context.
- The interface supports 200% zoom, reduced motion, forced colors, and WCAG 2.2
  AA contrast and target sizing.

## 10. Privacy and security

- Passwords are verified by the Titen service as salted PBKDF2-HMAC-SHA-256
  verifiers. In session mode the browser submits username/password once over
  loopback or configured HTTPS; the adapter seals the short-lived API key in a
  time-bounded opaque HttpOnly SameSite=Strict cookie. A shared 32-byte sealing
  key is optional for replica/restart continuity; without it restart invalidates
  every session.
- Bootstrap and Add User generate a random temporary password shown once. Until
  it is replaced, the session has no product scopes and the private shell stays
  hidden; replacement revokes every dashboard session for that principal.
- Credentials, private IDs, response content, and view data never enter URLs,
  browser storage, analytics, third-party requests, service workers, or logs.
- Navigation, counts, search suggestions, and empty states must not reveal
  inaccessible resources or entitlements.
- The browser consumes authorized REST responses and never reads SQL, D1,
  SQLite, vector indexes, models, or provider bindings directly.
- Disabling the dashboard changes no canonical data and leaves headless
  REST/MCP behavior complete.
- The frontend persists no browser-readable credential or private result and
  calls only fixed same-origin adapter routes. Logout, or an adapter restart
  without a configured shared sealing key, invalidates sessions.

## 11. Design acceptance

- **AC-DESIGN-001 — State-driven:** While an area lacks an implemented authorized contract or completed UI work item, Titen shall expose no route or interactive control for it and shall present any reference-shell label only as non-interactive orientation.
- **AC-DESIGN-002 — Optional feature:** Where the live dashboard is enabled, Titen shall render only the authenticated principal's discoverable destinations from the fifteen-area product map.
- **AC-DESIGN-003 — Event-driven:** When an area passes its emergence gate, Titen shall convert only that authorized discoverable area from an orientation label into an interactive control and route.
- **AC-DESIGN-004 — Unwanted behavior:** If a principal requests an unauthorized or foreign area or resource, then Titen shall return a non-disclosing state and shall clear any prior private content that could be mistaken for the current result.
- **AC-DESIGN-005 — Ubiquitous:** Titen shall keep categories and tags as memory filters, domain events inside Audit, backup/recovery in deployment tooling, and bounded password rotation inside Profile.
- **AC-DESIGN-007 — Event-driven:** When session mode authenticates a principal, Titen shall discover areas from that principal's scopes and shall clear prior private data on denial, logout, expiry, identity change, or adapter restart without a configured shared sealing key.
- **AC-DESIGN-006 — Optional feature:** Where the dashboard is disabled or omitted, Titen shall preserve complete authorized REST/MCP behavior on Cloudflare and VPS.

These criteria define product design behavior. Each implemented slice must copy
the applicable behavior into its own active EARS work spec and evidence plan.
