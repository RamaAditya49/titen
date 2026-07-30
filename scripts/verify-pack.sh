#!/usr/bin/env bash
# Prove the npm tarball works before publishing it. npm publish cannot be
# undone after 72 hours, so this runs against a real install in a throwaway
# directory rather than against the working tree, where every path resolves
# even when `files` forgot to ship it.
set -euo pipefail

cd "$(dirname "$0")/.."
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo "==> packing"
tarball="$work/$(npm pack --pack-destination "$work" --silent | tail -1)"

echo "==> 1/6 packaged README"
if tar -xOf "$tarball" package/README.md | grep -Eq '(href|src)="\./|\]\(\./'; then
  echo "FAIL: packaged README contains repository-relative references" >&2
  exit 1
fi

echo "==> installing $(basename "$tarball") into a clean tree"
cd "$work"
npm init -y >/dev/null
npm install "$tarball" >/dev/null

echo "==> 2/6 dependency tree"
installed="$(ls node_modules | grep -v '^\.' | sort | tr '\n' ' ')"
echo "    $installed"
for toolchain in astro wrangler playwright miniflare vite esbuild; do
  if [ -d "node_modules/$toolchain" ]; then
    echo "FAIL: $toolchain reached consumers; it belongs in devDependencies" >&2
    exit 1
  fi
done

echo "==> 3/6 titen bootstrap"
./node_modules/.bin/titen bootstrap --db "$work/t.db" --org 'Pack Verify' \
  | grep -q '^api_key: titen_' \
  || { echo "FAIL: bootstrap printed no API key" >&2; exit 1; }

echo "==> 4/6 titen serve"
# Port 0 would be cleaner, but the CLI prints the bound URL and nothing parses
# it back, so pick a high fixed port and fail loudly if it is busy.
port=8899
./node_modules/.bin/titen serve --db "$work/t.db" --port "$port" >"$work/serve.log" 2>&1 &
server=$!
trap 'kill "$server" 2>/dev/null || true; rm -rf "$work"' EXIT
for _ in $(seq 1 60); do
  curl -sf "http://127.0.0.1:$port/healthz" >/dev/null 2>&1 && break
  sleep 0.25
done
ready="$(curl -sf "http://127.0.0.1:$port/readyz" || true)"
case "$ready" in
  *'"ready":true'*) : ;;
  *) echo "FAIL: /readyz not ready: ${ready:-<no response>}" >&2; cat "$work/serve.log" >&2; exit 1 ;;
esac
kill "$server" 2>/dev/null || true
trap 'rm -rf "$work"' EXIT

echo "==> 5/6 SDK on plain node"
node --input-type=module -e '
  const { createRequire } = await import("node:module");
  const { TitenClient } = await import("titen-memory");
  const sub = await import("titen-memory/sdk");
  if (typeof TitenClient !== "function" || typeof sub.TitenClient !== "function")
    throw new Error("SDK did not export TitenClient");
  if (typeof TitenClient.prototype.request !== "function" ||
      typeof TitenClient.prototype.requestRaw !== "function")
    throw new Error("SDK did not ship generic JSON/raw access");
  // An "exports" map hides every subpath it does not list, including this one.
  // Bundlers and tooling read it, so the omission only surfaces downstream.
  createRequire(process.cwd() + "/").resolve("titen-memory/package.json");
' || { echo "FAIL: node cannot import the SDK" >&2; exit 1; }

echo "==> 6/6 custom global prefix"
prefix="$work/npm-prefix"
npm install --global --prefix "$prefix" "$tarball" >/dev/null
"$prefix/bin/titen" --help | grep -q '^titen — self-hosted memory service' \
  || { echo "FAIL: custom-prefix titen binary did not execute" >&2; exit 1; }

echo
echo "OK — $(basename "$tarball") is publishable."
