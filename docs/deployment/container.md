# Container image

Status: **image verified, publication unverified.** The image in this repository
was built and run on 2026-08-04 (evidence at the bottom). The publishing
workflow has never run, because it only runs on a version tag and no tag has
been pushed since it was added. Until the first `vN.N.N` tag,
`ghcr.io/ramaaditya49/titen` serves nothing and `podman pull` will fail — build
locally instead, as [VPS deployment](./vps.md#container-install-verified)
describes.

The container is optional. Titen runs directly under Bun with no container
runtime at all; this exists so a deployment can be reproduced without
provisioning a host.

## What gets published

Nothing is published automatically. This repository runs **no GitHub Actions**,
so the image is built and pushed by hand from a maintainer's machine, the same
way npm releases are (see [release](../engineering/release.md)):

```bash
docker build -t ghcr.io/ramaaditya49/titen:0.6.0 -t ghcr.io/ramaaditya49/titen:latest .
docker push ghcr.io/ramaaditya49/titen:0.6.0
docker push ghcr.io/ramaaditya49/titen:latest
```

Until that push happens the tags below describe the intended scheme, not
something a `docker pull` will find.

| Tag | Meaning |
| --- | --- |
| `v0.5.7` | The exact release. Pin this in production. |
| `latest` | The most recent non-prerelease tag. Moves under you. |

A prerelease tag (`v0.6.0-rc.1`) publishes its own tag and does **not** move
`latest`, matching the `next` dist-tag rule the npm release follows.

Published for **linux/amd64 only**. The `sqlite-vec` prebuilt Titen pins is
glibc x64, so an arm64 image would answer `/healthz` while silently having no
vector retrieval. Run Titen directly under Bun on arm64.

## Pull and run

```bash
podman volume create titen-data       # or: docker volume create

# Bootstrap once. Prints the org id, API key, dashboard user and temporary
# password; none of them can be shown again.
podman run --rm -v titen-data:/var/lib/titen \
  ghcr.io/ramaaditya49/titen:v0.5.7 \
  bootstrap --db /var/lib/titen/titen.db --org 'My Org'

# Serve on loopback only.
podman run -d --name titen \
  -p 127.0.0.1:8787:8787 \
  -v titen-data:/var/lib/titen \
  --read-only --cap-drop=all --security-opt no-new-privileges \
  ghcr.io/ramaaditya49/titen:v0.5.7

curl http://127.0.0.1:8787/readyz
```

`ENTRYPOINT` is the CLI, so any argument after the image name is a `titen`
subcommand. The default command is `serve --db /var/lib/titen/titen.db --host
0.0.0.0 --port 8787`: binding `0.0.0.0` *inside* the container is what makes the
published loopback port reachable, and `-p 127.0.0.1:8787:8787` is what keeps it
off the network. Do not publish the port on `0.0.0.0` and call it hardened.

`HEALTHCHECK` probes `/readyz`, which returns 503 until canonical SQL,
migrations, signing secrets and any configured semantic index all check out.
Neither runtime restarts a container for failing it; it only marks the container
unhealthy, so a failed migration surfaces instead of restart-looping.

## The volume that must persist

`/var/lib/titen` — the only writable path in the image and the whole of the
service's state:

| File | |
| --- | --- |
| `titen.db` | Canonical SQL. Every claim, key, lease and audit row. |
| `titen.db-wal`, `titen.db-shm` | WAL sidecars. Copying the database without them loses the most recent writes. |
| `titen.db.vec` | The sqlite-vec index, when the vector path is configured. Default location, already inside the volume. Rebuildable from canonical SQL. |

Files are mode 600 owned by uid 1000 (`bun`), which is the user the service runs
as. On SELinux hosts add `:Z` to the mount. Back it up with
[`deploy/backup.sh`](../../deploy/backup.sh) semantics — a SQLite-consistent
copy, not a `cp` of a live file.

Losing this volume loses the deployment. `latest` moving under a restart does
not.

## Environment variables that matter

Already set in the image: `TITEN_DB`, `TITEN_HOST`, `TITEN_PORT`.

Everything below is operator-supplied. **Pass them with `--env-file` from a
mode-0600 file, never with `-e` on a shared host and never baked into an image
layer**; `podman inspect` and every image layer are readable by anyone who can
read the image.

| Variable | When you need it |
| --- | --- |
| `TITEN_SECRET_KEYS` | Required before webhooks or federation. AES-256-GCM keyring as JSON. Without it those secrets cannot be wrapped. |
| `TITEN_MCP_ORIGIN` | Required when TLS terminates at a reverse proxy. Exact public origin, no trailing slash; Titen does not trust `X-Forwarded-Proto`. |
| `TITEN_WEBHOOK_ALLOWED_HOSTNAMES` | Outbound webhook allowlist. Delivery fails closed to anything else. |
| `TITEN_EMBED_BASE_URL`, `TITEN_EMBED_MODEL`, `TITEN_EMBED_DIMS`, `TITEN_EMBED_REVISION`, `TITEN_EMBED_PROFILE`, `TITEN_EMBED_MIN_COSINE` | The vector path. All six or none: a partial tuple fails readiness closed. There is no shipped default cosine floor. |
| `TITEN_VEC_DB_PATH` | Only to move the vector index off its default, `TITEN_DB` plus `.vec`. The default is already inside the volume; a path outside it lands on the read-only layer and fails. |
| `TITEN_EXTRACT_*` | Opt-in enrichment, disabled by default. |

Full semantics for each group are in
[`deploy/README.md`](../../deploy/README.md).

A container's `127.0.0.1` is not the host's. An embedding provider on the host
needs `--network host`, `host.containers.internal`, or a shared network — not
loopback.

## Rootless Quadlet

[`deploy/titen.container`](../../deploy/titen.container) references
`ghcr.io/ramaaditya49/titen:latest`. Pin it to the version tag you intend to run
before enabling it in production, or point it at `localhost/titen:latest` and
build locally. Install steps are in
[VPS deployment](./vps.md#rootless-quadlet).

That unit mounts a host directory rather than a named volume, which under
rootless podman needs `UserNS=keep-id:uid=1000,gid=1000` — the line is in the
unit. Without it the image's uid 1000 maps to a subuid that does not own
`~/.local/share/titen`, and the service exits immediately with `could not start
server: unable to open database file`. The `podman run` commands above use a
named volume instead, which inherits ownership from the image and needs no
mapping. If you swap either one for the other, keep this in mind — it is the
same failure in both directions.

## Building it yourself

```bash
podman build --format docker -t localhost/titen:latest .
```

`--format docker` is not optional under podman: podman defaults to the OCI image
format, which has no `HEALTHCHECK` field and drops it with a warning.

The base image is pinned by digest, so the build is reproducible from the tag
that produced it. Bumping Bun means changing that digest deliberately.

## Measured evidence

Built with podman 5.8.2 on `rama-tuf` (Linux x86_64), 2026-08-04, from this
commit's `Dockerfile`:

| | |
| --- | --- |
| Image size | 217 MB (`podman images`) |
| Runs as | uid 1000 `bun`, not root |
| `/readyz` on a fresh volume | `ready: true`, schema 21/21 verified |
| `HEALTHCHECK` verdict | `healthy` (docker-format build) |
| `sqlite-vec` inside the image | loads, `vec_version()` = `v0.1.9` |
| Idle resident memory | 34.84 MB (`podman stats`, no vectors configured) |
| Hardened run | `--read-only --cap-drop=all --security-opt no-new-privileges` reached ready in 161 ms from a cold container |
| Persistence | an organization bootstrapped before `podman restart` was still present after it |
| Quadlet | `deploy/titen.container` started under rootless `systemctl --user`, reached `ready: true`, wrote the database into the host directory as the invoking user |

Not measured: the GitHub Actions workflow (no tag pushed yet), any arm64 build,
a real `ghcr.io` pull, and any run longer than a few minutes.
