---
work_id: published-container-image-20260804
status: done
stage: done
outcome: completed
complexity: simple
created: 2026-08-04
updated: 2026-08-04
owner: ramaaditya
---

# Published container image

## Outcome

Completed. The `Dockerfile` is pinned by digest, ships only the two source
directories the service runs from, and probes readiness rather than liveness.
The image is pushed to `ghcr.io/ramaaditya49/titen` by hand
on a version tag only, using the built-in `GITHUB_TOKEN` and no other
credential. `docs/deployment/container.md` documents the pull, the volume, and
the environment. `deploy/titen.container` now names a real image and, separately,
was found to be non-functional under rootless podman and was fixed.

The image itself is verified: built, run, restarted, and health-checked on
`benchmark-host`. The workflow is not verified, because it runs only on a version tag
and no tag has been pushed.

## Problem

Strategic debt item 9 in `PONYTAIL-DEBT.md`: the self-host floor is Titen's
strongest verified advantage, and the packaging around it does not match. A
`Dockerfile` exists, but Docker Hub answers "object not found" and ghcr answers
401, so every operator who wants a container builds it themselves.
`deploy/titen.container` referenced `localhost/titen:latest`, an image that only
exists on a host that has already built it.

Two defects surfaced while proving the path rather than reading it:

1. The `Dockerfile` ran `bun install --production` against a `package.json` with
   no runtime dependencies, then overwrote the resulting `node_modules` with the
   vector stage's copy. The install was a network round trip that changed
   nothing, and it dragged `pnpm-lock.yaml` and `pnpm-workspace.yaml` into the
   image for no reason. It also copied all of `src`, including the Astro
   dashboard, which the memory service never loads.
2. `deploy/titen.container` mounts a host directory into a container that runs
   as its own uid 1000. Under rootless podman that uid maps to a subuid which
   does not own the directory, so the service exited on startup with `could not
   start server: unable to open database file`. The unit has never worked as
   checked in; the missing image hid a second failure behind it.

## Scope

In scope: `Dockerfile`, the publishing workflow, container deployment
documentation, the Quadlet unit and the `deploy/README.md` pointer to it.

Out of scope: npm publication, which stays manual from a maintainer's machine;
multi-architecture images; provenance attestation (issue #242); and the
`docs/README.md` index row, which another change owns.

## EARS acceptance criteria

- **AC-CONTAINER-001 — Event-driven:** When a `vN.N.N` tag is pushed to the
  repository, the container workflow shall build the image, verify that it
  serves a ready `/readyz` as a non-root user with a loadable `sqlite-vec`, and
  only then publish it to `ghcr.io/ramaaditya49/titen`.

- **AC-CONTAINER-002 — Unwanted behavior:** If a push targets a branch or a pull
  request is opened, then the container workflow shall not run, so that no
  fork-triggered job ever holds `packages: write`.

- **AC-CONTAINER-003 — Ubiquitous:** The publishing workflow shall consume no
  credential other than the built-in `GITHUB_TOKEN`, and shall not publish to
  npm.

- **AC-CONTAINER-004 — Ubiquitous:** The image shall run the service as a
  non-root user, from a base image pinned by digest, containing no dependency
  install step, no lockfile, no dashboard source, and no credential.

- **AC-CONTAINER-005 — State-driven:** While the container is running, the
  configured `HEALTHCHECK` shall report the container healthy only while
  `/readyz` returns success, and shall not itself restart the container.

- **AC-CONTAINER-006 — Optional feature:** Where the operator persists
  `/var/lib/titen`, canonical memory shall survive a container restart.

- **AC-CONTAINER-007 — Event-driven:** When the rootless Quadlet unit is
  started, the service shall reach readiness with its database written into the
  operator-owned host directory.

- **AC-CONTAINER-008 — Unwanted behavior:** If the pushed tag is a prerelease,
  then the workflow shall publish that tag alone and shall leave `latest`
  unchanged, matching the npm `next` dist-tag rule.

## Non-goals

An arm64 image. The pinned `sqlite-vec` prebuilt is glibc x64, so an arm64
image would answer `/healthz` and silently have no vector retrieval — the exact
failure the Debian base was chosen to avoid. The documentation scopes the claim
to `linux/amd64` instead of widening it untested, which is the option strategic
debt item 9 leaves open.
