/**
 * segmentDefs.ts — Single source of truth for all ProductDemo segments.
 *
 * Imported by:
 *   - scripts/sync.ts  (Node.js — to build the manifest)
 *   - ProductDemoScene.tsx (Remotion — for labels, zoom, click metadata)
 *
 * zoomRegions and clickHighlights are in SEGMENT-LOCAL frames (0 = start of
 * that segment's clip).  sync.ts / ProductDemoScene adds the scene-local
 * startFrame offset before rendering.
 */

import type {SegmentDef} from '../../scripts/types';

export const SEGMENT_DEFS: SegmentDef[] = [
  {
    id:             'login',
    sceneId:        'productDemo',
    label:          'Secure Login',
    subtitle:       'Enterprise SSO and role-based access control',
    manualOverride: 'assets/Login.mp4',   // always prefer public/assets/Login.mp4
    keywords:       ['login', 'signin', 'sign-in', 'auth', 'welcome'],
    accent:         'blue',
    zoomRegions: [
      {startFrame:  80, endFrame: 220, x: 560, y: 370, width: 800, height: 130, label: 'Username Field'},
      {startFrame: 260, endFrame: 420, x: 560, y: 500, width: 800, height: 130, label: 'Password Field'},
      {startFrame: 500, endFrame: 680, x: 660, y: 620, width: 600, height: 100, label: 'Sign In Button'},
    ],
    clickHighlights: [
      {frame: 120, x: 960, y: 435, label: 'Focus Username'},
      {frame: 300, x: 960, y: 565, label: 'Focus Password'},
      {frame: 540, x: 960, y: 670, label: 'Sign In'},
    ],
  },
  {
    id:       'dashboard',
    sceneId:  'productDemo',
    label:    'Equipment Dashboard',
    subtitle: 'Real-time fleet visibility across all facilities',
    keywords: ['dashboard', 'overview', 'home', 'main', 'summary', 'fleet'],
    accent:   'blue',
    zoomRegions: [
      {startFrame:  80, endFrame: 260, x: 200, y: 150, width: 700, height: 350, label: 'Fleet Overview'},
      {startFrame: 300, endFrame: 400, x: 900, y: 200, width: 500, height: 300, label: 'Alert Feed'},
    ],
    clickHighlights: [
      {frame: 120, x: 400, y: 280, label: 'View Equipment'},
      {frame: 320, x: 960, y: 240, label: 'Check Alert'},
    ],
  },
  {
    id:       'analytics',
    sceneId:  'productDemo',
    label:    'Predictive Analytics',
    subtitle: 'AI-driven maintenance forecasting',
    keywords: ['analytics', 'reports', 'charts', 'insights', 'metrics', 'performance', 'predictive'],
    accent:   'orange',
    zoomRegions: [
      {startFrame: 80, endFrame: 300, x: 150, y: 100, width: 800, height: 450, label: 'Analytics Chart'},
    ],
    clickHighlights: [
      {frame: 120, x: 500, y: 300, label: 'View Insights'},
    ],
  },
  {
    id:       'dispatch',
    sceneId:  'productDemo',
    label:    'Work Order Dispatch',
    subtitle: 'Automated field service management',
    keywords: ['dispatch', 'work-order', 'workorder', 'jobs', 'tasks', 'tickets', 'field', 'service'],
    accent:   'blue',
    zoomRegions: [
      {startFrame:  80, endFrame: 260, x: 300, y: 200, width: 600, height: 350, label: 'Dispatch Queue'},
    ],
    clickHighlights: [
      {frame: 120, x: 480, y: 280, label: 'Assign Job'},
      {frame: 220, x: 650, y: 320, label: 'Confirm Dispatch'},
    ],
  },
];
