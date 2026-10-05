import { AsyncLocalStorage } from "node:async_hooks";

export type AppUser = { id: string; email: string | null; username: string; displayName: string; isLocal: boolean; isAdmin: boolean; mustChangePassword: boolean };
type CredentialUserRow = { id: string; username: string; display_name: string; password_hash: string; password_salt: string; must_change_password: number; is_admin: number; active: number; failed_attempts: number; locked_until: string | null };

const OWNER_EMAIL = "samxstevenson@gmail.com", SESSION_COOKIE = "mm_auth_session", SESSION_DAYS = 7, PBKDF2_ITERATIONS = 100_000;
const authSchemaReady = new WeakMap<object, Promise<void>>();
const localUser: AppUser = { id: "local-user", email: OWNER_EMAIL, username: "local", displayName: "Local owner", isLocal: true, isAdmin: true, mustChangePassword: false };
export const userContext = new AsyncLocalStorage<AppUser>();
export function currentUser() { return userContext.getStore() || localUser; }

function bytesToBase64Url(bytes: Uint8Array) { let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, ""); }
function base64UrlToBytes(value: string) { const base64 = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "="); return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0)); }
function cookieValue(request: Request, name: string) { const match = (request.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`)); return match ? decodeURIComponent(match[1]) : null; }
async function sha256(value: string) { return bytesToBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))); }
async function passwordHash(password: string, salt: string) { const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]); const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: base64UrlToBytes(salt), iterations: PBKDF2_ITERATIONS }, key, 256); return bytesToBase64Url(new Uint8Array(bits)); }
function safeEqual(left: string, right: string) { if (left.length !== right.length) return false; let difference = 0; for (let i = 0; i < left.length; i += 1) difference |= left.charCodeAt(i) ^ right.charCodeAt(i); return difference === 0; }
function normalizeUsername(value: string) { const username = value.trim().toLowerCase(); if (!/^[a-z][a-z0-9._-]{2,31}$/.test(username)) throw new Error("Usernames must be 3–32 characters and begin with a letter."); return username; }
function validatePassword(password: string) { if (password.length < 12 || password.length > 128 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) throw new Error("Passwords must be 12–128 characters and include uppercase, lowercase, and a number."); }
function validateTemporaryPassword(password: string) { if (!password.length) throw new Error("Temporary password is required."); }
function urlSecure(request: Request) { return new URL(request.url).protocol === "https:" ? "; Secure" : ""; }

export async function ensureAuthSchema(db: D1Database) {
  const key = db as unknown as object; let ready = authSchemaReady.get(key);
  if (!ready) { ready = db.batch([db.prepare(`CREATE TABLE IF NOT EXISTS app_users (id TEXT PRIMARY KEY NOT NULL, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, must_change_password INTEGER NOT NULL DEFAULT 1, is_admin INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, failed_attempts INTEGER NOT NULL DEFAULT 0, locked_until TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`), db.prepare(`CREATE TABLE IF NOT EXISTS app_sessions (token_hash TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES app_users(id))`), db.prepare("CREATE INDEX IF NOT EXISTS idx_app_sessions_user_expiry ON app_sessions(user_id, expires_at)")]).then(() => undefined); authSchemaReady.set(key, ready); }
  await ready;
}
function rowToUser(row: CredentialUserRow): AppUser { return { id: row.id, email: null, username: row.username, displayName: row.display_name, isLocal: false, isAdmin: Boolean(row.is_admin), mustChangePassword: Boolean(row.must_change_password) }; }

export async function userForRequest(request: Request, db: D1Database): Promise<AppUser | null> {
  const url = new URL(request.url), local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  const oaiId = request.headers.get("oai-authenticated-user-id")?.trim(), email = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase();
  if (oaiId && email === OWNER_EMAIL) return { id: oaiId, email, username: "owner", displayName: "Sam Stevenson", isLocal: false, isAdmin: true, mustChangePassword: false };
  await ensureAuthSchema(db); const token = cookieValue(request, SESSION_COOKIE);
  if (token) {
    const row = await db.prepare(`SELECT u.id, u.username, u.display_name, u.password_hash, u.password_salt, u.must_change_password, u.is_admin, u.active, u.failed_attempts, u.locked_until FROM app_sessions s JOIN app_users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`).bind(await sha256(token), new Date().toISOString()).first<CredentialUserRow>();
    if (row) return rowToUser(row);
  }
  return local ? localUser : null;
}

export async function loginWithPassword(request: Request, db: D1Database, usernameInput: string, password: string) {
  await ensureAuthSchema(db); let username = ""; try { username = normalizeUsername(usernameInput); } catch { username = usernameInput.trim().toLowerCase(); }
  const row = await db.prepare("SELECT id, username, display_name, password_hash, password_salt, must_change_password, is_admin, active, failed_attempts, locked_until FROM app_users WHERE username = ?").bind(username).first<CredentialUserRow>();
  const calculated = await passwordHash(password, row?.password_salt || bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16))));
  const now = new Date(), locked = Boolean(row?.locked_until && new Date(row.locked_until) > now);
  if (!row || !row.active || locked || !safeEqual(calculated, row.password_hash)) {
    if (row && row.active && !locked) { const attempts = row.failed_attempts + 1, lockUntil = attempts >= 5 ? new Date(now.getTime() + 15 * 60_000).toISOString() : null; await db.prepare("UPDATE app_users SET failed_attempts = ?, locked_until = ?, updated_at = ? WHERE id = ?").bind(attempts >= 5 ? 0 : attempts, lockUntil, now.toISOString(), row.id).run(); }
    throw new Error("Invalid username or password.");
  }
  const token = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32))), expires = new Date(now.getTime() + SESSION_DAYS * 86_400_000).toISOString();
  await db.batch([db.prepare("UPDATE app_users SET failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?").bind(now.toISOString(), row.id), db.prepare("DELETE FROM app_sessions WHERE expires_at <= ?").bind(now.toISOString()), db.prepare("INSERT INTO app_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").bind(await sha256(token), row.id, expires)]);
  return { user: rowToUser(row), cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DAYS * 86_400}${urlSecure(request)}` };
}
export async function logout(request: Request, db: D1Database) { await ensureAuthSchema(db); const token = cookieValue(request, SESSION_COOKIE); if (token) await db.prepare("DELETE FROM app_sessions WHERE token_hash = ?").bind(await sha256(token)).run(); return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${urlSecure(request)}`; }
export async function changePassword(db: D1Database, user: AppUser, password: string) { if (user.isLocal || user.email) throw new Error("This account is managed by OpenAI sign-in."); validatePassword(password); const salt = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16))), hash = await passwordHash(password, salt), now = new Date().toISOString(); await db.prepare("UPDATE app_users SET password_hash = ?, password_salt = ?, must_change_password = 0, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ? AND active = 1").bind(hash, salt, now, user.id).run(); }
export async function listCredentialUsers(db: D1Database) { await ensureAuthSchema(db); const rows = await db.prepare("SELECT id, username, display_name, must_change_password, active, created_at FROM app_users ORDER BY created_at").all<Record<string, string | number>>(); return rows.results.map((row) => ({ id: row.id, username: row.username, displayName: row.display_name, mustChangePassword: Boolean(row.must_change_password), active: Boolean(row.active), createdAt: row.created_at })); }
export async function createCredentialUser(db: D1Database, input: { username: string; displayName: string; temporaryPassword: string }) { await ensureAuthSchema(db); const username = normalizeUsername(input.username), displayName = input.displayName.trim(); if (!displayName || displayName.length > 80) throw new Error("Display name is required and must be 80 characters or fewer."); validateTemporaryPassword(input.temporaryPassword); const salt = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16))), hash = await passwordHash(input.temporaryPassword, salt), id = `app:${crypto.randomUUID()}`; await db.prepare("INSERT INTO app_users (id, username, display_name, password_hash, password_salt, must_change_password) VALUES (?, ?, ?, ?, ?, 1)").bind(id, username, displayName, hash, salt).run(); return { id, username, displayName, mustChangePassword: true, active: true }; }
export async function resetCredentialPassword(db: D1Database, id: string, password: string) { validateTemporaryPassword(password); const salt = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16))), hash = await passwordHash(password, salt), now = new Date().toISOString(); const result = await db.prepare("UPDATE app_users SET password_hash = ?, password_salt = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL, active = 1, updated_at = ? WHERE id = ?").bind(hash, salt, now, id).run(); if (!result.meta.changes) throw new Error("User not found."); await db.prepare("DELETE FROM app_sessions WHERE user_id = ?").bind(id).run(); }
export async function deactivateCredentialUser(db: D1Database, id: string) { const result = await db.prepare("UPDATE app_users SET active = 0, updated_at = ? WHERE id = ?").bind(new Date().toISOString(), id).run(); if (!result.meta.changes) throw new Error("User not found."); await db.prepare("DELETE FROM app_sessions WHERE user_id = ?").bind(id).run(); }
export function requireAdmin() { if (!currentUser().isAdmin) throw new Error("Administrator access is required."); }
export function requireLocalWorkspace() { if (!currentUser().isLocal) throw new Error("Corporate-action simulation is available only in a local workspace."); }
