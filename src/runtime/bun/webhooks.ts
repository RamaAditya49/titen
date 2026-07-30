import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import type { WebhookSecurity } from "../../core/webhook-security";

export function pinnedLookup(address: string) {
  const family = address.includes(":") ? 6 : 4;
  return (_hostname: string, options: { all?: boolean }, callback: (...args: any[]) => void) => {
    if (options?.all) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };
}

/** DNS-resolved and address-pinned HTTPS transport for the Bun/VPS runtime. */
export function createBunWebhookSecurity(value: string | undefined): WebhookSecurity | undefined {
  const allowedHostnames = value?.split(",").map((host) => host.trim()).filter(Boolean);
  if (!allowedHostnames?.length) return undefined;
  return {
    allowedHostnames,
    async resolve(hostname) {
      return (await lookup(hostname, { all: true, verbatim: true })).map(({ address }) => address);
    },
    dispatch({ url, addresses, init }) {
      const pinned = addresses[0]!;
      return new Promise((resolve, reject) => {
        const request = httpsRequest(url, {
          method: init.method,
          headers: Object.fromEntries(new Headers(init.headers)),
          signal: init.signal ?? undefined,
          // Keep TLS SNI/hostname verification from `url`, but never resolve a
          // second address inside the HTTP client.
          lookup: pinnedLookup(pinned),
        }, (response) => {
          const headers = new Headers();
          for (let index = 0; index < response.rawHeaders.length; index += 2)
            headers.append(response.rawHeaders[index]!, response.rawHeaders[index + 1]!);
          response.resume();
          resolve({
            response: new Response(null, { status: response.statusCode ?? 502, headers }),
            // This client supplied the sole lookup result; Node/Bun could not
            // have opened the connection to a different address.
            connectedAddress: pinned,
          });
        });
        request.once("error", reject);
        if (typeof init.body === "string") request.end(init.body);
        else request.end();
      });
    },
  };
}
