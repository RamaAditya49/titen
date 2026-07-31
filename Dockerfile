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
FROM docker.io/oven/bun:1.3 AS vector-deps

WORKDIR /vector
RUN bun add --no-save sqlite-vec@0.1.9

FROM docker.io/oven/bun:1.3

WORKDIR /app

# Dependencies first, so a source edit does not reinstall them.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Keep the base install production-only. The published package leaves sqlite-vec
# opt-in so SDK users do not download native code; the isolated stage brings
# only sqlite-vec and its platform binary into this vector-capable image.
RUN bun install --production --no-save 2>/dev/null || bun install --production
COPY --from=vector-deps /vector/node_modules ./node_modules
RUN bun -e 'require.resolve("sqlite-vec")'

COPY src ./src
COPY scripts ./scripts

# SQLite needs a writable directory it owns, and the service must not run as
# root. bun:sqlite creates WAL sidecar files next to the database.
RUN mkdir -p /var/lib/titen && chown -R bun:bun /var/lib/titen /app
USER bun

ENV TITEN_DB=/var/lib/titen/titen.db \
    TITEN_HOST=0.0.0.0 \
    TITEN_PORT=8787

EXPOSE 8787
VOLUME ["/var/lib/titen"]

# Liveness only. Readiness additionally reports migrations and capabilities, but
# a failing migration should surface in logs rather than restart-loop a container.
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD bun -e 'const r = await fetch("http://127.0.0.1:8787/healthz"); process.exit(r.ok ? 0 : 1)'

ENTRYPOINT ["bun", "src/runtime/bun/cli.ts"]
CMD ["serve", "--db", "/var/lib/titen/titen.db", "--host", "0.0.0.0", "--port", "8787"]
