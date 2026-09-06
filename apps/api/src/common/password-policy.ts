/**
 * SAMCO password policy — the single definition used everywhere a password is
 * accepted from a client (account creation and password change).
 *
 * This is deliberately MINIMAL and matches the rule that already existed on
 * CreateUserDto (`@MinLength(8)`). It was extracted here rather than
 * re-invented, so account creation and password change cannot drift apart and
 * no existing user is suddenly unable to rotate a password they were allowed to
 * register with.
 *
 * MAX length exists for a concrete reason, not as arbitrary strictness: bcrypt
 * silently truncates input beyond 72 BYTES. Without an explicit bound, a 200
 * character passphrase would be quietly reduced to its first 72 bytes, and two
 * different long passwords sharing a prefix would authenticate interchangeably.
 * Rejecting the input is honest; truncating it silently is not.
 *
 * Note the unit mismatch: class-validator's MaxLength counts UTF-16 code units
 * while bcrypt counts bytes, so a multi-byte password can still exceed 72 bytes
 * at fewer than 72 characters. The bound is therefore a guard against the
 * obvious case, not a precise one — see BACKLOG for byte-accurate validation.
 *
 * Complexity rules (character classes, dictionaries, breach lists, rotation
 * expiry) are deliberately NOT implemented: modern guidance (NIST SP 800-63B)
 * favours length and breach-checking over composition rules, and breach-list
 * lookups need infrastructure that is out of scope for Phase 1.
 */
export const PASSWORD_POLICY = {
  MIN_LENGTH: 8,
  /** bcrypt's effective input ceiling. */
  MAX_LENGTH: 72,
} as const;
