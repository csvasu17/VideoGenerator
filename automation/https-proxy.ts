/**
 * Self-signed HTTPS front door for Studio (3000→3443) and the Config API (4001→4443).
 *
 * Why this exists: Chrome only treats localhost/127.0.0.1 as a "secure context" over
 * plain HTTP. Any other address — including this machine's own LAN IP — is insecure,
 * and Remotion Studio's audio-waveform preview (@remotion/media-parser) needs the
 * WebCodecs AudioDecoder API, which browsers disable entirely outside secure contexts.
 * That's the "This audio track cannot be decoded by this browser" error when opening
 * a composition via http://<lan-ip>:3000 from this machine or a teammate's.
 *
 * https:// is always a secure context regardless of certificate trust, so terminating
 * TLS here — even with a self-signed cert — fixes it for every machine on the LAN.
 * Each browser sees a one-time "connection isn't private" warning per cert (per
 * machine) the first time; clicking through is enough, no shared CA needed.
 *
 * The proxy itself is a raw TCP relay (TLS in, plaintext out to localhost) rather than
 * an HTTP-aware proxy — it doesn't need to understand HTTP to relay it, and relaying
 * raw bytes means WebSocket upgrades (Studio's live-reload) pass through unmodified
 * too, with no header rewriting to get wrong.
 */
import * as tls from 'tls';
import * as net from 'net';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import selfsigned from 'selfsigned';

const ROOT = path.resolve(__dirname, '..');
const CERT_DIR = path.join(ROOT, '.tmp', 'certs');
const CERT_PATH = path.join(CERT_DIR, 'https-proxy-cert.pem');
const KEY_PATH = path.join(CERT_DIR, 'https-proxy-key.pem');
const META_PATH = path.join(CERT_DIR, 'https-proxy-meta.json');

// Regenerating the cert on every restart would make every machine re-click through
// the browser warning each time. A 10-year validity window means it's generated once
// and reused indefinitely — browsers don't enforce the shorter CA-issued lifetime caps
// on a self-signed cert the user manually trusts.
const VALIDITY_MS = 10 * 365 * 24 * 60 * 60 * 1000;

const PROXIES: Array<{ listenPort: number; targetPort: number; name: string }> = [
  { listenPort: 3443, targetPort: 3000, name: 'Remotion Studio' },
  { listenPort: 4443, targetPort: 4001, name: 'Config API' },
];

function getLocalNetworkIPs(): string[] {
  const ips: string[] = [];
  for (const configs of Object.values(os.networkInterfaces())) {
    for (const config of configs ?? []) {
      if (config.family === 'IPv4' && !config.internal) ips.push(config.address);
    }
  }
  return ips;
}

async function loadOrCreateCert(ips: string[]): Promise<{ key: string; cert: string }> {
  const sortedIps = ips.slice().sort();
  if (fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH) && fs.existsSync(META_PATH)) {
    try {
      const meta = JSON.parse(fs.readFileSync(META_PATH, 'utf8')) as { ips: string[]; notAfter: number };
      const sameIps = JSON.stringify(meta.ips) === JSON.stringify(sortedIps);
      const stillValid = Date.now() < meta.notAfter;
      if (sameIps && stillValid) {
        return { key: fs.readFileSync(KEY_PATH, 'utf8'), cert: fs.readFileSync(CERT_PATH, 'utf8') };
      }
    } catch {
      // Corrupt cache — fall through and regenerate.
    }
  }

  const notAfterDate = new Date(Date.now() + VALIDITY_MS);
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'localhost' }], {
    keySize: 2048,
    algorithm: 'sha256',
    notBeforeDate: new Date(),
    notAfterDate,
    extensions: [
      { name: 'basicConstraints', cA: false, critical: true },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
      { name: 'extKeyUsage', serverAuth: true, clientAuth: true },
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' },
          { type: 7, ip: '127.0.0.1' },
          { type: 7, ip: '::1' },
          ...ips.map((ip) => ({ type: 7 as const, ip })),
        ],
      },
    ],
  });

  fs.mkdirSync(CERT_DIR, { recursive: true });
  fs.writeFileSync(CERT_PATH, pems.cert);
  fs.writeFileSync(KEY_PATH, pems.private);
  fs.writeFileSync(META_PATH, JSON.stringify({ ips: sortedIps, notAfter: notAfterDate.getTime() }));
  return { key: pems.private, cert: pems.cert };
}

function startProxy(listenPort: number, targetPort: number, tlsOpts: tls.TlsOptions): void {
  const server = tls.createServer(tlsOpts, (secureSocket) => {
    const upstream = net.connect(targetPort, '127.0.0.1');
    secureSocket.on('error', () => upstream.destroy());
    upstream.on('error', () => secureSocket.destroy());
    secureSocket.pipe(upstream);
    upstream.pipe(secureSocket);
  });
  server.on('error', (err) => {
    console.error(`[https-proxy] port ${listenPort} failed to start:`, (err as Error).message);
  });
  server.listen(listenPort, '0.0.0.0');
}

async function main(): Promise<void> {
  const ips = getLocalNetworkIPs();
  const { key, cert } = await loadOrCreateCert(ips);

  console.log('\n  HTTPS proxy (self-signed cert — accept the one-time browser warning on each machine):');
  for (const { listenPort, targetPort, name } of PROXIES) {
    startProxy(listenPort, targetPort, { key, cert });
    console.log(`\n    ${name}  (→ localhost:${targetPort})`);
    console.log(`      Local:   https://localhost:${listenPort}`);
    for (const ip of ips) {
      console.log(`      Network: https://${ip}:${listenPort}`);
    }
  }
  console.log('');
}

main().catch((err) => {
  console.error('[https-proxy] fatal error:', err);
  process.exit(1);
});
