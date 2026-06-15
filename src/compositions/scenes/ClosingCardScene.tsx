/**
 * ClosingCardScene — Phase 5 premium closing card.
 *
 * Extracted from the inline component that previously lived in DemoVideo.tsx.
 * Completely redesigned for Phase 5 with:
 *   • Same animated-orb background as OpeningTitleScene (visual bookend)
 *   • Product name with gradient-hero-text treatment (mirrors the opening)
 *   • Feature highlight pills (up to 3 capability names from scenes)
 *   • CTA button with a slow-breathing glow pulse
 *   • "Powered by ACL Digital" footer matching opening style
 *
 * Animation timeline (150 frames / 5 s at 30 fps):
 *   0       Orbs visible immediately (subtle bg — no entrance needed)
 *   0–14    Product name springs up + fades in (all at once — confident reveal)
 *   8–22    Red divider bar draws in
 *   20–50   Feature pills stagger in (10 fr apart, left → right)
 *   48–62   CTA button scales up from 0.88→1.00
 *   60+     CTA button glow pulses at ~2 s period
 *   75+     "Powered by ACL Digital" footer fades in
 */

import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

import {
  ACCENT_RED,
  DARK_BG,
  CARD_BG,
  TEXT_WHITE,
  TEXT_MUTED,
  TEXT_SUBTLE,
  ACCENT_TEAL,
  BORDER_TEAL,
  FONT_STACK,
  GRID_BG_STYLE,
} from '../tokens';

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface ClosingCardData {
  from:             number;
  durationInFrames: number;
  callToAction:     string;
  productName:      string;
  backgroundColor:  string;
}

interface ClosingCardSceneProps {
  data:          ClosingCardData;
  /**
   * Up to 3 short feature/capability names surfaced on the closing card.
   * Derived by DemoVideo from the highlighted scene elements.
   * Example: ["Consumption Analytics", "Impact & Recommended", "Quick Stats"]
   */
  highlights?:   string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export const ClosingCardScene: React.FC<ClosingCardSceneProps> = ({
  data,
  highlights = [],
}) => {
  const frame = useCurrentFrame();
  const { fps }  = useVideoConfig();

  // ── Time-based values (orb drift) ─────────────────────────────────────────
  const t = frame / fps;

  const orb1X = Math.sin(t * 0.52 + 0.8) * 60;
  const orb1Y = Math.cos(t * 0.38 + 1.2) * 45;
  const orb2X = Math.sin(t * 0.42 + 2.6) * 50;
  const orb2Y = Math.cos(t * 0.32 + 0.4) * 40;

  // ── Product name (spring all-at-once — confident, not word-by-word) ───────
  const nameSpring = spring({ frame, fps, from: 0, to: 1, config: { damping: 14, stiffness: 90 } });
  const nameY      = interpolate(nameSpring, [0, 1], [42, 0]);

  // ── Red divider ────────────────────────────────────────────────────────────
  const dividerWidth = interpolate(frame, [8, 28], [0, 160], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // ── Feature pills (staggered: frame 20, 30, 40) ───────────────────────────
  const PILL_BASE  = 20;
  const PILL_GAP   = 10;

  // ── CTA button ─────────────────────────────────────────────────────────────
  const ctaSpring = spring({ frame: frame - 48, fps, from: 0, to: 1, config: { damping: 12, stiffness: 75 } });
  const ctaScale  = interpolate(ctaSpring, [0, 1], [0.82, 1]);

  // CTA breathing glow — starts after button has settled (~frame 65)
  const glowPhase     = Math.max(0, frame - 62);
  const glowCycle     = glowPhase % 80;  // ~2.67 s period at 30 fps
  const glowIntensity = Math.sin((glowCycle / 80) * Math.PI * 2) * 0.5 + 0.5;  // 0–1

  const ctaBoxShadow = `
    0 0 ${20 + glowIntensity * 18}px rgba(229,0,38,${0.28 + glowIntensity * 0.28}),
    0 0 ${40 + glowIntensity * 28}px rgba(229,0,38,${0.10 + glowIntensity * 0.12}),
    inset 0 1px 0 rgba(255,255,255,0.12)
  `.trim();

  // ── Footer ─────────────────────────────────────────────────────────────────
  const footerOpacity = interpolate(frame, [76, 92], [0, 0.38], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // ── Tagline (short motivational line above CTA) ────────────────────────────
  const taglineOpacity = spring({ frame: frame - 36, fps, from: 0, to: 1, config: { damping: 10 } });

  // ── Normalise product name for display ────────────────────────────────────
  const displayName = data.productName
    ? data.productName.replace(/^the\s+/i, '').trim() || data.productName
    : 'Platform';

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <AbsoluteFill
      style={{
        background:    `linear-gradient(145deg, ${DARK_BG} 0%, ${CARD_BG} 55%, #080f22 100%)`,
        display:       'flex',
        flexDirection: 'column',
        alignItems:    'center',
        justifyContent:'center',
        fontFamily:    FONT_STACK,
        overflow:      'hidden',
      }}
    >

      {/* ── Grid overlay ─────────────────────────────────────────────────── */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', ...GRID_BG_STYLE }} />

      {/* ── Background orb — red (top-right) ─────────────────────────────── */}
      <div style={{
        position:     'absolute',
        top:          `calc(10% + ${orb1Y}px)`,
        right:        `calc(8% + ${orb1X}px)`,
        width:         460,
        height:        460,
        borderRadius: '50%',
        background:   `radial-gradient(circle, ${ACCENT_RED}1d 0%, transparent 68%)`,
        filter:       'blur(56px)',
        pointerEvents:'none',
      }} />

      {/* ── Background orb — teal (bottom-left) ──────────────────────────── */}
      <div style={{
        position:     'absolute',
        bottom:       `calc(8% - ${orb2Y}px)`,
        left:         `calc(6% - ${orb2X}px)`,
        width:         400,
        height:        400,
        borderRadius: '50%',
        background:   `radial-gradient(circle, ${ACCENT_TEAL}15 0%, transparent 66%)`,
        filter:       'blur(48px)',
        pointerEvents:'none',
      }} />

      {/* ── Brand wordmark — top left ─────────────────────────────────────── */}
      <div style={{
        position:  'absolute',
        top:        52,
        left:       60,
        display:   'flex',
        alignItems:'center',
        gap:        14,
        opacity:    nameSpring,
      }}>
        <div style={{
          width:      10,
          height:     10,
          background: ACCENT_RED,
          transform: 'rotate(45deg)',
          flexShrink: 0,
          boxShadow: `0 0 12px ${ACCENT_RED}88`,
        }} />
        <span style={{
          fontSize:      15,
          fontWeight:    700,
          letterSpacing: '3.5px',
          color:         TEXT_MUTED,
          textTransform: 'uppercase',
        }}>
          {displayName.toUpperCase()}
        </span>
        <div style={{ width: 1, height: 14, background: 'rgba(255,255,255,0.20)' }} />
        <span style={{
          fontSize:      12,
          fontWeight:    500,
          letterSpacing: '2px',
          color:         ACCENT_TEAL,
          textTransform: 'uppercase',
          opacity:       0.80,
        }}>
          Building Intelligence
        </span>
      </div>

      {/* ── Central content block ────────────────────────────────────────── */}
      <div style={{
        display:        'flex',
        flexDirection:  'column',
        alignItems:     'center',
        gap:             28,
        maxWidth:       '80%',
        textAlign:      'center',
      }}>

        {/* Product name — gradient hero text */}
        <div style={{
          opacity:   nameSpring,
          transform: `translateY(${nameY}px)`,
        }}>
          <span style={{
            fontSize:             72,
            fontWeight:           800,
            letterSpacing:        '-2px',
            lineHeight:            1.05,
            background:           `linear-gradient(135deg, #ffffff 0%, rgba(255,255,255,0.88) 50%, ${ACCENT_TEAL} 100%)`,
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor:  'transparent',
            backgroundClip:       'text',
            display:              'block',
          }}>
            {displayName}
          </span>
        </div>

        {/* Red divider */}
        <div style={{
          width:        dividerWidth,
          height:       3,
          background:   `linear-gradient(to right, ${ACCENT_RED}, ${ACCENT_RED}aa)`,
          borderRadius:  2,
          boxShadow:    `0 0 10px ${ACCENT_RED}55`,
        }} />

        {/* Feature highlight pills */}
        {highlights.length > 0 && (
          <div style={{
            display:   'flex',
            gap:        14,
            flexWrap:  'wrap',
            justifyContent: 'center',
          }}>
            {highlights.slice(0, 3).map((label, i) => {
              const pillSpring = spring({
                frame:  frame - (PILL_BASE + i * PILL_GAP),
                fps,
                from:   0,
                to:     1,
                config: { damping: 11, stiffness: 85 },
              });
              const pillY = interpolate(pillSpring, [0, 1], [18, 0]);

              return (
                <div
                  key={i}
                  style={{
                    opacity:       pillSpring,
                    transform:     `translateY(${pillY}px)`,
                    display:       'flex',
                    alignItems:    'center',
                    gap:            8,
                    background:    'rgba(10,147,211,0.08)',
                    border:        `1px solid ${BORDER_TEAL}`,
                    borderRadius:   8,
                    padding:       '9px 20px',
                  }}
                >
                  {/* Teal dot indicator */}
                  <div style={{
                    width:        6,
                    height:       6,
                    borderRadius: '50%',
                    background:   ACCENT_TEAL,
                    flexShrink:   0,
                    boxShadow:   `0 0 8px ${ACCENT_TEAL}88`,
                  }} />
                  <span style={{
                    fontSize:      15,
                    fontWeight:    600,
                    color:         TEXT_MUTED,
                    letterSpacing: '0.3px',
                    whiteSpace:   'nowrap',
                  }}>
                    {label}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Tagline */}
        <div style={{
          opacity:   taglineOpacity,
          fontSize:  18,
          color:     TEXT_MUTED,
          fontWeight:400,
          letterSpacing: '0.2px',
        }}>
          Intelligent buildings.&nbsp; Predictive operations.&nbsp; Complete visibility.
        </div>

        {/* CTA button */}
        <div style={{
          opacity:      ctaSpring,
          transform:    `scale(${ctaScale})`,
          background:   ACCENT_RED,
          borderRadius:  10,
          padding:      '18px 52px',
          boxShadow:    ctaBoxShadow,
          cursor:       'default',
        }}>
          <span style={{
            color:         TEXT_WHITE,
            fontSize:      22,
            fontWeight:    700,
            letterSpacing: '0.4px',
            display:       'block',
          }}>
            {data.callToAction || 'Schedule a live demo today'}
          </span>
        </div>

      </div>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <div style={{
        position:      'absolute',
        bottom:         52,
        display:       'flex',
        alignItems:    'center',
        gap:            12,
        opacity:        footerOpacity,
      }}>
        <div style={{ width: 28, height: 1, background: TEXT_SUBTLE }} />
        <span style={{
          fontSize:      12,
          color:         TEXT_SUBTLE,
          letterSpacing: '3px',
          textTransform: 'uppercase',
          fontWeight:    500,
        }}>
          Powered by ACL Digital
        </span>
        <div style={{ width: 28, height: 1, background: TEXT_SUBTLE }} />
      </div>

    </AbsoluteFill>
  );
};
