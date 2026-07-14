/**
 * nodeTypeStyle — visual legend for the app_flow diagram.
 *
 * Fixed color per AppFlowNodeType so the sitemap is self-explanatory without
 * needing an icon-library dependency (same technique as
 * EnterpriseBenefitSlide.tsx's ICON_COLORS map).
 */

import type { AppFlowNodeType } from '../../../core/domain/entities/RemotionPackage';

export interface NodeTypeStyleEntry {
  color: string;
  label: string;
}

export const NODE_TYPE_STYLE: Record<AppFlowNodeType, NodeTypeStyleEntry> = {
  entry:     { color: '#0a93d3', label: 'Entry' },
  dashboard: { color: '#7c3aed', label: 'Dashboard' },
  list:      { color: '#059669', label: 'List' },
  detail:    { color: '#2563eb', label: 'Detail' },
  form:      { color: '#d97706', label: 'Form' },
  modal:     { color: '#db2777', label: 'Modal' },
  settings:  { color: '#64748b', label: 'Settings' },
  report:    { color: '#0891b2', label: 'Report' },
  generic:   { color: '#94a3b8', label: 'Screen' },
};
