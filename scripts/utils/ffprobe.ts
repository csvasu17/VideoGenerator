import {execSync} from 'child_process';
import * as fs from 'fs';

export interface VideoInfo {
  duration: number;
  width:    number;
  height:   number;
  fps:      number;
}

const FFPROBE_CANDIDATES = [
  'ffprobe',
  'C:/ffmpeg/bin/ffprobe',
  'C:/Program Files/ffmpeg/bin/ffprobe.exe',
  process.env.FFPROBE_PATH,
].filter(Boolean) as string[];

export function getVideoInfo(filePath: string): VideoInfo {
  for (const cmd of FFPROBE_CANDIDATES) {
    try {
      const raw = execSync(
        `"${cmd}" -v quiet -print_format json -show_streams -show_format "${filePath}"`,
        {timeout: 12000, encoding: 'utf8'},
      );
      const data = JSON.parse(raw);
      const vs = (data.streams || []).find((s: any) => s.codec_type === 'video');
      const duration = parseFloat(vs?.duration ?? data.format?.duration ?? '0');
      const width    = parseInt(vs?.width  ?? '1920');
      const height   = parseInt(vs?.height ?? '1080');
      const [n, d]   = (vs?.r_frame_rate ?? '60/1').split('/').map(Number);
      return {duration, width, height, fps: n / (d || 1)};
    } catch {
      continue;
    }
  }
  console.warn(
    'WARNING: ffprobe not found. Install ffmpeg for accurate durations: https://ffmpeg.org/download.html',
  );
  const bytes = fs.statSync(filePath).size;
  return {duration: bytes / (300 * 1024), width: 1920, height: 1080, fps: 60};
}

export function durationToFrames(duration: number, fps: number): number {
  return Math.ceil(duration * fps);
}
