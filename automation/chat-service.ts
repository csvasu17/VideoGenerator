import * as fs from 'fs';
import * as path from 'path';
import { AzureOpenAI } from 'openai';
import * as jsonpatch from 'fast-json-patch';
import { loadPrompt } from '../src/infrastructure/llm/PromptLoader';
import { OUT_DIR } from './config';
import { generateWithAzureOpenAI } from './utils/tts';
import { getVideoInfo } from './utils/ffprobe';

export interface ChatOperation {
  op: 'replace' | 'add' | 'remove';
  path: string;
  value?: unknown;
}

export interface ChatResult {
  reply: string;
  changes: ChatOperation[];
  applied: boolean;
  error?: string;
}

let client: AzureOpenAI | null = null;

function getClient(): AzureOpenAI {
  if (!client) {
    client = new AzureOpenAI({
      apiKey:     process.env['AZURE_OPENAI_API_KEY']    ?? '',
      endpoint:   process.env['AZURE_OPENAI_ENDPOINT']   ?? '',
      deployment: process.env['AZURE_OPENAI_DEPLOYMENT'] ?? '',
      apiVersion: process.env['OPENAI_API_VERSION']      ?? '2024-12-01-preview',
    });
  }
  return client;
}

// Maps each package-driven Remotion composition (see src/Root.tsx) to the
// on-disk file it actually reads via calculateMetadata. Several compositions
// share the same React component (e.g. EnterpriseVideo.tsx renders both
// "EnterpriseVideo" and "ManualRecordingEnterpriseVideo") but load DIFFERENT
// files — without this map the chat could edit a file the active preview
// never reads, applying "successfully" while nothing on screen changes.
const EDITABLE_COMPOSITIONS: Record<string, string> = {
  DemoVideo:                     'demo-package.json',
  EnterpriseVideo:                'demo-package.json',
  TeaserVideo:                    'demo-package.json',
  ManualRecordingEnterpriseVideo: path.join('manual-recording', 'demo-package.json'),
};

export function resolvePackagePath(compositionId: string | undefined): string | null {
  if (!compositionId || !(compositionId in EDITABLE_COMPOSITIONS)) return null;
  return path.join(OUT_DIR, EDITABLE_COMPOSITIONS[compositionId]);
}

// scenes[].narration is editable via chat, but the audio the video actually
// plays comes from a SEPARATE voice-script file's segments[].text — a TTS
// step (generate-voice.ts / manual-recording-to-enterprise.ts) reads that
// file once, ahead of time, and bakes the result into a static MP3. Patching
// demo-package.json alone leaves that MP3 (and this file's text) stale, so a
// narration edit silently has no audible effect. Only compositions that
// actually load a voice script in src/Root.tsx are listed — DemoVideo has no
// voice pipeline wired up, so it's intentionally absent (regen is skipped).
const VOICE_SCRIPT_FILES: Record<string, string> = {
  EnterpriseVideo:                'voice-script.json',
  TeaserVideo:                    'voice-script.json',
  ManualRecordingEnterpriseVideo: path.join('manual-recording', 'enterprise-voice-script.json'),
};

interface VoiceSegment {
  id:          string;
  label?:      string;
  text:        string;
  durationSec: number;
  [k: string]: unknown;
}
interface VoiceScript {
  voice:      string;
  model:      string;
  speed:      number;
  fps:        number;
  voiceDir?:  string;
  segments:   VoiceSegment[];
  [k: string]: unknown;
}

interface SceneLike { id?: string; durationInFrames?: number; }

function loadVoiceScript(compositionId: string | undefined): VoiceScript | null {
  const rel = compositionId ? VOICE_SCRIPT_FILES[compositionId] : undefined;
  if (!rel) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(OUT_DIR, rel), 'utf-8'));
  } catch {
    return null;
  }
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// Calibrates a words-per-second speaking rate from this video's OWN existing
// segments (same voice/speed/TTS deployment) rather than a hardcoded guess,
// since actual pace varies by voice and speed setting.
const DEFAULT_WORDS_PER_SEC = 2.3; // ~140wpm fallback, only used if no segments to calibrate from
function estimateWordsPerSecond(voiceScript: VoiceScript): number {
  let words = 0, seconds = 0;
  for (const seg of voiceScript.segments) {
    if (seg.text && seg.durationSec > 0) {
      words += wordCount(seg.text);
      seconds += seg.durationSec;
    }
  }
  return seconds > 0 ? words / seconds : DEFAULT_WORDS_PER_SEC;
}

// Builds a per-scene "you have ~N seconds → aim for ~M words" hint block so
// the LLM paces new narration to the scene's ACTUAL visual duration instead
// of a generic word-count rule — added to userContent, not the static system
// prompt, since the budget is different for every scene/package.
function buildTimingHints(scenes: SceneLike[] | undefined, voiceScript: VoiceScript): string | null {
  if (!scenes || scenes.length === 0) return null;
  const rate = estimateWordsPerSecond(voiceScript);
  const lines = scenes.map((s, i) => {
    if (!s.id || !s.durationInFrames) return null;
    const budgetSec = s.durationInFrames / voiceScript.fps;
    const targetWords = Math.max(5, Math.round(budgetSec * rate));
    return `  scene ${i} (id: ${s.id}): ${budgetSec.toFixed(1)}s available → aim for ~${targetWords} words if rewriting narration`;
  }).filter(Boolean);
  if (lines.length === 0) return null;
  return `Scene narration time budgets (this video's measured speaking pace is ~${rate.toFixed(2)} words/sec — narration text becomes real spoken audio, and each scene's visual duration is fixed):\n${lines.join('\n')}`;
}

// Tolerance for how far regenerated audio may exceed a scene's visual budget
// before it's rejected outright rather than silently allowed to drift into
// the next scene (the exact failure this whole mechanism exists to prevent).
function fitsWithinBudget(newDurationSec: number, budgetSec: number): boolean {
  return newDurationSec <= Math.max(budgetSec * 1.15, budgetSec + 1.5);
}

interface NarrationEdit { sceneIdx: number; sceneId: string; newText: string; }

function findNarrationEdits(changes: ChatOperation[], scenes: SceneLike[] | undefined): NarrationEdit[] {
  const edits: NarrationEdit[] = [];
  for (const c of changes) {
    const m = /^\/scenes\/(\d+)\/narration$/.exec(c.path);
    if (!m || typeof c.value !== 'string') continue;
    const sceneIdx = parseInt(m[1], 10);
    const scene = scenes?.[sceneIdx];
    if (!scene?.id || !scene.durationInFrames) continue;
    edits.push({ sceneIdx, sceneId: scene.id, newText: c.value });
  }
  return edits;
}

// After validating (but BEFORE writing anything to disk) any scenes/{i}/narration
// edits, regenerates each segment's MP3 into a temp file first and measures its
// real duration. If it fits the scene's visual budget, stages it for commit;
// if not, the whole request is rejected (nothing written) with a clear
// explanation — audio that overruns into the next scene is exactly the
// "voice/screen drift" failure this project has hit before, so it's better to
// reject and ask for a shorter rewrite than silently ship a drifted video.
async function regenerateNarrationAudio(
  compositionId: string | undefined,
  voiceScript: VoiceScript | null,
  patchedScenes: SceneLike[] | undefined,
  changes: ChatOperation[],
): Promise<{ ok: true; commit: () => void; notes: string[] } | { ok: false; reply: string }> {
  const edits = findNarrationEdits(changes, patchedScenes);
  if (edits.length === 0) return { ok: true, commit: () => {}, notes: [] };
  if (!voiceScript) return { ok: true, commit: () => {}, notes: ['(Narration text updated, but no voice-script.json was found to regenerate audio from.)'] };

  const rate = estimateWordsPerSecond(voiceScript);
  const voiceDir = voiceScript.voiceDir ?? 'voice-segments';
  const staged: Array<{ segment: VoiceSegment; tmpPath: string; finalPath: string; newText: string; oldDuration: number; newDuration: number }> = [];
  const notes: string[] = [];
  const cleanup = () => { for (const s of staged) { try { fs.unlinkSync(s.tmpPath); } catch {} } };

  for (const edit of edits) {
    const budgetSec = (patchedScenes![edit.sceneIdx].durationInFrames as number) / voiceScript.fps;
    const segment = voiceScript.segments.find(s => s.id === edit.sceneId);
    if (!segment) {
      notes.push(`(No matching voice segment "${edit.sceneId}" — narration text updated but audio unchanged.)`);
      continue;
    }

    const finalPath = path.join(OUT_DIR, voiceDir, `${segment.id}.mp3`);
    const tmpPath = `${finalPath}.tmp`;
    try {
      await generateWithAzureOpenAI(edit.newText, tmpPath, voiceScript.voice, voiceScript.model, voiceScript.speed ?? 1.0);
    } catch (err) {
      notes.push(`(Could not regenerate audio for "${segment.id}": ${String(err)}. Text updated, but the old recording will keep playing until this is retried.)`);
      continue;
    }

    const newDuration = getVideoInfo(tmpPath).duration;
    if (!fitsWithinBudget(newDuration, budgetSec)) {
      cleanup();
      const targetWords = Math.max(5, Math.round(budgetSec * rate));
      return {
        ok: false,
        reply: `That narration is too long for scene "${edit.sceneId}" — it would run ${newDuration.toFixed(1)}s but the scene's visual duration is only ${budgetSec.toFixed(1)}s (audio would play over the next scene). Try again with roughly ${targetWords} words or fewer.`,
      };
    }

    staged.push({ segment, tmpPath, finalPath, newText: edit.newText, oldDuration: segment.durationSec, newDuration });
  }

  const commit = () => {
    if (staged.length === 0) return;
    for (const s of staged) {
      fs.renameSync(s.tmpPath, s.finalPath);
      s.segment.text = s.newText;
      s.segment.durationSec = s.newDuration;
      notes.push(`Regenerated audio for "${s.segment.label ?? s.segment.id}" (${s.oldDuration.toFixed(1)}s → ${s.newDuration.toFixed(1)}s).`);
    }
    const rel = VOICE_SCRIPT_FILES[compositionId!];
    fs.writeFileSync(path.join(OUT_DIR, rel), JSON.stringify(voiceScript, null, 2), 'utf-8');
  };

  return { ok: true, commit, notes };
}

export async function chat(userMessage: string, compositionId?: string): Promise<ChatResult> {
  const pkgPath = resolvePackagePath(compositionId);
  if (!pkgPath) {
    return {
      reply: compositionId
        ? `Editing isn't available on the "${compositionId}" screen. Open Demo Video, Enterprise Video, Manual Recording Enterprise Video, or Teaser Video to edit its content here.`
        : `I couldn't tell which composition is open in Studio. Select a video composition and try again.`,
      changes: [],
      applied: false,
    };
  }

  let pkg: unknown;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  } catch {
    return {
      reply: `No demo-package.json found for "${compositionId}". Run the pipeline first to generate this video, then I can help you edit it.`,
      changes: [],
      applied: false,
    };
  }

  let systemPrompt: string;
  try {
    systemPrompt = loadPrompt('chat', 'video-editor.v1');
  } catch {
    return { reply: 'Chat service misconfiguration: prompt file missing.', changes: [], applied: false };
  }

  const voiceScript = loadVoiceScript(compositionId);
  const timingHints = voiceScript
    ? buildTimingHints((pkg as { scenes?: SceneLike[] }).scenes, voiceScript)
    : null;

  const userContent = [
    `Current demo-package.json:\n${JSON.stringify(pkg, null, 2)}`,
    ...(timingHints ? [timingHints] : []),
    `User request: ${userMessage}`,
  ].join('\n\n');

  let rawText: string;
  try {
    const response = await getClient().chat.completions.create({
      model:       process.env['AZURE_OPENAI_DEPLOYMENT'] ?? '',
      max_completion_tokens: 1024,
      temperature: 0.2,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userContent  },
      ],
    });
    rawText = response.choices[0]?.message?.content ?? '';
  } catch (err) {
    return { reply: 'AI service error — check your AZURE_OPENAI_* env vars.', changes: [], applied: false, error: String(err) };
  }

  let parsed: { reply: string; changes: ChatOperation[] };
  try {
    const jsonStr = rawText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    parsed = JSON.parse(jsonStr);
  } catch {
    return { reply: rawText || 'Unexpected response from AI.', changes: [], applied: false, error: 'Non-JSON response' };
  }

  if (!Array.isArray(parsed.changes) || parsed.changes.length === 0) {
    return { reply: parsed.reply ?? 'No changes needed.', changes: [], applied: false };
  }

  try {
    const patchError = jsonpatch.validate(parsed.changes as jsonpatch.Operation[], pkg);
    if (patchError) {
      return {
        reply: parsed.reply,
        changes: parsed.changes,
        applied: false,
        error: (patchError as { message?: string }).message ?? 'Invalid patch path',
      };
    }

    const patched = jsonpatch.applyPatch(
      JSON.parse(JSON.stringify(pkg)),
      parsed.changes as jsonpatch.Operation[],
      true,
      false,
    ).newDocument;

    // Regenerate any narration audio into temp files and check it fits the
    // scene's visual budget BEFORE writing anything to disk — a rejection
    // here must leave both demo-package.json and voice-script.json untouched.
    const audioResult = await regenerateNarrationAudio(
      compositionId, voiceScript, (patched as { scenes?: SceneLike[] }).scenes, parsed.changes,
    );
    if (!audioResult.ok) {
      return { reply: audioResult.reply, changes: parsed.changes, applied: false };
    }

    fs.writeFileSync(pkgPath, JSON.stringify(patched, null, 2), 'utf-8');
    audioResult.commit();

    const reply = audioResult.notes.length > 0 ? `${parsed.reply}\n\n${audioResult.notes.join('\n')}` : parsed.reply;

    return { reply, changes: parsed.changes, applied: true };
  } catch (err) {
    return {
      reply: parsed.reply,
      changes: parsed.changes,
      applied: false,
      error: String(err),
    };
  }
}
