/**
 * True when a session email matches the configured admin email. Pure so the
 * comparison is testable; callers pass process.env.ADMIN_EMAIL server-side.
 * An unset admin email matches nothing.
 */
export function isAdminEmail(
  email: string | null | undefined,
  adminEmail: string | null | undefined
): boolean {
  return Boolean(adminEmail) && email === adminEmail;
}
