import { AsyncLocalStorage } from "node:async_hooks";

export type AlpacaCredentials = { keyId: string; secretKey: string };

type CredentialRow = {
  encrypted_credentials: string;
  iv: string;
  key_id_masked: string;
  connected_at: string;
  validated_at: string;
};

export type CredentialStatus = {
  connected: boolean;
  provider: "alpaca";
  maskedKeyId?: string;
  connectedAt?: string;
  validatedAt?: string;
};

const COOKIE_NAME = "mm_market_session";
const SESSION_BYTES = 32;

export const marketDataCredentialContext = new AsyncLocalStorage<AlpacaCredentials | null>();

export function currentAlpacaCredentials() {
  return marketDataCredentialContext.getStore() || null;
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function sessionFromRequest(request: Request) {
  const cookie = request.headers.get("cookie") || "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  if (!match) return null;
  try {
    const value = decodeURIComponent(match[1]);
    return base64UrlToBytes(value).length === SESSION_BYTES ? value : null;
  } catch {
    return null;
  }
}

async function sessionHash(session: string) {
  const digest = await crypto.subtle.digest("SHA-256", base64UrlToBytes(session));
  return bytesToBase64Url(new Uint8Array(digest));
}

async function encryptionKey(session: string) {
  return crypto.subtle.importKey("raw", base64UrlToBytes(session), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function ensureCredentialSchema(db: D1Database) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS market_data_credentials (
    session_hash TEXT NOT NULL,
    provider TEXT NOT NULL,
    encrypted_credentials TEXT NOT NULL,
    iv TEXT NOT NULL,
    key_id_masked TEXT NOT NULL,
    connected_at TEXT NOT NULL,
    validated_at TEXT NOT NULL,
    PRIMARY KEY (session_hash, provider)
  )`).run();
}

async function credentialRow(request: Request, db: D1Database) {
  const session = sessionFromRequest(request);
  if (!session) return { session: null, row: null };
  await ensureCredentialSchema(db);
  const row = await db.prepare("SELECT encrypted_credentials, iv, key_id_masked, connected_at, validated_at FROM market_data_credentials WHERE session_hash = ? AND provider = 'alpaca'")
    .bind(await sessionHash(session)).first<CredentialRow>();
  return { session, row };
}

export async function credentialsForRequest(request: Request, db: D1Database): Promise<AlpacaCredentials | null> {
  try {
    const { session, row } = await credentialRow(request, db);
    if (!session || !row) return null;
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64UrlToBytes(row.iv) }, await encryptionKey(session), base64UrlToBytes(row.encrypted_credentials));
    return JSON.parse(new TextDecoder().decode(plaintext)) as AlpacaCredentials;
  } catch {
    return null;
  }
}

export async function credentialStatus(request: Request, db: D1Database): Promise<CredentialStatus> {
  const { row } = await credentialRow(request, db);
  return row ? { connected: true, provider: "alpaca", maskedKeyId: row.key_id_masked, connectedAt: row.connected_at, validatedAt: row.validated_at } : { connected: false, provider: "alpaca" };
}

export async function saveCredentials(request: Request, db: D1Database, credentials: AlpacaCredentials) {
  let session = sessionFromRequest(request);
  if (!session) session = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(SESSION_BYTES)));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(session), new TextEncoder().encode(JSON.stringify(credentials)));
  const now = new Date().toISOString();
  const maskedKeyId = credentials.keyId.length > 8 ? `${credentials.keyId.slice(0, 4)}••••${credentials.keyId.slice(-4)}` : "••••••••";
  await ensureCredentialSchema(db);
  await db.prepare(`INSERT INTO market_data_credentials (session_hash, provider, encrypted_credentials, iv, key_id_masked, connected_at, validated_at)
    VALUES (?, 'alpaca', ?, ?, ?, ?, ?)
    ON CONFLICT(session_hash, provider) DO UPDATE SET encrypted_credentials = excluded.encrypted_credentials, iv = excluded.iv,
      key_id_masked = excluded.key_id_masked, connected_at = excluded.connected_at, validated_at = excluded.validated_at`)
    .bind(await sessionHash(session), bytesToBase64Url(new Uint8Array(encrypted)), bytesToBase64Url(iv), maskedKeyId, now, now).run();
  return { status: { connected: true, provider: "alpaca", maskedKeyId, connectedAt: now, validatedAt: now } satisfies CredentialStatus, cookie: `${COOKIE_NAME}=${encodeURIComponent(session)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000${new URL(request.url).protocol === "https:" ? "; Secure" : ""}` };
}

export async function deleteCredentials(request: Request, db: D1Database) {
  const session = sessionFromRequest(request);
  if (session) {
    await ensureCredentialSchema(db);
    await db.prepare("DELETE FROM market_data_credentials WHERE session_hash = ? AND provider = 'alpaca'").bind(await sessionHash(session)).run();
  }
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
}
