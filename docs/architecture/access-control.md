# Scoped canonical access

Titen applies two independent gates before canonical memory enters lookup,
counting, ranking, cursors, conflicts, citations, Atlas traversal, events, or
federation:

1. visibility: organization, same actor for private, or active workspace
   membership for team data;
2. an active additive organization/project/subject grant for the operation.

The shared SQL predicates in `src/core/authorization.ts` are the authority for
reads and event projections. Canonical writes call the same target policy
before persistence. Approval decisions request the `approve` operation. A
missing gate is a non-disclosing `404`; the service never returns a redacted
placeholder or a hidden-derived count.

## Grants and delegation

Grants are append-and-revoke rows with `read`, `write`, `approve`, and `admin`
permissions. Organization grants cover every target in that organization;
project and subject grants cover only their exact target. `admin` permits
delegation and revocation only at the same target, while an organization admin
grant covers child targets. The caller cannot delegate a permission it does not
currently hold. The organization owner is the only record-access bypass;
owner/admin roles still gate governance operations such as approval decisions.

Migration 23 is additive. It records subjects and references already implicit
in canonical rows and backfills one organization grant per active principal.
This keeps upgraded installations compatible until an operator deliberately
revokes or narrows a grant. Canonical evidence is never rewritten or deleted.

## Derived keys

An API key may declare one organization, project (including explicit unscoped
memory), or subject target. Its effective authority is the intersection of:

- the key's scopes and trust ceiling;
- its declared data target;
- the issuing principal's active grants at request time;
- record visibility, lifecycle, and retention.

Revoking the issuer's grant therefore clamps every derived key on its next
request without a background sweep. A direct bootstrap/session principal is
backfilled through the same grant table; raw keys and hashes never appear in
grant rows or diagnostics.

## Operator simulation

The owner-only access simulator evaluates visibility, grant, and final
`read|write|approve` outcomes against a known readable claim or observation. It
does not impersonate the target principal, create a grant, or disclose a record
the operator could not already inspect. Every real route independently repeats
authorization; dashboard capability hiding is presentation only.
