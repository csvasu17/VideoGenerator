/**
 * recording.config.js
 *
 * autoExplore: true  — auto-discovery reads all <a href> tags from the dashboard DOM.
 * Workflows here only run as BACKUP if auto-discovery misses a page.
 *
 * To add a page manually: inspect the URL in your browser after clicking the
 * sidebar item, then add it here:
 *
 *   {id: 'mypage', label: 'My Page', ..., steps:[{action:'goto', url:'...actual URL...'}]}
 */

const BASE = 'https://acl-rheem.vercel.app';

module.exports = {
  // Let auto-discovery (href scan + button clicks) find all pages first.
  // Set false only if you want ONLY the explicit workflows below.
  autoExplore: true,

  // Fallback workflows — only recorded if auto-discovery doesn't find them.
  // NOTE: Use the EXACT URL from your browser address bar, not guessed paths.
  workflows: [
    {
      id: 'dashboard',
      label: 'Dashboard',
      subtitle: 'Main operational dashboard',
      sceneId: 'productDemo',
      steps: [
        {action: 'goto',   url: BASE + '/dashboard'},
        {action: 'wait',   ms: 2500},
        {action: 'scroll', y: 500},
        {action: 'wait',   ms: 1000},
        {action: 'scroll', y: 0},
        {action: 'wait',   ms: 1000},
      ],
    },
    {
      id: 'settings',
      label: 'Settings',
      subtitle: 'Application configuration',
      sceneId: 'productDemo',
      steps: [
        {action: 'goto',   url: BASE + '/settings'},
        {action: 'wait',   ms: 2500},
        {action: 'scroll', y: 400},
        {action: 'wait',   ms: 1000},
        {action: 'click',  selector: '[role="tab"]:nth-child(2)', optional: true},
        {action: 'wait',   ms: 1200},
        {action: 'scroll', y: 0},
        {action: 'wait',   ms: 1000},
      ],
    },
  ],
};
