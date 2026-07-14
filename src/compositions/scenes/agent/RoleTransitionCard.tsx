/**
 * RoleTransitionCard — short title card shown between each role's footage in the
 * exhaustive Agent Recording walkthrough. Reuses EnterpriseBRollScene's dark
 * cinematic fade/slide visual language for brand consistency with the rest of the
 * product's videos, rather than inventing a new look for this one template.
 */

import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { FONT_STACK } from '../../tokens';

export interface RoleTransitionCardProps {
  roleName:   string;
  roleIndex:  number;   // 0-based
  totalRoles: number;
  /** Shown when this role's footage was recorded under a fallback account
   *  (no Quick Access card matched the role) — makes the degradation visible
   *  in the video itself, not just in agent-safety-report.json. */
  note?:      string;
  // Required so Composition<Schema, Props> in Root.tsx can infer Props from
  // defaultProps alone — matches every other top-level Composition props
  // interface in this codebase (DemoVideoProps, EnterpriseVideoProps, etc.).
  [key: string]: unknown;
}

export const RoleTransitionCard: React.FC<RoleTransitionCardProps> = ({
  roleName, roleIndex, totalRoles, note,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const fadeIn  = interpolate(frame, [0, 18], [0, 1], { extrapolateRight: 'clamp' });
  const fadeOut = interpolate(frame, [durationInFrames - 18, durationInFrames], [1, 0], { extrapolateLeft: 'clamp' });
  const opacity = Math.min(fadeIn, fadeOut);

  const titleSpring = spring({ frame, fps, from: 0, to: 1, config: { damping: 16, stiffness: 70 } });
  const titleSlide   = interpolate(titleSpring, [0, 1], [24, 0]);

  return (
    <AbsoluteFill
      style={{
        background: 'radial-gradient(ellipse at 50% 40%, #16233f 0%, #0a0f1a 70%)',
        fontFamily: FONT_STACK,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        opacity,
      }}
    >
      <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 16, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 16, opacity: titleSpring }}>
        Role {roleIndex + 1} of {totalRoles}
      </div>

      <div style={{ opacity: titleSpring, transform: `translateY(${titleSlide}px)` }}>
        <span style={{ color: '#ffffff', fontSize: 48, fontWeight: 800, letterSpacing: '-0.5px' }}>
          {roleName}
        </span>
      </div>

      <div style={{ width: 60, height: 3, borderRadius: 2, background: 'linear-gradient(to right, #0a93d3, #059669)', marginTop: 22, opacity: titleSpring }} />

      {note && (
        <div style={{ opacity: titleSpring, marginTop: 20, maxWidth: 700, textAlign: 'center', padding: '0 48px' }}>
          <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: 16, fontStyle: 'italic' }}>
            {note}
          </span>
        </div>
      )}
    </AbsoluteFill>
  );
};
