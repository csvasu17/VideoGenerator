/**
 * RawVideoPlayback — plays back an already-recorded/assembled MP4 as-is, with
 * no scene composition of our own. Used to preview the Config UI's "Agent
 * Recording" and "Manual Recording" outputs (automation/record-flow.ts,
 * automation/process-manual-recording.ts) as proper Remotion Studio
 * compositions, alongside the template-driven videos (Enterprise, Teaser,
 * etc.), instead of only as inline <video> players inside the Config tool.
 */

import React from 'react';
import { AbsoluteFill, OffthreadVideo, staticFile } from 'remotion';

export interface RawVideoPlaybackProps {
  /** Path relative to the current product's public-dir, e.g. "agent-recording/agent-walkthrough.mp4". Empty when the file doesn't exist yet. */
  videoPath: string;
  /** Shown instead of the video when videoPath is empty (file not generated yet). */
  emptyMessage: string;
  // Remotion's <Composition> requires Props to satisfy Record<string, unknown>.
  [key: string]: unknown;
}

export const RawVideoPlayback: React.FC<RawVideoPlaybackProps> = ({ videoPath, emptyMessage }) => {
  if (!videoPath) {
    return (
      <AbsoluteFill style={{
        background: '#0a0f1a', color: '#ffffff', fontFamily: 'sans-serif',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 32, textAlign: 'center', padding: 100, lineHeight: 1.5,
      }}>
        {emptyMessage}
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill style={{ background: '#000000' }}>
      <OffthreadVideo
        src={staticFile(videoPath)}
        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
      />
    </AbsoluteFill>
  );
};
