/**
 * AppFlowDetailScene — "detail dive": camera zooms toward a screen's map
 * position, then crossfades to a full detail card (label + screenshot inset
 * + staggered field list).
 *
 * The crossfade (not further camera push) closes the last distance — reusing
 * CameraChoreographer to zoom all the way onto a tiny sitemap node box would
 * exceed the zoom ceiling it's tuned for (zooming into an element inside a
 * full screenshot, not closing to a small box on a diagram canvas).
 *
 * Screenshot decoding is scoped to exactly this one active scene — map/tour
 * phases never render <Img>, matching the existing "only mount the active
 * scene" memory discipline extended one level deeper.
 */

import React, { useState } from 'react';
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { CameraLayer } from '../../layers/CameraLayer';
import { CameraChoreographer } from '../../../motion/camera/CameraChoreographer';
import { AppFlowDiagramCanvas } from './AppFlowDiagramCanvas';
import { AppFlowFieldList } from './AppFlowFieldList';
import { NODE_TYPE_STYLE } from './nodeTypeStyle';
import { FONT_STACK } from '../../tokens';
import type { AppFlowNode, AppFlowNodeType } from '../../../core/domain/entities/RemotionPackage';

export interface AppFlowDetailSceneProps {
  nodes: AppFlowNode[];
  node:  AppFlowNode;
}

const APPROACH_FRAMES  = 45; // camera zoom toward the node's map position
const CROSSFADE_FRAMES = 20; // then crossfade to the full detail card

/** Maps the screen's classification to the camera profile that best fits its zoom feel. */
function toElementType(nodeType: AppFlowNodeType): 'form' | 'table' | 'kpi_card' | 'navigation' | 'modal' {
  switch (nodeType) {
    case 'form':
    case 'detail':    return 'form';
    case 'list':
    case 'report':    return 'table';
    case 'dashboard': return 'kpi_card';
    case 'modal':     return 'modal';
    default:          return 'navigation';
  }
}

export const AppFlowDetailScene: React.FC<AppFlowDetailSceneProps> = ({ nodes, node }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, fps } = useVideoConfig();
  const [imgFailed, setImgFailed] = useState(false);

  const bbox = { x: node.x - node.width / 2, y: node.y - node.height / 2, width: node.width, height: node.height };

  const cameraTimeline = React.useMemo(() => {
    const choreographer = new CameraChoreographer();
    return choreographer.choreograph({
      sceneId:          node.id,
      durationInFrames: Math.min(durationInFrames, APPROACH_FRAMES + CROSSFADE_FRAMES + 20),
      fps,
      spotlightTarget: { elementType: toElementType(node.nodeType), boundingBox: bbox, priority: 0.8 },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id, durationInFrames, fps]);

  const mapOpacity  = interpolate(frame, [APPROACH_FRAMES, APPROACH_FRAMES + CROSSFADE_FRAMES], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const cardOpacity = interpolate(frame, [APPROACH_FRAMES, APPROACH_FRAMES + CROSSFADE_FRAMES], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  const nodeOpacity: Record<string, number> = { [node.id]: 1 };
  const style = NODE_TYPE_STYLE[node.nodeType];
  const showScreenshot = !!node.screenshotPath && !imgFailed;

  return (
    <AbsoluteFill style={{ background: '#0a0f1a', fontFamily: FONT_STACK }}>

      {/* Map approach — fades out once the crossfade to the detail card begins */}
      <div style={{ position: 'absolute', inset: 0, opacity: mapOpacity }}>
        <CameraLayer timeline={cameraTimeline}>
          <AppFlowDiagramCanvas nodes={nodes} nodeOpacity={nodeOpacity} highlightNodeId={node.id} />
        </CameraLayer>
      </div>

      {/* Detail card — label, screenshot inset, field list */}
      <div style={{ position: 'absolute', inset: 0, opacity: cardOpacity, display: 'flex', padding: '64px 80px', gap: 48, boxSizing: 'border-box' }}>
        <div style={{ flex: '0 0 42%', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <span style={{ width: 12, height: 12, borderRadius: '50%', background: style.color }} />
            <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {style.label}
            </span>
          </div>
          <span style={{ color: '#fff', fontSize: 34, fontWeight: 800, lineHeight: 1.15, marginBottom: 12 }}>{node.label}</span>
          {node.description && (
            <span style={{ color: 'rgba(255,255,255,0.65)', fontSize: 18, lineHeight: 1.4 }}>{node.description}</span>
          )}
          {showScreenshot && (
            <div style={{ marginTop: 24, borderRadius: 10, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.14)', boxShadow: '0 12px 32px rgba(0,0,0,0.4)' }}>
              <Img
                src={staticFile(node.screenshotPath!.replace(/\\/g, '/'))}
                style={{ width: '100%', height: 'auto', display: 'block' }}
                onError={() => setImgFailed(true)}
              />
            </div>
          )}
        </div>
        <div style={{ flex: '1 1 auto', overflow: 'hidden', paddingTop: 8, minWidth: 0 }}>
          <AppFlowFieldList fields={node.fields} />
        </div>
      </div>
    </AbsoluteFill>
  );
};
