---
work_id: published-container-image-20260804
status: done
stage: done
outcome: completed
complexity: simple
created: 2026-08-04
updated: 2026-08-04
owner: ramaaditya
spec: docs/specs/done/2026-08-04-published-container-image.md
---

# Published container image plan

## Steps

- [x] Read the existing `Dockerfile` and `deploy/titen.container` and establish
  what image reference the deployment path actually expects. It expected
  `localhost/titen:latest`, which exists only on a host that has already built
  it.
- [x] Trace what the service loads before changing the build: `src/core` and
  `src/runtime/bun` import each other and `../../package.json` and nothing else,
  so the dashboard sources, the lockfile and the workspace file are dead weight
  in the image.
- [x] Resolve the multi-architecture index digest for `oven/bun:1.3.14` and pin
  the base image to it in both stages, keeping the tag beside it for reading.
- [x] Delete the `bun install --production` step. `package.json` declares no
  runtime dependencies, and the vector stage's `node_modules` overwrote the
  result anyway.
- [x] Narrow the copies to `package.json`, `src/core` and `src/runtime/bun`, and
  narrow the `chown` to the state directory so `/app` stays root-owned and
  read-only to the service.
- [x] Move `HEALTHCHECK` from `/healthz` to `/readyz` after confirming in
  `src/core/app.ts` that `/healthz` is a static handler that never touches the
  database or the migration state.
- [x] Write `.github/workflows/container.yml`: tag trigger only, `packages:
  write` on the job, `GITHUB_TOKEN` as the only credential, a smoke run before
  the push, and a prerelease guard on `latest`.
- [x] Build the image on `benchmark-host` with podman and run it: probe both
  endpoints, check the uid, load `sqlite-vec`, restart it with a persisted
  volume, and wait for the health verdict.
- [x] Run the unit under rootless `systemctl --user`, find the host-path
  ownership failure, fix it with `UserNS=keep-id`, and re-run.
- [x] Write `docs/deployment/container.md` and point `deploy/README.md` at it.
- [x] Remove every container, volume, image, unit and directory created on
  `benchmark-host` during verification.

## Acceptance evidence

All container evidence was produced on `benchmark-host` with podman 5.8.2 on
2026-08-04. Podman, not docker, is the runtime used for verification; the
workflow itself builds with docker on a GitHub runner and has not run.

**AC-CONTAINER-001** — partially verified. The individual assertions the
workflow makes were each executed against the built image: `/readyz` returned
`ready: true` with schema 21 of 21 verified, `id -u` returned 1000, and the
`sqlite-vec` load assertion exited 0 after reporting `v0.1.9`. The workflow as a
whole is **not measured**: it triggers only on a version tag and no tag has been
pushed since it was added. `docs/deployment/container.md` states this rather
than implying the registry already serves an image.

**AC-CONTAINER-002** — verified by parsing the workflow: its trigger set is
exactly `push.tags`, with no `pull_request` and no branch push.

**AC-CONTAINER-003** — verified by scanning the workflow for secret references.
The only match is `secrets.GITHUB_TOKEN`. It contains no npm step, no registry
other than ghcr, and no `NODE_AUTH_TOKEN`.

**AC-CONTAINER-004** — verified. Both stages pin
`docker.io/oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4`,
the index digest podman reports for that tag. The final image runs as
`uid=1000(bun)`. No install step, lockfile or workspace file remains, the copied
trees contain only TypeScript sources, and the only environment variables the
image declares are `TITEN_DB`, `TITEN_HOST` and `TITEN_PORT`. Image size 217 MB.

**AC-CONTAINER-005** — verified. Built with `podman build --format docker`, the
running container reported `State.Health.Status` of `healthy` against `/readyz`.
Podman's default OCI format drops `HEALTHCHECK` with a warning, which is why the
documentation gives `--format docker` for local builds. No restart was observed
from the probe, which matches both runtimes marking rather than restarting.

**AC-CONTAINER-006** — verified. An organization was bootstrapped through
`podman exec` into a named volume, the container was restarted, and the
organization count read back as 1 from the persisted database. The volume also
held the WAL and shared-memory sidecars, owned by uid 1000 at mode 600.

**AC-CONTAINER-007** — verified, after a fix. The unit as checked in failed
immediately with `could not start server: unable to open database file`, because
its host-path mount is not writable by the image's uid 1000 under rootless
podman. With `UserNS=keep-id:uid=1000,gid=1000` the unit became active,
`/readyz` returned `ready: true`, the process inside ran as `uid=1000(bun)`, and
the database appeared in the host directory owned by the invoking user.

**AC-CONTAINER-008** — verified by executing the workflow's tag-routing branch
directly: `v1.2.3` selects the branch that moves `latest`, `v1.2.3-rc.1` selects
the branch that leaves it alone.

## Verification

Passed:

- `podman build` of the current `Dockerfile`, both default and docker format.
- Endpoint, uid, `sqlite-vec`, health, restart-persistence and hardened
  (`--read-only --cap-drop=all --security-opt no-new-privileges`) runs described
  above. The hardened run reached readiness 161 ms after container start on a
  fresh volume; idle resident memory was 34.84 MB with no vectors configured.
- Rootless Quadlet start under `systemctl --user`.
- Workflow YAML parses; trigger, permission and secret assertions above.
- `node scripts/check-workflow-docs.mjs`.

Not measured:

- The GitHub Actions workflow end to end, including the ghcr push and login.
- Any arm64 build, any real `ghcr.io` pull, and any run longer than a few
  minutes.
- Whether the sizes quoted in `docs/deployment/vps.md` still hold; that document
  cites about 239 MB for an earlier image and is owned by another change.

Cleanup: every container, named volume, image, systemd unit, environment file
and build directory created on `benchmark-host` for this work was removed and the
removal was confirmed. No API key, database content or embedding was printed at
any point; the bootstrap that produced persistence evidence had its output
discarded before it left the remote host.
