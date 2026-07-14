/**
 * AppFlowDiagramCanvas — shared node+edge renderer for the app_flow template.
 *
 * Renders the full sitemap tree as flat color-coded boxes (never <Img>
 * screenshots — those are scoped strictly to the one active AppFlowDetailScene)
 * plus parent→child connector lines. Positions are pre-baked fractions
 * (x/y/width/height, 0-1) computed once by automation/utils/treeLayout.ts —
 * this component does zero layout math, it just reads the numbers.
 *
 * Pure/stateless so it can be reused unchanged inside a <CameraLayer>: the
 * camera treats this canvas's 100%x100% box as "the product window" and
 * zooms/pans into fractions of it exactly like it would a screenshot.
 */

import React from 'react';
import { FONT_STACK } from '../../tokens';
import { NODE_TYPE_STYLE } from './nodeTypeStyle';
import type { AppFlowNode } from '../../../core/domain/entities/RemotionPackage';

export interface AppFlowDiagramCanvasProps {
  nodes: AppFlowNode[];
  /** 0-1 opacity per node id. Nodes absent from the map default to opacity 1. */
  nodeOpacity?: Record<string, number>;
  /** Node id to draw a bright highlight ring around (e.g. the active detail dive). */
  highlightNodeId?: string;
}

export const AppFlowDiagramCanvas: React.FC<AppFlowDiagramCanvasProps> = ({
  nodes,
  nodeOpacity,
  highlightNodeId,
}) => {
  const byId = new Map(nodes.map(n => [n.id, n]));

  return (
    <div style={{ position: 'absolute', inset: 0 }}>

      {/* Connector lines — parent to child, drawn behind the node boxes. */}
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      >
        {nodes
          .filter(n => n.parentId && byId.has(n.parentId))
          .map(n => {
            const parent = byId.get(n.parentId!)!;
            const opacity = Math.min(nodeOpacity?.[n.id] ?? 1, nodeOpacity?.[parent.id] ?? 1);
            return (
              <line
                key={`edge-${n.id}`}
                x1={parent.x * 100} y1={(parent.y + parent.height / 2) * 100}
                x2={n.x * 100}      y2={(n.y - n.height / 2) * 100}
                stroke="rgba(255,255,255,0.22)"
                strokeWidth={0.25}
                opacity={opacity}
              />
            );
          })}
      </svg>

      {/* Node boxes */}
      {nodes.map(n => {
        const style        = NODE_TYPE_STYLE[n.nodeType];
        const opacity       = nodeOpacity?.[n.id] ?? 1;
        const isHighlighted = highlightNodeId === n.id;

        return (
          <div
            key={n.id}
            style={{
              position:       'absolute',
              left:           `${(n.x - n.width / 2) * 100}%`,
              top:            `${(n.y - n.height / 2) * 100}%`,
              width:          `${n.width * 100}%`,
              height:         `${n.height * 100}%`,
              opacity,
              display:        'flex',
              flexDirection:  'column',
              alignItems:     'center',
              justifyContent: 'center',
              background:     'rgba(13,31,60,0.92)',
              border:         `2px solid ${isHighlighted ? '#ffffff' : style.color}`,
              borderRadius:   10,
              boxShadow:      isHighlighted
                ? `0 0 0 6px ${style.color}55, 0 10px 30px rgba(0,0,0,0.5)`
                : '0 6px 18px rgba(0,0,0,0.35)',
              fontFamily:     FONT_STACK,
              padding:        '4% 6%',
              boxSizing:      'border-box',
            }}
          >
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: style.color, marginBottom: 6, flexShrink: 0 }} />
            <div style={{ color: '#ffffff', fontSize: 14, fontWeight: 700, textAlign: 'center', lineHeight: 1.25 }}>
              {n.label}
            </div>
            {n.fields.length > 0 && (
              <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, marginTop: 4 }}>
                {n.fields.length} field{n.fields.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
};
