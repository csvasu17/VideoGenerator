import React from 'react';
import {useCurrentFrame, interpolate} from 'remotion';
import {theme} from '../config/theme';

export interface Caption {
  startFrame: number;
  endFrame: number;
  text: string;
  speaker?: string;
}

interface Props {
  captions: Caption[];
  position?: 'bottom' | 'top';
}

export const CaptionComponent: React.FC<Props> = ({captions, position = 'bottom'}) => {
  const frame = useCurrentFrame();
  const active = captions.find(c => frame >= c.startFrame && frame <= c.endFrame);
  if (!active) return null;

  const inProgress = Math.min((frame - active.startFrame) / 10, 1);
  const outProgress = Math.min((active.endFrame - frame) / 10, 1);
  const opacity = Math.min(inProgress, outProgress);

  return (
    <div style={{
      position:'absolute',
      [position === 'bottom' ? 'bottom' : 'top']: 60,
      left:'50%', transform:'translateX(-50%)',
      display:'flex', flexDirection:'column', alignItems:'center', gap:6,
      opacity,
      maxWidth: 1400,
      zIndex: 100,
    }}>
      {active.speaker && (
        <div style={{
          fontFamily: theme.fonts.body,
          fontSize: 18, fontWeight:600,
          color: theme.colors.blue.bright,
          letterSpacing:'0.08em', textTransform:'uppercase',
        }}>
          {active.speaker}
        </div>
      )}
      <div style={{
        background:'rgba(0,0,0,0.75)',
        backdropFilter:'blur(12px)',
        border: `1px solid ${theme.colors.border.subtle}`,
        borderRadius: theme.radius.md,
        padding:'12px 28px',
        fontFamily: theme.fonts.body,
        fontSize: 26, fontWeight:400,
        color: theme.colors.text.primary,
        lineHeight: 1.5,
        textAlign:'center',
        letterSpacing:'0.01em',
      }}>
        {active.text}
      </div>
    </div>
  );
};
