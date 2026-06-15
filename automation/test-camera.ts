/**
 * Smoke-test for CameraChoreographer.
 * Run: npx ts-node --project tsconfig.scripts.json automation/test-camera.ts
 */

import { CameraChoreographer } from '../src/motion/camera/CameraChoreographer';
import type { CameraTimeline }  from '../src/motion/camera/types';

const c = new CameraChoreographer();

function printTimeline(label: string, t: CameraTimeline): void {
  console.log(`\n=== ${label} ===`);
  console.log(`sceneId: ${t.sceneId}  frames: ${t.durationInFrames}`);
  t.keyframes.forEach((kf, i) => {
    console.log(
      `  [${i}] frame=${kf.frame}  zoom=${kf.zoom.toFixed(3)}  ` +
      `focusX=${kf.focusX.toFixed(3)}  focusY=${kf.focusY.toFixed(3)}  easing=${kf.easing}`,
    );
  });
}

// ─── (a) No spotlight → Ken-Burns ────────────────────────────────────────────
const a = c.choreograph({ sceneId: 'a', durationInFrames: 330, fps: 30, spotlightTarget: undefined });
printTimeline('(a) Ken-Burns — no spotlight', a);

const aFirst = a.keyframes[0];
const aLast  = a.keyframes[a.keyframes.length - 1];
console.log(`  EXPECT zoom: 1.00→1.10  focusX: 0.5  focusY: 0.5`);
console.log(`  ACTUAL zoom: ${aFirst.zoom}→${aLast.zoom}  focusX: ${aFirst.focusX}→${aLast.focusX}`);
console.log(`  ${aFirst.zoom === 1.0 && aLast.zoom === 1.10 && aLast.focusX === 0.5 ? '✓ PASS' : '✗ FAIL'}`);

// ─── (b) chart, no bbox, priority 0.75 ───────────────────────────────────────
const b = c.choreograph({ sceneId: 'b', durationInFrames: 330, fps: 30, spotlightTarget: { elementType: 'chart', priority: 0.75 } });
printTimeline('(b) chart — canonical region, priority 0.75', b);

// chart profile: zoomMin=1.3 zoomMax=1.5, priority 0.75 → 1.3 + 0.75*(0.2)=1.45
// canonical: focusX=0.50, focusY=0.45
// Find the approach keyframe: zoom > 1.0, spring easing, frame > 0 (not context)
const bApproach = b.keyframes.find(kf => kf.zoom > 1.0 && kf.easing === 'spring' && kf.frame > 0);
const bZoom     = bApproach?.zoom ?? 0;
console.log(`  EXPECT approach zoom≈1.45  canonical focusX=0.50  canonical focusY=0.45`);
console.log(`  ACTUAL approach zoom=${bZoom.toFixed(3)}  focusX=${bApproach?.focusX}  focusY=${bApproach?.focusY}`);
console.log(`  ${Math.abs(bZoom - 1.45) < 0.01 && bApproach?.focusX === 0.50 ? '✓ PASS' : '✗ FAIL'}`);

// ─── (c) kpi_card with bbox, priority 1.0 ────────────────────────────────────
const c2 = c.choreograph({
  sceneId: 'c', durationInFrames: 330, fps: 30,
  spotlightTarget: {
    elementType: 'kpi_card',
    boundingBox: { x: 0.1, y: 0.05, width: 0.3, height: 0.15 },
    priority:    1.0,
  },
});
printTimeline('(c) kpi_card — bbox provided, priority 1.0', c2);

// kpi_card profile: zoomMax=1.6  bbox center: x=0.1+0.15=0.25, y=0.05+0.075=0.125
const cApproach = c2.keyframes.find(kf => kf.zoom > 1.0 && kf.easing === 'spring' && kf.focusX !== 0.5);
console.log(`  EXPECT zoom=1.60  focusX=0.25  focusY=0.125`);
console.log(`  ACTUAL zoom=${cApproach?.zoom}  focusX=${cApproach?.focusX}  focusY=${cApproach?.focusY}`);
console.log(`  ${cApproach?.zoom === 1.6 && cApproach?.focusX === 0.25 && cApproach?.focusY === 0.125 ? '✓ PASS' : '✗ FAIL'}`);
