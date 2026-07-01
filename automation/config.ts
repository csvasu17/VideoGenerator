/**
 * config.ts — Single source of truth for the output directory.
 *
 * The output folder is derived from APP_PRODUCT_NAME in .env
 * (slugified to lowercase-kebab-case). Falls back to the hostname
 * of APP_URL, then to "localhost".
 *
 * Example:  APP_PRODUCT_NAME=TicketFlow  →  out/ticketflow/
 *           APP_PRODUCT_NAME=My SaaS App →  out/my-saas-app/
 */

import * as dotenv from 'dotenv';
import * as path   from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function resolveSlug(): string {
  const name = process.env['APP_PRODUCT_NAME'];
  if (name) return toSlug(name);

  const url = process.env['APP_URL'];
  if (url) {
    try { return toSlug(new URL(url).hostname); } catch {}
  }

  return 'localhost';
}

export const APP_SLUG    = resolveSlug();
export const ROOT        = path.resolve(__dirname, '..');
export const OUT_DIR     = path.join(ROOT, 'out', APP_SLUG);
export const SHOW_AVATAR = process.env['SHOW_AVATAR'] !== 'false';
export const SCREEN_FIT  = (process.env['SCREEN_FIT'] as 'fit' | 'full') ?? 'full';
