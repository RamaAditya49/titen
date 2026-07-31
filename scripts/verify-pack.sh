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
bootstrap="$(./node_modules/.bin/titen bootstrap --db "$work/t.db" --org 'Pack Verify')"
printf '%s\n' "$bootstrap" | grep -q '^api_key: titen_' \
  || { echo "FAIL: bootstrap printed no API key" >&2; exit 1; }
api_key="$(printf '%s\n' "$bootstrap" | sed -n 's/^api_key: //p')"
[ -n "$api_key" ] || { echo "FAIL: bootstrap API key is empty" >&2; exit 1; }
umask 077
printf 'header = "authorization: Bearer %s"\n' "$api_key" >"$work/curl-auth"

echo "==> 4/6 titen serve + MCP"
# The verifier may run beside other Titen processes. Ask the OS for a free port
# instead of mistaking an unrelated fixed-port server for this candidate.
port="$(node --input-type=module -e '
  import { createServer } from "node:net";
  const server = createServer();
  server.listen(0, "127.0.0.1", () => {
    console.log(server.address().port);
    server.close();
  });
')"
./node_modules/.bin/titen serve --db "$work/t.db" --port "$port" >"$work/serve.log" 2>&1 &
server=$!
trap 'kill "$server" 2>/dev/null || true; rm -rf "$work"' EXIT
for _ in $(seq 1 60); do
  curl --max-time 2 -sf "http://127.0.0.1:$port/healthz" >/dev/null 2>&1 && break
  kill -0 "$server" 2>/dev/null \
    || { echo "FAIL: installed server exited" >&2; cat "$work/serve.log" >&2; exit 1; }
  sleep 0.25
done
ready="$(curl --max-time 5 -sf "http://127.0.0.1:$port/readyz" || true)"
case "$ready" in
  *'"ready":true'*) : ;;
  *) echo "FAIL: /readyz not ready: ${ready:-<no response>}" >&2; cat "$work/serve.log" >&2; exit 1 ;;
esac
initialize="$(curl --max-time 5 -sf "http://127.0.0.1:$port/mcp" \
  --config "$work/curl-auth" \
  -H 'accept: application/json, text/event-stream' \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"pack-verify","version":"0"}}}')"
case "$initialize" in
  *'"protocolVersion":"2025-11-25"'*'"name":"titen"'*) : ;;
  *) echo "FAIL: installed MCP initialize failed" >&2; exit 1 ;;
esac
notification_status="$(curl --max-time 5 -sS -o /dev/null -w '%{http_code}' \
  --config "$work/curl-auth" \
  "http://127.0.0.1:$port/mcp" \
  -H 'accept: application/json, text/event-stream' \
  -H 'content-type: application/json' \
  -H 'mcp-protocol-version: 2025-11-25' \
  --data '{"jsonrpc":"2.0","method":"notifications/initialized"}')"
[ "$notification_status" = 202 ] \
  || { echo "FAIL: installed MCP notification returned $notification_status" >&2; exit 1; }
tools="$(curl --max-time 5 -sf "http://127.0.0.1:$port/mcp" \
  --config "$work/curl-auth" \
  -H 'accept: application/json, text/event-stream' \
  -H 'content-type: application/json' \
  -H 'mcp-protocol-version: 2025-11-25' \
  --data '{"jsonrpc":"2.0","id":2,"method":"tools/list"}')"
tool_names="$(printf '%s' "$tools" | node --input-type=module -e '
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const tools = JSON.parse(input).result?.tools;
  if (!Array.isArray(tools)) process.exit(1);
  console.log(tools.map((tool) => tool.name).sort().join("\n"));
')"
expected_tools='titen_checkpoint_get
titen_checkpoint_save
titen_compile
titen_feedback
titen_handoff
titen_lease_acquire
titen_remember'
[ "$tool_names" = "$expected_tools" ] \
  || { echo "FAIL: installed MCP tool list differs" >&2; exit 1; }
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
