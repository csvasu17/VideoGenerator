/**
 * AppFlowIntroScene — opening beat: full-map cascade reveal.
 *
 * Nodes fade in as a breadth-first, depth-level wave (all depth-0 nodes
 * together, then depth-1, then depth-2, ...) rather than a per-node stagger —
 * this bounds the reveal duration by the tree's maxDepth (2-4), not by total
 * node count, so the scene works the same whether the app has 10 screens or
 * 60.
 */

import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { AppFlowDiagramCanvas } from './AppFlowDiagramCanvas';
import { FONT_STACK } from '../../tokens';
import type { AppFlowNode } from '../../../core/domain/entities/RemotionPackage';

export interface AppFlowIntroSceneProps {
  nodes:       AppFlowNode[];
  productName: string;
}

const WAVE_START_FRAME = 20;
const WAVE_GAP_FRAMES  = 15;
const WAVE_FADE_FRAMES = 18;

export const AppFlowIntroScene: React.FC<AppFlowIntroSceneProps> = ({ nodes, productName }) => {
  const frame = useCurrentFrame();

  const titleOpacity = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: 'clamp' });

  const nodeOpacity: Record<string, number> = {};
  for (const n of nodes) {
    const waveStart = WAVE_START_FRAME + n.depth * WAVE_GAP_FRAMES;
    nodeOpacity[n.id] = interpolate(
      frame, [waveStart, waveStart + WAVE_FADE_FRAMES], [0, 1],
      { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
    );
  }

  return (
    <AbsoluteFill style={{ background: '#0a0f1a', fontFamily: FONT_STACK }}>
      <div style={{ position: 'absolute', top: 40, left: 0, right: 0, textAlign: 'center', opacity: titleOpacity, zIndex: 10 }}>
        <span style={{ color: '#fff', fontSize: 32, fontWeight: 800 }}>{productName}</span>
        <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 16, marginTop: 4 }}>Complete Application Map</div>
      </div>
      <div style={{ position: 'absolute', top: 120, left: 80, right: 80, bottom: 60 }}>
        <AppFlowDiagramCanvas nodes={nodes} nodeOpacity={nodeOpacity} />
      </div>
    </AbsoluteFill>
  );
};
