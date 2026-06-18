/**
 * AnimatedFemaleAvatar — CSS/SVG animated professional female presenter.
 *
 * Self-contained: uses useCurrentFrame() for:
 *   - Talking mouth  (sin-wave open/close, ~0.28s cycle)
 *   - Eye blink      (3 frames every ~4 seconds)
 *   - Subtle head nod
 *
 * ViewBox 200×298 matches the PresenterOverlay 1:1.49 aspect ratio exactly.
 */

import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';

export const AnimatedFemaleAvatar: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Talking: mouth opens/closes in a natural cycle
  const mouthOpen = Math.abs(Math.sin((frame / (fps * 0.28)) * Math.PI)) * 6.5;

  // Eye blink every ~4 s, lasting 3 frames
  const isBlink = (frame % Math.round(fps * 4)) < 3;
  const eyeRY   = isBlink ? 1.2 : 8.5;

  // Subtle head nod
  const nod = Math.sin(frame * 0.04) * 1.8;

  // ── Palette ──
  const S   = '#F2C580';  // skin base
  const SS  = '#D49840';  // skin shadow
  const SD  = '#C07A28';  // skin dark
  const H   = '#2E1A09';  // hair dark
  const HM  = '#4A2C10';  // hair mid
  const BD  = '#0E2038';  // blazer dark
  const W   = '#F5F5F5';  // shirt
  const L   = '#C05858';  // upper lip
  const LL  = '#D07070';  // lower lip
  const EW  = '#FFFFFF';  // eye white
  const IR  = '#4A2C14';  // iris
  const PU  = '#180A04';  // pupil
  const BR  = '#281606';  // brow

  return (
    <svg
      viewBox="0 0 200 298"
      xmlns="http://www.w3.org/2000/svg"
      style={{ width: '100%', height: '100%', display: 'block' }}
    >
      <defs>
        <linearGradient id="av-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0c1a30" />
          <stop offset="100%" stopColor="#070e1e" />
        </linearGradient>
        <radialGradient id="av-skin" cx="50%" cy="38%" r="55%">
          <stop offset="0%" stopColor="#FAD494" />
          <stop offset="100%" stopColor="#D49840" />
        </radialGradient>
        <linearGradient id="av-hair" x1="0.2" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4A2C10" />
          <stop offset="55%" stopColor="#281408" />
          <stop offset="100%" stopColor="#160A04" />
        </linearGradient>
        <linearGradient id="av-blazer" x1="0" y1="0" x2="0.2" y2="1">
          <stop offset="0%" stopColor="#1E3D64" />
          <stop offset="100%" stopColor="#0E2038" />
        </linearGradient>
        <radialGradient id="av-glow" cx="50%" cy="95%" r="45%">
          <stop offset="0%" stopColor="#0a93d3" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#0a93d3" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* ── Panel background ── */}
      <rect width="200" height="298" fill="url(#av-bg)" rx="16" />
      <rect x="0" y="210" width="200" height="88" fill="url(#av-glow)" />
      <rect width="200" height="3" fill="#0a93d3" rx="2" />

      {/* ── Character (with head nod) ── */}
      <g transform={`translate(0,${nod})`}>

        {/* Blazer body */}
        <path
          d="M 0,298 L 0,225 Q 32,199 58,193 L 74,207 L 100,219 L 126,207 L 142,193 Q 168,199 200,225 L 200,298 Z"
          fill="url(#av-blazer)"
        />
        {/* Shoulder highlight */}
        <path d="M 0,241 Q 28,215 56,209 L 54,221 Q 28,229 0,257 Z" fill="#244468" opacity="0.45" />
        {/* Left lapel */}
        <path d="M 58,193 L 76,208 L 76,223 L 60,219 L 52,208 Z" fill={BD} />
        {/* Right lapel */}
        <path d="M 142,193 L 124,208 L 124,223 L 140,219 L 148,208 Z" fill={BD} />
        {/* Blouse / shirt */}
        <path d="M 76,208 L 100,239 L 124,208 L 100,199 Z" fill={W} />
        <line x1="100" y1="199" x2="100" y2="239" stroke="#DDDDDD" strokeWidth="0.8" />
        <circle cx="100" cy="215" r="2.2" fill="#CCCCCC" />
        <circle cx="100" cy="226" r="2.2" fill="#CCCCCC" />

        {/* Neck */}
        <rect x="87" y="161" width="26" height="36" rx="10" fill="url(#av-skin)" />
        <path d="M 87,161 Q 100,155 113,161 L 113,171 Q 100,165 87,171 Z" fill={SS} opacity="0.45" />

        {/* ── Hair back mass ── */}
        <ellipse cx="100" cy="100" rx="58" ry="70" fill="url(#av-hair)" />
        {/* Left long hair */}
        <path
          d="M 44,83 Q 26,119 22,159 Q 18,193 22,227 Q 24,253 34,263 L 48,265 Q 38,249 38,213 Q 38,175 46,141 Q 54,111 58,97 Z"
          fill={H}
        />
        {/* Right long hair */}
        <path
          d="M 156,83 Q 174,119 178,159 Q 182,193 178,227 Q 176,253 166,263 L 152,265 Q 162,249 162,213 Q 162,175 154,141 Q 146,111 142,97 Z"
          fill={H}
        />

        {/* ── Face oval ── */}
        <ellipse cx="100" cy="99" rx="51" ry="58" fill="url(#av-skin)" />

        {/* Cheek blush */}
        <ellipse cx="67"  cy="113" rx="13" ry="8" fill="#E8806A" opacity="0.13" />
        <ellipse cx="133" cy="113" rx="13" ry="8" fill="#E8806A" opacity="0.13" />

        {/* ── Hair front (over forehead) ── */}
        <path
          d="M 51,95 Q 55,44 100,40 Q 145,44 149,95 Q 133,68 100,66 Q 67,68 51,95 Z"
          fill="url(#av-hair)"
        />
        {/* Center part */}
        <path d="M 96,40 Q 100,38 104,40 L 103,66 Q 100,64 97,66 Z" fill={HM} opacity="0.6" />

        {/* ── Ears ── */}
        <ellipse cx="49"  cy="105" rx="7" ry="9" fill={S} />
        <ellipse cx="49"  cy="105" rx="4" ry="6" fill={SS} opacity="0.5" />
        <ellipse cx="151" cy="105" rx="7" ry="9" fill={S} />
        <ellipse cx="151" cy="105" rx="4" ry="6" fill={SS} opacity="0.5" />

        {/* ── Eyebrows (thin arched feminine) ── */}
        <path d="M 67,82 Q 74,76 85,79"  stroke={BR} strokeWidth="2.6" fill="none" strokeLinecap="round" />
        <path d="M 133,82 Q 126,76 115,79" stroke={BR} strokeWidth="2.6" fill="none" strokeLinecap="round" />

        {/* ── Left eye ── */}
        <ellipse cx="78" cy="93" rx="13.5" ry="10" fill={SD} opacity="0.10" />
        <ellipse cx="78" cy="92" rx="12" ry={eyeRY} fill={EW} />
        {!isBlink && (
          <>
            <circle cx="79" cy="92" r="7"   fill={IR} />
            <circle cx="79" cy="92" r="4"   fill={PU} />
            <circle cx="82" cy="89.5" r="2.2" fill="white" opacity="0.92" />
            <circle cx="77.5" cy="95" r="1" fill="white" opacity="0.35" />
          </>
        )}
        <path d="M 66,92 Q 78,83 90,92" stroke={PU} strokeWidth="1.8" fill="none" />
        {/* Left lashes */}
        <line x1={68.5} y1={88.5} x2={66}   y2={85}   stroke={PU} strokeWidth="1.2" />
        <line x1={73.5} y1={86}   x2={72}   y2={82.5} stroke={PU} strokeWidth="1.2" />
        <line x1={78.5} y1={85}   x2={78}   y2={81}   stroke={PU} strokeWidth="1.2" />
        <line x1={83.5} y1={86}   x2={85}   y2={82.5} stroke={PU} strokeWidth="1.2" />
        <line x1={88}   y1={88.5} x2={90.5} y2={85.5} stroke={PU} strokeWidth="1.2" />
        <path d="M 67,92 Q 78,99 89,92" stroke={SD} strokeWidth="0.7" fill="none" opacity="0.4" />

        {/* ── Right eye ── */}
        <ellipse cx="122" cy="93" rx="13.5" ry="10" fill={SD} opacity="0.10" />
        <ellipse cx="122" cy="92" rx="12" ry={eyeRY} fill={EW} />
        {!isBlink && (
          <>
            <circle cx="121" cy="92" r="7"   fill={IR} />
            <circle cx="121" cy="92" r="4"   fill={PU} />
            <circle cx="124" cy="89.5" r="2.2" fill="white" opacity="0.92" />
            <circle cx="119.5" cy="95" r="1" fill="white" opacity="0.35" />
          </>
        )}
        <path d="M 110,92 Q 122,83 134,92" stroke={PU} strokeWidth="1.8" fill="none" />
        {/* Right lashes */}
        <line x1={111.5} y1={88.5} x2={109}   y2={85}   stroke={PU} strokeWidth="1.2" />
        <line x1={116.5} y1={86}   x2={115}   y2={82.5} stroke={PU} strokeWidth="1.2" />
        <line x1={121.5} y1={85}   x2={121}   y2={81}   stroke={PU} strokeWidth="1.2" />
        <line x1={126.5} y1={86}   x2={128}   y2={82.5} stroke={PU} strokeWidth="1.2" />
        <line x1={131}   y1={88.5} x2={133.5} y2={85.5} stroke={PU} strokeWidth="1.2" />
        <path d="M 111,92 Q 122,99 133,92" stroke={SD} strokeWidth="0.7" fill="none" opacity="0.4" />

        {/* ── Nose ── */}
        <path d="M 99,106 Q 97,113 99,117 Q 100,119 101,117 Q 103,113 101,106" stroke={SS} strokeWidth="1.1" fill="none" />
        <path d="M 94,116 Q 97.5,120 100,118" stroke={SD} strokeWidth="0.9" fill="none" />
        <path d="M 106,116 Q 102.5,120 100,118" stroke={SD} strokeWidth="0.9" fill="none" />

        {/* ── Mouth (animated) ── */}
        {/* Upper lip */}
        <path
          d={`M 84,125 Q 91,120 100,122 Q 109,120 116,125 Q 109,${125.5 + mouthOpen * 0.25} 100,${126.5 + mouthOpen * 0.25} Q 91,${125.5 + mouthOpen * 0.25} 84,125 Z`}
          fill={L}
        />
        {/* Cupid's bow highlight */}
        <path d="M 94,122 Q 100,120 106,122" stroke="#D07070" strokeWidth="0.8" fill="none" />
        {/* Teeth */}
        {mouthOpen > 1.5 && (
          <ellipse
            cx="100"
            cy={129 + mouthOpen * 0.35}
            rx={Math.min(9.5, 9.5 * mouthOpen / 6.5)}
            ry={mouthOpen * 0.55}
            fill="#FAFAF8"
          />
        )}
        {/* Lower lip */}
        <path
          d={`M 84,125 Q 91,${133 + mouthOpen * 0.8} 100,${135 + mouthOpen} Q 109,${133 + mouthOpen * 0.8} 116,125 Q 109,${130 + mouthOpen * 0.35} 100,${129 + mouthOpen * 0.35} Q 91,${130 + mouthOpen * 0.35} 84,125 Z`}
          fill={LL}
        />
        {/* Lip separator */}
        <path d={`M 84,125 Q 100,${127 + mouthOpen * 0.3} 116,125`} stroke="#A03838" strokeWidth="0.9" fill="none" />
        {/* Smile corners */}
        <path d="M 84,125 Q 82,129 83,133" stroke={SS} strokeWidth="0.8" fill="none" opacity="0.55" />
        <path d="M 116,125 Q 118,129 117,133" stroke={SS} strokeWidth="0.8" fill="none" opacity="0.55" />

      </g>

      {/* Label tag */}
      <rect x="28" y="277" width="144" height="17" rx="6" fill="rgba(10,147,211,0.22)" />
      <text
        x="100" y="289"
        textAnchor="middle"
        fill="#6CC8E8"
        fontSize="8"
        fontFamily="system-ui,-apple-system,sans-serif"
        fontWeight="700"
        letterSpacing="1.5"
      >
        AI PRESENTER
      </text>
    </svg>
  );
};
