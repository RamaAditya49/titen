import { isIP } from "node:net";

export function loginClientAddress(socketAddress: string | undefined, request: Request, trustedHeader?: string): string {
  const address = socketAddress ?? "unknown-client";
  if (trustedHeader && ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address)) {
    const forwarded = request.headers.get(trustedHeader)?.trim();
    if (forwarded && isIP(forwarded)) return forwarded;
  }
  return address;
}

export function createClientLoginLimit(client: (request: Request) => string, now: () => number = Date.now) {
  const attempts = new Map<string, { count: number; expires: number }>();
  return {
    async limit({ request }: { request: Request }) {
      const time = now();
      const key = client(request);
      let bucket = attempts.get(key);
      if (!bucket || bucket.expires <= time) {
        for (const [storedKey, stored] of attempts) if (stored.expires <= time) attempts.delete(storedKey);
        if (attempts.size >= 4096) return { success: false };
        bucket = { count: 0, expires: time + 60_000 };
        attempts.set(key, bucket);
      }
      bucket.count++;
      return { success: bucket.count <= 20 };
    },
  };
}
