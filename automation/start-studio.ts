/**
 * start-studio.ts — Launches Remotion Studio with the app-specific public-dir.
 *
 * Reads APP_PRODUCT_NAME from .env, converts to a slug (e.g. "TicketFlow"
 * → "ticketflow"), and starts Remotion Studio with --public-dir=out/<slug>.
 *
 * Usage: npm start
 */

import { execSync }    from 'child_process';
import { APP_SLUG, OUT_DIR } from './config';
import * as fs         from 'fs';
import * as path       from 'path';

const ROOT = path.resolve(__dirname, '..');

if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`Created output directory: out/${APP_SLUG}/`);
}

// Sync global brand assets (logo, fonts, etc.) into this product's public-dir
// so staticFile('assets/...') resolves correctly for every product.
const globalAssets = path.join(ROOT, 'public', 'assets');
const productAssets = path.join(OUT_DIR, 'assets');
if (fs.existsSync(globalAssets)) {
  fs.mkdirSync(productAssets, { recursive: true });
  for (const file of fs.readdirSync(globalAssets)) {
    const src  = path.join(globalAssets, file);
    const dest = path.join(productAssets, file);
    fs.copyFileSync(src, dest);
  }
  console.log(`Synced global assets → out/${APP_SLUG}/assets/`);
}

console.log(`Starting Remotion Studio  →  public-dir: out/${APP_SLUG}/`);

execSync(
  `npx remotion studio --public-dir=out/${APP_SLUG}`,
  { cwd: ROOT, stdio: 'inherit' },
);
