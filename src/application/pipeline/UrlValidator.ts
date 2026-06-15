// ─────────────────────────────────────────────────────────────────────────────
// UrlValidator  (RF6 — SSRF protection)
//
// Rejects URLs that could be weaponised for Server-Side Request Forgery:
//   • Non-http/https schemes   (file, data, javascript, ftp, …)
//   • Loopback                 (localhost, 127.0.0.0/8, ::1)
//   • RFC 1918 private ranges  (10/8, 172.16/12, 192.168/16)
//   • APIPA / link-local       (169.254/16, fe80::/10)
//   • CGNAT shared space       (100.64/10)
//   • Cloud-provider metadata  (169.254.169.254, 100.100.100.200, 192.0.0.192,
//                                metadata.google.internal, …)
//   • IPv4-mapped IPv6         (::ffff:10.x.x.x etc.)
//   • ULA / other private IPv6 (fc00::/7)
// ─────────────────────────────────────────────────────────────────────────────

export class UrlValidationError extends Error {
  constructor(
    message: string,
    public readonly url: string,
    public readonly reason: string,
  ) {
    super(message);
    this.name = 'UrlValidationError';
  }
}

// ── Allowed schemes ─────────────────────────────────────────────────────────

const ALLOWED_SCHEMES = new Set(['http:', 'https:']);

// ── Exact hostname blocklist ────────────────────────────────────────────────

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '0.0.0.0',
  '127.0.0.1',
  '::1',
  // Cloud metadata endpoints
  '169.254.169.254',          // AWS / GCP / Azure / DigitalOcean / OpenStack
  'metadata.google.internal', // GCP internal alias
  '100.100.100.200',          // Alibaba Cloud
  '192.0.0.192',              // Oracle Cloud
  'fd00:ec2::254',            // AWS IPv6 metadata
]);

// ── IPv4 private range table ─────────────────────────────────────────────────
// Each entry is [networkAddress, prefixLength].
// isInRange() converts a dotted-quad to uint32 and checks with a bitmask.

const IPV4_BLOCKED_RANGES: Array<[string, number]> = [
  ['0.0.0.0',    8],   // "This" network (RFC 1122)
  ['10.0.0.0',   8],   // RFC 1918 Class A private
  ['100.64.0.0', 10],  // Shared address space / CGNAT (RFC 6598)
  ['127.0.0.0',  8],   // Loopback (RFC 990)
  ['169.254.0.0', 16], // Link-local / APIPA / metadata (RFC 3927)
  ['172.16.0.0', 12],  // RFC 1918 Class B private
  ['192.0.0.0',  24],  // IETF Protocol Assignments (RFC 6890)
  ['192.168.0.0', 16], // RFC 1918 Class C private
  ['198.18.0.0', 15],  // Benchmarking (RFC 2544)
  ['198.51.100.0', 24],// TEST-NET-2 (RFC 5737)
  ['203.0.113.0', 24], // TEST-NET-3 (RFC 5737)
  ['240.0.0.0',  4],   // Reserved / future use (RFC 1112)
  ['255.255.255.255', 32], // Limited broadcast
];

// ── IPv6 private prefix table ────────────────────────────────────────────────
// Each entry is [prefixHex (128-bit as bigint), prefixLength].

const IPV6_BLOCKED_PREFIXES: Array<[bigint, number]> = [
  [0x00000000000000000000000000000001n, 128], // ::1 loopback
  [0xfc000000000000000000000000000000n, 7],   // fc00::/7  ULA (fc00 + fd00)
  [0xfe800000000000000000000000000000n, 10],  // fe80::/10 link-local
  [0x00000000000000000000ffff00000000n, 96],  // ::ffff:0:0/96 IPv4-mapped
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Convert a dotted-quad IPv4 string to an unsigned 32-bit integer. */
function ipv4ToUint32(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const octet = parseInt(part, 10);
    if (isNaN(octet) || octet < 0 || octet > 255 || part !== String(octet)) return null;
    value = (value << 8) | octet;
  }
  // Force unsigned 32-bit (JS bitwise ops produce signed int32)
  return value >>> 0;
}

/** Convert an IPv6 address string (no brackets) to a 128-bit bigint. */
function ipv6ToBigInt(ip: string): bigint | null {
  try {
    // Expand :: shorthand
    let expanded = ip;
    if (expanded.includes('::')) {
      const [left, right] = expanded.split('::');
      const leftGroups  = left  ? left.split(':')  : [];
      const rightGroups = right ? right.split(':') : [];
      const fill = 8 - leftGroups.length - rightGroups.length;
      if (fill < 0) return null;
      expanded = [
        ...leftGroups,
        ...Array(fill).fill('0'),
        ...rightGroups,
      ].join(':');
    }
    const groups = expanded.split(':');
    if (groups.length !== 8) return null;
    let value = 0n;
    for (const group of groups) {
      const num = parseInt(group || '0', 16);
      if (isNaN(num) || num < 0 || num > 0xffff) return null;
      value = (value << 16n) | BigInt(num);
    }
    return value;
  } catch {
    return null;
  }
}

/** Check whether an IPv4 string falls within a CIDR range. */
function isInIpv4Range(ip: string, network: string, prefix: number): boolean {
  const ipInt  = ipv4ToUint32(ip);
  const netInt = ipv4ToUint32(network);
  if (ipInt === null || netInt === null) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipInt & mask) >>> 0 === (netInt & mask) >>> 0;
}

/** Check whether an IPv6 bigint falls within a prefix. */
function isInIpv6Prefix(ip: bigint, prefix: bigint, length: number): boolean {
  if (length === 0) return true;
  const shift = BigInt(128 - length);
  return (ip >> shift) === (prefix >> shift);
}

/**
 * If `ip` is an IPv4-mapped IPv6 address (::ffff:a.b.c.d), extract the
 * embedded IPv4 string. Returns null otherwise.
 */
function extractMappedIpv4(ipv6: bigint): string | null {
  const IPV4_MAPPED_PREFIX = 0x00000000000000000000ffff00000000n;
  const MASK_96 = (1n << 96n) - 1n;
  if ((ipv6 >> 32n) === (IPV4_MAPPED_PREFIX >> 32n)) {
    // Bottom 32 bits are the IPv4 address
    const ipv4Int = Number(ipv6 & BigInt(0xffffffff));
    return [
      (ipv4Int >>> 24) & 0xff,
      (ipv4Int >>> 16) & 0xff,
      (ipv4Int >>>  8) & 0xff,
       ipv4Int         & 0xff,
    ].join('.');
  }
  void MASK_96; // suppress unused-variable lint
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// UrlValidator
// ─────────────────────────────────────────────────────────────────────────────

export class UrlValidator {
  /**
   * Validate a URL for use as a pipeline entry point.
   *
   * @returns The parsed `URL` object when valid.
   * @throws  `UrlValidationError` when the URL is disallowed.
   */
  static validate(raw: string): URL {
    // ── Parse ────────────────────────────────────────────────────────────────
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      throw new UrlValidationError(
        `Invalid URL: "${raw}"`,
        raw,
        'URL could not be parsed — ensure it includes a scheme (https://)',
      );
    }

    // ── Scheme allowlist ─────────────────────────────────────────────────────
    if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
      throw new UrlValidationError(
        `Blocked scheme "${parsed.protocol}" in URL: "${raw}"`,
        raw,
        `Only http: and https: are permitted. Got: ${parsed.protocol}`,
      );
    }

    // ── Strip brackets from IPv6 hostnames (URL spec adds them) ─────────────
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();

    // ── Exact hostname blocklist ─────────────────────────────────────────────
    if (BLOCKED_HOSTNAMES.has(hostname)) {
      throw new UrlValidationError(
        `Blocked hostname "${hostname}" in URL: "${raw}"`,
        raw,
        `The hostname "${hostname}" is not permitted (loopback / private / metadata)`,
      );
    }

    // ── IPv4 range checks ────────────────────────────────────────────────────
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
      for (const [network, prefix] of IPV4_BLOCKED_RANGES) {
        if (isInIpv4Range(hostname, network, prefix)) {
          throw new UrlValidationError(
            `Blocked private IPv4 address "${hostname}" in URL: "${raw}"`,
            raw,
            `${hostname} falls within the blocked range ${network}/${prefix}`,
          );
        }
      }
    }

    // ── IPv6 range checks ────────────────────────────────────────────────────
    if (hostname.includes(':')) {
      const ipv6 = ipv6ToBigInt(hostname);
      if (ipv6 !== null) {
        // Check for IPv4-mapped address and re-run IPv4 range checks
        const mappedIpv4 = extractMappedIpv4(ipv6);
        if (mappedIpv4 !== null) {
          for (const [network, prefix] of IPV4_BLOCKED_RANGES) {
            if (isInIpv4Range(mappedIpv4, network, prefix)) {
              throw new UrlValidationError(
                `Blocked IPv4-mapped IPv6 address "${hostname}" in URL: "${raw}"`,
                raw,
                `Embedded IPv4 ${mappedIpv4} falls within the blocked range ${network}/${prefix}`,
              );
            }
          }
        }

        // Check native IPv6 private prefixes
        for (const [prefix, length] of IPV6_BLOCKED_PREFIXES) {
          if (isInIpv6Prefix(ipv6, prefix, length)) {
            throw new UrlValidationError(
              `Blocked private IPv6 address "${hostname}" in URL: "${raw}"`,
              raw,
              `${hostname} falls within a blocked IPv6 prefix (length /${length})`,
            );
          }
        }
      }
    }

    return parsed;
  }
}
