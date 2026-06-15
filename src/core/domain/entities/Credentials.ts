// ─────────────────────────────────────────────────────────────────────────────
// SealedCredentials  (RF5 — credential memory hygiene)
//
// JavaScript private class fields (#) provide *runtime* privacy — the values
// are unreachable from outside the class, even via (obj as any).#field or
// Object.keys(). After seal() is called the strings are zeroed and every
// accessor throws, minimising the window in which plaintext credentials live
// in the heap.
//
// Note on JavaScript string immutability: JS strings are immutable primitives;
// we cannot overwrite the bytes of the original string value in memory.
// What seal() does is (a) replace the reference with an empty string so GC can
// collect the original as soon as there are no other live references, and
// (b) set a permanent guard that prevents any further reads through this object.
// ─────────────────────────────────────────────────────────────────────────────

export class CredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialError';
  }
}

export class SealedCredentials {
  // Real JS private fields — not accessible at runtime via any cast.
  #username: string;
  #password: string;
  #sealed   = false;

  constructor(username: string, password: string) {
    if (!username || username.trim().length === 0) {
      throw new CredentialError('username must be a non-empty string');
    }
    if (password === null || password === undefined) {
      throw new CredentialError('password must be a string');
    }
    this.#username = username;
    this.#password = password;
  }

  // ── Accessors ──────────────────────────────────────────────────────────────

  get username(): string {
    if (this.#sealed) throw new CredentialError('Credentials have been sealed — username is no longer accessible');
    return this.#username;
  }

  get password(): string {
    if (this.#sealed) throw new CredentialError('Credentials have been sealed — password is no longer accessible');
    return this.#password;
  }

  get isSealed(): boolean {
    return this.#sealed;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Zero-out the credential strings and permanently disable all reads.
   *
   * Must be called immediately after the auth agent consumes the credentials,
   * regardless of whether login succeeded or failed.
   *
   * Calling seal() more than once is safe and has no effect after the first call.
   */
  seal(): void {
    if (this.#sealed) return;
    // Replace references so the GC can collect the original string values.
    this.#username = '';
    this.#password = '';
    this.#sealed   = true;
  }

  // Prevent accidental serialisation of credentials.
  toJSON(): Record<string, never> {
    return {};
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return this.#sealed ? 'SealedCredentials[sealed]' : 'SealedCredentials[live]';
  }
}
