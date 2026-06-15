import { SealedCredentials, CredentialError } from '../Credentials';

// ─────────────────────────────────────────────────────────────────────────────
// SealedCredentials — unit tests  (RF5)
// ─────────────────────────────────────────────────────────────────────────────

describe('SealedCredentials', () => {

  // ── Construction ────────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('creates a live credential object with a valid username and password', () => {
      const creds = new SealedCredentials('alice@example.com', 'p@ssw0rd');
      expect(creds.isSealed).toBe(false);
    });

    it('accepts an empty string as a password (blank passwords are valid)', () => {
      expect(() => new SealedCredentials('user', '')).not.toThrow();
    });

    it('throws CredentialError for an empty username', () => {
      expect(() => new SealedCredentials('', 'secret')).toThrow(CredentialError);
    });

    it('throws CredentialError for a whitespace-only username', () => {
      expect(() => new SealedCredentials('   ', 'secret')).toThrow(CredentialError);
    });

    it('throws CredentialError for null password', () => {
      // @ts-expect-error — deliberate misuse to verify runtime guard
      expect(() => new SealedCredentials('user', null)).toThrow(CredentialError);
    });

    it('throws CredentialError for undefined password', () => {
      // @ts-expect-error — deliberate misuse to verify runtime guard
      expect(() => new SealedCredentials('user', undefined)).toThrow(CredentialError);
    });
  });

  // ── Pre-seal reads ───────────────────────────────────────────────────────────

  describe('before sealing', () => {
    it('returns the correct username', () => {
      const creds = new SealedCredentials('bob@acme.com', 'hunter2');
      expect(creds.username).toBe('bob@acme.com');
    });

    it('returns the correct password', () => {
      const creds = new SealedCredentials('bob@acme.com', 'hunter2');
      expect(creds.password).toBe('hunter2');
    });

    it('isSealed is false', () => {
      const creds = new SealedCredentials('user', 'pass');
      expect(creds.isSealed).toBe(false);
    });
  });

  // ── Post-seal behaviour ──────────────────────────────────────────────────────

  describe('after seal()', () => {
    it('sets isSealed to true', () => {
      const creds = new SealedCredentials('user', 'pass');
      creds.seal();
      expect(creds.isSealed).toBe(true);
    });

    it('throws CredentialError when reading username after sealing', () => {
      const creds = new SealedCredentials('user', 'pass');
      creds.seal();
      expect(() => creds.username).toThrow(CredentialError);
    });

    it('throws CredentialError when reading password after sealing', () => {
      const creds = new SealedCredentials('user', 'pass');
      creds.seal();
      expect(() => creds.password).toThrow(CredentialError);
    });

    it('does not expose credentials in the error message', () => {
      const creds = new SealedCredentials('user', 'super-secret');
      creds.seal();
      let message = '';
      try { creds.password; } catch (e) { message = (e as Error).message; }
      expect(message).not.toContain('super-secret');
    });

    it('calling seal() a second time is a no-op (does not throw)', () => {
      const creds = new SealedCredentials('user', 'pass');
      creds.seal();
      expect(() => creds.seal()).not.toThrow();
    });

    it('isSealed remains true after second seal() call', () => {
      const creds = new SealedCredentials('user', 'pass');
      creds.seal();
      creds.seal();
      expect(creds.isSealed).toBe(true);
    });
  });

  // ── Serialisation safety ─────────────────────────────────────────────────────

  describe('serialisation', () => {
    it('toJSON() returns an empty object (credentials not leaked via JSON.stringify)', () => {
      const creds = new SealedCredentials('user', 'pass');
      expect(JSON.parse(JSON.stringify(creds))).toEqual({});
    });

    it('credentials are not enumerable via Object.keys()', () => {
      const creds = new SealedCredentials('user', 'pass');
      const keys = Object.keys(creds);
      expect(keys).not.toContain('username');
      expect(keys).not.toContain('password');
    });

    it('credentials are not visible in JSON even before sealing', () => {
      const creds = new SealedCredentials('admin', 'topsecret');
      const serialised = JSON.stringify({ input: { credentials: creds, url: 'https://x.com' } });
      expect(serialised).not.toContain('topsecret');
      expect(serialised).not.toContain('admin');
    });
  });

  // ── Runtime privacy ──────────────────────────────────────────────────────────

  describe('runtime privacy', () => {
    it('private fields cannot be read via property access cast', () => {
      const creds = new SealedCredentials('user', 'pass') as unknown as Record<string, unknown>;
      // TypeScript private fields accessed via (obj as any).field would work,
      // but JS # private fields are NOT accessible even at runtime.
      expect(creds['_username']).toBeUndefined();
      expect(creds['_password']).toBeUndefined();
    });
  });
});
