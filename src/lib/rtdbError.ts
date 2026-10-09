/**
 * RTDB write-failure helpers.
 *
 * A rejected write is not always a network problem — most often the security
 * rules refused it. Calling that "check your connection" sends the operator
 * chasing the wrong thing, so permission failures are surfaced distinctly.
 */

function isPermissionDenied(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && code.toUpperCase().includes("PERMISSION_DENIED");
}

/** Message for a failed write: a permission message, or `fallback` for the rest. */
export function writeErrorMessage(error: unknown, fallback: string): string {
  return isPermissionDenied(error)
    ? "You don't have permission to do that — sign in with the operator account."
    : fallback;
}
