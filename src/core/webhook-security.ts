import { unavailable, validationError } from "./errors";

export interface WebhookSecurity {
  allowedHostnames: readonly string[];
  /** Defaults to 10 seconds; embedded runtimes and tests may lower it. */
  timeoutMs?: number;
  resolve(hostname: string): Promise<readonly string[]>;
  dispatch(request: {
    url: string;
    hostname: string;
    addresses: readonly string[];
    init: RequestInit;
  }): Promise<{ response: Response; connectedAddress: string }>;
}

function canonicalIpv4(value: string): number[] | null {
  try {
    const normalized = new URL(`http://${value}/`).hostname;
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(normalized)) return null;
    const bytes = normalized.split(".").map(Number);
    return bytes.length === 4 && bytes.every((part) => part >= 0 && part <= 255) ? bytes : null;
  } catch {
    return null;
  }
}

function unsafeIpv4([a, b, c]: number[]): boolean {
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b! >= 64 && b! <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0 && c === 113) ||
    a! >= 224
  );
}

function ipv6Words(value: string): number[] | null {
  let input = value.toLowerCase();
  if (input.startsWith("[") && input.endsWith("]")) input = input.slice(1, -1);
  if (input.includes("%")) return null;
  const lastColon = input.lastIndexOf(":");
  const tail = lastColon >= 0 ? input.slice(lastColon + 1) : "";
  const ipv4Tail = tail.includes(".") ? canonicalIpv4(tail) : null;
  if (ipv4Tail)
    input = `${input.slice(0, lastColon)}:${((ipv4Tail[0]! << 8) | ipv4Tail[1]!).toString(16)}:${((ipv4Tail[2]! << 8) | ipv4Tail[3]!).toString(16)}`;
  const halves = input.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const words = [...left, ...Array(missing).fill("0"), ...right].map((part) => Number.parseInt(part, 16));
  return words.length === 8 && words.every((word) => Number.isInteger(word) && word >= 0 && word <= 0xffff)
    ? words
    : null;
}

export function isUnsafeWebhookAddress(address: string): boolean {
  const ipv4 = canonicalIpv4(address);
  if (ipv4) return unsafeIpv4(ipv4);
  const words = ipv6Words(address);
  if (!words) return true;
  const mapped = words.slice(0, 5).every((word) => word === 0) && (words[5] === 0 || words[5] === 0xffff);
  if (mapped)
    return unsafeIpv4([words[6]! >> 8, words[6]! & 255, words[7]! >> 8, words[7]! & 255]);
  // Only ordinary global unicast is accepted. Block documentation, benchmarking,
  // ORCHID, Teredo, and 6to4 because they can tunnel an unsafe IPv4 destination.
  if (words[0]! < 0x2000 || words[0]! > 0x3fff) return true;
  if (words[0] === 0x2001 && [0x0000, 0x0002, 0x0db8].includes(words[1]!)) return true;
  if (words[0] === 0x2001 && words[1]! >= 0x0010 && words[1]! <= 0x001f) return true;
  if (words[0] === 0x2002) return true;
  return false;
}

export async function validateWebhookDestination(
  value: string,
  security: WebhookSecurity | undefined,
): Promise<{ url: string; hostname: string; addresses: string[] }> {
  if (!security) throw unavailable("Webhook delivery security is not configured.");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw validationError('Field "url" must be a valid HTTPS URL.');
  }
  if (parsed.protocol !== "https:") throw validationError('Field "url" must use HTTPS.');
  if (parsed.username || parsed.password) throw validationError('Field "url" must not contain credentials.');
  if (parsed.hash) throw validationError('Field "url" must not contain a fragment.');
  if (parsed.port && parsed.port !== "443") throw validationError('Field "url" may only use HTTPS port 443.');
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname || hostname.includes(":") || canonicalIpv4(hostname))
    throw validationError('Field "url" must use a DNS hostname, not an IP literal.');
  const allowed = new Set(security.allowedHostnames.map((host) => host.toLowerCase().replace(/\.$/, "")));
  if (!allowed.has(hostname)) throw validationError('Field "url" hostname is not allowlisted.');
  let resolved: readonly string[];
  try {
    resolved = await security.resolve(hostname);
  } catch {
    throw unavailable("Webhook DNS resolution failed.");
  }
  const addresses = [...new Set(resolved)];
  if (!addresses.length || addresses.some(isUnsafeWebhookAddress))
    throw validationError("Webhook hostname resolved to an unsafe address.");
  parsed.hostname = hostname;
  return { url: parsed.toString(), hostname, addresses };
}

export async function dispatchWebhook(
  value: string,
  security: WebhookSecurity | undefined,
  init: RequestInit,
): Promise<Response> {
  const destination = await validateWebhookDestination(value, security);
  const result = await security!.dispatch({
    ...destination,
    init: { ...init, redirect: "error" },
  });
  if (!destination.addresses.includes(result.connectedAddress))
    throw unavailable("Webhook transport did not prove address pinning.");
  if (result.response.status >= 300 && result.response.status < 400)
    throw unavailable("Webhook redirects are disabled.");
  return result.response;
}
