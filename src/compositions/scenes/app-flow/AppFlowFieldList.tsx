/**
 * AppFlowFieldList — staggered field-row list for the app_flow detail dive.
 *
 * Same stagger technique as EnterpriseBenefitSlide.tsx's BulletRow (spring
 * opacity + slide-in, N frames after the previous row), reused here for a
 * screen's individual data fields instead of benefit bullets.
 *
 * Capped at maxVisible rows with a "+N more" overflow chip — a scene's
 * duration must stay bounded regardless of how field-heavy a discovered
 * screen is.
 */

import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { FONT_STACK } from '../../tokens';

const FIELD_ICONS: Record<string, string> = {
  input:         '✎',
  select:        '▾',
  textarea:      '≡',
  'table-column': '▦',
};

const STAGGER_FRAMES = 4;

const FieldRow: React.FC<{ label: string; fieldType: string; staggerFrame: number }> = ({
  label, fieldType, staggerFrame,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const relFrame = Math.max(0, frame - staggerFrame);
  const opacity  = spring({ frame: relFrame, fps, from: 0, to: 1, config: { damping: 18, stiffness: 90 } });
  const slideX   = interpolate(
    spring({ frame: relFrame, fps, config: { damping: 18, stiffness: 90 } }),
    [0, 1], [-16, 0],
  );

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, opacity,
      transform: `translateX(${slideX}px)`, padding: '8px 0',
      borderBottom: '1px solid rgba(255,255,255,0.08)',
    }}>
      <span style={{
        width: 22, height: 22, borderRadius: 6, background: 'rgba(255,255,255,0.08)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, color: 'rgba(255,255,255,0.6)', flexShrink: 0,
      }}>
        {FIELD_ICONS[fieldType] ?? '•'}
      </span>
      <span style={{ color: '#fff', fontSize: 16, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </span>
    </div>
  );
};

export interface AppFlowFieldListProps {
  fields:     { label: string; fieldType: string }[];
  maxVisible?: number;
}

export const AppFlowFieldList: React.FC<AppFlowFieldListProps> = ({ fields, maxVisible = 24 }) => {
  const visible  = fields.slice(0, maxVisible);
  const overflow = fields.length - visible.length;
  const twoColumn = visible.length > 10;

  return (
    <div style={{ fontFamily: FONT_STACK, width: '100%' }}>
      <div style={{
        display:             twoColumn ? 'grid' : 'flex',
        flexDirection:       twoColumn ? undefined : 'column',
        gridTemplateColumns: twoColumn ? '1fr 1fr' : undefined,
        columnGap:           twoColumn ? 40 : undefined,
      }}>
        {visible.map((f, i) => (
          <FieldRow key={i} label={f.label} fieldType={f.fieldType} staggerFrame={i * STAGGER_FRAMES} />
        ))}
      </div>
      {overflow > 0 && (
        <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14, marginTop: 8, fontStyle: 'italic' }}>
          +{overflow} more field{overflow === 1 ? '' : 's'}
        </div>
      )}
    </div>
  );
};
