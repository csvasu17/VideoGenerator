/**
 * OpeningTitleScene — Phase 5 premium redesign.
 *
 * Visual progression (90 frames / 3 s at 30 fps):
 *   0–∞     Two gradient orbs drift slowly in the background (deterministic, frame-driven)
 *   0–15    Brand wordmark + category badge fade + slide in
 *   0–20    Red accent bar draws in (width 0 → 260 px)
 *   5+      Title words spring up, word-by-word (6 fr / word stagger)
 *   titleEnd+6  Subtitle line fades in as a single unit
 *   late    Scene-count indicator dots spring in (4 fr stagger)
 *   last    "Powered by ACL Digital" fades in at bottom
 *
 * New in Phase 5 vs the Phase 2 version:
 *   • Animated background orbs (red + teal) for a premium "alive" feel
 *   • Brand wordmark area (product name + category badge)
 *   • Scene-count indicator dots — tells viewer how many acts are coming
 *   • Better vertical rhythm — brand/title/subtitle/dots/footer all aligned
 *
 * Backward-compatible: existing OpeningCard data shape unchanged.
 * New optional props (productName, scenesCount) default gracefully.
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
  TEXT_MUTED,
  TEXT_SUBTLE,
  ACCENT_TEAL,
  FONT_STACK,
  GRID_BG_STYLE,
} from '../tokens';

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface OpeningCardData {
  from:             number;
  durationInFrames: number;
  title:            string;
  subtitle:         string;
  backgroundColor:  string;
}

interface OpeningTitleSceneProps {
  data:          OpeningCardData;
  /** Product/brand name shown in the top wordmark (e.g. "the Platform"). */
  productName?:  string;
  /** Number of scenes — drives the indicator dot row. Defaults to 0 (hidden). */
  scenesCount?:  number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export const OpeningTitleScene: React.FC<OpeningTitleSceneProps> = ({
  data,
  productName,
  scenesCount = 0,
}) => {
  const frame = useCurrentFrame();
  const { fps }  = useVideoConfig();

  // ── Time in seconds (for slow orb drift) ─────────────────────────────────
  const t = frame / fps;

  // ── Animated orb positions (deterministic, frame-driven) ──────────────────
  const orb1X = Math.sin(t * 0.55) * 55;   // red orb — slow horizontal drift
  const orb1Y = Math.cos(t * 0.40) * 40;   // red orb — vertical drift
  const orb2X = Math.sin(t * 0.45 + 1.8) * 60;  // teal orb — opposite phase
  const orb2Y = Math.cos(t * 0.35 + 0.9) * 45;

  // ── Brand / category header elements ──────────────────────────────────────
  const headerSpring = spring({
    frame,
    fps,
    from:   0,
    to:     1,
    config: { damping: 14, stiffness: 90 },
  });
  const headerY = interpolate(headerSpring, [0, 1], [-20, 0]);

  // ── Red accent bar ────────────────────────────────────────────────────────
  const lineWidth = interpolate(frame, [0, 20], [0, 260], { extrapolateRight: 'clamp' });

  // ── Title words ───────────────────────────────────────────────────────────
  // Split at " — " to extract just the product name as the hero text.
  const heroText   = data.title.split(' — ')[0].trim() || data.title;
  const titleWords = heroText.split(' ');
  const TITLE_START   = 5;
  const TITLE_STAGGER = 6;

  const titleLastWordStart = TITLE_START + (titleWords.length - 1) * TITLE_STAGGER;
  const titleSettled       = titleLastWordStart + 20;  // spring settle time

  // ── Subtitle (single-unit fade-in — faster than word-by-word) ────────────
  const SUBTITLE_START = titleSettled + 6;
  const subtitleOpacity = spring({
    frame:  frame - SUBTITLE_START,
    fps,
    from:   0,
    to:     1,
    config: { damping: 12, stiffness: 70 },
  });
  const subtitleY = interpolate(subtitleOpacity, [0, 1], [16, 0]);

  // Text: prefer data.subtitle; fall back to the " — " remainder of the title.
  const subtitleText = (
    data.subtitle ||
    data.title.split(' — ').slice(1).join(' ').trim()
  ).replace(/\.$/, '');   // strip trailing period for cleaner display

  // ── Scene indicator dots ──────────────────────────────────────────────────
  const DOTS_START = titleSettled + 14;

  // ── Bottom label ──────────────────────────────────────────────────────────
  const LABEL_START  = DOTS_START + 12;
  const labelOpacity = interpolate(
    frame,
    [LABEL_START, LABEL_START + 12],
    [0, 0.35],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  // ── Derived brand name ────────────────────────────────────────────────────
  // Normalise generic AI outputs ("the Platform", "the platform") to uppercase.
  const rawBrand   = (productName || heroText || 'the Platform').trim();
  const brandLabel = rawBrand.toUpperCase();

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <AbsoluteFill
      style={{
        background:    `linear-gradient(145deg, ${DARK_BG} 0%, ${CARD_BG} 55%, #080f22 100%)`,
        display:       'flex',
        flexDirection: 'column',
        alignItems:    'center',
        justifyContent:'center',
        fontFamily:     FONT_STACK,
        overflow:      'hidden',
      }}
    >

      {/* ── Grid overlay ─────────────────────────────────────────────────── */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', ...GRID_BG_STYLE }} />

      {/* ── Background orb — red (top-right quadrant) ───────────────────── */}
      <div style={{
        position:     'absolute',
        top:          `calc(15% + ${orb1Y}px)`,
        right:        `calc(10% + ${orb1X}px)`,
        width:         420,
        height:        420,
        borderRadius: '50%',
        background:   `radial-gradient(circle, ${ACCENT_RED}1e 0%, transparent 70%)`,
        filter:       'blur(52px)',
        pointerEvents:'none',
      }} />

      {/* ── Background orb — teal (bottom-left quadrant) ────────────────── */}
      <div style={{
        position:     'absolute',
        bottom:       `calc(12% - ${orb2Y}px)`,
        left:         `calc(8% - ${orb2X}px)`,
        width:         360,
        height:        360,
        borderRadius: '50%',
        background:   `radial-gradient(circle, ${ACCENT_TEAL}18 0%, transparent 68%)`,
        filter:       'blur(44px)',
        pointerEvents:'none',
      }} />

      {/* ── Brand wordmark ────────────────────────────────────────────────── */}
      <div style={{
        position:  'absolute',
        top:        52,
        left:       60,
        display:   'flex',
        alignItems:'center',
        gap:        14,
        opacity:    headerSpring,
        transform: `translateY(${headerY}px)`,
      }}>
        {/* Red diamond glyph */}
        <div style={{
          width:        10,
          height:       10,
          background:   ACCENT_RED,
          transform:   'rotate(45deg)',
          flexShrink:   0,
          boxShadow:   `0 0 12px ${ACCENT_RED}88`,
        }} />
        {/* Brand name */}
        <span style={{
          fontSize:      15,
          fontWeight:    700,
          letterSpacing: '3.5px',
          color:         TEXT_MUTED,
          textTransform: 'uppercase',
        }}>
          {brandLabel}
        </span>
        {/* Separator */}
        <div style={{ width: 1, height: 14, background: 'rgba(255,255,255,0.20)' }} />
        {/* Category badge */}
        <span style={{
          fontSize:      12,
          fontWeight:    500,
          letterSpacing: '2px',
          color:         ACCENT_TEAL,
          textTransform: 'uppercase',
          opacity:       0.85,
        }}>
          Building Intelligence
        </span>
      </div>

      {/* ── Red accent bar ────────────────────────────────────────────────── */}
      <div style={{
        position:     'absolute',
        top:          '41%',
        left:         '50%',
        transform:    'translateX(-50%)',
        width:         lineWidth,
        height:        2,
        background:   `linear-gradient(to right, ${ACCENT_RED}, ${ACCENT_RED}bb)`,
        borderRadius:  2,
        boxShadow:    `0 0 10px ${ACCENT_RED}66`,
      }} />

      {/* ── Main content block ───────────────────────────────────────────── */}
      <div style={{
        display:        'flex',
        flexDirection:  'column',
        alignItems:     'center',
        justifyContent: 'center',
        marginTop:       76,  // push centre-of-mass slightly below visual midpoint
        gap:             22,
      }}>

        {/* Title words — word-by-word spring reveal */}
        <div style={{
          display:        'flex',
          flexWrap:       'wrap',
          gap:            '16px',
          justifyContent: 'center',
          alignItems:     'flex-end',
          maxWidth:       '78%',
          lineHeight:      1.12,
        }}>
          {titleWords.map((word, i) => {
            const wordSpring = spring({
              frame:  frame - (TITLE_START + i * TITLE_STAGGER),
              fps,
              from:   0,
              to:     1,
              config: { damping: 13, stiffness: 95 },
            });
            const translateY = interpolate(wordSpring, [0, 1], [52, 0]);

            return (
              <span
                key={i}
                style={{
                  fontSize:             56,
                  fontWeight:           800,
                  letterSpacing:        '-1.5px',
                  background:           `linear-gradient(135deg, #ffffff 0%, rgba(255,255,255,0.90) 50%, ${ACCENT_TEAL} 100%)`,
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor:  'transparent',
                  backgroundClip:       'text',
                  opacity:               wordSpring,
                  transform:            `translateY(${translateY}px)`,
                  display:              'inline-block',
                  textShadow:           'none',   // required for gradient text in Chromium
                }}
              >
                {word}
              </span>
            );
          })}
        </div>

        {/* Subtitle — single-unit fade */}
        {subtitleText && (
          <div style={{
            opacity:       subtitleOpacity,
            transform:     `translateY(${subtitleY}px)`,
            display:       'flex',
            alignItems:    'center',
            gap:            10,
            maxWidth:      '64%',
            justifyContent:'center',
            flexWrap:      'wrap',
          }}>
            {subtitleText.split(' · ').map((chunk, i, arr) => (
              <React.Fragment key={i}>
                <span style={{
                  fontSize:   22,
                  fontWeight: 400,
                  color:      TEXT_MUTED,
                  textAlign: 'center',
                  lineHeight: 1.5,
                }}>
                  {chunk}
                </span>
                {i < arr.length - 1 && (
                  <span style={{ color: ACCENT_TEAL, opacity: 0.55, fontSize: 14, userSelect: 'none' }}>·</span>
                )}
              </React.Fragment>
            ))}
          </div>
        )}

        {/* Scene indicator dots */}
        {scenesCount > 0 && (
          <div style={{
            display:    'flex',
            gap:         10,
            marginTop:   8,
          }}>
            {Array.from({ length: scenesCount }).map((_, i) => {
              const dotSpring = spring({
                frame:  frame - (DOTS_START + i * 4),
                fps,
                from:   0,
                to:     1,
                config: { damping: 10, stiffness: 100 },
              });
              return (
                <div
                  key={i}
                  style={{
                    width:        7,
                    height:       7,
                    borderRadius: '50%',
                    background:   i === 0 ? ACCENT_RED : ACCENT_TEAL,
                    opacity:      dotSpring * (i === 0 ? 1 : 0.50),
                    transform:    `scale(${dotSpring})`,
                  }}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* ── Bottom label ──────────────────────────────────────────────────── */}
      <div style={{
        position:      'absolute',
        bottom:         52,
        display:       'flex',
        alignItems:    'center',
        gap:            12,
        opacity:        labelOpacity,
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
