import type { Db, Stmt } from "./db";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const ENVELOPE_PREFIX = "titen-secret:v1:";
const REWRAP_BATCH = 50;

export interface SecretCipher {
  activeKey: string;
  encrypt(plaintext: string, aad: string): Promise<string>;
  decrypt(envelope: string, aad: string): Promise<string>;
}

interface Envelope {
  v: 1;
  alg: "A256GCM";
  kid: string;
  iv: string;
  ciphertext: string;
}

const base64url = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
};

function fromBase64url(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function bufferOf(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function parseEnvelope(value: string): Envelope {
  if (!value.startsWith(ENVELOPE_PREFIX))
    throw new Error("Signing secret is legacy plaintext and must be migrated.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(value.slice(ENVELOPE_PREFIX.length));
  } catch {
    throw new Error("Signing secret is legacy plaintext and must be migrated.");
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    (parsed as Partial<Envelope>).v !== 1 ||
    (parsed as Partial<Envelope>).alg !== "A256GCM" ||
    typeof (parsed as Partial<Envelope>).kid !== "string" ||
    typeof (parsed as Partial<Envelope>).iv !== "string" ||
    typeof (parsed as Partial<Envelope>).ciphertext !== "string"
  )
    throw new Error("Signing secret envelope is invalid.");
  return parsed as Envelope;
}

/** Web-Crypto AES-GCM keyring shared by Bun and Workers. */
export function createSecretCipher(config: {
  active: string;
  keys: Readonly<Record<string, string>>;
}): SecretCipher {
  if (!config.active || !config.keys[config.active])
    throw new Error("TITEN_SECRET_KEYS must name an active key.");
  const rawKeys = new Map<string, Uint8Array>();
  for (const [version, encoded] of Object.entries(config.keys)) {
    const raw = fromBase64url(encoded);
    if (raw.byteLength !== 32)
      throw new Error(`TITEN_SECRET_KEYS key ${version} must decode to 32 bytes.`);
    rawKeys.set(version, raw);
  }
  const key = async (version: string, usage: KeyUsage) => {
    const raw = rawKeys.get(version);
    if (!raw) throw new Error("The signing-secret key version is unavailable.");
    return crypto.subtle.importKey("raw", bufferOf(raw), "AES-GCM", false, [usage]);
  };
  return {
    activeKey: config.active,
    async encrypt(plaintext, aad) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: encoder.encode(aad), tagLength: 128 },
        await key(config.active, "encrypt"),
        encoder.encode(plaintext),
      );
      return ENVELOPE_PREFIX + JSON.stringify({
        v: 1,
        alg: "A256GCM",
        kid: config.active,
        iv: base64url(iv),
        ciphertext: base64url(new Uint8Array(ciphertext)),
      } satisfies Envelope);
    },
    async decrypt(value, aad) {
      const envelope = parseEnvelope(value);
      const plaintext = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: bufferOf(fromBase64url(envelope.iv)),
          additionalData: encoder.encode(aad),
          tagLength: 128,
        },
        await key(envelope.kid, "decrypt"),
        bufferOf(fromBase64url(envelope.ciphertext)),
      );
      return decoder.decode(plaintext);
    },
  };
}

export function parseSecretCipher(value: string | undefined): SecretCipher | undefined {
  if (!value) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("TITEN_SECRET_KEYS must be valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("TITEN_SECRET_KEYS must be an object.");
  const active = (parsed as { active?: unknown }).active;
  const keys = (parsed as { keys?: unknown }).keys;
  if (typeof active !== "string" || !keys || typeof keys !== "object" || Array.isArray(keys))
    throw new Error("TITEN_SECRET_KEYS must contain active and keys.");
  for (const value of Object.values(keys))
    if (typeof value !== "string") throw new Error("TITEN_SECRET_KEYS values must be strings.");
  return createSecretCipher({ active, keys: keys as Record<string, string> });
}

/**
 * Rewrap legacy rows and old key versions before serving. The plaintext is held
 * only in memory and every SQL change commits together.
 */
export async function migrateSigningSecrets(db: Db, cipher: SecretCipher): Promise<number> {
  let migrated = 0;
  const groups = [
    { table: "webhooks", column: "secret", prefix: "webhook" },
    { table: "federation_peers", column: "shared_secret", prefix: "federation" },
  ] as const;
  for (const group of groups) {
    let after = "";
    for (;;) {
      const rows = await db.all<{ id: string; value: string }>(
        `SELECT id, ${group.column} AS value FROM ${group.table}
          WHERE ${group.column} IS NOT NULL AND id > ? ORDER BY id LIMIT ?`,
        [after, REWRAP_BATCH],
      );
      if (!rows.length) break;
      const statements: Stmt[] = [];
      for (const row of rows) {
        const aad = `${group.prefix}:${row.id}`;
        let plaintext: string;
        let needsWrite = false;
        try {
          const envelope = parseEnvelope(row.value);
          plaintext = await cipher.decrypt(row.value, aad);
          needsWrite = envelope.kid !== cipher.activeKey;
        } catch (error) {
          if (row.value.startsWith(ENVELOPE_PREFIX)) throw error;
          plaintext = row.value;
          needsWrite = true;
        }
        if (needsWrite)
          statements.push({
            sql: `UPDATE ${group.table} SET ${group.column} = ? WHERE id = ?`,
            params: [await cipher.encrypt(plaintext, aad), row.id],
          });
      }
      if (statements.length) await db.batch(statements);
      migrated += statements.length;
      after = rows.at(-1)!.id;
    }
  }
  return migrated;
}

/** Existing recoverable signing secrets require a usable external keyring. */
export async function prepareSigningSecrets(
  db: Db,
  cipher: SecretCipher | undefined,
): Promise<boolean> {
  // A NULL signing secret cannot be recovered. Terminalize only those active
  // integrations so startup can resume without making an unsigned delivery.
  await db.batch([
    { sql: `UPDATE webhooks SET status = 'disabled' WHERE status = 'active' AND secret IS NULL` },
    { sql: `UPDATE federation_peers SET status = 'suspended' WHERE status = 'active' AND shared_secret IS NULL` },
  ]);
  const counts = await Promise.all([
    db.all<{ present: number; missing: number }>(
      `SELECT SUM(CASE WHEN secret IS NOT NULL THEN 1 ELSE 0 END) AS present,
              SUM(CASE WHEN status = 'active' AND secret IS NULL THEN 1 ELSE 0 END) AS missing
         FROM webhooks`,
    ),
    db.all<{ present: number; missing: number }>(
      `SELECT SUM(CASE WHEN shared_secret IS NOT NULL THEN 1 ELSE 0 END) AS present,
              SUM(CASE WHEN status = 'active' AND shared_secret IS NULL THEN 1 ELSE 0 END) AS missing
         FROM federation_peers`,
    ),
  ]);
  if (counts.some((rows) => Number(rows[0]?.missing ?? 0) > 0)) return false;
  const present = counts.some((rows) => Number(rows[0]?.present ?? 0) > 0);
  if (!present) return true;
  if (!cipher) return false;
  try {
    await migrateSigningSecrets(db, cipher);
    return true;
  } catch {
    return false;
  }
}
