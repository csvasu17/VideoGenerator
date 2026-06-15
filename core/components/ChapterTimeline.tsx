import React from 'react';
import {useCurrentFrame, interpolate} from 'remotion';
import {useTheme} from '../themes';

interface Chapter {
  label: string;
  startFrame: number;
  endFrame: number;
}

interface Props {
  chapters: Chapter[];
  totalFrames: number;
}

export const ChapterTimeline: React.FC<Props> = ({chapters, totalFrames}) => {
  const theme = useTheme();
  const frame = useCurrentFrame();
  const progress = frame / totalFrames;
  const activeChapter = chapters.findIndex(c => frame >= c.startFrame && frame <= c.endFrame);

  return (
    <div style={{
      position:'absolute', bottom:28, left:80, right:80,
      display:'flex', alignItems:'center', gap:0,
      zIndex:50,
    }}>
      {/* Track */}
      <div style={{position:'absolute', left:0, right:0, height:2, background:theme.colors.border.subtle, borderRadius:1}}/>
      {/* Progress */}
      <div style={{
        position:'absolute', left:0, width:`${progress*100}%`, height:2,
        background: `linear-gradient(90deg, ${theme.colors.blue.primary}, ${theme.colors.orange.primary})`,
        borderRadius:1, boxShadow:`0 0 8px ${theme.colors.blue.glow}`,
      }}/>
      {/* Chapter markers */}
      {chapters.map((c, i) => {
        const pos = c.startFrame / totalFrames;
        const isActive = i === activeChapter;
        const isPast = frame > c.endFrame;
        return (
          <div key={i} style={{
            position:'absolute',
            left:`${pos*100}%`,
            display:'flex', flexDirection:'column', alignItems:'center', gap:6,
            transform:'translateX(-50%)',
          }}>
            <div style={{
              width: isActive ? 12 : 8,
              height: isActive ? 12 : 8,
              borderRadius:'50%',
              background: isActive ? theme.colors.blue.primary : isPast ? theme.colors.blue.primary : theme.colors.border.normal,
              boxShadow: isActive ? `0 0 12px ${theme.colors.blue.glow}` : 'none',
              transition:'all 0.2s',
            }}/>
            <div style={{
              fontFamily: theme.fonts.body,
              fontSize:11, fontWeight: isActive ? 600 : 400,
              color: isActive ? theme.colors.text.primary : theme.colors.text.tertiary,
              letterSpacing:'0.05em', textTransform:'uppercase',
              marginTop:6,
              opacity: isActive ? 1 : 0.6,
              whiteSpace:'nowrap',
            }}>
              {c.label}
            </div>
          </div>
        );
      })}
    </div>
  );
};
