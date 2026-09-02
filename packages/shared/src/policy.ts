/**
 * Shared security policy constants.
 *
 * Kept here rather than duplicated as literals so the API validators and the
 * admin UI cannot drift apart — a mismatch shows up as a form that accepts a
 * password the server then rejects.
 */

/**
 * Minimum length for a local account password, applied to the breakglass
 * bootstrap password and to admin-created user passwords.
 *
 * Not applied when *logging in* — the login DTO deliberately accepts any
 * non-empty string so that changing this value never locks out an existing
 * account whose password predates the change.
 *
 * Passwords are hashed with argon2id (19 MiB, t=2, p=1), so length is only one
 * part of the picture; the hash parameters do the heavy lifting against
 * offline attack.
 */
export const MIN_PASSWORD_LENGTH = 10;
