# Security policy

Titen stores agent and user memory, so confidentiality, integrity, provenance,
and scope isolation are core security properties.

The design-level assets, trust boundaries, attack paths, required controls, and
residual risks are maintained in the
[threat model](https://github.com/RamaAditya49/titen/blob/main/docs/security/threat-model.md).

## Reporting a vulnerability

Do not disclose vulnerabilities through public issues, discussions, pull
requests, or example payloads.

Use [GitHub Private Vulnerability Reporting](https://github.com/RamaAditya49/titen/security/advisories/new).
Do not include real credentials or private memory content unless explicitly
requested through a secure channel.

Useful reports include:

- affected component/runtime and revision;
- minimal reproduction with synthetic data;
- security impact and trust boundary crossed;
- whether tenant, subject, visibility, evidence, or audit integrity is affected;
- suggested mitigation if known.

## Security boundaries

- Memory content and model output are untrusted.
- Tenant/organization authority comes from authentication.
- API keys are high entropy, hashed at rest, scoped, labeled, and revocable.
- Human operator passwords use unique salts and versioned PBKDF2-HMAC-SHA-256
  verifiers with 600,000 iterations; submitted passwords are never stored,
  exported, logged, or echoed.
- Bootstrap and Add User reveal a random temporary password once. Its login has
  no product scopes; replacement revokes all dashboard sessions for that
  principal and requires fresh authentication.
- Claims do not become trusted without evidence and policy.
- Verified trust does not permit external disclosure; customer-facing knowledge
  requires an explicit approved release for one channel/audience.
- Vector indexes do not authorize or serve canonical content.
- Memory Atlas is a read-only derived projection; it authorizes before
  traversal, cannot grant access, and must not reveal hidden topology or counts.
- Another agent's private memory is not eligible for retrieval.
- Checkpoints, leases, and handoffs do not become durable facts automatically.
- Federation applies source policy before transmitting an event.
- External customers use an authenticated application gateway and never receive
  a Titen key or direct canonical-memory access.

## Prohibited data handling

Titen must not log or expose:

- API keys, passwords, password verifiers, model tokens, or session credentials;
- raw prompts or private memory content in normal logs;
- embeddings;
- full private identifiers when a short/hash reference is sufficient;
- cross-tenant resource existence.

## Vulnerability classes of special interest

- cross-tenant or cross-visibility retrieval;
- memory poisoning or stored prompt injection;
- unauthorized procedural/organization memory writes;
- unauthorized channel publication, stale release serving, or cross-customer
  CRM/chatbot context leakage;
- evidence mutation or provenance forgery;
- stale vector resurrection after revoke/delete;
- Memory Atlas topology/count leakage, stale-projection disclosure, or Scope
  Preview impersonation/authority escalation;
- lease/checkpoint races causing duplicate destructive work;
- export/import scope bypass;
- federation policy or signature bypass;
- secret leakage through logs, errors, health, backup, or audit export.
- password enumeration, verifier downgrade, login-throttle bypass, or session
  key reuse after logout.

## Supported versions

Before the first tagged release, only the latest `main` revision is supported.
After releases begin, the supported-version table and disclosure response targets
will be added here.
