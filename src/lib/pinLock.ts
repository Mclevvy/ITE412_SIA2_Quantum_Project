/**
 * Device PIN lock — fast unlock for a shared field phone.
 * ------------------------------------------------------
 * The PIN is a LOCAL convenience lock, not a credential: Firebase Auth still
 * owns the real session, and the PIN gate only appears while that session is
 * alive. If the session expires, the user signs in with email/password again.
 *
 * Storage: localStorage (persists in the Capacitor webview). The PIN itself
 * is NEVER stored — only a salted SHA-256 hash. This is a deterrent for
 * casual access on a shared device, not a vault against forensic extraction.
 */

export const PIN_LENGTH = 4;
export const MAX_PIN_ATTEMPTS = 5;

const HASH_KEY = "bunius.pinHash";
const SALT_KEY = "bunius.pinSalt";
const SKIPPED_KEY = "bunius.pinSkipped";

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

export function hasPin(): boolean {
  return storageGet(HASH_KEY) !== null && storageGet(SALT_KEY) !== null;
}

export function wasPinSkipped(): boolean {
  return storageGet(SKIPPED_KEY) === "1";
}

export function markPinSkipped(): void {
  storageSet(SKIPPED_KEY, "1");
}

export function clearPinSkipped(): void {
  storageRemove(SKIPPED_KEY);
}

export async function setPin(pin: string): Promise<void> {
  if (!isPinFormatValid(pin)) throw new Error(`PIN must be ${PIN_LENGTH} digits.`);
  const salt = randomSaltHex();
  const hash = await sha256Hex(`${salt}:${pin}`);
  storageSet(SALT_KEY, salt);
  storageSet(HASH_KEY, hash);
  storageRemove(SKIPPED_KEY);
}

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
  storageRemove(SKIPPED_KEY);
}
