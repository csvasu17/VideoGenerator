import {useCurrentFrame} from 'remotion';

export function useTypewriter(text: string, startFrame = 0, charsPerSecond = 30, fps = 60) {
  const frame = useCurrentFrame();
  const elapsed = Math.max(0, frame - startFrame);
  const charsPerFrame = charsPerSecond / fps;
  const visibleChars = Math.min(Math.floor(elapsed * charsPerFrame), text.length);
  return {
    text: text.slice(0, visibleChars),
    isDone: visibleChars >= text.length,
    progress: text.length > 0 ? visibleChars / text.length : 0,
  };
}
