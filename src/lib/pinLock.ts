/**
 * Trusted-device session + local PIN unlock.
 * ------------------------------------------
 * Architecture (see in-code diagram in AuthedGate):
 *
 *   FIRST LOGIN (email+password) → verify → create 6-digit PIN
 *     → trusted device created (trust timestamp stored)
 *   EVERY LAUNCH within 60 days → PIN unlocks the live session
 *   LOGOUT or 60-DAY EXPIRY → trust destroyed → email+password again
 *
 * The important distinction: the PIN itself is never "valid for 60 days".
 * The authenticated device trust is valid for up to 60 days; the PIN merely
 * unlocks that trusted session on each launch.
 *
 * Storage: localStorage (persists in the Capacitor webview). The PIN itself
 * is NEVER stored — only a salted SHA-256 hash. Everything is scoped per
 * Firebase uid so a second account on a shared phone gets its own setup
 * instead of being locked behind someone else's PIN.
 */

export const PIN_LENGTH = 6;
export const MAX_PIN_ATTEMPTS = 5;
export const MAX_SESSION_DAYS = 60;
export const MAX_SESSION_MS = MAX_SESSION_DAYS * 24 * 60 * 60 * 1000;

const HASH_KEY = "bunius.pinHash";
const SALT_KEY = "bunius.pinSalt";
const UID_KEY = "bunius.pinUid";
const SKIPPED_UID_KEY = "bunius.pinSkippedUid";
const TRUSTED_SINCE_KEY = "bunius.trustedSince";

function storageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private mode / blocked storage: PIN simply won't persist.
  }
}

function storageRemove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function randomSaltHex(bytes = 16): string {
  const buf = new Uint8Array(bytes);
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    crypto.getRandomValues(buf);
  } else {
    for (let i = 0; i < buf.length; i += 1) buf[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(input: string): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  // Non-secure-context fallback (plain http dev server): NOT cryptographic,
  // only obfuscation so the feature keeps working. Production (https /
  // Capacitor) always takes the WebCrypto path above.
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

export function isPinFormatValid(pin: string): boolean {
  return new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin);
}

/** PIN exists AND belongs to this account. */
export function hasPinFor(uid: string | null | undefined): boolean {
  if (!uid) return false;
  return storageGet(HASH_KEY) !== null && storageGet(SALT_KEY) !== null && storageGet(UID_KEY) === uid;
}

/** Legacy alias — prefer hasPinFor(uid). */
export function hasPin(): boolean {
  return storageGet(HASH_KEY) !== null && storageGet(SALT_KEY) !== null;
}

export function wasPinSkippedFor(uid: string | null | undefined): boolean {
  if (!uid) return false;
  return storageGet(SKIPPED_UID_KEY) === uid;
}

/** Legacy alias — prefer wasPinSkippedFor(uid). */
export function wasPinSkipped(): boolean {
  return storageGet(SKIPPED_UID_KEY) !== null;
}

export function markPinSkippedFor(uid: string): void {
  storageSet(SKIPPED_UID_KEY, uid);
}

/** Legacy alias. */
export function markPinSkipped(): void {
  storageSet(SKIPPED_UID_KEY, "1");
}

export function clearPinSkipped(): void {
  storageRemove(SKIPPED_UID_KEY);
}

export async function setPinFor(pin: string, uid: string): Promise<void> {
  if (!isPinFormatValid(pin)) throw new Error(`PIN must be ${PIN_LENGTH} digits.`);
  if (!uid) throw new Error("Account id is required to store a PIN.");
  const salt = randomSaltHex();
  const hash = await sha256Hex(`${salt}:${uid}:${pin}`);
  storageSet(SALT_KEY, salt);
  storageSet(HASH_KEY, hash);
  storageSet(UID_KEY, uid);
  storageRemove(SKIPPED_UID_KEY);
  setTrustedSince(Date.now());
}

/** Legacy alias — prefer setPinFor(pin, uid). */
export async function setPin(pin: string): Promise<void> {
  if (!isPinFormatValid(pin)) throw new Error(`PIN must be ${PIN_LENGTH} digits.`);
  const salt = randomSaltHex();
  const hash = await sha256Hex(`${salt}:${pin}`);
  storageSet(SALT_KEY, salt);
  storageSet(HASH_KEY, hash);
  storageRemove(SKIPPED_UID_KEY);
}

export async function verifyPinFor(pin: string, uid: string): Promise<boolean> {
  const salt = storageGet(SALT_KEY);
  const expected = storageGet(HASH_KEY);
  if (!salt || !expected || storageGet(UID_KEY) !== uid) return false;
  const actual = await sha256Hex(`${salt}:${uid}:${pin}`);
  return actual === expected;
}

/** Legacy alias — prefer verifyPinFor(pin, uid). */
export async function verifyPin(pin: string): Promise<boolean> {
  const salt = storageGet(SALT_KEY);
  const expected = storageGet(HASH_KEY);
  if (!salt || !expected) return false;
  const actual = await sha256Hex(`${salt}:${pin}`);
  return actual === expected;
}

export function clearPin(): void {
  storageRemove(HASH_KEY);
  storageRemove(SALT_KEY);
  storageRemove(UID_KEY);
  storageRemove(SKIPPED_UID_KEY);
}

/** Start (or renew) the 60-day trusted-device window. Call on password login. */
export function setTrustedSince(timestamp: number): void {
  storageSet(TRUSTED_SINCE_KEY, String(timestamp));
}

export function getTrustedSince(): number | null {
  const raw = storageGet(TRUSTED_SINCE_KEY);
  const ts = raw === null ? NaN : Number(raw);
  return Number.isFinite(ts) && ts > 0 ? ts : null;
}

/** Destroy device trust (logout / expiry / lockout). */
export function clearTrust(): void {
  storageRemove(TRUSTED_SINCE_KEY);
}

export function isTrustExpired(now: number = Date.now()): boolean {
  const since = getTrustedSince();
  if (since === null) return false;
  return now - since > MAX_SESSION_MS;
}
