# Security policy

Titen stores agent and user memory, so confidentiality, integrity, provenance,
and scope isolation are core security properties.

## Reporting a vulnerability

Do not disclose vulnerabilities through public issues, discussions, pull
requests, or example payloads.

Once the public GitHub repository exists, use GitHub Private Vulnerability
Reporting from the repository Security tab. Before publication, contact the
maintainer through an already established private channel. Do not include real
credentials or private memory content unless explicitly requested through a
secure channel.

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
- Claims do not become trusted without evidence and policy.
- Vector indexes do not authorize or serve canonical content.
- Another agent's private memory is not eligible for retrieval.
- Checkpoints, leases, and handoffs do not become durable facts automatically.
- Federation applies source policy before transmitting an event.

## Prohibited data handling

Titen must not log or expose:

- API keys, model tokens, or session credentials;
- raw prompts or private memory content in normal logs;
- embeddings;
- full private identifiers when a short/hash reference is sufficient;
- cross-tenant resource existence.

## Vulnerability classes of special interest

- cross-tenant or cross-visibility retrieval;
- memory poisoning or stored prompt injection;
- unauthorized procedural/organization memory writes;
- evidence mutation or provenance forgery;
- stale vector resurrection after revoke/delete;
- lease/checkpoint races causing duplicate destructive work;
- export/import scope bypass;
- federation policy or signature bypass;
- secret leakage through logs, errors, health, backup, or audit export.

## Supported versions

Before the first tagged release, only the latest `main` revision is supported.
After releases begin, the supported-version table and disclosure response targets
will be added here.
