/**
 * FeatureProof — 3-column feature-proof scene for Remotion.
 *
 * Animation sequence:
 *   0  – 30f : Eyebrow label slides in from left
 *  10  – 55f : Headline fades up (split across two lines)
 *  35  – 90f : Feature cards stagger in (scale + translateY) — one by one
 *  80  – 160f: SVGCheckmarks draw on each card with stagger
 * 140+ – end : Stat lines roll/fade in below each card
 *
 * Default content is Rheem Visibility chapter proof. Override all props as needed.
 */
import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate} from 'remotion';
import {theme} from '../config/theme';
import {Springs, staggerDelay, glowPulse, slideFromLeft, wordStagger} from '../../core/utils/animations';
import {cinematicFade, scenePresenceStyle} from '../../core/utils/transitions';
import {SVGCheckmark} from '../components/SVGCheckmark';

export interface FeatureDef {
  icon: string;
  title: string;
  description: string;
  stat?: string;
  accent?: 'blue' | 'orange';
}

interface Props {
  eyebrow?: string;
  headline?: string;
  subline?: string;
  features?: FeatureDef[];
  accent?: 'blue' | 'orange';
}

// ─── Rheem defaults — Visibility chapter features ─────────────────────────────

const DEFAULT_FEATURES: FeatureDef[] = [
  {
    icon: '📡',
    title: 'Real-Time Fleet View',
    description: 'All 27 devices across 6 sites on a single dashboard — live status, zero blind spots, zero delays.',
    stat: '100% fleet visibility',
    accent: 'blue',
  },
  {
    icon: '🔔',
    title: 'Instant Alert Triage',
    description: 'Critical alarms surface automatically, priority-sorted so your team acts on what matters first.',
    stat: '60% faster response',
    accent: 'orange',
  },
  {
    icon: '📊',
    title: 'KPI Command Center',
    description: 'Uptime, energy efficiency, service velocity — every operational metric unified in one view.',
    stat: '99.9% uptime tracked',
    accent: 'blue',
  },
];

// ─── Main component ───────────────────────────────────────────────────────────

export const FeatureProof: React.FC<Props> = ({
  eyebrow  = 'PROVEN CAPABILITIES',
  headline = 'Everything you need.\nNothing you don\'t.',
  subline,
  features = DEFAULT_FEATURES,
  accent   = 'blue',
}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();

  const accentColor = accent === 'blue' ? theme.colors.blue.primary : theme.colors.orange.primary;
  const pulse       = glowPulse(frame, fps, 0.35);

  const sceneOp  = cinematicFade(frame, durationInFrames, 22, 22);
  const presence = scenePresenceStyle(frame, durationInFrames, 22, 22, 'fade-up', 'push-left');

  const eyebrowAnim = slideFromLeft(frame, fps, 8, 80);
  const headlineWords = headline.split(/\s+/);

  return (
    <AbsoluteFill style={{opacity: sceneOp, ...presence, overflow: 'hidden'}}>

      {/* ── SMOOTH GRADIENT WASH background ── */}
      <div style={{position:'absolute', inset:0, background:'#060510'}}/>
      <div style={{
        position:'absolute', top:'-40%', left:'-30%',
        width:1500, height:1500, borderRadius:'50%',
        background:'radial-gradient(circle, rgba(80,100,255,0.55) 0%, rgba(50,60,200,0.30) 40%, transparent 68%)',
        filter:'blur(110px)', pointerEvents:'none',
      }}/>
      <div style={{
        position:'absolute', bottom:'-40%', right:'-30%',
        width:1500, height:1500, borderRadius:'50%',
        background:'radial-gradient(circle, rgba(200,60,255,0.52) 0%, rgba(160,20,200,0.28) 40%, transparent 68%)',
        filter:'blur(110px)', pointerEvents:'none',
      }}/>
      <div style={{
        position:'absolute', top:'10%', left:'50%', transform:'translateX(-50%)',
        width:1800, height:600, borderRadius:'50%',
        background:'radial-gradient(ellipse, rgba(130,80,255,0.18) 0%, transparent 65%)',
        filter:'blur(80px)', pointerEvents:'none',
      }}/>

      {/* Grid overlay */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: [
          'linear-gradient(rgba(255,255,255,0.016) 1px, transparent 1px)',
          'linear-gradient(90deg, rgba(255,255,255,0.016) 1px, transparent 1px)',
        ].join(', '),
        backgroundSize: '80px 80px', opacity: 0.6,
      }}/>
      {/* Vignette */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'radial-gradient(ellipse 80% 80% at 50% 50%, transparent 40%, rgba(0,0,0,0.6) 100%)',
      }}/>

      {/* ── Content ───────────────────────────────────────────────────────── */}
      <AbsoluteFill style={{
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: 40, padding: '60px 100px',
      }}>

        {/* Header block */}
        <div style={{textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 10}}>
          {/* Eyebrow */}
          <div style={{
            fontFamily: theme.fonts.body, fontSize: 11, fontWeight: 700,
            letterSpacing: '0.20em', textTransform: 'uppercase' as const,
            color: accentColor,
            opacity: eyebrowAnim.opacity,
            transform: `translateX(${eyebrowAnim.translateX}px)`,
          }}>
            {eyebrow}
          </div>

          {/* Headline — word-by-word reveal */}
          <div style={{
            fontFamily: theme.fonts.heading, fontSize: 46, fontWeight: 800,
            letterSpacing: '-0.03em', lineHeight: 1.1,
            color: theme.colors.text.primary,
            display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '0 12px',
          }}>
            {headlineWords.map((word, wi) => {
              const wAnim = wordStagger(frame, fps, wi, 18, 7);
              return (
                <span key={wi} style={{
                  display: 'inline-block',
                  opacity: wAnim.opacity,
                  transform: `translateY(${wAnim.translateY}px)`,
                }}>
                  {word}
                </span>
              );
            })}
          </div>

          {/* Optional subline */}
          {subline && (
            <div style={{
              fontFamily: theme.fonts.body, fontSize: 17, fontWeight: 400,
              color: theme.colors.text.secondary, lineHeight: 1.5,
              opacity: interpolate(
                spring({fps, frame: frame - 50, config: Springs.gentle, durationInFrames: 30}),
                [0,0.3,1],[0,1,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}),
            }}>
              {subline}
            </div>
          )}
        </div>

        {/* Feature cards — 3-column grid */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
          gap: 20, width: '100%',
        }}>
          {features.map((feat, idx) => {
            const cardDelay = 38 + staggerDelay(idx, 18);
            const cardP     = spring({fps, frame: frame - cardDelay, config: Springs.cinematic, durationInFrames: 50});
            const cardOp    = interpolate(cardP, [0,0.2,1], [0,1,1], {extrapolateLeft:'clamp', extrapolateRight:'clamp'});
            const cardTY    = interpolate(cardP, [0,1], [40,0]);
            const cardSc    = interpolate(cardP, [0,1], [0.93,1.0]);

            const featAccent      = feat.accent ?? accent;
            const featColor       = featAccent === 'blue' ? theme.colors.blue.primary  : theme.colors.orange.primary;
            const featGlow        = featAccent === 'blue' ? theme.colors.blue.glow     : theme.colors.orange.glow;
            const featSubtle      = featAccent === 'blue' ? theme.colors.blue.subtle   : theme.colors.orange.subtle;
            const featBorder      = featAccent === 'blue' ? theme.colors.border.blue   : theme.colors.border.orange;

            // Checkmark delay: after card is ~80% revealed
            const checkDelay = cardDelay + 30 + staggerDelay(idx, 12);
            // Stat line delay
            const statDelay  = checkDelay + 35;
            const statP      = spring({fps, frame: frame - statDelay, config: Springs.gentle, durationInFrames: 25});

            return (
              <div key={idx} style={{
                opacity: cardOp,
                transform: `translateY(${cardTY}px) scale(${cardSc})`,
                background: theme.colors.backgroundCard,
                border: `1px solid ${featBorder}`,
                borderRadius: theme.radius.lg,
                padding: '32px 28px',
                display: 'flex', flexDirection: 'column', gap: 14,
                position: 'relative', overflow: 'hidden',
                boxShadow: `0 20px 60px rgba(0,0,0,0.4), 0 0 40px ${featGlow}22`,
              }}>
                {/* Top accent bar */}
                <div style={{
                  position: 'absolute', top: 0, left: 0, right: 0, height: 2,
                  background: featColor, opacity: 0.85,
                }}/>
                {/* Ambient glow behind icon */}
                <div style={{
                  position: 'absolute', top: '-20%', left: '-10%',
                  width: '50%', height: '50%',
                  background: `radial-gradient(circle, ${featSubtle} 0%, transparent 70%)`,
                  filter: 'blur(28px)', pointerEvents: 'none',
                }}/>

                {/* Icon + checkmark row */}
                <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
                  <div style={{
                    width: 52, height: 52, borderRadius: 13,
                    background: featSubtle,
                    border: `1px solid ${featGlow}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 26,
                    boxShadow: `0 0 18px ${featGlow}`,
                    position: 'relative',
                  }}>
                    {feat.icon}
                  </div>
                  <SVGCheckmark
                    size={34}
                    color={featColor}
                    delay={checkDelay}
                    strokeWidth={2.5}
                    showCircle={true}
                  />
                </div>

                {/* Title */}
                <div style={{
                  fontFamily: theme.fonts.heading, fontSize: 20, fontWeight: 700,
                  color: theme.colors.text.primary, letterSpacing: '-0.01em',
                  position: 'relative',
                }}>
                  {feat.title}
                </div>

                {/* Description */}
                <div style={{
                  fontFamily: theme.fonts.body, fontSize: 14, fontWeight: 400,
                  color: theme.colors.text.secondary, lineHeight: 1.65,
                  position: 'relative',
                }}>
                  {feat.description}
                </div>

                {/* Stat badge */}
                {feat.stat && (
                  <div style={{
                    marginTop: 'auto',
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '6px 12px',
                    background: featSubtle,
                    border: `1px solid ${featGlow}`,
                    borderRadius: theme.radius.full,
                    opacity: interpolate(statP, [0,0.3,1], [0,1,1], {extrapolateLeft:'clamp', extrapolateRight:'clamp'}),
                    transform: `translateY(${interpolate(statP, [0,1], [8,0])}px)`,
                    alignSelf: 'flex-start',
                    position: 'relative',
                  }}>
                    <div style={{width: 6, height: 6, borderRadius: '50%', background: featColor, boxShadow: `0 0 6px ${featGlow}`}}/>
                    <div style={{
                      fontFamily: theme.fonts.heading, fontSize: 12, fontWeight: 700,
                      color: featColor, letterSpacing: '0.02em',
                    }}>
                      {feat.stat}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

      </AbsoluteFill>
    </AbsoluteFill>
  );
};
