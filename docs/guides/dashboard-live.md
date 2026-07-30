# Secure opt-in live dashboard

The built dashboard is a clearly labelled synthetic demo by default. Live Atlas is an optional loopback-only same-origin integration: the browser calls `/dashboard-api/status` and the one allowlisted `/dashboard-api/atlas/compile`; the adapter adds the canonical key server-side and forwards only the subject-scoped `conflict_freshness` lens to `POST /v1/memory-views/compile`.

```sh
pnpm build
TITEN_DASHBOARD_LIVE=true \
TITEN_API_URL=http://127.0.0.1:8787 \
TITEN_API_KEY='...' \
pnpm dashboard:adapter
# open http://127.0.0.1:4322/dashboard/?live=1
```

`TITEN_API_KEY` must be a least-privilege key with `views:compile`. Never use `PUBLIC_*` variables for credentials: Astro intentionally embeds those in browser assets. Live startup fails if URL/key are missing. The adapter binds `127.0.0.1` and rejects foreign Host/Origin values; it is not a shared reverse-proxy authentication layer. Requests use an exact route/lens allowlist, bounded subject/limit input, a five-second timeout, no-store responses, and generic upstream errors. If live retrieval fails, the page says so and retains the labelled demo instead of presenting fixture rows as live. Other product areas remain orientation text, not links or controls.
