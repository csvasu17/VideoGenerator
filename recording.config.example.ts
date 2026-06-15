/**
 * recording.config.example.ts
 *
 * Copy to recording.config.ts (or .js after compiling) and customise.
 * Workflows defined here are recorded BEFORE auto-exploration and take
 * priority over auto-discovered pages with matching ids.
 *
 * Run:  npm run record -- https://your-app.com --user admin --pass secret
 */

import type {RecordingConfig} from './scripts/types';

const config: RecordingConfig = {
  appUrl: process.env.APP_URL || 'https://your-app.example.com',
  viewport: {width: 1920, height: 1080},

  // Disable auto-crawl if you only want the explicit workflows below
  autoExplore: true,
  maxNavDepth: 2,

  credentials: {
    username: process.env.APP_USERNAME || '',
    password: process.env.APP_PASSWORD || '',
    // Override these selectors if the login form uses unusual markup
    // usernameSelector: '#email',
    // passwordSelector: '#password',
    // submitSelector:   'button[type="submit"]',
    // successIndicator: '.dashboard',
  },

  // Define key workflows to record.
  // Each produces public/assets/recordings/<id>.mp4
  // The id must match a SEGMENT_DEFS entry (or a new one you add) for it
  // to be wired into the video automatically.
  workflows: [
    {
      id:       'dashboard',
      label:    'Equipment Dashboard',
      subtitle: 'Real-time fleet overview',
      sceneId:  'productDemo',
      steps: [
        {action: 'goto',            url: '/dashboard'},
        {action: 'wait',            ms: 1500},
        {action: 'scroll',          y: 500},
        {action: 'wait',            ms: 800},
        {action: 'click',           selector: '[data-tab="alerts"]', optional: true},
        {action: 'wait',            ms: 1200},
        {action: 'scroll',          y: 0},
        {action: 'wait',            ms: 1000},
      ],
    },
    {
      id:       'analytics',
      label:    'Predictive Analytics',
      subtitle: 'AI-driven maintenance forecasting',
      sceneId:  'productDemo',
      steps: [
        {action: 'goto',            url: '/analytics'},
        {action: 'wait',            ms: 1500},
        {action: 'scroll',          y: 400},
        {action: 'wait',            ms: 1000},
        {action: 'click',           selector: '[data-chart="prediction"]', optional: true},
        {action: 'wait',            ms: 1200},
      ],
    },
    {
      id:       'dispatch',
      label:    'Work Order Dispatch',
      subtitle: 'Automated field service management',
      sceneId:  'productDemo',
      steps: [
        {action: 'goto',            url: '/work-orders'},
        {action: 'wait',            ms: 1500},
        {action: 'click',           selector: 'button:has-text("New Work Order")', optional: true},
        {action: 'wait',            ms: 1000},
        {action: 'scroll',          y: 400},
        {action: 'wait',            ms: 1200},
      ],
    },
  ],
};

module.exports = config;
