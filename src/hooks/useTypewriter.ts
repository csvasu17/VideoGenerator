import {useCurrentFrame} from 'remotion';

interface TypewriterResult {
  text: string;
  isDone: boolean;
  progress: number;
  /** Blinking pipe character — `'|'` or `''`. Only active when showCursor=true and typing is in progress. */
  cursor: string;
}

/**
 * Frame-accurate typewriter hook for Remotion.
 * @param text           Full target string
 * @param startFrame     Frame to begin typing (default 0)
 * @param charsPerSecond Typing speed (default 30 chars/sec)
 * @param fps            Video frame rate (default 60)
 * @param showCursor     Show blinking `|` cursor while typing (default false)
 */
export function useTypewriter(
  text: string,
  startFrame = 0,
  charsPerSecond = 30,
  fps = 60,
  showCursor = false,
): TypewriterResult {
  const frame = useCurrentFrame();
  const elapsed = Math.max(0, frame - startFrame);
  const charsPerFrame = charsPerSecond / fps;
  const visibleChars = Math.min(Math.floor(elapsed * charsPerFrame), text.length);
  const isDone = visibleChars >= text.length;

  // Blink at ~3 Hz (toggles every 18 frames at 60fps, every 10 frames at 30fps)
  const blinkInterval = Math.max(1, Math.round(fps / 6));
  const cursorOn = showCursor && !isDone && Math.floor(frame / blinkInterval) % 2 === 0;

  return {
    text: text.slice(0, visibleChars),
    isDone,
    progress: text.length > 0 ? visibleChars / text.length : 0,
    cursor: cursorOn ? '|' : '',
  };
}
