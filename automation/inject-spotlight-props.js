/**
 * inject-spotlight-props.js
 * Reads demo-package.json, injects a kpi_card spotlight on scene-1,
 * writes demo-props-spotlight.json for the still-frame render test.
 */
const fs   = require('fs');
const path = require('path');

const PKG  = path.join(__dirname, '..', 'out', 'localhost', 'demo-package.json');
const OUT  = path.join(__dirname, '..', 'out', 'localhost', 'demo-props-spotlight.json');

const pkg = JSON.parse(fs.readFileSync(PKG, 'utf-8'));

// Inject spotlight on scene-1 (kpi_card, top-right bbox)
pkg.scenes[0].spotlightTarget = {
  elementType: 'kpi_card',
  boundingBox:  { x: 0.60, y: 0.02, width: 0.35, height: 0.22 },
  label:        'Consumption Tracking KPI metric card',
  priority:     0.85,
};

const props = {
  openingCard: pkg.openingCard,
  scenes: pkg.scenes.map(function(s) {
    return Object.assign({}, s, {
      screenshotPath:     s.screenshotPath     ? s.screenshotPath.replace(/\\/g, '/')     : s.screenshotPath,
      fullScreenshotPath: s.fullScreenshotPath ? s.fullScreenshotPath.replace(/\\/g, '/') : s.fullScreenshotPath,
    });
  }),
  closingCard: pkg.closingCard,
};

fs.writeFileSync(OUT, JSON.stringify(props, null, 2), 'utf-8');

console.log('Wrote: ' + OUT);
console.log('scene-1 starts at frame ' + pkg.scenes[0].from + ' (global)');
console.log('spotlight:', JSON.stringify(pkg.scenes[0].spotlightTarget));
console.log('Render frame ' + (pkg.scenes[0].from + 40) + ' — should be zoomed in on top-right');
