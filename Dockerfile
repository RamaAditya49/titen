# Titen memory service.
#
# Optional, not required: the service runs directly under Bun on a host. This
# exists so a deployment can be reproduced without provisioning one, and so the
# VPS install path can be exercised on any machine with an OCI runtime. Builds
# under docker and podman alike; nothing here is docker-specific.
# Debian-based on purpose, not Alpine: sqlite-vec ships a glibc-linked prebuilt,
# and musl cannot load it (it fails on __memcpy_chk). An Alpine image still runs
# the service, it just silently loses vector retrieval, which is worse than being
# a little larger.
# Pinned by digest, not by the floating 1.3 tag: the published image must be
# reproducible from the tag that built it. The tag is kept beside the digest for
# readability only; the digest wins. Bun 1.3.14 is the version CI tests against.
# Published for linux/amd64 only, because the pinned sqlite-vec prebuilt is
# glibc x64. See docs/deployment/container.md.
FROM docker.io/oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS vector-deps

WORKDIR /vector
RUN bun add --no-save sqlite-vec@0.1.9

FROM docker.io/oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4

WORKDIR /app

# Titen itself has zero runtime dependencies, so there is no install step and no
# lockfile in this image. The published package leaves sqlite-vec opt-in so SDK
# users do not download native code; the isolated stage above brings only
# sqlite-vec and its platform binary into this vector-capable image.
COPY --from=vector-deps /vector/node_modules ./node_modules

# Only the two directories the service actually runs from. package.json is here
# because src/core/version.ts imports it, not to install anything. The dashboard
# sources under src/pages and src/lib are a separate Astro build and are not
# part of the memory service.
COPY package.json ./
COPY src/core ./src/core
COPY src/runtime/bun ./src/runtime/bun
RUN bun -e 'require.resolve("sqlite-vec")'

# SQLite needs a writable directory it owns, and the service must not run as
# root. bun:sqlite creates WAL sidecar files next to the database. /app stays
# root-owned and read-only to the service.
RUN mkdir -p /var/lib/titen && chown bun:bun /var/lib/titen
USER bun

ENV TITEN_DB=/var/lib/titen/titen.db \
    TITEN_HOST=0.0.0.0 \
    TITEN_PORT=8787

EXPOSE 8787
VOLUME ["/var/lib/titen"]

# Readiness, not liveness: /healthz answers before migrations are verified, so it
# reports healthy on a store the service cannot actually serve. /readyz returns
# 503 until canonical SQL, migrations, signing secrets and any configured
# semantic index all check out, which is the condition a proxy should gate on.
# Neither docker nor podman restarts a container for failing this; it only marks
# it unhealthy, so a broken migration surfaces without a restart loop.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e 'const r = await fetch("http://127.0.0.1:8787/readyz"); process.exit(r.ok ? 0 : 1)'

ENTRYPOINT ["bun", "src/runtime/bun/cli.ts"]
CMD ["serve", "--db", "/var/lib/titen/titen.db", "--host", "0.0.0.0", "--port", "8787"]
