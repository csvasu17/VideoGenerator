import type {ClipInfo, SegmentDef, ResolvedSegment} from '../types';

/**
 * Match clips to segment definitions and build a timeline.
 * Priority: manualOverride > manual (non-recordings/) > auto-recorded.
 */
export function resolveClipsToSegments(
  segments:        SegmentDef[],
  allClips:        ClipInfo[],
  fps:             number,
  fallbackSeconds = 7,
): ResolvedSegment[] {
  const manualClips = allClips.filter(c => c.source === 'manual');
  const autoClips   = allClips.filter(c => c.source === 'auto');

  function findClip(seg: SegmentDef): ClipInfo | undefined {
    // 1. Explicit manualOverride path
    if (seg.manualOverride) {
      const hit = manualClips.find(
        c => c.file === seg.manualOverride ||
             c.file.endsWith('/' + seg.manualOverride.replace('assets/', '')),
      );
      if (hit) return hit;
    }
    // 2. Manual file matching id or keyword
    const kws = [seg.id, ...(seg.keywords || [])].map(k => k.toLowerCase());
    const manual = manualClips.find(
      c => kws.some(k => c.id.includes(k) || c.file.toLowerCase().includes(k)),
    );
    if (manual) return manual;
    // 3. Auto-recorded clip
    return autoClips.find(
      c => kws.some(k => c.id.includes(k) || c.file.toLowerCase().includes(k)),
    );
  }

  let cursor = 0;
  return segments.map(seg => {
    const clip = findClip(seg);
    const dur  = clip ? clip.durationInFrames : Math.ceil(fallbackSeconds * fps);
    const resolved: ResolvedSegment = {
      ...seg,
      resolvedClip: clip,
      startFrame: cursor,
      durationInFrames: dur,
    };
    cursor += dur;
    return resolved;
  });
}
