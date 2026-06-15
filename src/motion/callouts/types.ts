/**
 * Callout overlay domain types — Phase 7 Motion Direction Engine.
 *
 * Defines the data structures for animated glassmorphism callout panels
 * rendered inside the product window, timed to attention beats.
 *
 * No business logic here — pure type definitions.
 */

import type { Vec2 } from '../attention/types';

// ─────────────────────────────────────────────────────────────────────────────
// CalloutContent
// ─────────────────────────────────────────────────────────────────────────────

/** Text content of a callout panel. */
export interface CalloutContent {
  /** 1–4 words, bold headline. e.g. "Live monitoring" */
  headline:  string;
  /** Optional sub-line, ≤ 6 words. e.g. "Updates every 30s" */
  subline?:  string;
  /** Optional metric overlay. e.g. "↓ 23% energy waste" */
  metric?:   string;
}

// ─────────────────────────────────────────────────────────────────────────────
// CalloutStyle
// ─────────────────────────────────────────────────────────────────────────────

/** Visual presentation variant for callout panels. */
export type CalloutVariant =
  | 'glass-light'    // frosted glass, white text — for dark UI backgrounds
  | 'glass-dark'     // dark glass, white text — for light UI backgrounds
  | 'neon-outline';  // colored outline + glow — for high-energy scenes

/** Full visual style specification for a callout panel. */
export interface CalloutStyle {
  variant:       CalloutVariant;
  accentColor:   string;   // hex colour, matches scene accent
  backdropBlur:  number;   // px, typically 16–24
  borderOpacity: number;   // 0–1, typically 0.15–0.25
  panelOpacity:  number;   // 0–1, typically 0.10–0.20 (glass) or 0.88 (dark)
  cornerRadius:  number;   // px
}

// ─────────────────────────────────────────────────────────────────────────────
// CalloutConnector
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Visual connector between the callout panel and the UI element it annotates.
 * Rendered as SVG with an animated draw-in effect.
 */
export interface CalloutConnector {
  type:         'line' | 'arrow' | 'none';
  /** Point where the connector touches the UI element (product-window normalized). */
  anchorPoint:  Vec2;
  strokeColor:  string;   // hex or rgba
  strokeWidth:  number;   // px
  /**
   * Frames over which the connector draws from the callout to the anchor.
   * 0 = instant appearance.
   */
  drawDuration: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// AnimatedCallout
// ─────────────────────────────────────────────────────────────────────────────

/** Enter animation for a callout panel. */
export type CalloutEnterAnimation =
  | 'fade-slide-up'         // opacity 0→1 + translateY up by 8px
  | 'scale-pop'             // scale 0.85→1 + opacity 0→1
  | 'draw-line-then-fade';  // connector draws first, then panel fades in

/** Exit animation for a callout panel. */
export type CalloutExitAnimation =
  | 'fade-down'       // opacity 1→0 + translateY down by 8px
  | 'scale-shrink'    // scale 1→0.90 + opacity 1→0
  | 'dissolve';       // pure opacity 1→0

/**
 * One animated callout overlay — appears inside the product window,
 * timed to an attention beat, positioned relative to the UI element.
 *
 * Invariant: startFrame < holdStart < holdEnd < endFrame
 */
export interface AnimatedCallout {
  id:     string;
  beatId: string;   // matches AttentionBeat.id this callout is anchored to

  // ── Scene-relative timing ─────────────────────────────────────────────────
  /** Frame when the enter animation begins. */
  startFrame: number;
  /** Frame when the callout reaches full opacity (enter animation complete). */
  holdStart:  number;
  /** Frame when the exit animation begins. */
  holdEnd:    number;
  /** Frame when the callout has fully disappeared. */
  endFrame:   number;

  // ── Spatial ───────────────────────────────────────────────────────────────
  /** Connector anchor point on the UI element (product-window normalized). */
  anchor:       Vec2;
  /** Center of the callout panel (product-window normalized). */
  panelPosition:Vec2;
  /** Size of the callout panel (product-window normalized). */
  panelSize:    { width: number; height: number };

  // ── Content + appearance ──────────────────────────────────────────────────
  content:   CalloutContent;
  style:     CalloutStyle;
  connector: CalloutConnector;

  // ── Animation ─────────────────────────────────────────────────────────────
  enter: CalloutEnterAnimation;
  exit:  CalloutExitAnimation;
}

// ─────────────────────────────────────────────────────────────────────────────
// CalloutTrack
// ─────────────────────────────────────────────────────────────────────────────

/**
 * All callouts for one scene, in temporal order.
 *
 * Invariant (enforced by CalloutComposer): at most 2 callouts visible
 * simultaneously. The renderer may further clip to this limit defensively.
 */
export interface CalloutTrack {
  sceneId:  string;
  callouts: AnimatedCallout[];
}
