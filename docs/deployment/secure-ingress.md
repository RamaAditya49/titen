# Secure ingress for a self-hosted Titen

This guide exposes a Bun/VPS Titen deployment without opening its database or
loopback listeners. It does not deploy the Cloudflare Worker runtime and does
not require GitHub Actions.

Use one of these paths:

- **Tailscale Serve** for a private operator dashboard inside one tailnet;
- **Cloudflare Tunnel + Access** for an authenticated custom domain.

Tailscale Funnel and an unprotected Cloudflare Tunnel hostname are public. Do
not put the live dashboard, `/v1`, or `/mcp` behind either one without a separate
application-authentication layer.

## Preserve the local boundary

Keep the API and dashboard adapter on loopback:

```text
Titen API          127.0.0.1:8787
dashboard adapter  127.0.0.1:4322
```

Expose the dashboard adapter, not port `8787`. In the recommended session mode,
each operator submits a bounded Titen key once and the adapter keeps it only in
process memory behind an opaque HttpOnly cookie. Never configure a shared owner
or wildcard key in the adapter.

If remote agents genuinely need REST or MCP, give the API a separate hostname,
ingress policy, and revocable Titen key. Set `TITEN_MCP_ORIGIN` to the exact
external origin only when that hostname exposes `/mcp`.

## Tailscale Serve

Serve is the smallest private option. It terminates HTTPS at `tailscaled`,
proxies to the loopback adapter, and applies the tailnet policy to connections.

### Prerequisites

- Tailscale is installed and connected on the host and operator device.
- HTTPS certificates are enabled for the tailnet.
- Tailnet grants allow only the intended operators to reach this node on TCP
  `443`.
- The dashboard build and adapter pass their local verification.

Install and authenticate the official stable Linux client on the host:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
tailscale status
```

The final command must list the host in the intended tailnet. Operators also
install Tailscale on their own device using the platform link from the official
install page. If piping an installer is disallowed, use Tailscale's stable
distribution package instructions instead.

On Linux, `tailscaled` normally runs as root. Either run the Serve commands with
`sudo`, or delegate daemon management once to a trusted local account:

```bash
sudo tailscale set --operator=<trusted-local-user>
```

The operator setting permits that account to manage Tailscale generally, not
only this mapping. Do not assign it to the Titen process account merely to avoid
one administrative command.

For a tagged server, a narrow grant can look like this:

```jsonc
{
  "groups": {
    "group:titen-operators": ["operator@example.com"]
  },
  "tagOwners": {
    "tag:titen-dashboard": ["autogroup:admin"]
  },
  "grants": [
    {
      "src": ["group:titen-operators"],
      "dst": ["tag:titen-dashboard"],
      "ip": ["tcp:443"]
    }
  ]
}
```

Applying a tag changes a node from user-owned to tag-owned. Use the current
node's existing identity when changing that ownership would be disruptive.
Preview and test tailnet-policy changes before saving them.

### Publish the dashboard

Start the adapter with the exact HTTPS name that Serve reports:

```bash
pnpm build
TITEN_DASHBOARD_LIVE=true \
TITEN_DASHBOARD_AUTH=session \
TITEN_API_URL=http://127.0.0.1:8787 \
TITEN_DASHBOARD_ORIGIN=https://titen-host.example-tailnet.ts.net \
pnpm dashboard:adapter
```

Then create the background Serve mapping:

```bash
tailscale serve --bg --https=443 http://127.0.0.1:4322
tailscale serve status --json
```

Open the reported `.ts.net` URL from an allowed tailnet device. The scheme,
host, and optional port must exactly match `TITEN_DASHBOARD_ORIGIN`.

### Container deployments

The host-side Serve path works unchanged when Bun, Docker, or Podman publishes
the adapter only on host loopback. This is simpler than adding Tailscale to the
application container.

If Tailscale must run in a container, use the official `tailscale/tailscale`
image, persist `TS_STATE_DIR`, set `TS_AUTH_ONCE=true`, and provide a
tag-restricted enrollment secret outside the image and repository.
`TS_SERVE_CONFIG` accepts the JSON produced by
`tailscale serve status --json`; mount the containing directory rather than an
individual file. Because the adapter listens on `127.0.0.1`, the Tailscale and
adapter containers must share a network namespace, such as one Podman pod.
Docker and Podman use the same image and environment contract.

### Funnel is not private ingress

[Tailscale Funnel](https://tailscale.com/docs/features/tailscale-funnel) is a
public beta service. It requires MagicDNS, HTTPS certificates, and a `funnel`
node attribute; it accepts only ports `443`, `8443`, and `10000`. Funnel access
is public and does not carry Tailscale identity headers. A `nodeAttrs` rule
controls who may enable Funnel, not who may visit the resulting URL.

Do not replace the Serve command above with `tailscale funnel` for a live Titen
dashboard or API. Funnel is suitable only after a separate application-auth
proxy has been specified and verified.

### Verify and roll back

From an allowed tailnet device, verify the dashboard plus
`/dashboard-api/health` and `/dashboard-api/readiness`. Also verify that an
unapproved tailnet identity cannot connect and that the host does not expose API
port `8787` on LAN or tailnet addresses.

To remove the mapping, repeat its original flags with `off`:

```bash
tailscale serve --https=443 off
```

Use `tailscale serve reset` only when the node has no unrelated Serve mappings.
Stopping the adapter and removing Serve changes no canonical data.

Official references:

- [Install Tailscale on Linux](https://tailscale.com/docs/install/linux)
- [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve)
- [`tailscale serve` command](https://tailscale.com/docs/reference/tailscale-cli/serve)
- [Linux operator permission](https://tailscale.com/docs/reference/troubleshooting/linux/linux-operator-permission)
- [Grants](https://tailscale.com/docs/features/access-control/grants)
- [Tailscale container parameters](https://tailscale.com/docs/features/containers/docker/docker-params)
- [Docker-compatible managers including Podman](https://tailscale.com/docs/features/containers/docker/how-to/connect-docker-alt-manager)

## Cloudflare Tunnel with Access

Cloudflare Tunnel creates outbound-only connections from `cloudflared`; the
origin needs no public IP or inbound firewall port. The hostname becomes public
DNS, so create the Access application before adding the tunnel route.

### Prerequisites

- The hostname's domain is active in Cloudflare DNS.
- `cloudflared` can reach Cloudflare on outbound port `7844`.
- One human Access policy identifies dashboard operators.
- Automated API clients, when needed, have a separate Service Auth policy.

### Install `cloudflared` on Linux

Use Cloudflare's signed package repository. On Debian or Ubuntu:

```bash
sudo mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg \
  | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" \
  | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt-get update
sudo apt-get install cloudflared
cloudflared --version
```

On RHEL, Fedora, or a compatible distribution:

```bash
curl -fsSL https://pkg.cloudflare.com/cloudflared.repo \
  | sudo tee /etc/yum.repos.d/cloudflared.repo >/dev/null
sudo dnf install cloudflared
cloudflared --version
```

The dashboard-generated command may install the remotely managed tunnel as a
service after the binary is present. Its embedded token is a secret; run it
only on the target host and do not paste it into an issue, log, or repository.

### Protect the hostname first

In the Cloudflare dashboard:

1. Go to **Zero Trust > Access controls > Applications**.
2. Create a **Self-hosted and private** application with a public hostname such
   as `memory.example.com`.
3. Add the smallest Allow policy for the dashboard operators. Access is
   deny-by-default; users must match an Allow policy.
4. Select the intended identity provider, choose a bounded session duration,
   and create the application.

Do not use an Access Bypass policy for the dashboard or API.

### Create and route the tunnel

Cloudflare recommends remotely managed tunnels for most deployments and for
Docker:

1. Go to **Networking > Tunnels** and create a `cloudflared` tunnel.
2. Copy the installation command for the host. The embedded tunnel token is a
   secret: anyone with it can run that tunnel. Keep it out of the repository,
   images, logs, and shared shell history.
3. Wait for the connector to become healthy.
4. Add a **Published application** route for `memory.example.com` with service
   URL `http://localhost:4322`.
5. Enable **Protect with Access** for the route so `cloudflared` validates the
   Access application token.
6. Confirm that DNS is a proxied CNAME to `<tunnel-uuid>.cfargotunnel.com`.

Use a one-level subdomain when possible. Multi-level subdomains can require an
Advanced Certificate.

Start the dashboard adapter with the same public origin:

```bash
TITEN_DASHBOARD_LIVE=true \
TITEN_DASHBOARD_AUTH=session \
TITEN_API_URL=http://127.0.0.1:8787 \
TITEN_DASHBOARD_ORIGIN=https://memory.example.com \
pnpm dashboard:adapter
```

For Bun, Docker, and Podman, running `cloudflared` on the host keeps the route
to `127.0.0.1:4322` identical. If `cloudflared` is containerized, it must share
the adapter's network namespace or Podman pod; `localhost` in an unrelated
container points back to that container. Use the official
`cloudflare/cloudflared` image and inject the remotely managed tunnel token from
a secret at runtime.

### Optional REST or MCP hostname

Do not broaden the dashboard route. If remote agents require the API, add a
separate hostname such as `api.memory.example.com`, a separate Access
application, and a Service Auth policy. Route that hostname to
`http://127.0.0.1:8787` and keep Titen bearer authentication enabled.

An automated request then carries both Access credentials and its bounded Titen
credential:

```bash
curl https://api.memory.example.com/v1/principal \
  -H 'CF-Access-Client-Id: <access-client-id>' \
  -H 'CF-Access-Client-Secret: <access-client-secret>' \
  -H 'Authorization: Bearer <titen-api-key>'
```

Do not configure Access single-header authentication on `Authorization`; Titen
already uses that header. If a client cannot send the two Cloudflare headers in
addition to the Titen bearer key, use a private Tailscale or Cloudflare One
Client route instead of weakening either authentication layer.

When the hostname exposes `/mcp`, set:

```text
TITEN_MCP_ORIGIN=https://api.memory.example.com
```

### Locally managed alternative

Use a locally managed tunnel only when local configuration is a requirement.
Keep the account-wide `cert.pem` off the runtime host after provisioning; the
tunnel-specific credentials file is sufficient to run one tunnel.

```yaml
tunnel: <tunnel-uuid>
credentials-file: /etc/cloudflared/<tunnel-uuid>.json
ingress:
  - hostname: memory.example.com
    service: http://127.0.0.1:4322
  - service: http_status:404
```

```bash
cloudflared tunnel route dns <tunnel-uuid> memory.example.com
cloudflared tunnel --config /etc/cloudflared/config.yml run <tunnel-uuid>
```

The final catch-all rule is required. Protect the hostname with the same Access
application before running the tunnel.

### Verify and roll back

Verify all of these before declaring ingress complete:

- an anonymous dashboard request is stopped by Access;
- an allowed operator receives the live dashboard and exact deployed revision;
- an API request with Access credentials but no Titen key receives `401`;
- out-of-scope and revoked Titen keys still return the expected `403` and `401`;
- direct LAN and public access to host ports `4322` and `8787` fails;
- the tunnel reports healthy without printing credentials.

For rollback, remove the published route first and then stop the connector. The
loopback API, adapter, SQLite database, and headless operation remain unchanged.
Rotate the tunnel token immediately if it entered a repository, image, log, or
shared history.

Official references:

- [`cloudflared` downloads and packages](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/)
- [Create a remotely managed tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/)
- [Published applications and DNS](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/)
- [Protect a self-hosted public application](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/)
- [Tunnel-token permissions and rotation](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/remote-tunnel-permissions/)
- [Access service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/)
- [Locally managed configuration](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/configuration-file/)
- [Locally managed tunnel permissions](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/tunnel-permissions/)
