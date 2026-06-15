/**
 * AnimatedBackground — Smooth gradient wash
 *
 * Matches the reference Gantt View gradient exactly:
 *   Left half  : blue-lavender wash  (rgba(80,100,255) → rgba(50,60,200))
 *   Right half : pink-purple wash    (rgba(200,60,255) → rgba(160,20,200))
 *   Center     : purple blend ellipse to tie both washes seamlessly
 *
 * Each wash orb drifts very slowly so the gradient feels alive but
 * never resolves into distinct circles — it stays a continuous flow.
 */
import React from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';
import {orbDrift} from '../utils/animations';
import {useTheme} from '../themes';

interface Props {
  variant?: 'default' | 'intense' | 'subtle';
  phaseOffset?: number;
}

export const AnimatedBackground: React.FC<Props> = ({variant = 'default', phaseOffset = 0}) => {
  const theme = useTheme();
  const frame = useCurrentFrame();
  const {fps}  = useVideoConfig();

  // Very slow, wide drifts — keeps washes flowing without becoming blobs
  const drift1 = orbDrift(frame + phaseOffset, fps, 0,    0.38, 55, 40);   // blue-lavender wash
  const drift2 = orbDrift(frame + phaseOffset, fps, 1.80, 0.30, -48, 36);  // pink-purple wash
  const drift3 = orbDrift(frame + phaseOffset, fps, 3.20, 0.52,  30, 22);  // center blend

  // Intensity scales opacity of washes (not size — size stays large for smooth look)
  const blueOp  = variant === 'intense' ? 0.62 : variant === 'subtle' ? 0.20 : 0.55;
  const pinkOp  = variant === 'intense' ? 0.58 : variant === 'subtle' ? 0.18 : 0.52;
  const blendOp = variant === 'intense' ? 0.24 : variant === 'subtle' ? 0.08 : 0.18;

  return (
    <div style={{position: 'absolute', inset: 0, background: '#060510', overflow: 'hidden'}}>

      {/* ── SMOOTH GRADIENT WASH — watercolor flow matching reference ──
           Blue-lavender (left) flowing into pink-purple (right).
           Huge orbs + extreme blur = continuous wash, never blobs.
      ── */}

      {/* BLUE-LAVENDER WASH — covers entire left half */}
      <div style={{
        position: 'absolute',
        top:  `calc(-40% + ${drift1.y}px)`,
        left: `calc(-30% + ${drift1.x * -1}px)`,
        width: 1500, height: 1500, borderRadius: '50%',
        background: `radial-gradient(circle,
          rgba(80,100,255,${blueOp}) 0%,
          rgba(50,60,200,${blueOp * 0.55}) 40%,
          transparent 68%)`,
        filter: 'blur(110px)',
        pointerEvents: 'none',
        willChange: 'top, left',
      }} />

      {/* PINK-PURPLE WASH — covers entire right half */}
      <div style={{
        position: 'absolute',
        bottom: `calc(-40% + ${drift2.y}px)`,
        right:  `calc(-30% + ${drift2.x * -1}px)`,
        width: 1500, height: 1500, borderRadius: '50%',
        background: `radial-gradient(circle,
          rgba(200,60,255,${pinkOp}) 0%,
          rgba(160,20,200,${pinkOp * 0.54}) 40%,
          transparent 68%)`,
        filter: 'blur(110px)',
        pointerEvents: 'none',
        willChange: 'bottom, right',
      }} />

      {/* CENTER BLEND — ties both washes into a seamless gradient */}
      <div style={{
        position: 'absolute',
        top:  `calc(10% + ${drift3.y}px)`,
        left: `calc(50% + ${drift3.x}px)`,
        transform: 'translateX(-50%)',
        width: 1800, height: 600, borderRadius: '50%',
        background: `radial-gradient(ellipse, rgba(130,80,255,${blendOp}) 0%, transparent 65%)`,
        filter: 'blur(80px)',
        pointerEvents: 'none',
        willChange: 'top, left',
      }} />

      {/* Fine grid texture */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: [
          'linear-gradient(rgba(255,255,255,0.018) 1px, transparent 1px)',
          'linear-gradient(90deg, rgba(255,255,255,0.018) 1px, transparent 1px)',
        ].join(', '),
        backgroundSize: '80px 80px',
        opacity: 0.70,
      }} />

      {/* Edge vignette — keeps center clean */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'radial-gradient(ellipse 80% 78% at 50% 50%, transparent 33%, rgba(0,0,0,0.58) 100%)',
      }} />
    </div>
  );
};
