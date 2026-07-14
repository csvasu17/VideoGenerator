/**
 * AppFlowTourStopScene — one guided-tour stop, camera framing a depth-1
 * branch (that node + all its descendants).
 *
 * Reuses CameraChoreographer/CameraLayer completely unmodified — the union
 * bounding box of the branch's subtree is passed as the spotlight target's
 * boundingBox, exactly the same mechanism DemoVideo.tsx already uses to zoom
 * into a screenshot region, just aimed at a diagram canvas instead.
 *
 * elementType is 'navigation' (not 'default') deliberately: CameraChoreographer
 * treats 'default' as "no spotlight" and ignores boundingBox entirely — any
 * other ElementType is required to make it actually zoom toward the given box.
 * 'navigation' has the gentlest zoom profile (1.2-1.3x), fitting for framing a
 * whole branch rather than a single small element.
 */

import React from 'react';
import { AbsoluteFill, useVideoConfig } from 'remotion';
import { CameraLayer } from '../../layers/CameraLayer';
import { CameraChoreographer } from '../../../motion/camera/CameraChoreographer';
import { AppFlowDiagramCanvas } from './AppFlowDiagramCanvas';
import { FONT_STACK } from '../../tokens';
import type { AppFlowNode } from '../../../core/domain/entities/RemotionPackage';

export interface AppFlowTourStopSceneProps {
  nodes:          AppFlowNode[];
  subtreeNodeIds: string[];
  caption?:       string;
}

export const AppFlowTourStopScene: React.FC<AppFlowTourStopSceneProps> = ({
  nodes, subtreeNodeIds, caption,
}) => {
  const { durationInFrames, fps } = useVideoConfig();

  const subtreeSet   = new Set(subtreeNodeIds);
  const subtreeNodes = nodes.filter(n => subtreeSet.has(n.id));

  const bbox = React.useMemo(() => {
    if (subtreeNodes.length === 0) return { x: 0.5, y: 0.5, width: 0.2, height: 0.2 };
    const minX = Math.min(...subtreeNodes.map(n => n.x - n.width / 2));
    const maxX = Math.max(...subtreeNodes.map(n => n.x + n.width / 2));
    const minY = Math.min(...subtreeNodes.map(n => n.y - n.height / 2));
    const maxY = Math.max(...subtreeNodes.map(n => n.y + n.height / 2));
    return {
      x: minX, y: minY,
      width:  Math.max(maxX - minX, 0.05),
      height: Math.max(maxY - minY, 0.05),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtreeNodeIds.join(',')]);

  const cameraTimeline = React.useMemo(() => {
    const choreographer = new CameraChoreographer();
    return choreographer.choreograph({
      sceneId:          caption ?? 'tour-stop',
      durationInFrames,
      fps,
      spotlightTarget: { elementType: 'navigation', boundingBox: bbox, priority: 0.6 },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bbox, durationInFrames, fps]);

  const nodeOpacity: Record<string, number> = {};
  for (const n of nodes) nodeOpacity[n.id] = subtreeSet.has(n.id) ? 1 : 0.28;

  return (
    <AbsoluteFill style={{ background: '#0a0f1a', fontFamily: FONT_STACK }}>
      <div style={{ position: 'absolute', inset: 0 }}>
        <CameraLayer timeline={cameraTimeline}>
          <AppFlowDiagramCanvas nodes={nodes} nodeOpacity={nodeOpacity} highlightNodeId={subtreeNodeIds[0]} />
        </CameraLayer>
      </div>
      {caption && (
        <div style={{ position: 'absolute', bottom: 48, left: 0, right: 0, textAlign: 'center', zIndex: 10 }}>
          <span style={{
            background: 'rgba(10,15,26,0.75)', border: '1px solid rgba(255,255,255,0.14)',
            borderRadius: 999, padding: '10px 24px', color: '#fff', fontSize: 18, fontWeight: 600,
          }}>
            {caption}
          </span>
        </div>
      )}
    </AbsoluteFill>
  );
};
