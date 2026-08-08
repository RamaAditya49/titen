# Official MCP registry listing

Status: **published.** Titen was listed on 2026-08-07T05:33:16Z and the entry is
active:

```console
$ curl -s "https://registry.modelcontextprotocol.io/v0/servers?search=titen" \
  | jq '.servers[0].server | {name, version, websiteUrl}'
{
  "name": "io.github.RamaAditya49/titen-memory",
  "version": "0.7.0",
  "websiteUrl": "https://titen.dev"
}
```

[`server.json`](../../server.json) in the repository root is the manifest behind
that entry. Both prerequisites below are satisfied — they are kept because a
**version bump has to satisfy them again**: the listing tracks whatever version
`server.json` names, so it trails npm `latest` until a maintainer bumps the
manifest and re-runs `mcp-publisher publish`. See
[Refreshing the listing](#refreshing-the-listing).

The registry stores **metadata only**. It never hosts the package; it points at
`titen-memory` on npm and at this repository. Listing Titen adds a discovery
entry to the index that MCP host applications and third-party directories read.
It changes nothing about how Titen runs.

Publishing is manual, from a maintainer's machine, exactly like the [npm
release](../engineering/release.md). This repository runs **no GitHub Actions**;
the registry's own GitHub Actions publishing path is deliberately not used.

## Before you can publish

Two hard prerequisites. Neither can be satisfied by editing `server.json`.

### 1. `package.json` must carry `mcpName`, and that must reach npm

The registry proves package ownership by fetching
`https://registry.npmjs.org/titen-memory/<version>` and comparing its `mcpName`
field to the `name` in `server.json`. The comparison is exact, including case.
No published version of `titen-memory` has the field today:

```console
$ curl -s https://registry.npmjs.org/titen-memory/0.6.1 | jq .mcpName
null
```

So `package.json` needs one added line, and it only counts once a release
carrying it is on npm — the registry reads npm, not this repository:

```diff
   "name": "titen-memory",
   "version": "0.6.1",
+  "mcpName": "io.github.RamaAditya49/titen-memory",
   "description": "...",
```

### 2. `titen mcp` must run with no environment

`server.json` describes `npx -y titen-memory@<version> mcp` as a stdio server
whose environment variables are all optional. On `0.6.1` that is not yet true:

```console
$ npx -y titen-memory@0.6.1 mcp
error: TITEN_MCP_URL and TITEN_API_KEY are required
```

Publishing before zero-config local mode ships would put a listing in a public
index that fails on first launch for everyone who installs it. Do not publish a
version older than the one where `titen mcp` opens a local store on its own.

## Proving ownership of the namespace

The namespace in `server.json`'s `name` is not free-form — it must be one the
registry watches you prove. Titen's manifest uses `io.github.RamaAditya49/`,
which is proven by a GitHub device-code login and needs no key material and no
DNS change.

| Method | Name must start with | What proves it |
| --- | --- | --- |
| GitHub (**in use**) | `io.github.RamaAditya49/` | `mcp-publisher login github`, device code in the browser |
| DNS | `dev.titen/` | Ed25519 or ECDSA-P384 keypair, `v=MCPv1; …` TXT record on `titen.dev` |
| HTTP | `dev.titen/` | The same keypair, served at `https://titen.dev/.well-known/mcp-registry-auth` |

The GitHub namespace is the login **as GitHub spells it**. The registry grants
`io.github.RamaAditya49/*` and matches it with a case-sensitive prefix
comparison, so `io.github.ramaaditya49/titen-memory` would be rejected with a
403 even though it is the same account.

`dev.titen/memory` is the nicer name and matches the homepage, but it costs a
keypair the maintainer then has to keep, plus a DNS record. It is not worth it
for a first listing. If it is ever wanted, the [authentication
guide](https://modelcontextprotocol.io/registry/authentication) has the exact
`openssl` incantations — and note that switching namespaces creates a **second,
unrelated server entry**. Registry entries are immutable apart from their status
field; a name is not renameable.

## Validate before touching credentials

The registry exposes an unauthenticated validation endpoint. Run this after any
edit to `server.json`:

```console
$ curl -s -X POST https://registry.modelcontextprotocol.io/v0/validate \
    -H 'content-type: application/json' --data-binary @server.json | jq .
{
  "valid": true,
  "issues": []
}
```

A malformed manifest answers `422` naming the offending field:

```console
$ jq '.name = "titen/Bad Name"' server.json | curl -s -X POST … --data-binary @-
{"title":"Unprocessable Entity","status":422,"detail":"validation failed",
 "errors":[{"message":"expected string to match pattern ^[a-zA-Z0-9.-]+/[a-zA-Z0-9._-]+$",
            "location":"body.name","value":"titen/Bad Name"}]}
```

This checks the schema and the registry's semantic rules. It does **not** check
package ownership — `server.json` validates today even though `titen-memory` has
no `mcpName` on npm. Ownership fails later, at publish.

## Publish

Run from the repository root, after the two prerequisites above hold.

1. **Release to npm first.** The registry validates against a version that
   already exists on npm, so follow [release](../engineering/release.md) to the
   end before starting here.

2. **Set all three versions to the version you just published.** They must
   agree: `package.json` `version`, `server.json` `version`, and
   `server.json` `packages[0].version`. A version string may be published to
   the registry only once, and cannot be edited afterwards.

3. **Validate**, using the `curl` above. Fix anything it reports.

4. **Install `mcp-publisher`** (a single Go binary; Homebrew also has it):

   ```bash
   curl -L "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_$(uname -s | tr '[:upper:]' '[:lower:]')_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/').tar.gz" \
     | tar xz mcp-publisher && sudo mv mcp-publisher /usr/local/bin/
   ```

   Do **not** run `mcp-publisher init`. It generates a template `server.json`
   and would overwrite the one in this repository.

5. **Authenticate.** Opens a device-code flow; the account must be
   `RamaAditya49`:

   ```bash
   mcp-publisher login github
   ```

6. **Publish:**

   ```bash
   mcp-publisher publish
   ```

   Expected output names the server and version:

   ```text
   ✓ Successfully published
   ✓ Server io.github.RamaAditya49/titen-memory version <version>
   ```

7. **Verify** — the entry is queryable the moment publish returns:

   ```bash
   curl -s "https://registry.modelcontextprotocol.io/v0/servers?search=titen" | jq '.metadata.count'
   curl -s "https://registry.modelcontextprotocol.io/v0.1/servers/io.github.RamaAditya49%2Ftiten-memory/versions/latest" | jq '.server.version'
   ```

   The path segment must be URL-encoded; the `/` in the server name is `%2F`.

### If publish fails

| Message | Cause |
| --- | --- |
| `missing required 'mcpName' field` | Prerequisite 1. The released npm version does not carry it. Adding it to this repository is not enough — publish a new npm version. |
| `ownership validation failed. Expected mcpName 'X', got 'Y'` | `mcpName` and `server.json` `name` disagree, often only in case. |
| `You do not have permission to publish this server` | The namespace does not match the authenticated account. Check the capitalisation of `RamaAditya49`. |
| `Invalid or expired Registry JWT token` | Re-run `mcp-publisher login github`. |

## Propagation

There are three different delays, and only the first is the registry's:

- **The official registry: none.** The entry is served by the API as soon as
  `publish` returns, which is why step 7 verifies immediately.
- **Third-party directories and MCP host applications: about an hour, often
  longer.** They are downstream aggregators that scrape
  `GET /v0.1/servers` on their own schedule; the registry documents an expected
  cadence of roughly once per hour and offers no guarantee. Nothing on our side
  makes this faster.
- **DNS authentication only: minutes to hours** for the TXT record to propagate
  before `mcp-publisher login dns` will succeed. Not applicable to the GitHub
  method this manifest uses.

Do not treat a successful publish as a discovery result. It adds one row to an
index that already holds thousands of servers; that is a precondition for being
found, not evidence of being found.

## Updating a listing

Publish a new version. Existing versions are immutable — the registry stores
each version separately and marks the highest semantic version `latest`. There
is no edit, and no way to fix a typo in a published entry other than superseding
it.

## Refreshing the listing

The registry entry is a snapshot of `server.json`, not a pointer to npm, so it
does not follow a release. After an npm publish the listing keeps naming the old
version until a maintainer refreshes it:

```bash
# 1. bump BOTH version fields in server.json to the released version
jq '.version, .packages[0].version' server.json      # must equal npm latest
npm view titen-memory version

# 2. the ownership check re-runs against that exact version, so it must carry mcpName
curl -s "https://registry.npmjs.org/titen-memory/$(npm view titen-memory version)" | jq .mcpName

# 3. republish
mcp-publisher login github && mcp-publisher publish
```

A trailing listing is cosmetic — the registry stores metadata only, and `npx
titen-memory mcp` always resolves npm `latest` regardless of what the entry
says — so this is release hygiene, not a functional gate. Do it in the same
session as the release, or the two drift.

## Reference

- [Publishing quickstart](https://modelcontextprotocol.io/registry/quickstart)
- [Authentication methods](https://modelcontextprotocol.io/registry/authentication)
- [Package types and ownership verification](https://modelcontextprotocol.io/registry/package-types)
- [Schema](https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json)
  (`$schema` in `server.json` pins this dated version)
