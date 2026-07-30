#!/usr/bin/env bash
# Prove the npm tarball works before publishing it. npm publish cannot be
# undone after 72 hours, so this runs against a real install in a throwaway
# directory rather than against the working tree, where every path resolves
# even when `files` forgot to ship it.
set -euo pipefail

cd "$(dirname "$0")/.."
root="$PWD"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo "==> 1/5 publish-time normalization"
# npm rewrites package.json on publish and `npm pack` does not, so a bin entry
# can be dropped there and nowhere else — invisible to every check below. Ask
# npm's own normalizer what it will actually ship instead of trusting the
# tarball. It is also the only place the misleading "was invalid and removed"
# wording gets resolved into what the field really becomes.
node -e '
  const path = require("path");
  const [npmRoot, dir] = process.argv.slice(1);
  const PackageJson = require(path.join(npmRoot, "npm/node_modules/@npmcli/package-json"));
  PackageJson.load(dir).then(async (pj) => {
    const changes = [];
    await pj.normalize({ steps: ["binDir", "bin", "fixRepositoryField", "fixBugsField"], changes });
    for (const c of changes) console.log("    npm will rewrite: " + c);
    const bin = pj.content.bin;
    if (!bin || !bin.titen) throw new Error("publish would ship no `titen` bin");
    console.log("    bin.titen -> " + bin.titen);
  }).catch((error) => { console.error("FAIL: " + error.message); process.exit(1); });
' "$(npm root -g)" "$root"

echo "==> packing"
tarball="$work/$(npm pack --pack-destination "$work" --silent | tail -1)"

echo "==> installing $(basename "$tarball") into a clean tree"
cd "$work"
npm init -y >/dev/null
npm install "$tarball" >/dev/null

echo "==> 2/5 dependency tree"
installed="$(ls node_modules | grep -v '^\.' | sort | tr '\n' ' ')"
echo "    $installed"
for toolchain in astro wrangler playwright miniflare vite esbuild; do
  if [ -d "node_modules/$toolchain" ]; then
    echo "FAIL: $toolchain reached consumers; it belongs in devDependencies" >&2
    exit 1
  fi
done

echo "==> 3/5 titen bootstrap"
./node_modules/.bin/titen bootstrap --db "$work/t.db" --org 'Pack Verify' \
  | grep -q '^api_key: titen_' \
  || { echo "FAIL: bootstrap printed no API key" >&2; exit 1; }

echo "==> 4/5 titen serve"
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

echo "==> 5/5 SDK on plain node"
node --input-type=module -e '
  const { createRequire } = await import("node:module");
  const { TitenClient } = await import("titen-memory");
  const sub = await import("titen-memory/sdk");
  if (typeof TitenClient !== "function" || typeof sub.TitenClient !== "function")
    throw new Error("SDK did not export TitenClient");
  // An "exports" map hides every subpath it does not list, including this one.
  // Bundlers and tooling read it, so the omission only surfaces downstream.
  createRequire(process.cwd() + "/").resolve("titen-memory/package.json");
' || { echo "FAIL: node cannot import the SDK" >&2; exit 1; }

echo
echo "OK — $(basename "$tarball") is publishable."
