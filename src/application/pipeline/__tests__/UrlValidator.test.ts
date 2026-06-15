import { UrlValidator, UrlValidationError } from '../UrlValidator';

// ─────────────────────────────────────────────────────────────────────────────
// UrlValidator — unit tests  (RF6 — SSRF protection)
// ─────────────────────────────────────────────────────────────────────────────

/** Expect a URL to pass validation (returns void — compatible with Jest 30 it() callback). */
function expectValid(raw: string): void {
  expect(() => UrlValidator.validate(raw)).not.toThrow();
  expect(UrlValidator.validate(raw)).toBeInstanceOf(URL);
}

/** Expect a URL to be rejected with UrlValidationError. */
function expectBlocked(raw: string, reason?: string | RegExp) {
  expect(() => UrlValidator.validate(raw)).toThrow(UrlValidationError);
  if (reason) {
    expect(() => UrlValidator.validate(raw)).toThrow(reason);
  }
}

describe('UrlValidator', () => {

  // ── Valid URLs ───────────────────────────────────────────────────────────────

  describe('allowed URLs', () => {
    it('accepts https with a public hostname', () => {
      expectValid('https://app.example.com');
    });

    it('accepts http with a public hostname', () => {
      expectValid('http://app.example.com');
    });

    it('accepts https with path and query string', () => {
      expectValid('https://demo.acme.io/login?ref=test');
    });

    it('accepts a public IPv4 address', () => {
      expectValid('https://203.0.1.1');
    });

    it('accepts a public IPv4 on a non-standard port', () => {
      expectValid('https://1.2.3.4:8443');
    });

    it('returns the parsed URL object for a valid input', () => {
      const url = UrlValidator.validate('https://example.com/path');
      expect(url).toBeInstanceOf(URL);
      expect(url.hostname).toBe('example.com');
    });
  });

  // ── Scheme blocklist ─────────────────────────────────────────────────────────

  describe('blocked schemes', () => {
    it('rejects file://', () => expectBlocked('file:///etc/passwd'));
    it('rejects data:', () => expectBlocked('data:text/html,<script>'));
    it('rejects javascript:', () => expectBlocked('javascript:alert(1)'));
    it('rejects ftp://', () => expectBlocked('ftp://example.com'));
    it('rejects mailto:', () => expectBlocked('mailto:user@example.com'));
    it('rejects about:', () => expectBlocked('about:blank'));
  });

  // ── Loopback hostnames ───────────────────────────────────────────────────────

  describe('loopback hosts', () => {
    it('rejects localhost', () => expectBlocked('http://localhost/app'));
    it('rejects LOCALHOST (case insensitive)', () => expectBlocked('http://LOCALHOST/app'));
    it('rejects 127.0.0.1', () => expectBlocked('http://127.0.0.1:3000'));
    it('rejects 127.0.0.2 (whole /8 is loopback)', () => expectBlocked('http://127.0.0.2'));
    it('rejects 127.255.255.255', () => expectBlocked('http://127.255.255.255'));
    it('rejects IPv6 loopback ::1', () => expectBlocked('http://[::1]'));
    it('rejects IPv6 loopback ::1 with port', () => expectBlocked('http://[::1]:8080'));
    it('rejects 0.0.0.0', () => expectBlocked('http://0.0.0.0'));
  });

  // ── RFC 1918 private ranges ──────────────────────────────────────────────────

  describe('RFC 1918 private ranges', () => {
    // 10.0.0.0/8
    it('rejects 10.0.0.1', () => expectBlocked('https://10.0.0.1'));
    it('rejects 10.10.10.10', () => expectBlocked('https://10.10.10.10'));
    it('rejects 10.255.255.255', () => expectBlocked('https://10.255.255.255'));

    // 172.16.0.0/12  →  172.16.x.x to 172.31.x.x
    it('rejects 172.16.0.1', () => expectBlocked('https://172.16.0.1'));
    it('rejects 172.20.0.1', () => expectBlocked('https://172.20.0.1'));
    it('rejects 172.31.255.255', () => expectBlocked('https://172.31.255.255'));
    it('allows 172.32.0.1 (outside /12 range)', () => expectValid('https://172.32.0.1'));
    it('allows 172.15.0.1 (outside /12 range)', () => expectValid('https://172.15.0.1'));

    // 192.168.0.0/16
    it('rejects 192.168.0.1', () => expectBlocked('https://192.168.0.1'));
    it('rejects 192.168.100.50', () => expectBlocked('https://192.168.100.50'));
    it('rejects 192.168.255.255', () => expectBlocked('https://192.168.255.255'));
    it('allows 192.169.0.1 (outside /16 range)', () => expectValid('https://192.169.0.1'));
    it('allows 192.167.0.1 (outside /16 range)', () => expectValid('https://192.167.0.1'));
  });

  // ── Cloud / link-local metadata ──────────────────────────────────────────────

  describe('cloud metadata endpoints', () => {
    it('rejects 169.254.169.254 (AWS/GCP/Azure metadata)', () => {
      expectBlocked('http://169.254.169.254/latest/meta-data/');
    });
    it('rejects 169.254.0.1 (whole link-local /16)', () => {
      expectBlocked('http://169.254.0.1');
    });
    it('rejects metadata.google.internal', () => {
      expectBlocked('http://metadata.google.internal/computeMetadata/v1/');
    });
    it('rejects 100.100.100.200 (Alibaba Cloud metadata)', () => {
      expectBlocked('http://100.100.100.200/latest/meta-data');
    });
    it('rejects 192.0.0.192 (Oracle Cloud metadata)', () => {
      expectBlocked('http://192.0.0.192');
    });
  });

  // ── CGNAT / shared address space ─────────────────────────────────────────────

  describe('CGNAT shared address space (100.64.0.0/10)', () => {
    it('rejects 100.64.0.1', () => expectBlocked('http://100.64.0.1'));
    it('rejects 100.100.0.1', () => expectBlocked('http://100.100.0.1'));
    it('rejects 100.127.255.255', () => expectBlocked('http://100.127.255.255'));
    it('allows 100.63.255.255 (just before /10 range)', () => expectValid('http://100.63.255.255'));
    it('allows 100.128.0.1 (just after /10 range)', () => expectValid('http://100.128.0.1'));
  });

  // ── IPv6 private ranges ──────────────────────────────────────────────────────

  describe('IPv6 private ranges', () => {
    it('rejects fc00::1 (ULA)', () => expectBlocked('http://[fc00::1]'));
    it('rejects fd00::1 (ULA)', () => expectBlocked('http://[fd00::1]'));
    it('rejects fd12:3456::1 (ULA sub-range)', () => expectBlocked('http://[fd12:3456::1]'));
    it('rejects fe80::1 (link-local)', () => expectBlocked('http://[fe80::1]'));
    it('rejects fe80::1%eth0 (link-local with zone id — blocked via prefix)', () => {
      // Browsers strip zone IDs; URL parsing may reject this outright — either
      // way it must not pass validation.
      expect(() => UrlValidator.validate('http://[fe80::1%25eth0]')).toThrow();
    });
  });

  // ── IPv4-mapped IPv6 ─────────────────────────────────────────────────────────

  describe('IPv4-mapped IPv6 addresses', () => {
    it('rejects ::ffff:10.0.0.1 (mapped RFC1918)', () => {
      expectBlocked('http://[::ffff:10.0.0.1]');
    });
    it('rejects ::ffff:192.168.1.1 (mapped RFC1918)', () => {
      expectBlocked('http://[::ffff:192.168.1.1]');
    });
    it('rejects ::ffff:127.0.0.1 (mapped loopback)', () => {
      expectBlocked('http://[::ffff:127.0.0.1]');
    });
    it('rejects ::ffff:169.254.169.254 (mapped metadata)', () => {
      expectBlocked('http://[::ffff:169.254.169.254]');
    });
  });

  // ── Malformed input ──────────────────────────────────────────────────────────

  describe('malformed input', () => {
    it('rejects a bare string with no scheme', () => {
      expectBlocked('example.com/app');
    });

    it('rejects an empty string', () => {
      expectBlocked('');
    });

    it('rejects a string with only spaces', () => {
      expectBlocked('   ');
    });

    it('throws UrlValidationError (not a generic Error)', () => {
      const err = (() => {
        try { UrlValidator.validate('file:///etc/passwd'); }
        catch (e) { return e; }
      })();
      expect(err).toBeInstanceOf(UrlValidationError);
      expect((err as UrlValidationError).url).toBe('file:///etc/passwd');
      expect((err as UrlValidationError).reason).toBeTruthy();
    });
  });
});
