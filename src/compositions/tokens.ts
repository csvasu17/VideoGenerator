/**
 * Design tokens — shared colour palette, typography, and shadow constants.
 *
 * Import from any composition or scene component to keep all values in sync.
 * Never paste hex values inline; always use these exports.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Colour palette
// ─────────────────────────────────────────────────────────────────────────────

export const ACCENT_RED   = '#e50026';
/** @deprecated Use ACCENT_RED — brand-neutral alias */
export const RHEEM_RED    = ACCENT_RED;
export const DARK_BG      = '#060d1a';   // deepest background — scene base
export const CARD_BG      = '#0d1f3c';   // slightly lighter panel / card bg
export const PANEL_BG     = '#0a1535';   // mid-panel, used for narration strip
export const TEXT_WHITE   = '#ffffff';
export const TEXT_MUTED   = 'rgba(255,255,255,0.70)';
export const TEXT_SUBTLE  = 'rgba(255,255,255,0.38)';
export const ACCENT_TEAL  = '#0a93d3';

// Borders
export const BORDER_DIM   = 'rgba(255,255,255,0.08)';
export const BORDER_TEAL  = `rgba(10,147,211,0.30)`;
export const BORDER_RED   = `rgba(229,0,38,0.30)`;

// ─────────────────────────────────────────────────────────────────────────────
// Typography
// ─────────────────────────────────────────────────────────────────────────────

export const FONT_STACK = '"Inter", "Helvetica Neue", system-ui, sans-serif';

// ─────────────────────────────────────────────────────────────────────────────
// Shadows
// ─────────────────────────────────────────────────────────────────────────────

export const SHADOW_CARD      = '0 20px 60px rgba(0,0,0,0.60), 0 4px 20px rgba(0,0,0,0.40)';
export const SHADOW_GLOW_RED  = '0 0 40px rgba(229,0,38,0.25)';
export const SHADOW_GLOW_ACCENT = SHADOW_GLOW_RED;
export const SHADOW_GLOW_TEAL = '0 0 40px rgba(10,147,211,0.15)';

// ─────────────────────────────────────────────────────────────────────────────
// Reusable CSS object slices
// ─────────────────────────────────────────────────────────────────────────────

/** Subtle teal grid overlay used on card (opening / closing) scenes. */
export const GRID_BG_STYLE: React.CSSProperties = {
  backgroundImage: [
    'linear-gradient(rgba(10,147,211,0.05) 1px, transparent 1px)',
    'linear-gradient(90deg, rgba(10,147,211,0.05) 1px, transparent 1px)',
  ].join(', '),
  backgroundSize: '60px 60px',
};

// Keep React available for the CSSProperties type reference above.
import type React from 'react';
