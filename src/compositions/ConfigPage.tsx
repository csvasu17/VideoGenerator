import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { ChatWidget } from './ChatWidget';

// ─────────────────────────────────────────────────────────────────────────────
// KEYFRAMES
// ─────────────────────────────────────────────────────────────────────────────
const KEYFRAMES = `
  @keyframes orb-a {
    0%,100% { transform:translate(0,0) scale(1); opacity:.55; }
    40%      { transform:translate(40px,25px) scale(1.12); opacity:.8; }
    70%      { transform:translate(-15px,35px) scale(.95); opacity:.45; }
  }
  @keyframes orb-b {
    0%,100% { transform:translate(0,0) scale(1); opacity:.4; }
    35%      { transform:translate(-30px,-20px) scale(1.08); opacity:.7; }
    65%      { transform:translate(20px,-30px) scale(.92); opacity:.35; }
  }
  @keyframes orb-c {
    0%,100% { transform:translate(0,0); opacity:.3; }
    50%      { transform:translate(25px,-18px); opacity:.55; }
  }
  @keyframes spin { to { transform:rotate(360deg); } }
  @keyframes pulse-ring {
    0%   { transform:scale(1); opacity:.7; }
    100% { transform:scale(2.6); opacity:0; }
  }
  @keyframes toast-in {
    from { opacity:0; transform:translateY(10px) scale(.96); }
    to   { opacity:1; transform:translateY(0) scale(1); }
  }
  @keyframes dot-pulse {
    0%,100% { transform:scale(1); }
    50%      { transform:scale(1.35); }
  }
  @keyframes cc-sheen {
    from { left:-70%; }
    to   { left:120%; }
  }
  @keyframes cc-bar-1 {
    0%,100% { transform:scaleY(0.45); } 50% { transform:scaleY(1); }
  }
  @keyframes cc-bar-2 {
    0%,100% { transform:scaleY(0.7); } 50% { transform:scaleY(0.4); }
  }
  @keyframes cc-bar-3 {
    0%,100% { transform:scaleY(0.6); } 60% { transform:scaleY(0.95); }
  }
  @keyframes cc-play {
    from { left:0%; } to { left:82%; }
  }
  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--cfg-scroll-thumb, rgba(255,255,255,0.15)); border-radius: 4px; }
  * { scrollbar-width: thin; scrollbar-color: var(--cfg-scroll-thumb, rgba(255,255,255,0.15)) transparent; }
  button:focus-visible, [role="button"]:focus-visible, a:focus-visible,
  textarea:focus-visible, select:focus-visible, input:focus-visible {
    outline: 2px solid #6366f1;
    outline-offset: 2px;
  }
  @media (prefers-reduced-motion: reduce) {
    .cfg-anim-decorative { animation: none !important; }
  }
`;

// ─────────────────────────────────────────────────────────────────────────────
// TYPE SCALE — shared across both themes (size/weight are theme-independent)
// caption vs. label are intentionally close in size: caption is dense metadata/
// hint text, label is an uppercase tracked eyebrow/section tag. Don't collapse.
// ─────────────────────────────────────────────────────────────────────────────
const TYPE_SCALE = {
  caption:    { fontSize: 10, fontWeight: 500, lineHeight: 1.4, letterSpacing: '0.02em' } as React.CSSProperties,
  label:      { fontSize: 11, fontWeight: 700, lineHeight: 1.3, letterSpacing: '0.08em', textTransform: 'uppercase' } as React.CSSProperties,
  fieldLabel: { fontSize: 12, fontWeight: 600, lineHeight: 1.3, letterSpacing: '0.01em' } as React.CSSProperties,
  body:       { fontSize: 12, fontWeight: 500, lineHeight: 1.5 } as React.CSSProperties,
  bodyLg:     { fontSize: 13, fontWeight: 600, lineHeight: 1.4 } as React.CSSProperties,
  input:      { fontSize: 14, fontWeight: 400, lineHeight: 1.4 } as React.CSSProperties,
  h3:         { fontSize: 14, fontWeight: 700, lineHeight: 1.3, letterSpacing: '-0.2px' } as React.CSSProperties,
  h2:         { fontSize: 16, fontWeight: 700, lineHeight: 1.2, letterSpacing: '-0.4px' } as React.CSSProperties,
};

// ─────────────────────────────────────────────────────────────────────────────
// DESIGN TOKENS — Nexus palette
// ─────────────────────────────────────────────────────────────────────────────
const DARK_TOKENS = {
  type: TYPE_SCALE,
  // Base backgrounds
  bg:          '#060d1a',
  surface:     'rgba(255,255,255,0.025)',
  card:        'rgba(14,20,48,0.6)',
  sidebarBg:   'rgba(4,8,18,0.72)',
  headerBg:    'rgba(4,8,18,0.96)',
  cardBg:      'rgba(255,255,255,0.03)',
  cardShadow:  'inset 0 1px 0 rgba(255,255,255,0.07), 0 24px 48px rgba(0,0,0,0.4)',
  logHeaderBg: 'rgba(0,0,0,0.35)',
  tabBarBg:    'rgba(0,0,0,0.2)',
  pillBg:      'rgba(255,255,255,0.04)',
  btnGhostBg:  'rgba(255,255,255,0.06)',
  btnGhostBdr: 'rgba(255,255,255,0.1)',
  trackBg:     'rgba(255,255,255,0.05)',
  gridItemBg:  'rgba(255,255,255,0.03)',
  gridItemBdr: 'rgba(255,255,255,0.07)',
  badgeBg:     'rgba(255,255,255,0.06)',
  // Borders
  border:      'rgba(255,255,255,0.075)',
  borderMd:    'rgba(255,255,255,0.13)',
  railTrack:   'rgba(255,255,255,0.07)',
  stepBdr:     'rgba(255,255,255,0.12)',
  stepBg:      'rgba(255,255,255,0.05)',
  stepDoneBg:  'rgba(20,184,166,0.12)',
  toggleOffBg: 'rgba(255,255,255,0.1)',
  toggleOffBdr:'rgba(255,255,255,0.15)',
  // Inputs
  input:       'rgba(255,255,255,0.035)',
  inputBdr:    'rgba(255,255,255,0.14)',
  inputFocus:  'rgba(255,255,255,0.055)',
  optionBg:    '#0d1e35',
  terminal:    '#020b14',
  // Typography
  text:        '#e7ecf7',
  sub:         '#7a82a0',
  hint:        '#8b93b8',
  labelColor:  'rgba(180,195,230,0.85)',
  // Accents (unchanged across themes)
  indigo:      '#4f46e5',
  violet:      '#7c3aed',
  cyan:        '#06b6d4',
  teal:        '#0a93d3',
  red:         '#e50026',
  green:       '#22c55e',
  yellow:      '#f59e0b',
  purple:      '#8b5cf6',
  ring:        '#6366f1',
  font:        '"Manrope","Helvetica Neue",system-ui,sans-serif',
  mono:        '"Consolas","Fira Code",monospace',
};

const LIGHT_TOKENS = {
  type: TYPE_SCALE,
  // Base backgrounds
  bg:          '#f0f4f8',
  surface:     'rgba(0,0,0,0.025)',
  card:        'rgba(255,255,255,0.85)',
  sidebarBg:   '#e4eaf3',
  headerBg:    'rgba(248,250,252,0.97)',
  cardBg:      'rgba(255,255,255,0.88)',
  cardShadow:  'inset 0 1px 0 rgba(255,255,255,0.9), 0 2px 16px rgba(0,0,0,0.07)',
  logHeaderBg: 'rgba(0,0,0,0.05)',
  tabBarBg:    'rgba(0,0,0,0.04)',
  pillBg:      'rgba(0,0,0,0.04)',
  btnGhostBg:  'rgba(0,0,0,0.04)',
  btnGhostBdr: 'rgba(0,0,0,0.12)',
  trackBg:     'rgba(0,0,0,0.08)',
  gridItemBg:  'rgba(0,0,0,0.025)',
  gridItemBdr: 'rgba(0,0,0,0.09)',
  badgeBg:     'rgba(0,0,0,0.05)',
  // Borders
  border:      'rgba(0,0,0,0.10)',
  borderMd:    'rgba(0,0,0,0.18)',
  railTrack:   'rgba(0,0,0,0.09)',
  stepBdr:     'rgba(0,0,0,0.14)',
  stepBg:      'rgba(0,0,0,0.04)',
  stepDoneBg:  'rgba(10,147,211,0.08)',
  toggleOffBg: 'rgba(0,0,0,0.07)',
  toggleOffBdr:'rgba(0,0,0,0.12)',
  // Inputs
  input:       'rgba(0,0,0,0.04)',
  inputBdr:    'rgba(0,0,0,0.16)',
  inputFocus:  'rgba(0,0,0,0.06)',
  optionBg:    '#e2e8f0',
  terminal:    '#1e293b',
  // Typography
  text:        '#0f172a',
  sub:         '#475569',
  hint:        '#5a6478',
  labelColor:  '#334155',
  // Accents (unchanged across themes)
  indigo:      '#4f46e5',
  violet:      '#7c3aed',
  cyan:        '#06b6d4',
  teal:        '#0a93d3',
  red:         '#e50026',
  green:       '#22c55e',
  yellow:      '#f59e0b',
  purple:      '#8b5cf6',
  ring:        '#6366f1',
  font:        '"Manrope","Helvetica Neue",system-ui,sans-serif',
  mono:        '"Consolas","Fira Code",monospace',
};

export type ThemeTokens = typeof DARK_TOKENS;
export const ThemeCtx = React.createContext(DARK_TOKENS);

const API  = 'http://localhost:4001';
const MASK = '••••••••';
const PW_KEYS = ['APP_PASSWORD', 'APP_PASSWORD_2'];

const SECTIONS = [
  { id: 'app-setup', glyph: '01', label: 'App Setup',  sub: 'Connection & auth',  accent: '#4f46e5' },
  { id: 'narration', glyph: '02', label: 'Narration',  sub: 'Context & routes',   accent: '#7c3aed' },
  { id: 'template',  glyph: '03', label: 'Template',   sub: 'Visual style',       accent: '#06b6d4' },
  { id: 'generate',  glyph: '04', label: 'Generate',   sub: 'Review & launch',    accent: '#0a93d3' },
];

// ─────────────────────────────────────────────────────────────────────────────
// COPY-PROMPT CONSTANTS — paste into any AI tool to generate field values
// ─────────────────────────────────────────────────────────────────────────────
const PROMPT_APP_CONTEXT = `You are a product marketing expert writing context for an AI video narration system.

Generate an APP_CONTEXT_TEXT value — a structured plain-text paragraph (no markdown, no bullet symbols, plain sentences only) covering:
1. What the product is and what problem it solves (2–3 sentences)
2. The primary value proposition (1–2 sentences)
3. A ROLES section in this exact format:
ROLES: [Role Name] ([Job Title]): [what they do in this product and key value]. [Next role name] ...

Keep the entire output under 600 words. Plain business language.
Return ONLY the plain-text context. No headers, no wrapping.

--- Describe your product below ---
Product name:
What it does:
Primary value proposition:
User roles (name, title, screens they use, pain eliminated, demo "aha" moment):`;

const PROMPT_ROUTE_MAP = `You are a technical analyst extracting structured metadata from application source code to improve an AI narration system's knowledge of this product.

From the source code provide, extract the APP_ROUTE_MAP — a JSON object mapping URL path patterns to a human-readable description.

Format: {"<url-pattern>": "<role> — <page purpose in one sentence>"}

Rules:
- Include every meaningful page/route; skip auth/error/redirect routes
- Format each value as "<role> — <page purpose in one sentence>"
- Output must be valid compact JSON (no newlines inside the object)

Return ONLY the JSON object. No explanation, no markdown fences.`;

const PROMPT_GLOSSARY = `You are a technical analyst extracting structured metadata from application source code to improve an AI narration system's knowledge of this product.

From the source code provide, extract the APP_GLOSSARY — a plain-text list of domain-specific abbreviations, terms, and component names the AI might not know.

Format: TERM: definition (one line each)

Rules:
- Only include terms visible in the UI or used in user-facing features
- Do NOT include internal variable names, database column names, or infrastructure terms
- Keep each definition under 20 words
- Include 10–30 terms maximum

Return ONLY the glossary lines. No explanation, no markdown fences.`;

// Same fill-in-the-blank style as PROMPT_APP_CONTEXT above — a plain reusable template,
// not mail-merged with this app's current field values, so the exact same copied text
// works for any app: paste your own Product Context / Route Map / Glossary into the blanks.
// Keep this roughly in sync with generateDemoPainPoints()'s prompt in automation/record-app-clips.ts
// (that one DOES mail-merge live values — it runs automatically inside the pipeline, not copy-pasted).
const PROMPT_DEMO_PAIN_POINTS = `You are a B2B SaaS demo script writer.

For EACH route listed below, describe the real workflow a user performs on that screen, the specific
pain point it removes, and an observable "aha moment" outcome. Use domain glossary terms/metric
names where they fit, but do NOT invent specific fake numbers, device IDs, or names — this text
will be layered onto a real screenshot later and must not contradict it. Describe the general
shape of the action and outcome, not invented literal specifics. Return ONLY a JSON object keyed
by route path (use the exact route paths given below), no markdown fences:
{ "/route": { "workflow": "...", "painPoint": "...", "ahaMoment": "..." }, ... }

Optionally, for any route where a real multi-step click-through would make a great demo screen,
add an "actions" array and "durationSec" to that route's entry — but ONLY if you already know the
exact button text/selectors for that route from inspecting the live app; do not guess selectors.

--- Paste your product details below (copy from App Context / Route Map / Glossary above) ---
Product context:
Route map (JSON, path → page description):
Domain glossary (optional):`;

/** Light, non-blocking check — just enough to catch an obviously-broken paste. */
function isValidJsonObject(text: string): boolean {
  try {
    const parsed = JSON.parse(text);
    return !!parsed && typeof parsed === 'object' && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FORM PRIMITIVES
// ─────────────────────────────────────────────────────────────────────────────

function InputField({ value, onChange, placeholder, type = 'text', password = false, icon }: {
  value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; password?: boolean; icon?: React.ReactNode;
}) {
  const C = React.useContext(ThemeCtx);
  const [focused, setFocused] = useState(false);
  const [show, setShow]       = useState(false);
  const paddingLeft  = icon ? 42 : 14;
  const paddingRight = password ? 44 : 14;
  return (
    <div style={{ position: 'relative', width: '100%' }}>
      {icon && (
        <div style={{
          position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)',
          pointerEvents: 'none', color: focused ? C.ring : C.hint,
          transition: 'color .18s', display: 'flex', alignItems: 'center',
        }}>{icon}</div>
      )}
      <input
        type={password && !show ? 'password' : type === 'number' ? 'number' : 'text'}
        value={value}
        placeholder={placeholder}
        min={type === 'number' ? 0 : undefined}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          width: '100%', boxSizing: 'border-box',
          height: 44, borderRadius: 11,
          background: focused ? C.inputFocus : C.input,
          border: `1px solid ${focused ? C.ring : C.inputBdr}`,
          color: C.text, fontFamily: C.font, ...C.type.input,
          padding: `0 ${paddingRight}px 0 ${paddingLeft}px`,
          outline: 'none',
          transition: 'border-color .18s, background .18s, box-shadow .18s',
          boxShadow: focused ? '0 0 0 3px rgba(99,102,241,0.22)' : 'none',
        }}
      />
      {password && (
        <button type="button" onClick={() => setShow(s => !s)}
          aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}
          style={{
            position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
            background: 'none', border: 'none', cursor: 'pointer',
            color: C.hint, padding: 2, lineHeight: 1, display: 'flex', alignItems: 'center',
          }}>
          {show ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a18.5 18.5 0 0 1 5.06-5.94M9.9 4.24A10.94 10.94 0 0 1 12 5c7 0 11 7 11 7a18.5 18.5 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>
          )}
        </button>
      )}
    </div>
  );
}

function SelectBox({ value, onChange, options }: {
  value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  const C = React.useContext(ThemeCtx);
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <select value={value} onChange={e => onChange(e.target.value)}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        style={{
          width: '100%', boxSizing: 'border-box', appearance: 'none',
          height: 44, borderRadius: 11,
          background: focused ? C.inputFocus : C.input,
          border: `1px solid ${focused ? C.ring : C.inputBdr}`,
          color: C.text, fontFamily: C.font, ...C.type.input,
          padding: '0 36px 0 14px', outline: 'none', cursor: 'pointer',
          transition: 'border-color .18s, background .18s, box-shadow .18s',
          boxShadow: focused ? '0 0 0 3px rgba(99,102,241,0.22)' : 'none',
        }}>
        {options.map(o => (
          <option key={o.value} value={o.value} style={{ background: C.optionBg, color: C.text }}>{o.label}</option>
        ))}
      </select>
      <div style={{ position: 'absolute', right: 13, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: C.hint }}>
        <svg width="10" height="6" viewBox="0 0 10 6"><path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>
      </div>
    </div>
  );
}

function TextareaField({ value, onChange, placeholder, rows = 4, maxLength }: {
  value: string; onChange: (v: string) => void; placeholder?: string; rows?: number; maxLength?: number;
}) {
  const C = React.useContext(ThemeCtx);
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <textarea value={value} placeholder={placeholder} rows={rows} maxLength={maxLength}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        style={{
          width: '100%', boxSizing: 'border-box', resize: 'vertical',
          borderRadius: 11,
          background: focused ? C.inputFocus : C.input,
          border: `1px solid ${focused ? C.ring : C.inputBdr}`,
          color: C.text, fontFamily: C.mono, fontSize: 12, lineHeight: 1.7,
          padding: maxLength ? '10px 14px 18px' : '10px 14px', outline: 'none',
          transition: 'border-color .18s, background .18s, box-shadow .18s',
          boxShadow: focused ? '0 0 0 3px rgba(99,102,241,0.22)' : 'none',
          maskImage: !focused ? 'linear-gradient(to bottom, black 82%, transparent)' : 'none',
          WebkitMaskImage: !focused ? 'linear-gradient(to bottom, black 82%, transparent)' : 'none',
        }}
      />
      {maxLength && (
        <div style={{ position: 'absolute', right: 10, bottom: 6, ...C.type.caption, color: C.hint, pointerEvents: 'none' }}>
          {value.length}/{maxLength}
        </div>
      )}
    </div>
  );
}

function Toggle({ value, onChange, onLabel = 'Enabled', offLabel = 'Disabled' }: {
  value: string; onChange: (v: string) => void; onLabel?: string; offLabel?: string;
}) {
  const C = React.useContext(ThemeCtx);
  const on = value !== 'false';
  return (
    <button type="button" onClick={() => onChange(on ? 'false' : 'true')} aria-pressed={on}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none', background: 'none', border: 'none', padding: 0, fontFamily: 'inherit' }}>
      <div style={{
        position: 'relative', width: 44, height: 25, borderRadius: 13,
        background: on ? C.teal : C.toggleOffBg,
        border: `1.5px solid ${on ? C.teal : C.toggleOffBdr}`,
        transition: 'background .22s, border-color .22s',
        boxShadow: on ? '0 0 12px rgba(10,147,211,0.35)' : 'none',
      }}>
        <div style={{
          position: 'absolute', top: 3, left: on ? 21 : 3,
          width: 17, height: 17, borderRadius: '50%', background: '#fff',
          transition: 'left .2s cubic-bezier(.34,1.56,.64,1)',
          boxShadow: '0 1px 4px rgba(0,0,0,.4)',
        }} />
      </div>
      <span style={{ ...C.type.bodyLg, fontWeight: 500, color: on ? C.text : C.sub }}>{on ? onLabel : offLabel}</span>
    </button>
  );
}

// Small living indicator next to the Presenter Avatar toggle — a plain switch label
// doesn't convey "there's a talking-head overlay" the way a little animated avatar
// does. Purely decorative (no click target of its own); the Toggle beside it is
// still what actually flips SHOW_AVATAR.
function PresenterAvatarBadge({ on }: { on: boolean }) {
  const C = React.useContext(ThemeCtx);
  return (
    <div style={{ position: 'relative', width: 34, height: 34, flexShrink: 0 }}>
      {on && (
        <div className="cfg-anim-decorative" style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: `1.5px solid ${C.violet}`, animation: 'pulse-ring 1.8s ease-out infinite', opacity: 0.55, pointerEvents: 'none' }} />
      )}
      <div style={{
        position: 'relative', width: 34, height: 34, borderRadius: '50%',
        background: on ? `linear-gradient(135deg,${C.violet},${C.purple})` : C.toggleOffBg,
        border: `1.5px solid ${on ? C.violet : C.toggleOffBdr}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: on ? `0 0 12px ${C.violet}60` : 'none',
        transition: 'background .25s, border-color .25s, box-shadow .25s',
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={on ? '#fff' : C.sub} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transition: 'stroke .25s' }}>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 20c0-4.4 3.6-7 8-7s8 2.6 8 7" />
        </svg>
      </div>
    </div>
  );
}

// 2-3 option picker (e.g. New/Existing Recording) — distinct from Toggle, which is
// reserved for true boolean flags. Keeping these as two intentional patterns rather
// than forcing one component to cover both.
function SegmentedControl({ value, onChange, options }: {
  value: string; onChange: (v: string) => void;
  options: { value: string; label: React.ReactNode; accent: string; icon?: React.ReactNode }[];
}) {
  const C = React.useContext(ThemeCtx);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${options.length}, 1fr)`, gap: 7 }}>
      {options.map(opt => {
        const active = opt.value === value;
        return (
          <button key={opt.value} type="button" onClick={() => onChange(opt.value)} aria-pressed={active} style={{
            padding: '10px 8px', borderRadius: 10, border: `1.5px solid ${active ? opt.accent : C.border}`,
            background: active ? `${opt.accent}1f` : C.cardBg,
            cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
            transition: 'all .18s', fontFamily: C.font,
          }}>
            {opt.icon && (
              <div style={{ width: 28, height: 28, borderRadius: 8, background: active ? `${opt.accent}33` : C.btnGhostBg, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background .18s' }}>
                {opt.icon}
              </div>
            )}
            <span style={{ ...C.type.caption, fontWeight: 700, color: active ? C.text : C.sub, textAlign: 'center', lineHeight: 1.35 }}>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function FL({ label, hint, req, children, full, action }: {
  label: string; hint?: string; req?: boolean; children: React.ReactNode; full?: boolean;
  action?: React.ReactNode;
}) {
  const C = React.useContext(ThemeCtx);
  return (
    <div style={{ marginBottom: 10, gridColumn: full ? '1/-1' : undefined }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: hint ? 2 : 4 }}>
        <span style={{ ...C.type.fieldLabel, color: C.labelColor }}>{label}</span>
        {req && <span style={{ fontSize: 13, fontWeight: 700, color: C.red, lineHeight: 1 }}>*</span>}
        {action && <div style={{ marginLeft: 'auto' }}>{action}</div>}
      </div>
      {hint && <div style={{ ...C.type.caption, color: C.hint, marginBottom: 5 }}>{hint}</div>}
      {children}
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 20px' }}>{children}</div>;
}

function SubRule({ label, optional }: { label: string; optional?: boolean }) {
  const C = React.useContext(ThemeCtx);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, marginTop: 4 }}>
      <span style={{ ...C.type.label, color: C.hint, whiteSpace: 'nowrap' }}>{label}</span>
      {optional && <span style={{ ...C.type.caption, fontWeight: 600, color: C.sub, background: C.badgeBg, border: `1px solid ${C.border}`, borderRadius: 4, padding: '1px 6px', letterSpacing: '.04em', textTransform: 'uppercase' }}>Optional</span>}
      <div style={{ flex: 1, height: 1, background: C.border }} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TEMPLATE PREVIEW ELEMENTS
// intentionally miniature — simulated dashboard screenshots at ~4.5-8px, not
// real UI copy. Excluded from the shared type scale on purpose.
// ─────────────────────────────────────────────────────────────────────────────

const ModernPreview = () => (
  <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: '#f1f5f9' }}>
    {/* Top nav bar */}
    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 13, background: '#fff', borderBottom: '1px solid rgba(0,0,0,0.07)', display: 'flex', alignItems: 'center', padding: '0 5px', gap: 4 }}>
      <div style={{ width: 9, height: 6, borderRadius: 2, background: '#3b82f6' }} />
      <div style={{ width: 24, height: 3.5, borderRadius: 2, background: 'rgba(0,0,0,0.1)' }} />
      <div style={{ flex: 1 }} />
      <div style={{ width: 14, height: 5, borderRadius: 8, background: '#3b82f6', opacity: 0.8 }} />
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#e2e8f0' }} />
    </div>
    {/* Sidebar */}
    <div style={{ position: 'absolute', top: 13, left: 0, width: 22, bottom: 0, background: '#0f172a', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '6px 0', gap: 4 }}>
      <div style={{ width: 13, height: 4, borderRadius: 2, background: '#3b82f6' }} />
      {[1,2,3,4].map(i => <div key={i} style={{ width: 13, height: 3.5, borderRadius: 2, background: 'rgba(255,255,255,0.12)' }} />)}
    </div>
    {/* Main area */}
    <div style={{ position: 'absolute', top: 13, left: 22, right: 0, bottom: 0, padding: '5px 5px 4px' }}>
      <div style={{ fontSize: 6, fontWeight: 800, color: '#1e293b', marginBottom: 3 }}>Dashboard</div>
      {/* KPI row */}
      <div style={{ display: 'flex', gap: 3, marginBottom: 4 }}>
        {[{ v: '2,847', l: 'Cases', c: '#3b82f6' }, { v: '94%', l: 'Approved', c: '#22c55e' }, { v: '1.4h', l: 'Time', c: '#f59e0b' }].map(k => (
          <div key={k.l} style={{ flex: 1, background: '#fff', borderRadius: 3, padding: '3px 4px', boxShadow: '0 1px 3px rgba(0,0,0,0.07)', border: '1px solid rgba(0,0,0,0.05)' }}>
            <div style={{ fontSize: 7.5, fontWeight: 800, color: k.c, lineHeight: 1 }}>{k.v}</div>
            <div style={{ fontSize: 5, color: '#94a3b8', marginTop: 1.5 }}>{k.l}</div>
          </div>
        ))}
      </div>
      {/* Bar chart card */}
      <div style={{ background: '#fff', borderRadius: 3, padding: '3px 4px', boxShadow: '0 1px 3px rgba(0,0,0,0.07)', border: '1px solid rgba(0,0,0,0.05)', marginBottom: 3 }}>
        <div style={{ fontSize: 5.5, fontWeight: 600, color: '#64748b', marginBottom: 3 }}>Analytics Overview</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1.5, height: 26 }}>
          {[45, 68, 52, 80, 58, 92, 70, 55, 84, 66, 74, 88].map((h, i) => (
            <div key={i} style={{
              flex: 1, height: `${h}%`, borderRadius: '1px 1px 0 0',
              background: i === 5 ? '#3b82f6' : 'rgba(59,130,246,0.3)',
              animation: `cc-bar-${(i % 3) + 1} ${2 + i * 0.1}s ease-in-out infinite`,
              transformOrigin: 'bottom',
            }} />
          ))}
        </div>
      </div>
      {/* Bottom two panels */}
      <div style={{ display: 'flex', gap: 3 }}>
        <div style={{ flex: 1.4, background: '#fff', borderRadius: 3, padding: '3px 4px', border: '1px solid rgba(0,0,0,0.05)', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
          {[{ l: 'PA Review', p: 88 }, { l: 'Clinical', p: 65 }, { l: 'Appeals', p: 42 }].map(r => (
            <div key={r.l} style={{ marginBottom: 3 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 1 }}>
                <div style={{ fontSize: 4.5, color: '#94a3b8' }}>{r.l}</div>
                <div style={{ fontSize: 4.5, color: '#3b82f6', fontWeight: 700 }}>{r.p}%</div>
              </div>
              <div style={{ height: 2.5, background: '#e2e8f0', borderRadius: 1 }}>
                <div style={{ height: '100%', width: `${r.p}%`, background: '#3b82f6', borderRadius: 1, opacity: 0.7 }} />
              </div>
            </div>
          ))}
        </div>
        <div style={{ flex: 1, background: '#fff', borderRadius: 3, padding: '3px 4px', border: '1px solid rgba(0,0,0,0.05)', boxShadow: '0 1px 2px rgba(0,0,0,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'conic-gradient(#3b82f6 0% 58%, #22c55e 58% 80%, #f59e0b 80% 100%)', position: 'relative' }}>
            <div style={{ position: 'absolute', inset: 7, borderRadius: '50%', background: '#fff' }} />
          </div>
        </div>
      </div>
    </div>
  </div>
);

const EnterprisePreview = () => (
  <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: '#080e1e' }}>
    {/* Top nav */}
    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 13, background: '#0d1526', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', padding: '0 5px', gap: 4 }}>
      <div style={{ width: 9, height: 6, borderRadius: 2, background: 'rgba(139,92,246,0.8)' }} />
      <div style={{ width: 24, height: 3.5, borderRadius: 2, background: 'rgba(255,255,255,0.1)' }} />
      <div style={{ flex: 1 }} />
      <div style={{ width: 14, height: 5, borderRadius: 8, background: 'rgba(139,92,246,0.6)' }} />
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'rgba(255,255,255,0.1)' }} />
    </div>
    {/* Sidebar */}
    <div style={{ position: 'absolute', top: 13, left: 0, width: 22, bottom: 0, background: '#060b16', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '6px 0', gap: 4 }}>
      <div style={{ width: 13, height: 4, borderRadius: 2, background: 'rgba(139,92,246,0.8)' }} />
      {[1,2,3,4].map(i => <div key={i} style={{ width: 13, height: 3.5, borderRadius: 2, background: 'rgba(255,255,255,0.07)' }} />)}
    </div>
    {/* Main area */}
    <div style={{ position: 'absolute', top: 13, left: 22, right: 0, bottom: 0, padding: '5px 5px 4px' }}>
      <div style={{ fontSize: 6, fontWeight: 800, color: '#e2e8f0', marginBottom: 3 }}>Analytics</div>
      {/* KPI row */}
      <div style={{ display: 'flex', gap: 3, marginBottom: 4 }}>
        {[{ v: '8,291', l: 'Total', c: 'rgba(139,92,246,0.9)' }, { v: '96%', l: 'Rate', c: 'rgba(34,197,94,0.9)' }, { v: '2.1s', l: 'Speed', c: 'rgba(6,182,212,0.9)' }].map(k => (
          <div key={k.l} style={{ flex: 1, background: 'rgba(255,255,255,0.04)', borderRadius: 3, padding: '3px 4px', border: '1px solid rgba(255,255,255,0.07)' }}>
            <div style={{ fontSize: 7.5, fontWeight: 800, color: k.c, lineHeight: 1 }}>{k.v}</div>
            <div style={{ fontSize: 5, color: 'rgba(180,200,240,0.35)', marginTop: 1.5 }}>{k.l}</div>
          </div>
        ))}
      </div>
      {/* Two-column charts */}
      <div style={{ display: 'flex', gap: 3, marginBottom: 3 }}>
        {/* Bar chart */}
        <div style={{ flex: 1.5, background: 'rgba(255,255,255,0.03)', borderRadius: 3, padding: '3px 4px', border: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ fontSize: 5.5, fontWeight: 600, color: 'rgba(180,200,240,0.4)', marginBottom: 3 }}>Performance</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1.5, height: 26 }}>
            {[40, 65, 50, 82, 58, 90, 68, 55, 84, 72].map((h, i) => (
              <div key={i} style={{
                flex: 1, height: `${h}%`, borderRadius: '1px 1px 0 0',
                background: `rgba(139,92,246,${0.25 + h / 200})`,
                animation: `cc-bar-${(i % 3) + 1} ${2 + i * 0.12}s ease-in-out infinite`,
                transformOrigin: 'bottom',
              }} />
            ))}
          </div>
        </div>
        {/* Donut */}
        <div style={{ flex: 1, background: 'rgba(255,255,255,0.03)', borderRadius: 3, padding: '3px 4px', border: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'conic-gradient(rgba(139,92,246,0.85) 0% 55%, rgba(34,197,94,0.7) 55% 80%, rgba(6,182,212,0.6) 80% 100%)', position: 'relative' }}>
            <div style={{ position: 'absolute', inset: 7, borderRadius: '50%', background: '#080e1e' }} />
          </div>
        </div>
      </div>
      {/* Progress bars panel */}
      <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 3, padding: '3px 5px', border: '1px solid rgba(255,255,255,0.06)' }}>
        {[{ l: 'Approved', p: 82, c: '#22c55e' }, { l: 'Pending', p: 52, c: '#f59e0b' }, { l: 'Denied', p: 24, c: '#e50026' }].map(r => (
          <div key={r.l} style={{ marginBottom: 2.5 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 1 }}>
              <div style={{ fontSize: 4.5, color: 'rgba(180,200,240,0.4)' }}>{r.l}</div>
              <div style={{ fontSize: 4.5, color: r.c, fontWeight: 700 }}>{r.p}%</div>
            </div>
            <div style={{ height: 2.5, background: 'rgba(255,255,255,0.06)', borderRadius: 1 }}>
              <div style={{ height: '100%', width: `${r.p}%`, background: r.c, borderRadius: 1, opacity: 0.7 }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  </div>
);

const TeaserPreview = () => (
  <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: 'linear-gradient(160deg,#0d1424 0%,#111a2e 55%,#0a0f1a 100%)' }}>
    {/* Cinematic vignette */}
    <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at 50% 40%, rgba(10,147,211,0.16) 0%, transparent 65%)' }} />
    {/* Play button */}
    <div style={{ position: 'absolute', top: '38%', left: '50%', transform: 'translate(-50%,-50%)', width: 22, height: 22, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 0, height: 0, marginLeft: 1.5, borderTop: '3.5px solid transparent', borderBottom: '3.5px solid transparent', borderLeft: '5.5px solid #fff' }} />
    </div>
    {/* Headline card, bottom-left — mirrors the teaser's B-roll hook layout */}
    <div style={{ position: 'absolute', left: 8, bottom: 20, right: 30 }}>
      <div style={{ fontSize: 6.5, fontWeight: 800, color: '#fff', lineHeight: 1.15, letterSpacing: '-0.2px' }}>Intelligence,<br/>Simplified</div>
      <div style={{ width: 10, height: 1.5, borderRadius: 1, background: '#0a93d3', marginTop: 3 }} />
    </div>
    {/* Music waveform bar */}
    <div style={{ position: 'absolute', left: 8, bottom: 8, display: 'flex', alignItems: 'flex-end', gap: 1, height: 7 }}>
      {[3, 5, 4, 7, 3, 6, 4, 2, 5, 3, 6, 4].map((h, i) => (
        <div key={i} style={{ width: 1.2, height: h, borderRadius: 1, background: 'rgba(255,255,255,0.4)', animation: `cc-bar-${(i % 3) + 1} ${1.6 + i * 0.08}s ease-in-out infinite` }} />
      ))}
    </div>
    {/* Filmstrip progress dots, top */}
    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, display: 'flex', gap: 1.5, padding: '0 6px' }}>
      {[1, 1, 1, 0.3, 0.3].map((o, i) => (
        <div key={i} style={{ flex: 1, height: '100%', background: `rgba(10,147,211,${o})` }} />
      ))}
    </div>
  </div>
);

const EndToEndPreview = () => (
  <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: 'linear-gradient(160deg,#0d1424 0%,#111a2e 55%,#0a0f1a 100%)' }}>
    {/* Browser chrome bar, evoking a real screen recording rather than a diagram */}
    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 13, background: '#080d1a', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', padding: '0 5px', gap: 3 }}>
      <div style={{ width: 3, height: 3, borderRadius: '50%', background: 'rgba(255,255,255,0.25)' }} />
      <div style={{ width: 3, height: 3, borderRadius: '50%', background: 'rgba(255,255,255,0.25)' }} />
      <div style={{ width: 3, height: 3, borderRadius: '50%', background: 'rgba(255,255,255,0.25)' }} />
      <div style={{ flex: 1 }} />
      <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#e50026', boxShadow: '0 0 4px #e50026', animation: 'dot-pulse 1.2s ease-in-out infinite' }} />
    </div>
    {/* Faux app content being recorded */}
    <div style={{ position: 'absolute', top: 13, left: 0, right: 0, bottom: 0, padding: '6px 6px 4px' }}>
      <div style={{ display: 'flex', gap: 3, marginBottom: 4 }}>
        {[1, 2, 3].map(i => (
          <div key={i} style={{ flex: 1, height: 14, borderRadius: 2, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }} />
        ))}
      </div>
      <div style={{ height: 34, borderRadius: 3, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', marginBottom: 4 }} />
      <div style={{ height: 20, borderRadius: 3, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }} />
    </div>
    {/* Cursor, evoking real interaction (agent clicks / manual walkthrough) */}
    <div style={{ position: 'absolute', left: '62%', top: '58%', width: 0, height: 0, borderLeft: '5px solid #fff', borderBottom: '4px solid transparent', borderTop: '3px solid transparent', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.6))' }} />
  </div>
);

function TemplateCard({ title, badge, accent, active, onClick, previewEl }: {
  title: string; badge?: string; accent: string;
  active: boolean; onClick: () => void; previewEl: React.ReactNode;
}) {
  const C = React.useContext(ThemeCtx);
  const [hovered, setHovered] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={active}
      onClick={onClick}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        borderRadius: 14, overflow: 'hidden', cursor: 'pointer',
        border: `1.5px solid ${active ? accent : hovered ? C.borderMd : C.inputBdr}`,
        background: C.surface,
        boxShadow: active
          ? `0 0 0 1px ${accent}33, 0 4px 24px ${accent}22, 0 8px 40px rgba(0,0,0,0.5)`
          : hovered ? '0 4px 20px rgba(0,0,0,0.4)' : '0 2px 10px rgba(0,0,0,0.3)',
        transform: hovered && !active ? 'translateY(-2px)' : 'translateY(0)',
        transition: 'all .22s cubic-bezier(.4,0,.2,1)',
      }}
    >
      <div style={{ height: 110, position: 'relative', overflow: 'hidden', background: 'rgba(0,0,0,0.25)' }}>
        {previewEl}
        {/* Scrim — keeps the radio/badge legible regardless of the preview content beneath */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 34, zIndex: 1, background: 'linear-gradient(180deg,rgba(0,0,0,0.4),transparent)', pointerEvents: 'none' }} />
        {/* Radio circle — top left */}
        <div style={{
          position: 'absolute', top: 9, left: 9, zIndex: 2,
          width: 18, height: 18, borderRadius: '50%',
          border: `2px solid ${active ? accent : 'rgba(255,255,255,0.35)'}`,
          background: active ? accent : 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: active ? `0 0 8px ${accent}99` : 'none',
          transition: 'all .2s',
        }}>
          {active && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }} />}
        </div>
        {/* Badge pill — top right */}
        {badge && (
          <div style={{
            position: 'absolute', top: 9, right: 9, zIndex: 2,
            background: accent, color: '#fff',
            ...C.type.caption, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase',
            padding: '3px 7px', borderRadius: 4,
            boxShadow: `0 2px 8px ${accent}60`,
          }}>{badge}</div>
        )}
      </div>
      <div style={{ padding: '11px 13px 13px' }}>
        <div style={{ ...C.type.bodyLg, fontWeight: 700, color: active ? C.text : 'rgba(200,215,240,0.75)', minHeight: 18 }}>{title}</div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION HEADER — numbered gradient badge + title
// ─────────────────────────────────────────────────────────────────────────────
function SectionHeader({ s }: { s: typeof SECTIONS[0] }) {
  const C = React.useContext(ThemeCtx);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 16 }}>
      <div style={{
        width: 38, height: 38, borderRadius: 11, flexShrink: 0,
        background: `linear-gradient(135deg,${s.accent},${s.accent}88)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 13, fontWeight: 800, color: '#fff', fontFamily: C.mono,
        boxShadow: `0 4px 14px ${s.accent}40`,
      }}>{s.glyph}</div>
      <div>
        <div style={{ ...C.type.label, color: s.accent, marginBottom: 3 }}>{s.id.replace('-', ' ')}</div>
        <div style={{ ...C.type.h2, color: C.text, lineHeight: 1.1 }}>{s.label}</div>
        <div style={{ ...C.type.body, color: C.sub, marginTop: 3 }}>{s.sub}</div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COPY PROMPT BUTTON
// ─────────────────────────────────────────────────────────────────────────────

function CopyPromptBtn({ text }: { text: string }) {
  const C = React.useContext(ThemeCtx);
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
      style={{
        padding: '2px 9px', borderRadius: 5, border: '1px solid rgba(124,58,237,0.35)',
        background: 'rgba(124,58,237,0.07)', color: C.purple,
        fontSize: 11, fontWeight: 600, fontFamily: C.font, cursor: 'pointer',
        transition: 'background .15s',
      }}
    >
      {copied ? '✓ Copied' : 'Copy Prompt'}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export const ConfigPage: React.FC = () => {
  const [uiTheme, setUiTheme] = useState<'dark' | 'light'>(() =>
    (localStorage.getItem('configUiTheme') as 'dark' | 'light') || 'dark'
  );
  const C = uiTheme === 'dark' ? DARK_TOKENS : LIGHT_TOKENS;
  const toggleTheme = () => {
    const next = uiTheme === 'dark' ? 'light' : 'dark';
    setUiTheme(next);
    localStorage.setItem('configUiTheme', next);
  };

  const [vals, setVals]             = useState<Record<string, string>>({});
  const [loading, setLoading]       = useState(true);
  const [serverErr, setServerErr]   = useState<string | null>(null);
  const [toast, setToast]           = useState<{ msg: string; ok: boolean } | null>(null);
  const [pStatus, setPStatus]       = useState<'idle' | 'running' | 'success' | 'failed'>('idle');
  const [log, setLog]               = useState<string[]>([]);
  const [shimmer, setShimmer]       = useState(false);
  const [forceRerecord, setForceRerecord] = useState(false);
  const [recordingMode, setRecordingMode] = useState<'new' | 'existing'>('existing');
  const [recStatus, setRecStatus]   = useState<{ hasRecordings: boolean; clipCount: number; hasPackage: boolean; hasVoiceScript: boolean } | null>(null);
  const [modTab, setModTab]         = useState<'voice' | 'broll' | 'custom'>('voice');
  const [voiceScript, setVoiceScript] = useState<Array<{ id: string; label: string; text: string }> | null>(null);
  const [voiceRegen, setVoiceRegen] = useState<'idle' | 'running' | 'success' | 'failed'>('idle');
  const [voiceRegenLog, setVoiceRegenLog] = useState<string[]>([]);
  const [brollClips, setBrollClips]   = useState<Array<{ id: string; file: string; index: number; label: string; sizeMb: number; hasFrame: boolean }> | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Which of the two End to End capture modes is shown — mutually exclusive,
  // not simultaneous, since running/reviewing both at once cluttered the
  // narrow Generate column and the two are independent alternatives anyway.
  const [endToEndMode, setEndToEndMode] = useState<'agent' | 'manual'>('agent');

  // ── Agent Recording (exhaustive, safe, all-roles) ────────────────────────────
  const [arStatus, setArStatus]     = useState<'idle' | 'running' | 'success' | 'failed'>('idle');
  const [arLog, setArLog]           = useState<string[]>([]);
  const [arNarrate, setArNarrate]   = useState(false);
  const [arHasWalkthrough, setArHasWalkthrough] = useState(false);
  const [arReport, setArReport]     = useState<{ rolesRun: string[]; pagesVisited: number; totalElementsEnumerated: number; totalClicked: number; totalFilled: number; totalSkipped: number } | null>(null);
  const arSseRef = useRef<EventSource | null>(null);
  const arLogRef = useRef<HTMLPreElement>(null);

  // ── Manual Recording (upload → ingest → narrate → assemble) ─────────────────
  const [mrUploadStatus, setMrUploadStatus] = useState<'idle' | 'uploading' | 'uploaded' | 'error'>('idle');
  const [mrUploadProgress, setMrUploadProgress] = useState(0);
  const [mrUploadErr, setMrUploadErr] = useState<string | null>(null);
  const [mrFileName, setMrFileName] = useState<string | null>(null);
  const [mrStatus, setMrStatus]     = useState<'idle' | 'running' | 'success' | 'failed'>('idle');
  const [mrLog, setMrLog]           = useState<string[]>([]);
  const [mrHasFinalVideo, setMrHasFinalVideo] = useState(false);
  const mrSseRef = useRef<EventSource | null>(null);
  const mrLogRef = useRef<HTMLPreElement>(null);
  const mrFileInputRef = useRef<HTMLInputElement>(null);

  const logRef     = useRef<HTMLPreElement>(null);
  const esRef      = useRef<EventSource | null>(null);
  // Holds the full voice-script.json object so voice/model/speed settings are preserved on save
  const voiceScriptRaw = useRef<Record<string, unknown> | null>(null);

  // Remotion Studio's fullscreen mode renders this composition at its native
  // registered pixel size (1280x800) rather than re-fitting it to the actual
  // (much larger) screen — so without this, fullscreen shows a fixed-size box
  // floating in a black canvas instead of filling the display. We can't fix
  // Studio's own fullscreen logic, so we react to it ourselves: whenever the
  // browser is in fullscreen (however it was triggered — Studio's own button
  // included), scale this component's fixed 1280x800 layout up to fill
  // whatever the real viewport is, preserving aspect ratio.
  // isFullscreen additionally forces this component's own wrapper to
  // position:fixed + 100vw/100vh — Studio's player container may not itself
  // stretch to the real screen size during fullscreen, so relying on our
  // wrapper's normal 100%-of-parent sizing isn't guaranteed to reach the
  // actual viewport. position:fixed escapes that regardless of what the
  // parent does.
  const [fsScale, setFsScale] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const recompute = () => {
      const fs = !!document.fullscreenElement;
      setIsFullscreen(fs);
      setFsScale(fs ? Math.min(window.innerWidth / 1280, window.innerHeight / 800) : 1);
    };
    recompute();
    document.addEventListener('fullscreenchange', recompute);
    window.addEventListener('resize', recompute);
    return () => {
      document.removeEventListener('fullscreenchange', recompute);
      window.removeEventListener('resize', recompute);
    };
  }, []);

  // Remotion Studio's OWN fullscreen button targets its own internal player
  // wrapper, not the whole page — and browsers only paint content inside the
  // fullscreened element's subtree, so our document.body portal above (needed
  // to escape Remotion's CSS-transform zoom wrapper) ends up outside that
  // subtree and invisible, while Remotion's now-emptied wrapper shows its own
  // blank/checkerboard placeholder. Fullscreening documentElement instead
  // keeps everything (including the portal target) inside the visible tree.
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }, []);

  // voice-script.json has { voice, model, segments: [...] } — extract the segments array
  const extractSegments = (raw: unknown): Array<{ id: string; label: string; text: string }> => {
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === 'object' && 'segments' in (raw as object)) {
      const segs = (raw as Record<string, unknown>)['segments'];
      return Array.isArray(segs) ? segs as Array<{ id: string; label: string; text: string }> : [];
    }
    return [];
  };

  const get = (k: string, fb = '') => vals[k] ?? fb;
  const set = useCallback((k: string, v: string) => setVals(p => ({ ...p, [k]: v })), []);
  const toast$ = useCallback((msg: string, ok = true) => {
    setToast({ msg, ok }); setTimeout(() => setToast(null), 3500);
  }, []);

  // Inject keyframes
  useEffect(() => {
    const el = document.createElement('style');
    el.textContent = KEYFRAMES;
    document.head.appendChild(el);
    return () => { try { document.head.removeChild(el); } catch {} };
  }, []);

  // Load Manrope via <link> (preconnect + stylesheet) instead of a render-blocking @import
  useEffect(() => {
    if (document.querySelector('link[data-config-font]')) return;
    const links = [
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
      { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800;900&display=swap' },
    ];
    const els = links.map(l => {
      const link = document.createElement('link');
      link.rel = l.rel;
      link.href = l.href;
      if (l.crossOrigin) link.crossOrigin = l.crossOrigin;
      link.setAttribute('data-config-font', '1');
      document.head.appendChild(link);
      return link;
    });
    return () => { els.forEach(l => { try { document.head.removeChild(l); } catch {} }); };
  }, []);

  // Load config on mount
  useEffect(() => {
    fetch(`${API}/api/config`).then(r => r.json())
      .then((d: { values: Record<string, string> }) => {
        const v = d.values ?? {};
        const display = { ...v };
        PW_KEYS.forEach(k => { if (v[k]) display[k] = MASK; });
        setVals(display);
        setLoading(false);
      })
      .catch(() => { setServerErr('Config server offline'); setLoading(false); });

    fetch(`${API}/api/pipeline-status`).then(r => r.json())
      .then((d: { status: string }) => { if (d.status === 'running') { setPStatus('running'); startSSE(); } })
      .catch(() => {});

    fetch(`${API}/api/recording-status`).then(r => r.json())
      .then((d: typeof recStatus) => {
        setRecStatus(d);
        setRecordingMode(d?.hasRecordings ? 'existing' : 'new');
      })
      .catch(() => {});

    fetch(`${API}/api/agent-recording/status`).then(r => r.json())
      .then((d: { status: string; hasWalkthrough: boolean; report: typeof arReport }) => {
        setArHasWalkthrough(d.hasWalkthrough);
        setArReport(d.report ?? null);
        if (d.status === 'running') { setArStatus('running'); startArSSE(); }
      })
      .catch(() => {});

    fetch(`${API}/api/manual-recording/status`).then(r => r.json())
      .then((d: { status: string; hasUpload: boolean; uploadFile: string | null; hasFinalVideo: boolean }) => {
        if (d.hasUpload) { setMrUploadStatus('uploaded'); setMrFileName(d.uploadFile); }
        setMrHasFinalVideo(d.hasFinalVideo);
        if (d.status === 'running') { setMrStatus('running'); startMrSSE(); }
      })
      .catch(() => {});

    return () => { esRef.current?.close(); arSseRef.current?.close(); mrSseRef.current?.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [log]);
  useEffect(() => { if (arLogRef.current) arLogRef.current.scrollTop = arLogRef.current.scrollHeight; }, [arLog]);
  useEffect(() => { if (mrLogRef.current) mrLogRef.current.scrollTop = mrLogRef.current.scrollHeight; }, [mrLog]);


  // Navigate Remotion Studio to the correct video composition.
  // ConfigPage renders inside an iframe; window.top is the Studio shell (same origin).
  // If already on the target composition, reload so calculateMetadata re-runs with the
  // fresh voice-script.json (voiceReady:true) written by the just-completed pipeline.
  const navigateToVideo = useCallback((tmpl: string) => {
    const comp = tmpl === 'enterprise' ? 'EnterpriseVideo' : tmpl === 'teaser' ? 'TeaserVideo' : 'DemoVideo';
    const target = `/compositions/${comp}`;
    try {
      const top = (window.top && window.top !== window) ? window.top : window;
      if (top.location.pathname === target) {
        top.location.reload();
      } else {
        top.location.href = target;
      }
    } catch {
      window.location.href = target;
    }
  }, []);

  const startSSE = useCallback(() => {
    esRef.current?.close();
    const es = new EventSource(`${API}/api/pipeline-stream`);
    esRef.current = es;
    es.onmessage = e => {
      try {
        const d = JSON.parse(e.data) as { type: string; line?: string; status?: string };
        if (d.type === 'log' && d.line) setLog(p => [...p.slice(-999), d.line!]);
        else if (d.status) {
          setPStatus(d.status as typeof pStatus);
          if (d.type === 'done') {
            es.close();
            // Refresh recording status and load voice script for the modify panel
            fetch(`${API}/api/recording-status`).then(r => r.json()).then(setRecStatus).catch(() => {});
            if (d.status === 'success') {
              fetch(`${API}/api/voice-script`).then(r => r.json())
                .then((vs: { script: unknown }) => { voiceScriptRaw.current = vs.script as Record<string, unknown>; setVoiceScript(extractSegments(vs.script)); })
                .catch(() => {});
              // Navigate to the video composition so the user can preview in Studio
              const tmpl = vals['VIDEO_TEMPLATE'] ?? 'modern_saas';
              setTimeout(() => navigateToVideo(tmpl), 1500);
            }
          }
        }
      } catch {}
    };
    es.onerror = () => { es.close(); esRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vals, navigateToVideo]);

  const startVoiceRegen = useCallback(() => {
    const es = new EventSource(`${API}/api/voice-stream`);
    es.onmessage = e => {
      try {
        const d = JSON.parse(e.data) as { type: string; line?: string; status?: string };
        if (d.type === 'log' && d.line) setVoiceRegenLog(p => [...p.slice(-199), d.line!]);
        else if (d.status) {
          setVoiceRegen(d.status as 'idle' | 'running' | 'success' | 'failed');
          if (d.type === 'done') {
            es.close();
            if (d.status === 'success') {
              fetch(`${API}/api/voice-script`).then(r => r.json())
                .then((vs: { script: unknown }) => { voiceScriptRaw.current = vs.script as Record<string, unknown>; setVoiceScript(extractSegments(vs.script)); })
                .catch(() => {});
              setTimeout(() => navigateToVideo(vals['VIDEO_TEMPLATE'] ?? 'enterprise'), 1500);
            }
          }
        }
      } catch {}
    };
    es.onerror = () => es.close();
  }, [navigateToVideo, vals]);

  const simulate = useCallback(() => {
    const lines = [
      '→ Starting pipeline…', '→ Loading configuration…', '→ Capturing screenshots…',
      '  ✓ Page 1/4', '  ✓ Page 2/4', '  ✓ Page 3/4', '  ✓ Page 4/4',
      '→ Generating narration with AI…', '  ✓ Script generated',
      '→ Synthesizing voice…', '  ✓ Audio ready',
      '→ Rendering video frames…', '  ✓ Scenes composed',
      '✓ Done — switch to your video composition to preview',
    ];
    lines.forEach((line, i) => {
      setTimeout(() => {
        setLog(p => [...p, line]);
        if (i === lines.length - 1) setPStatus('success');
      }, i * 600);
    });
  }, []);

  const payload = useCallback(() => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(vals)) {
      if (PW_KEYS.includes(k)) { if (v && v !== MASK) out[k] = v; }
      else out[k] = v;
    }
    return out;
  }, [vals]);

  const save = useCallback(async () => {
    const r = await fetch(`${API}/api/config`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: payload() }),
    }).catch(() => null);
    if (!r) { toast$('Network error', false); return; }
    const d = await r.json() as { saved?: boolean; error?: string };
    d.saved ? toast$('Saved ✓') : toast$(d.error ?? 'Error saving', false);
  }, [payload, toast$]);

  const run = useCallback(async () => {
    if (pStatus === 'running') return;
    const tmpl = vals['VIDEO_TEMPLATE'] ?? 'modern_saas';
    setLog([]); setPStatus('running');
    const saveR = await fetch(`${API}/api/config`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: payload() }),
    }).catch(() => null);
    if (!saveR) { simulate(); setTimeout(() => navigateToVideo(tmpl), 1000); return; }
    const r = await fetch(`${API}/api/run-pipeline`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ forceRerecord: recordingMode === 'new' ? true : forceRerecord }),
    }).catch(() => null);
    if (!r) { simulate(); setTimeout(() => navigateToVideo(tmpl), 1000); return; }
    const d = await r.json() as { started?: boolean; error?: string };
    if (d.started) {
      startSSE();
      if (tmpl !== 'enterprise') {
        setTimeout(() => navigateToVideo(tmpl), 800);
      }
      // Enterprise: stays on Config page; SSE 'done' handler navigates after voice is ready
    } else {
      simulate();
      setTimeout(() => navigateToVideo(tmpl), 1000);
    }
  }, [pStatus, vals, payload, startSSE, simulate, navigateToVideo]);

  const stop = useCallback(async () => {
    esRef.current?.close();
    esRef.current = null;
    await fetch(`${API}/api/stop-pipeline`, { method: 'POST' }).catch(() => {});
    setPStatus('failed');
    setLog(p => [...p, '⏹ Pipeline stopped by user.']);
  }, []);

  // ── Agent Recording ──────────────────────────────────────────────────────────
  const startArSSE = useCallback(() => {
    arSseRef.current?.close();
    const es = new EventSource(`${API}/api/agent-recording/stream`);
    arSseRef.current = es;
    es.onmessage = e => {
      try {
        const d = JSON.parse(e.data) as { type: string; line?: string; status?: string };
        if (d.type === 'log' && d.line) setArLog(p => [...p.slice(-999), d.line!]);
        else if (d.status) {
          setArStatus(d.status as typeof arStatus);
          if (d.type === 'done') {
            es.close();
            fetch(`${API}/api/agent-recording/status`).then(r => r.json())
              .then((s: { hasWalkthrough: boolean; report: typeof arReport }) => {
                setArHasWalkthrough(s.hasWalkthrough);
                setArReport(s.report ?? null);
              }).catch(() => {});
          }
        }
      } catch {}
    };
    es.onerror = () => { es.close(); arSseRef.current = null; };
  }, []);

  const runAgentRecording = useCallback(async () => {
    if (arStatus === 'running') return;
    setArLog([]); setArStatus('running');
    const r = await fetch(`${API}/api/agent-recording/run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ narrate: arNarrate }),
    }).catch(() => null);
    if (!r) { setArStatus('failed'); return; }
    const d = await r.json() as { started?: boolean; error?: string };
    if (d.started) startArSSE();
    else { setArStatus('failed'); setArLog(p => [...p, d.error ?? 'Failed to start.']); }
  }, [arStatus, arNarrate, startArSSE]);

  const stopAgentRecording = useCallback(async () => {
    arSseRef.current?.close();
    arSseRef.current = null;
    await fetch(`${API}/api/agent-recording/stop`, { method: 'POST' }).catch(() => {});
    setArStatus('failed');
    setArLog(p => [...p, '⏹ Stopped by user.']);
  }, []);

  // ── Manual Recording ─────────────────────────────────────────────────────────
  const startMrSSE = useCallback(() => {
    mrSseRef.current?.close();
    const es = new EventSource(`${API}/api/manual-recording/stream`);
    mrSseRef.current = es;
    es.onmessage = e => {
      try {
        const d = JSON.parse(e.data) as { type: string; line?: string; status?: string };
        if (d.type === 'log' && d.line) setMrLog(p => [...p.slice(-999), d.line!]);
        else if (d.status) {
          setMrStatus(d.status as typeof mrStatus);
          if (d.type === 'done') {
            es.close();
            fetch(`${API}/api/manual-recording/status`).then(r => r.json())
              .then((s: { hasFinalVideo: boolean }) => setMrHasFinalVideo(s.hasFinalVideo)).catch(() => {});
          }
        }
      } catch {}
    };
    es.onerror = () => { es.close(); mrSseRef.current = null; };
  }, []);

  const uploadRecording = useCallback((file: File) => {
    setMrUploadStatus('uploading');
    setMrUploadProgress(0);
    setMrUploadErr(null);
    const form = new FormData();
    form.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = e => {
      if (e.lengthComputable) setMrUploadProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      try {
        const resp = JSON.parse(xhr.responseText) as { uploaded?: boolean; error?: string };
        if (xhr.status >= 200 && xhr.status < 300 && resp.uploaded) {
          setMrUploadStatus('uploaded');
          setMrFileName(file.name);
        } else {
          setMrUploadStatus('error');
          setMrUploadErr(resp.error ?? `Upload failed (HTTP ${xhr.status})`);
        }
      } catch {
        setMrUploadStatus('error');
        setMrUploadErr(`Upload failed (HTTP ${xhr.status})`);
      }
    };
    xhr.onerror = () => { setMrUploadStatus('error'); setMrUploadErr('Network error during upload'); };
    xhr.open('POST', `${API}/api/manual-recording/upload`);
    xhr.send(form);
  }, []);

  const processRecording = useCallback(async () => {
    if (mrStatus === 'running') return;
    setMrLog([]); setMrStatus('running');
    const r = await fetch(`${API}/api/manual-recording/process`, { method: 'POST' }).catch(() => null);
    if (!r) { setMrStatus('failed'); return; }
    const d = await r.json() as { started?: boolean; error?: string };
    if (d.started) startMrSSE();
    else { setMrStatus('failed'); setMrLog(p => [...p, d.error ?? 'Failed to start.']); }
  }, [mrStatus, startMrSSE]);

  const stopManualRecording = useCallback(async () => {
    mrSseRef.current?.close();
    mrSseRef.current = null;
    await fetch(`${API}/api/manual-recording/stop`, { method: 'POST' }).catch(() => {});
    setMrStatus('failed');
    setMrLog(p => [...p, '⏹ Stopped by user.']);
  }, []);

  const loginType = get('LOGIN_TYPE', '1');
  const template  = get('VIDEO_TEMPLATE', 'modern_saas');
  // Both Enterprise and Teaser record real screen clips via Playwright (as opposed
  // to Modern SaaS's screenshot + synthetic-camera pipeline) and both generate
  // voice narration — they share the Recording Mode / Force re-record UI and the
  // Adjust Preview voice/broll editing panel. Only the Presenter Avatar toggle
  // stays gated on `template === 'enterprise'` alone (Teaser has no presenter).
  const isClipBased = template === 'enterprise' || template === 'teaser';
  const language  = get('APP_LANGUAGE', 'en');
  const running   = pStatus === 'running';

  // Real completion state for the header progress rail — no manual step navigation;
  // Template is always shown as the current step since it's the main working area.
  const hasProduct    = !!get('APP_PRODUCT_NAME');
  const hasUrl        = !!get('APP_URL');
  const hasAuth       = loginType === '2' || (!!get('APP_USERNAME') && !!get('APP_PASSWORD'));
  const appSetupDone  = hasProduct && hasUrl && hasAuth;
  const narrationDone = !!get('APP_CONTEXT_TEXT');
  const generateDone  = pStatus === 'success';
  const sectionDone   = [appSetupDone, narrationDone, false, generateDone];

  const statusCfg = {
    idle:    { dot: C.sub,    pulse: false, label: 'Ready to generate' },
    running: { dot: C.yellow, pulse: true,  label: 'Pipeline running…' },
    success: { dot: C.green,  pulse: false, label: 'Done — preview your video' },
    failed:  { dot: C.red,    pulse: false, label: 'Pipeline failed' },
  }[pStatus];

  const reviewItems = [
    { label: 'Product',  val: get('APP_PRODUCT_NAME') || '—' },
    { label: 'App URL',  val: get('APP_URL') || '—' },
    { label: 'Login',    val: get('LOGIN_TYPE', '1') === '1' ? 'Username & password' : 'Quick Access card' },
    { label: 'Template', val: get('VIDEO_TEMPLATE', 'modern_saas') === 'enterprise' ? 'Enterprise' : 'Modern SaaS' },
    { label: 'Language', val: ({ en: 'English', fr: 'French', de: 'German', es: 'Spanish', it: 'Italian', pt: 'Portuguese', ja: 'Japanese' } as Record<string,string>)[get('APP_LANGUAGE', 'en')] ?? get('APP_LANGUAGE', 'en') },
    { label: 'Screen Fit', val: get('SCREEN_FIT', 'full') === 'full' ? 'Full — edge-to-edge' : 'Fit — inset' },
    { label: 'Output',   val: get('APP_PRODUCT_NAME') ? `out/${get('APP_PRODUCT_NAME').toLowerCase()}/` : '—' },
  ];

  // ── RENDER ──────────────────────────────────────────────────────────────────
  // Composition is registered at this component's native 1280x800 layout size
  // (Root.tsx) — every pixel value below is tuned for exactly that size. The
  // fsScale transform below only kicks in during fullscreen (see the effect
  // above); at 1 it's a no-op and this renders at native size same as always.
  const content = (
    <ThemeCtx.Provider value={C}>
    <div style={isFullscreen
      ? { position: 'fixed', inset: 0, width: '100vw', height: '100vh', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000', zIndex: 2147483647 }
      : { width: '100%', height: '100%', overflow: 'hidden', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }
    }>
    <div style={{
      width: 1280, height: 800, transform: `scale(${fsScale})`, transformOrigin: 'center center', flexShrink: 0,
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden', background: C.bg, fontFamily: C.font, color: C.text,
      position: 'relative',
      ['--cfg-scroll-thumb' as string]: uiTheme === 'dark' ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.18)',
    } as React.CSSProperties}>

      {/* ── Screen-reader status announcer — mirrors the header status pill ── */}
      <div aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap' }}>
        {statusCfg.label}
      </div>

      {/* ── AMBIENT ORBS ─────────────────────────────────────────────────── */}
      <div className="cfg-anim-decorative" style={{ position: 'absolute', top: '-12%', left: '-6%', width: 700, height: 700, borderRadius: '50%', background: 'radial-gradient(circle,rgba(79,70,229,0.09) 0%,transparent 65%)', animation: 'orb-a 16s ease-in-out infinite', pointerEvents: 'none', zIndex: 0 }} />
      <div className="cfg-anim-decorative" style={{ position: 'absolute', top: '30%', right: '-10%', width: 600, height: 600, borderRadius: '50%', background: 'radial-gradient(circle,rgba(124,58,237,0.07) 0%,transparent 65%)', animation: 'orb-b 20s ease-in-out infinite', pointerEvents: 'none', zIndex: 0 }} />
      <div className="cfg-anim-decorative" style={{ position: 'absolute', bottom: '-8%', left: '25%', width: 500, height: 500, borderRadius: '50%', background: 'radial-gradient(circle,rgba(6,182,212,0.06) 0%,transparent 65%)', animation: 'orb-c 22s ease-in-out infinite', pointerEvents: 'none', zIndex: 0 }} />

      {/* ── GLASSMORPHISM HEADER ─────────────────────────────────────────────── */}
      <header style={{
        height: 56, flexShrink: 0, position: 'relative', zIndex: 10,
        background: 'rgba(4,8,18,0.92)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        display: 'flex', alignItems: 'center', padding: '0 18px', gap: 12,
      }}>
        {/* animated gradient accent line */}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 1, background: `linear-gradient(90deg,transparent 0%,${C.indigo}70 25%,${C.violet}70 50%,${C.cyan}70 75%,transparent 100%)` }} />

        {/* Logo mark */}
        <div style={{ width: 32, height: 32, borderRadius: 9, flexShrink: 0, background: `linear-gradient(135deg,${C.indigo},${C.violet})`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 4px 14px rgba(79,70,229,0.5), 0 0 0 1px rgba(79,70,229,0.2)` }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
          </svg>
        </div>

        <div style={{ flexShrink: 0 }}>
          <div style={{ fontSize: 14, fontWeight: C.type.h3.fontWeight, letterSpacing: C.type.h3.letterSpacing, background: 'linear-gradient(135deg,#e7ecf7,#a5b4fc)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', lineHeight: 1.2 }}>Video Generator</div>
          {/* <div style={{ ...C.type.caption, color: C.hint, marginTop: 1 }}>ACL Digital COE</div> */}
        </div>

        {/* Section progress rail — reflects real completion state, not a clickable wizard */}
        <div role="list" aria-label="Setup progress" style={{ display: 'flex', alignItems: 'center', gap: 3, marginLeft: 14 }}>
          {SECTIONS.map((s, i) => {
            const isDone = sectionDone[i];
            const isAct = i === 2; // Template is always the current working step
            return (
              <div key={s.id} role="listitem" aria-current={isAct ? 'step' : undefined} style={{
                display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px 4px 8px', borderRadius: 20,
                border: `1px solid ${isAct ? `${s.accent}55` : isDone ? 'rgba(20,184,166,0.2)' : 'rgba(255,255,255,0.06)'}`,
                background: isAct ? `${s.accent}18` : isDone ? 'rgba(20,184,166,0.05)' : 'transparent',
                color: isAct ? s.accent : isDone ? C.teal : C.hint,
                ...C.type.caption, fontWeight: 700, fontFamily: C.font, transition: 'all .15s',
                lineHeight: 1,
              }}>
                {isDone && <span style={{ fontSize: 10, fontFamily: C.mono, fontWeight: 800 }}>✓</span>}
                {s.label}
              </div>
            );
          })}
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Status pill */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: C.pillBg, border: `1px solid ${C.border}`, borderRadius: 20, padding: '4px 12px' }}>
            <div style={{ position: 'relative', width: 7, height: 7, flexShrink: 0 }}>
              <div className="cfg-anim-decorative" style={{ width: 7, height: 7, borderRadius: '50%', background: statusCfg.dot, boxShadow: `0 0 5px ${statusCfg.dot}`, animation: statusCfg.pulse ? 'dot-pulse 1.2s ease-in-out infinite' : 'none' }} />
              {statusCfg.pulse && <div className="cfg-anim-decorative" style={{ position: 'absolute', inset: -1, borderRadius: '50%', border: `1.5px solid ${statusCfg.dot}`, animation: 'pulse-ring 1.4s ease-out infinite', opacity: 0.5 }} />}
            </div>
            <span style={{ ...C.type.body, color: C.sub, whiteSpace: 'nowrap' }}>{statusCfg.label}</span>
          </div>

          <button type="button" onClick={toggleTheme} style={{ width: 30, height: 30, borderRadius: 8, border: `1px solid ${C.border}`, background: C.pillBg, color: C.sub, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {uiTheme === 'dark' ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
            )}
          </button>

          <button type="button" onClick={toggleFullscreen} title="Fullscreen (use this, not Studio's own player fullscreen button)" style={{ width: 30, height: 30, borderRadius: 8, border: `1px solid ${C.border}`, background: C.pillBg, color: C.sub, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {isFullscreen ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3"/></svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>
            )}
          </button>

          <button type="button" onClick={save} style={{ padding: '5px 12px', borderRadius: 8, background: 'transparent', border: `1px solid ${C.border}`, color: C.sub, ...C.type.fieldLabel, fontFamily: C.font, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17,21 17,13 7,13 7,21"/><polyline points="7,3 7,8 15,8"/></svg>
            Save
          </button>
        </div>
      </header>

      {/* ── 3-COLUMN DASHBOARD ───────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '270px 1fr 350px', overflow: 'hidden', position: 'relative', zIndex: 1 }}>

        {/* ════════════════════════════════════════════════════════════════════
            LEFT COLUMN — 01 App Connection + 02 Narration
        ════════════════════════════════════════════════════════════════════ */}
        <aside style={{
          overflowY: 'auto', borderRight: `1px solid ${C.border}`,
          padding: '8px 11px 16px', background: C.sidebarBg,
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          {serverErr && (
            <div style={{ background: 'rgba(229,0,38,0.07)', border: '1.5px solid rgba(229,0,38,0.2)', borderRadius: 10, padding: '9px 12px', flexShrink: 0 }}>
              <div style={{ ...C.type.fieldLabel, color: '#ff7070', marginBottom: 2 }}>⚠ Server offline</div>
              <div style={{ ...C.type.caption, color: '#ff9090' }}>Run <code style={{ fontFamily: C.mono }}>npm run dev</code></div>
            </div>
          )}

          {loading && !serverErr && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', height: 180, color: C.hint, ...C.type.body }}>
              <div style={{ width: 14, height: 14, border: `2px solid ${C.indigo}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
              Loading…
            </div>
          )}

          {!loading && (
            <>
              {/* ── 01 App Connection ── */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
                  <div style={{ width: 22, height: 22, borderRadius: 7, background: `linear-gradient(135deg,${C.indigo},${C.indigo}cc)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: `0 3px 10px ${C.indigo}50` }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                  </div>
                  <span style={{ ...C.type.bodyLg, fontWeight: 700, color: C.text, letterSpacing: '-0.2px' }}>App Connection</span>
                </div>
                <div style={{ background: C.cardBg, backdropFilter: 'blur(18px)', border: `1px solid ${C.border}`, borderRadius: 12, padding: '8px 11px 1px', boxShadow: C.cardShadow }}>
                  <FL label="Product Name" req hint="Output folder name">
                    <InputField value={get('APP_PRODUCT_NAME')} onChange={v => set('APP_PRODUCT_NAME', v)} placeholder="MyApp"
                      icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>}
                    />
                  </FL>
                  <FL label="App URL" req hint="URL to record">
                    <InputField value={get('APP_URL')} onChange={v => set('APP_URL', v)} placeholder="http://10.1.9.23:3013"
                      icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>}
                    />
                  </FL>

                  <FL label="Login Method">
                    <SelectBox value={get('LOGIN_TYPE', '1')} onChange={v => set('LOGIN_TYPE', v)} options={[
                      { value: '1', label: 'Username & password' },
                      { value: '2', label: 'Quick Access card' },
                    ]} />
                  </FL>
                  {loginType === '1' && (
                    <Grid>
                      <FL label="Username" req>
                        <InputField value={get('APP_USERNAME')} onChange={v => set('APP_USERNAME', v)} placeholder="admin"
                          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>}
                        />
                      </FL>
                      <FL label="Password" req>
                        <InputField value={get('APP_PASSWORD')} onChange={v => set('APP_PASSWORD', v)} placeholder={MASK} password
                          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>}
                        />
                      </FL>
                    </Grid>
                  )}
                  {loginType === '1' && (
                    <>
                      <SubRule label="Secondary User" optional />
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.18)', borderRadius: 7, padding: '6px 9px', marginBottom: 8 }}>
                        <span style={{ fontSize: 11, flexShrink: 0, lineHeight: 1.4 }}>⚠</span>
                        <div style={{ ...C.type.caption, color: C.sub }}>
                          <span style={{ fontWeight: 600, color: C.yellow }}>Security note:</span>{' '}
                          Credentials stored in .env. Flag for team review — consider session-based auth for production use.
                        </div>
                      </div>
                      <Grid>
                        <FL label="Username">
                          <InputField value={get('APP_USERNAME_2')} onChange={v => set('APP_USERNAME_2', v)} placeholder="user"
                            icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>}
                          />
                        </FL>
                        <FL label="Password">
                          <InputField value={get('APP_PASSWORD_2')} onChange={v => set('APP_PASSWORD_2', v)} placeholder={MASK} password
                            icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>}
                          />
                        </FL>
                      </Grid>
                    </>
                  )}
                </div>
              </div>

              {/* ── 01b Pages to Record ── */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
                  <div style={{ width: 22, height: 22, borderRadius: 7, background: `linear-gradient(135deg,${C.cyan},${C.cyan}cc)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: `0 3px 10px ${C.cyan}50` }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
                  </div>
                  <span style={{ ...C.type.bodyLg, fontWeight: 700, color: C.text, letterSpacing: '-0.2px' }}>Pages to Record</span>
                  <span style={{ ...C.type.caption, color: C.hint, marginLeft: 2 }}>Screens the pipeline captures</span>
                </div>
                <div style={{ background: C.cardBg, backdropFilter: 'blur(18px)', border: `1px solid ${C.border}`, borderRadius: 12, padding: '8px 11px 1px', boxShadow: C.cardShadow }}>
                  <FL label="Route Map" hint='JSON: { "/path": "Page description" }' action={<CopyPromptBtn text={PROMPT_ROUTE_MAP} />}>
                    <TextareaField value={get('APP_ROUTE_MAP')} onChange={v => set('APP_ROUTE_MAP', v)} rows={4} placeholder={'{\n  "/": "Dashboard",\n  "/vehicles": "Vehicle Fleet",\n  "/routes": "Route Planning"\n}'} />
                  </FL>
                </div>
              </div>

              {/* ── 02 Narration ── */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
                  <div style={{ width: 22, height: 22, borderRadius: 7, background: `linear-gradient(135deg,${C.violet},${C.violet}cc)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: `0 3px 10px ${C.violet}50` }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg>
                  </div>
                  <span style={{ ...C.type.bodyLg, fontWeight: 700, color: C.text, letterSpacing: '-0.2px' }}>Narration & Context</span>
                </div>
                <div style={{ background: C.cardBg, backdropFilter: 'blur(18px)', border: `1px solid ${C.border}`, borderRadius: 12, padding: '8px 11px 1px', boxShadow: C.cardShadow }}>
                  <FL label="App Context" hint="Powers narration & feature ranking" action={<CopyPromptBtn text={PROMPT_APP_CONTEXT} />}>
                    <TextareaField value={get('APP_CONTEXT_TEXT')} onChange={v => set('APP_CONTEXT_TEXT', v)} rows={2} maxLength={5000} placeholder="AI-powered Prior Authorization system for healthcare…" />
                  </FL>
                  <div style={{ marginTop: 4, marginBottom: 6 }}>
                    <button type="button" onClick={() => setAdvancedOpen(v => !v)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', padding: '3px 0', color: C.hint, fontFamily: C.font, width: '100%' }}>
                      <svg width="7" height="7" viewBox="0 0 8 8" fill="currentColor" style={{ transform: advancedOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform .18s', flexShrink: 0 }}><polygon points="0,0 8,4 0,8"/></svg>
                      <span style={{ ...C.type.label, fontWeight: 600, letterSpacing: '.04em' }}>Advanced</span>
                    </button>
                    {advancedOpen && (
                      <div style={{ marginTop: 6 }}>
                        <FL label="Glossary" hint="Domain terms for narration" action={<CopyPromptBtn text={PROMPT_GLOSSARY} />}>
                          <TextareaField value={get('APP_GLOSSARY')} onChange={v => set('APP_GLOSSARY', v)} rows={1} maxLength={5000} placeholder={"PA: Prior Authorization · UM: Utilization Management"} />
                        </FL>
                        <FL label="Demo Pain Points" hint="Optional — per-route workflow/pain-point overrides" action={<CopyPromptBtn text={PROMPT_DEMO_PAIN_POINTS} />}>
                          <TextareaField value={get('DEMO_PAIN_POINTS')} onChange={v => set('DEMO_PAIN_POINTS', v)} rows={3} placeholder={'{\n  "/maintenance": { "workflow": "...", "painPoint": "...", "ahaMoment": "..." }\n}'} />
                          {get('DEMO_PAIN_POINTS').trim() !== '' && !isValidJsonObject(get('DEMO_PAIN_POINTS')) && (
                            <div style={{ ...C.type.caption, color: C.yellow, marginTop: 4 }}>
                              Doesn't look like valid JSON — the pipeline will ignore this until it is.
                            </div>
                          )}
                        </FL>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </aside>

        {/* ════════════════════════════════════════════════════════════════════
            CENTER COLUMN — Hero stats + 03 Template + Language/Options
        ════════════════════════════════════════════════════════════════════ */}
        <main style={{ overflowY: 'auto', padding: '18px 20px 40px' }}>
          {!loading && (
            <>
              {/* Hero KPI row */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 9, marginBottom: 18 }}>
                {([
                  {
                    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>,
                    label: 'Product', value: get('APP_PRODUCT_NAME') || 'Not set', accent: C.indigo, ok: !!get('APP_PRODUCT_NAME'),
                  },
                  {
                    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>,
                    label: 'App URL', value: get('APP_URL') ? 'Configured' : 'Not set', accent: C.teal, ok: !!get('APP_URL'),
                  },
                  {
                    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>,
                    label: 'Template', value: template === 'enterprise' ? 'Enterprise' : template === 'teaser' ? 'Teaser Video' : template === 'end_to_end' ? 'End to End' : 'Modern SaaS', accent: template === 'enterprise' ? C.purple : template === 'teaser' ? C.teal : template === 'end_to_end' ? C.indigo : C.cyan, ok: true,
                  },
                  {
                    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>,
                    label: 'Language', value: ({ en:'English',fr:'French',de:'German',es:'Spanish',it:'Italian',pt:'Portuguese',ja:'Japanese' } as Record<string,string>)[language] ?? language, accent: C.violet, ok: true,
                  },
                ] as Array<{ icon: React.ReactNode; label: string; value: string; accent: string; ok: boolean }>).map(stat => (
                  <div key={stat.label} style={{
                    background: C.cardBg, backdropFilter: 'blur(20px)',
                    border: `1px solid ${stat.ok ? `${stat.accent}45` : 'rgba(229,0,38,0.28)'}`,
                    borderRadius: 13, padding: '13px 14px', position: 'relative', overflow: 'hidden',
                    boxShadow: stat.ok
                      ? `0 4px 28px rgba(0,0,0,0.45), 0 0 0 1px ${stat.accent}18`
                      : '0 4px 28px rgba(0,0,0,0.45), 0 0 0 1px rgba(229,0,38,0.06)',
                  }}>
                    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, background: stat.ok ? `linear-gradient(90deg,${stat.accent},${stat.accent}20,transparent)` : 'linear-gradient(90deg,rgba(229,0,38,0.6),transparent)', borderRadius: '0 0 13px 13px' }} />
                    {/* icon chip */}
                    <div style={{ width: 28, height: 28, borderRadius: 8, marginBottom: 10, background: stat.ok ? `${stat.accent}18` : 'rgba(229,0,38,0.07)', border: `1px solid ${stat.ok ? `${stat.accent}22` : 'rgba(229,0,38,0.18)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: stat.ok ? stat.accent : C.red }}>
                      {stat.icon}
                    </div>
                    <div style={{ ...C.type.h3, color: stat.ok ? C.text : C.red, marginBottom: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{stat.value}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <div style={{ width: 5, height: 5, borderRadius: '50%', background: stat.ok ? C.sub : C.red, flexShrink: 0 }} />
                      <span style={{ ...C.type.caption, color: C.sub }}>{stat.label}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* ── 03 Template ── */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 11 }}>
                <div style={{ width: 22, height: 22, borderRadius: 7, background: `linear-gradient(135deg,${C.purple},${C.violet})`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: `0 3px 10px ${C.purple}50` }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
                </div>
                <span style={{ ...C.type.bodyLg, fontWeight: 700, color: C.text, letterSpacing: '-0.2px' }}>Template</span>
                <span style={{ ...C.type.body, color: C.hint, marginLeft: 4 }}>Select the visual style for your generated video</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
                <TemplateCard title="Modern SaaS" badge="POPULAR" accent={C.cyan} active={template === 'modern_saas'} onClick={() => set('VIDEO_TEMPLATE', 'modern_saas')} previewEl={<ModernPreview />} />
                <TemplateCard title="Enterprise" badge="PROFESSIONAL" accent={C.purple} active={template === 'enterprise'} onClick={() => set('VIDEO_TEMPLATE', 'enterprise')} previewEl={<EnterprisePreview />} />
                <TemplateCard title="Teaser Video" badge="SHORT & PUNCHY" accent={C.teal} active={template === 'teaser'} onClick={() => set('VIDEO_TEMPLATE', 'teaser')} previewEl={<TeaserPreview />} />
                <TemplateCard title="End to End" badge="REAL RECORDING" accent={C.indigo} active={template === 'end_to_end'} onClick={() => set('VIDEO_TEMPLATE', 'end_to_end')} previewEl={<EndToEndPreview />} />
              </div>

              {/* Language + Options row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                <div style={{ background: C.cardBg, backdropFilter: 'blur(18px)', border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: C.cardShadow }}>
                  <div style={{ padding: '6px 12px', background: 'rgba(0,0,0,0.22)', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke={C.cyan} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                    <span style={{ ...C.type.label, color: C.sub }}>Video Language</span>
                  </div>
                  <div style={{ padding: '10px 13px 4px' }}>
                  <FL label="Language" hint="Narration & voice-over language">
                    <SelectBox value={language} onChange={v => set('APP_LANGUAGE', v)} options={[
                      { value: 'en', label: 'English' }, { value: 'fr', label: 'French' }, { value: 'de', label: 'German' },
                      { value: 'es', label: 'Spanish' }, { value: 'it', label: 'Italian' }, { value: 'pt', label: 'Portuguese' }, { value: 'ja', label: 'Japanese' },
                    ]} />
                  </FL>
                  {language !== 'en' && (
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 8, padding: '7px 10px', marginBottom: 10 }}>
                      <span style={{ fontSize: 12, flexShrink: 0 }}>🌐</span>
                      <div style={{ ...C.type.caption, color: C.sub }}>
                        <span style={{ fontWeight: 600, color: C.text }}>Multilingual active.</span>{' '}
                        Narration translated to {({ en:'English',fr:'French',de:'German',es:'Spanish',it:'Italian',pt:'Portuguese',ja:'Japanese' } as Record<string,string>)[language] ?? language} via LLM.
                      </div>
                    </div>
                  )}
                  </div>
                </div>
                <div style={{ background: C.cardBg, backdropFilter: 'blur(18px)', border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: C.cardShadow }}>
                  <div style={{ padding: '6px 12px', background: 'rgba(0,0,0,0.22)', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke={C.violet} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07M8.46 8.46a5 5 0 0 0 0 7.07"/></svg>
                    <span style={{ ...C.type.label, color: C.sub }}>Video Options</span>
                  </div>
                  <div style={{ padding: '10px 13px 4px' }}>
                  <FL label="Screen Fit" hint="How app screen is framed">
                    <SelectBox value={get('SCREEN_FIT', 'full')} onChange={v => set('SCREEN_FIT', v)} options={[
                      { value: 'full', label: 'Full — edge-to-edge' },
                      { value: 'fit', label: 'Fit — inset with padding' },
                    ]} />
                  </FL>
                  {template === 'enterprise' && (
                    <FL label="Presenter Avatar" hint="Talking-head overlay in the Enterprise template">
                      <div style={{ paddingTop: 6, display: 'flex', alignItems: 'center', gap: 12 }}>
                        <PresenterAvatarBadge on={get('SHOW_AVATAR', 'true') !== 'false'} />
                        <Toggle value={get('SHOW_AVATAR', 'true')} onChange={v => set('SHOW_AVATAR', v)} onLabel="Presenter: On" offLabel="Presenter: Off" />
                      </div>
                    </FL>
                  )}
                  </div>
                </div>
              </div>
              {/* ── Readiness focal point — the sole "you're good to go" affirmation on
                   this screen; the KPI cards above stay neutral so this doesn't compete ── */}
              <div style={{ borderRadius: 14, border: `1px solid ${appSetupDone ? 'rgba(34,197,94,0.18)' : `${C.indigo}22`}`, background: appSetupDone ? 'rgba(34,197,94,0.035)' : `${C.indigo}07`, padding: '16px 18px', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', inset: 0, background: appSetupDone ? 'radial-gradient(ellipse at 20% 50%,rgba(34,197,94,0.07) 0%,transparent 65%)' : `radial-gradient(ellipse at 20% 50%,${C.indigo}12 0%,transparent 65%)`, pointerEvents: 'none' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 12, flexShrink: 0, background: appSetupDone ? 'rgba(34,197,94,0.1)' : `${C.indigo}14`, border: `1px solid ${appSetupDone ? 'rgba(34,197,94,0.22)' : `${C.indigo}28`}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {appSetupDone
                      ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                      : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.indigo} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    }
                  </div>
                  <div>
                    <div style={{ ...C.type.h2, color: appSetupDone ? C.green : C.text, lineHeight: 1.2 }}>{appSetupDone ? 'Ready to Generate' : 'Complete Setup'}</div>
                    <div style={{ ...C.type.body, color: C.sub, marginTop: 3 }}>{appSetupDone ? 'All required fields configured — hit Render →' : 'Fill required fields in the left panel to unlock'}</div>
                  </div>
                </div>
              </div>

            </>
          )}
        </main>

        {/* ════════════════════════════════════════════════════════════════════
            RIGHT COLUMN — 04 Generate + 05 Adjust Preview
        ════════════════════════════════════════════════════════════════════ */}
        <div style={{
          overflowY: 'auto', borderLeft: `1px solid ${C.border}`,
          padding: '16px 13px 40px', background: C.sidebarBg,
          display: 'flex', flexDirection: 'column', gap: 11,
        }}>
          {!loading && (
            <>
              {/* 04 header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                <div style={{ width: 22, height: 22, borderRadius: 7, background: `linear-gradient(135deg,${C.indigo},${C.violet})`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: `0 3px 10px ${C.indigo}50` }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="white" stroke="none"><polygon points="5,3 19,12 5,21"/></svg>
                </div>
                <span style={{ ...C.type.bodyLg, fontWeight: 700, color: C.text, letterSpacing: '-0.2px' }}>Generate</span>
              </div>

              {template === 'end_to_end' ? (
                <>
                {/* ── Exhaustive Recording — Agent Recording OR Manual Recording ──
                     Neither runs through the WorkflowOrchestrator pipeline that the
                     other three templates use: both produce a real video directly via
                     Playwright/ffmpeg, driven by their own dedicated endpoints
                     (/api/agent-recording/*, /api/manual-recording/*), not a Remotion-
                     rendered composition. Mutually exclusive (endToEndMode), not shown
                     together — the two are independent alternatives, and this column
                     is only 350px, too narrow for both at once. */}
                <div style={{ ...C.type.caption, color: C.hint, marginBottom: 2 }}>Real, end-to-end app walkthroughs — independent of the Template above.</div>

                <SegmentedControl
                  value={endToEndMode}
                  onChange={v => setEndToEndMode(v as 'agent' | 'manual')}
                  options={[
                    { value: 'agent', accent: C.teal, label: <>🤖 Agent<br/>Recording</> },
                    { value: 'manual', accent: C.cyan, label: <>🎥 Manual<br/>Recording</> },
                  ]}
                />

                {endToEndMode === 'agent' && (
                <>
                {/* ── Agent Recording card ── */}
                <div style={{ background: C.cardBg, backdropFilter: 'blur(18px)', border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: C.cardShadow, display: 'flex', flexDirection: 'column' }}>
                  <div style={{ padding: '9px 12px', background: 'rgba(0,0,0,0.22)', borderBottom: `1px solid ${C.border}` }}>
                    <div style={{ ...C.type.bodyLg, fontWeight: 700, color: C.text }}>🤖 Agent Recording</div>
                    <div style={{ ...C.type.caption, color: C.hint, marginTop: 2 }}>AI clicks every button &amp; fills every field, for every configured role — automatically. Destructive actions (delete, logout, pay, submit…) are always skipped.</div>
                  </div>
                  <div style={{ padding: '11px 12px', display: 'flex', flexDirection: 'column', gap: 9, flex: 1 }}>
                    <button type="button" onClick={() => setArNarrate(v => !v)} aria-pressed={arNarrate}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', alignSelf: 'flex-start' }}>
                      <div style={{ width: 34, height: 20, borderRadius: 10, position: 'relative', background: arNarrate ? C.teal : C.toggleOffBg, border: `1.5px solid ${arNarrate ? C.teal : C.toggleOffBdr}`, transition: 'background .2s', flexShrink: 0 }}>
                        <div style={{ position: 'absolute', top: 2, left: arNarrate ? 15 : 2, width: 12, height: 12, borderRadius: '50%', background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
                      </div>
                      <span style={{ ...C.type.fieldLabel, color: arNarrate ? C.text : C.sub }}>Generate narration too</span>
                    </button>

                    <button type="button" onClick={runAgentRecording} disabled={arStatus === 'running'}
                      style={{
                        height: 40, borderRadius: 9, border: 'none', cursor: arStatus === 'running' ? 'not-allowed' : 'pointer',
                        background: arStatus === 'running' ? 'rgba(10,147,211,0.35)' : `linear-gradient(135deg,${C.teal},${C.cyan})`,
                        color: '#fff', ...C.type.bodyLg, fontWeight: 700, fontFamily: C.font,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                      }}>
                      {arStatus === 'running'
                        ? <><div style={{ width: 13, height: 13, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />Running…</>
                        : <>▶ Run Agent Recording</>}
                    </button>
                    {arStatus === 'running' && (
                      <button type="button" onClick={stopAgentRecording} style={{ height: 32, borderRadius: 8, border: '1.5px solid rgba(229,0,38,0.45)', background: 'rgba(229,0,38,0.08)', color: '#ff7070', ...C.type.fieldLabel, fontWeight: 700, fontFamily: C.font, cursor: 'pointer' }}>Stop</button>
                    )}

                    {(arLog.length > 0 || arStatus === 'running' || arStatus === 'failed') && (
                      <div style={{ borderRadius: 8, overflow: 'hidden', border: `1px solid ${arStatus === 'failed' ? 'rgba(229,0,38,0.4)' : C.border}` }}>
                        <div style={{ padding: '5px 10px', background: C.logHeaderBg, borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ ...C.type.label, color: C.hint }}>Output</span>
                          {arStatus === 'running' && <span style={{ ...C.type.caption, color: C.yellow }}>● running</span>}
                          {arStatus === 'success' && <span style={{ ...C.type.caption, color: C.green }}>✓ done</span>}
                          {arStatus === 'failed' && <span style={{ ...C.type.caption, color: C.red }}>✗ failed</span>}
                        </div>
                        <pre ref={arLogRef} style={{ margin: 0, padding: '6px 10px', background: C.terminal, color: arStatus === 'failed' && arLog.length === 0 ? '#ff7070' : '#5dba7d', fontSize: 10, fontFamily: C.mono, lineHeight: 1.6, maxHeight: 90, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                          {arLog.length > 0 ? arLog.join('\n') : arStatus === 'failed' ? 'Failed to start — no output was produced. Check that the config server terminal is running and try again.' : 'Initialising…'}
                        </pre>
                      </div>
                    )}

                    {arReport && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {[
                          { l: 'roles', v: arReport.rolesRun.length },
                          { l: 'pages', v: arReport.pagesVisited },
                          { l: 'clicked', v: arReport.totalClicked },
                          { l: 'filled', v: arReport.totalFilled },
                          { l: 'skipped', v: arReport.totalSkipped },
                        ].map(chip => (
                          <div key={chip.l} style={{ background: C.gridItemBg, border: `1px solid ${C.gridItemBdr}`, borderRadius: 6, padding: '3px 8px', ...C.type.caption, color: C.sub }}>
                            <span style={{ fontWeight: 800, color: C.text }}>{chip.v}</span> {chip.l}
                          </div>
                        ))}
                      </div>
                    )}

                    {arHasWalkthrough && (
                      <div style={{ ...C.type.caption, color: C.hint }}>✓ Walkthrough ready — open <strong style={{ color: C.text }}>AgentRecordingVideo</strong> in the sidebar to view it.</div>
                    )}
                  </div>
                </div>
                </>
                )}

                {endToEndMode === 'manual' && (
                <>
                {/* ── Manual Recording card ── */}
                <div style={{ background: C.cardBg, backdropFilter: 'blur(18px)', border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: C.cardShadow, display: 'flex', flexDirection: 'column' }}>
                  <div style={{ padding: '9px 12px', background: 'rgba(0,0,0,0.22)', borderBottom: `1px solid ${C.border}` }}>
                    <div style={{ ...C.type.bodyLg, fontWeight: 700, color: C.text }}>🎥 Manual Recording</div>
                    <div style={{ ...C.type.caption, color: C.hint, marginTop: 2 }}>Record your own 15+ minute walkthrough with any tool, upload it here — AI detects scenes, writes the narration, and assembles the final video.</div>
                  </div>
                  <div style={{ padding: '11px 12px', display: 'flex', flexDirection: 'column', gap: 9, flex: 1 }}>
                    <input ref={mrFileInputRef} type="file" accept="video/*" style={{ display: 'none' }}
                      onChange={e => { const f = e.target.files?.[0]; if (f) uploadRecording(f); }} />

                    {mrUploadStatus !== 'uploading' && (
                      <button type="button" onClick={() => mrFileInputRef.current?.click()}
                        style={{ height: 40, borderRadius: 9, border: `1.5px dashed ${C.inputBdr}`, background: C.input, color: C.sub, ...C.type.fieldLabel, fontFamily: C.font, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                        {mrFileName ? `Replace "${mrFileName}"` : 'Choose video file to upload'}
                      </button>
                    )}

                    {mrUploadStatus === 'uploading' && (
                      <div>
                        <div style={{ ...C.type.caption, color: C.sub, marginBottom: 4 }}>Uploading… {mrUploadProgress}%</div>
                        <div style={{ height: 6, borderRadius: 3, background: C.trackBg, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${mrUploadProgress}%`, background: `linear-gradient(90deg,${C.teal},${C.cyan})`, borderRadius: 3, transition: 'width .15s' }} />
                        </div>
                      </div>
                    )}

                    {mrUploadStatus === 'error' && (
                      <div style={{ ...C.type.caption, color: '#ff7070' }}>✗ {mrUploadErr}</div>
                    )}

                    {mrUploadStatus === 'uploaded' && (
                      <>
                        <button type="button" onClick={processRecording} disabled={mrStatus === 'running'}
                          style={{
                            height: 40, borderRadius: 9, border: 'none', cursor: mrStatus === 'running' ? 'not-allowed' : 'pointer',
                            background: mrStatus === 'running' ? 'rgba(10,147,211,0.35)' : `linear-gradient(135deg,${C.teal},${C.cyan})`,
                            color: '#fff', ...C.type.bodyLg, fontWeight: 700, fontFamily: C.font,
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                          }}>
                          {mrStatus === 'running'
                            ? <><div style={{ width: 13, height: 13, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />Processing…</>
                            : <>▶ Process Recording</>}
                        </button>
                        {mrStatus === 'running' && (
                          <button type="button" onClick={stopManualRecording} style={{ height: 32, borderRadius: 8, border: '1.5px solid rgba(229,0,38,0.45)', background: 'rgba(229,0,38,0.08)', color: '#ff7070', ...C.type.fieldLabel, fontWeight: 700, fontFamily: C.font, cursor: 'pointer' }}>Stop</button>
                        )}
                      </>
                    )}

                    {(mrLog.length > 0 || mrStatus === 'running' || mrStatus === 'failed') && (
                      <div style={{ borderRadius: 8, overflow: 'hidden', border: `1px solid ${mrStatus === 'failed' ? 'rgba(229,0,38,0.4)' : C.border}` }}>
                        <div style={{ padding: '5px 10px', background: C.logHeaderBg, borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ ...C.type.label, color: C.hint }}>Output</span>
                          {mrStatus === 'running' && <span style={{ ...C.type.caption, color: C.yellow }}>● running</span>}
                          {mrStatus === 'success' && <span style={{ ...C.type.caption, color: C.green }}>✓ done</span>}
                          {mrStatus === 'failed' && <span style={{ ...C.type.caption, color: C.red }}>✗ failed</span>}
                        </div>
                        <pre ref={mrLogRef} style={{ margin: 0, padding: '6px 10px', background: C.terminal, color: mrStatus === 'failed' && mrLog.length === 0 ? '#ff7070' : '#5dba7d', fontSize: 10, fontFamily: C.mono, lineHeight: 1.6, maxHeight: 90, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                          {mrLog.length > 0 ? mrLog.join('\n') : mrStatus === 'failed' ? 'Failed to start — no output was produced. Check that the config server terminal is running and try again.' : 'Initialising…'}
                        </pre>
                      </div>
                    )}

                    {mrHasFinalVideo && (
                      <div style={{ ...C.type.caption, color: C.hint }}>✓ Final video ready — open <strong style={{ color: C.text }}>ManualRecordingVideo</strong> in the sidebar to view it.</div>
                    )}
                  </div>
                </div>
                </>
                )}
                </>
              ) : (
              <>
              {/* Recording status */}
              {recStatus && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: recStatus.hasRecordings ? 'rgba(34,197,94,0.06)' : 'rgba(245,158,11,0.06)', border: `1px solid ${recStatus.hasRecordings ? 'rgba(34,197,94,0.2)' : 'rgba(245,158,11,0.2)'}`, borderRadius: 9, padding: '7px 11px' }}>
                  <span style={{ fontSize: 13 }}>{recStatus.hasRecordings ? '🎬' : '⚠️'}</span>
                  <div>
                    <div style={{ ...C.type.fieldLabel, color: recStatus.hasRecordings ? C.green : C.yellow }}>{recStatus.hasRecordings ? `${recStatus.clipCount} clips${isClipBased ? ` · ${recStatus.hasVoiceScript ? 'voice ready' : 'no voice yet'}` : ''}` : 'No recordings yet'}</div>
                  </div>
                </div>
              )}

              {/* Recording Mode selector */}
              {isClipBased && (
                <div>
                  <div style={{ ...C.type.label, color: C.hint, marginBottom: 7 }}>Recording Mode</div>
                  <SegmentedControl
                    value={recordingMode}
                    onChange={v => setRecordingMode(v as 'new' | 'existing')}
                    options={[
                      {
                        value: 'new', accent: C.violet, label: <>New<br/>Recording</>,
                        icon: (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="9" stroke={recordingMode === 'new' ? C.violet : C.sub} strokeWidth="2"/>
                            <circle cx="12" cy="12" r="3.5" fill={recordingMode === 'new' ? C.violet : C.sub}/>
                          </svg>
                        ),
                      },
                      {
                        value: 'existing', accent: C.cyan, label: <>Existing<br/>Recording</>,
                        icon: (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="2" y="7" width="20" height="13" rx="2" stroke={recordingMode === 'existing' ? C.cyan : C.sub} strokeWidth="2"/>
                            <path d="M15 13.5l-5 3V10.5l5 3z" fill={recordingMode === 'existing' ? C.cyan : C.sub}/>
                            <path d="M8 7V5a2 2 0 014 0v2" stroke={recordingMode === 'existing' ? C.cyan : C.sub} strokeWidth="2"/>
                          </svg>
                        ),
                      },
                    ]}
                  />

                  {/* Force re-record — only shown when using existing recordings */}
                  {recordingMode === 'existing' && (
                    <div style={{ marginTop: 8, padding: '9px 11px', borderRadius: 9, background: 'rgba(255,255,255,0.02)', border: `1px solid ${C.border}`, transition: 'opacity .2s' }}>
                      <button type="button" onClick={() => setForceRerecord(v => !v)} aria-pressed={forceRerecord}
                        style={{ display: 'flex', alignItems: 'center', gap: 9, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit' }}>
                        <div style={{ width: 34, height: 20, borderRadius: 10, position: 'relative', background: forceRerecord ? C.violet : C.toggleOffBg, border: `1.5px solid ${forceRerecord ? C.violet : C.toggleOffBdr}`, transition: 'background .2s', flexShrink: 0 }}>
                          <div style={{ position: 'absolute', top: 2, left: forceRerecord ? 15 : 2, width: 12, height: 12, borderRadius: '50%', background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
                        </div>
                        <span style={{ ...C.type.fieldLabel, color: forceRerecord ? C.text : C.sub }}>Force re-record: {forceRerecord ? 'On' : 'Off'}</span>
                      </button>
                      <div style={{ ...C.type.caption, color: C.hint, marginTop: 4, paddingLeft: 43 }}>Re-records all clips from scratch. Takes longer but ensures fresh screenshots.</div>
                    </div>
                  )}
                </div>
              )}

              {/* ── CINEMATIC CTA ── */}
              <button type="button" onClick={run}
                onMouseEnter={() => { if (!running) setShimmer(true); }}
                onMouseLeave={() => setShimmer(false)}
                disabled={running}
                style={{
                  position: 'relative', overflow: 'hidden', width: '100%', height: 58,
                  borderRadius: 13, border: 'none',
                  background: running ? 'rgba(79,70,229,0.45)' : `linear-gradient(135deg,${C.indigo} 0%,${C.violet} 50%,${C.cyan} 100%)`,
                  color: '#fff', ...C.type.h3, fontWeight: 800, fontFamily: C.font,
                  cursor: running ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
                  boxShadow: running ? 'none' : `0 8px 36px rgba(79,70,229,0.55), 0 0 0 1px rgba(79,70,229,0.28), inset 0 1px 0 rgba(255,255,255,0.2)`,
                  transition: 'all .22s cubic-bezier(.4,0,.2,1)',
                }}
              >
                {running ? (
                  <>
                    <div style={{ width: 16, height: 16, border: '2.5px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
                    {isClipBased ? 'Recording & generating…' : 'Generating video…'}
                  </>
                ) : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="5,3 19,12 5,21"/></svg>
                    {isClipBased
                      ? (recordingMode === 'existing' && !forceRerecord ? 'Regenerate Preview' : 'Generate Preview')
                      : 'Render Video'}
                  </>
                )}
                {shimmer && !running && (
                  <div className="cfg-anim-decorative" style={{ position: 'absolute', top: 0, bottom: 0, width: '50%', background: 'linear-gradient(90deg,transparent,rgba(255,255,255,0.2),transparent)', animation: 'cc-sheen .6s ease forwards', pointerEvents: 'none' }} />
                )}
              </button>

              {running && (
                <button type="button" onClick={stop} style={{
                  width: '100%', height: 40, borderRadius: 10,
                  border: `1.5px solid rgba(229,0,38,0.45)`,
                  background: 'rgba(229,0,38,0.08)',
                  color: '#ff7070', ...C.type.bodyLg, fontWeight: 700, fontFamily: C.font,
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                  transition: 'background .15s',
                }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
                  Stop
                </button>
              )}

              {isClipBased && !running && pStatus === 'idle' && (
                <div style={{ ...C.type.caption, color: C.hint, textAlign: 'center', marginTop: -4 }}>
                  Recordings + voice + music generated. Use Render to export MP4.
                </div>
              )}

              {/* Pipeline log */}
              {(log.length > 0 || running) && (
                <div style={{ borderRadius: 9, overflow: 'hidden', border: `1px solid ${C.border}` }}>
                  <div style={{ padding: '6px 11px', background: C.logHeaderBg, borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ ...C.type.label, color: C.hint }}>Pipeline Output</span>
                    {running && <span style={{ ...C.type.caption, color: C.yellow }}>● running</span>}
                    {pStatus === 'success' && <span style={{ ...C.type.caption, color: C.green }}>✓ ready</span>}
                    {pStatus === 'failed' && <span style={{ ...C.type.caption, color: C.red }}>✗ failed</span>}
                  </div>
                  <pre ref={logRef} style={{ margin: 0, padding: '7px 11px', background: C.terminal, color: '#5dba7d', fontSize: 10, fontFamily: C.mono, lineHeight: 1.65, maxHeight: 110, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                    {log.length === 0 ? 'Initialising…' : log.join('\n')}
                  </pre>
                </div>
              )}

              {/* Open composition */}
              {(running || pStatus === 'success' || pStatus === 'failed') && (
                <button type="button" onClick={() => navigateToVideo(template)} style={{ width: '100%', height: 38, borderRadius: 9, border: `1px solid ${C.border}`, background: C.btnGhostBg, cursor: 'pointer', color: C.text, ...C.type.fieldLabel, fontFamily: C.font, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5,3 19,12 5,21"/></svg>
                  Open {template === 'enterprise' ? 'EnterpriseVideo' : template === 'teaser' ? 'TeaserVideo' : 'DemoVideo'} composition
                </button>
              )}

              {/* Status banners */}
              {pStatus === 'success' && (
                <div style={{ padding: '9px 12px', borderRadius: 9, background: 'rgba(34,197,94,0.07)', border: '1px solid rgba(34,197,94,0.2)', display: 'flex', alignItems: 'center', gap: 9 }}>
                  <span style={{ fontSize: 16 }}>✓</span>
                  <div>
                    <div style={{ ...C.type.fieldLabel, fontWeight: 700, color: C.green }}>{isClipBased ? 'Preview ready!' : 'Video generated!'}</div>
                    <div style={{ ...C.type.caption, color: 'rgba(34,197,94,0.65)', marginTop: 1 }}>{template === 'enterprise' ? 'Opening EnterpriseVideo in Studio.' : template === 'teaser' ? 'Opening TeaserVideo in Studio.' : 'Switching to DemoVideo.'}</div>
                  </div>
                </div>
              )}
              {pStatus === 'failed' && (
                <div style={{ padding: '9px 12px', borderRadius: 9, background: 'rgba(229,0,38,0.07)', border: '1px solid rgba(229,0,38,0.2)', display: 'flex', alignItems: 'center', gap: 9 }}>
                  <span style={{ fontSize: 15 }}>✗</span>
                  <div>
                    <div style={{ ...C.type.fieldLabel, fontWeight: 700, color: '#ff7070' }}>Pipeline failed</div>
                    <div style={{ ...C.type.caption, color: 'rgba(255,120,120,0.65)', marginTop: 1 }}>Check output above. Composition still openable.</div>
                  </div>
                </div>
              )}
              </>
              )}

              {/* ── 05 Adjust Preview ── */}
              {isClipBased && (pStatus === 'success' || (recStatus?.hasRecordings && recStatus?.hasVoiceScript)) ? (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, marginTop: 2 }}>
                    <div style={{ width: 22, height: 22, borderRadius: 7, background: `linear-gradient(135deg,${C.violet},${C.purple})`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: `0 3px 10px ${C.violet}50` }}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/><circle cx="8" cy="6" r="2" fill="white" stroke="none"/><circle cx="16" cy="12" r="2" fill="white" stroke="none"/><circle cx="10" cy="18" r="2" fill="white" stroke="none"/></svg>
                    </div>
                    <span style={{ ...C.type.bodyLg, fontWeight: 700, color: C.text, letterSpacing: '-0.2px' }}>Adjust Preview</span>
                  </div>
                  <div style={{ background: C.cardBg, backdropFilter: 'blur(18px)', border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: C.cardShadow }}>
                    {/* Tab bar */}
                    <div style={{ display: 'flex', borderBottom: `1px solid ${C.border}`, background: C.tabBarBg }}>
                      {([
                        { id: 'voice' as const, label: 'Voice', icon: '🎙' },
                        { id: 'broll' as const, label: 'B-Roll', icon: '🎥' },
                        { id: 'custom' as const, label: 'Options', icon: '⚙️' },
                      ] as Array<{ id: typeof modTab; label: string; icon: string }>).map(tab => (
                        <button key={tab.id} type="button" onClick={() => {
                          setModTab(tab.id);
                          if (tab.id === 'voice') {
                            setVoiceScript(null);
                            fetch(`${API}/api/voice-script`).then(r => r.json())
                              .then((vs: { script: unknown }) => { voiceScriptRaw.current = vs.script as Record<string, unknown>; setVoiceScript(extractSegments(vs.script)); })
                              .catch(() => {});
                          }
                          if (tab.id === 'broll' && !brollClips) {
                            fetch(`${API}/api/broll-clips`).then(r => r.json())
                              .then((d: { clips: typeof brollClips }) => setBrollClips(d.clips ?? []))
                              .catch(() => setBrollClips([]));
                          }
                        }} style={{
                          flex: 1, padding: '9px 4px', border: 'none', borderBottom: `2px solid ${modTab === tab.id ? C.cyan : 'transparent'}`,
                          background: modTab === tab.id ? 'rgba(6,182,212,0.06)' : 'transparent',
                          color: modTab === tab.id ? C.cyan : C.sub, ...C.type.fieldLabel, fontFamily: C.font, cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, transition: 'all .15s',
                        }}>
                          <span>{tab.icon}</span>{tab.label}
                        </button>
                      ))}
                    </div>
                    {/* Tab content */}
                    <div style={{ padding: '12px 13px' }}>
                      {modTab === 'voice' && (
                        voiceScript ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                            {voiceScript.map((entry, idx) => (
                              <div key={entry.id} style={{ background: C.gridItemBg, border: `1px solid ${C.gridItemBdr}`, borderRadius: 8, padding: '8px 10px' }}>
                                <div style={{ ...C.type.label, color: C.hint, letterSpacing: '.06em', marginBottom: 5 }}>{String(idx + 1).padStart(2, '0')} · {entry.label || entry.id}</div>
                                <textarea value={entry.text} onChange={e => { const updated = voiceScript.map((s, i) => i === idx ? { ...s, text: e.target.value } : s); setVoiceScript(updated); }} rows={3}
                                  style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '6px 8px', color: C.text, ...C.type.body, fontFamily: C.font, lineHeight: 1.6, resize: 'vertical' }} />
                              </div>
                            ))}
                            <div style={{ display: 'flex', gap: 7, alignItems: 'center', marginTop: 2 }}>
                              <button type="button" onClick={async () => {
                                await fetch(`${API}/api/voice-script`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ script: voiceScriptRaw.current ? { ...voiceScriptRaw.current, segments: voiceScript } : voiceScript }) });
                                setVoiceRegen('running'); setVoiceRegenLog([]);
                                const r = await fetch(`${API}/api/regenerate-voice`, { method: 'POST' }).catch(() => null);
                                if (r?.ok) startVoiceRegen(); else setVoiceRegen('failed');
                              }} disabled={voiceRegen === 'running'}
                                style={{ padding: '7px 13px', borderRadius: 7, border: 'none', cursor: voiceRegen === 'running' ? 'not-allowed' : 'pointer', background: voiceRegen === 'running' ? 'rgba(6,182,212,0.3)' : `linear-gradient(135deg,${C.teal},${C.cyan})`, color: '#fff', ...C.type.fieldLabel, fontFamily: C.font, display: 'flex', alignItems: 'center', gap: 6 }}>
                                {voiceRegen === 'running' && <div style={{ width: 11, height: 11, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />}
                                {voiceRegen === 'running' ? 'Regenerating…' : 'Regenerate Voice'}
                              </button>
                              {voiceRegen === 'success' && <span style={{ ...C.type.body, color: C.green }}>✓ Updated</span>}
                              {voiceRegen === 'failed' && <span style={{ ...C.type.body, color: C.red }}>✗ Failed</span>}
                            </div>
                            {voiceRegenLog.length > 0 && <pre style={{ margin: 0, padding: '6px 9px', borderRadius: 6, background: C.terminal, color: '#5dba7d', fontSize: 10, fontFamily: C.mono, lineHeight: 1.6, maxHeight: 70, overflowY: 'auto', whiteSpace: 'pre-wrap' }}>{voiceRegenLog.join('\n')}</pre>}
                          </div>
                        ) : <div style={{ color: C.hint, ...C.type.body }}>Loading voice script…</div>
                      )}

                      {modTab === 'broll' && (
                        brollClips === null ? <div style={{ color: C.hint, ...C.type.body }}>Loading…</div>
                        : brollClips.length === 0 ? <div style={{ color: C.hint, ...C.type.body }}>No b-roll clips found.</div>
                        : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                            {brollClips.map(clip => (
                              <div key={clip.id} style={{ display: 'flex', alignItems: 'center', gap: 9, background: C.gridItemBg, border: `1px solid ${C.gridItemBdr}`, borderRadius: 8, padding: '7px 10px' }}>
                                <div style={{ width: 30, height: 20, borderRadius: 4, background: `linear-gradient(135deg,${C.violet}40,${C.indigo}40)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0 }}>🎥</div>
                                <div style={{ flex: 1 }}>
                                  <div style={{ ...C.type.fieldLabel, color: C.text }}>{clip.label}</div>
                                  <code style={{ fontSize: 10, color: C.hint, fontFamily: C.mono }}>{clip.sizeMb} MB</code>
                                </div>
                              </div>
                            ))}
                            <button type="button" onClick={() => navigateToVideo(template)} style={{ padding: '7px 13px', borderRadius: 7, border: 'none', cursor: 'pointer', background: `linear-gradient(135deg,${C.indigo},${C.violet})`, color: '#fff', ...C.type.fieldLabel, fontFamily: C.font, marginTop: 3 }}>
                              Preview B-roll in Studio
                            </button>
                          </div>
                        )
                      )}

                      {modTab === 'custom' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                          {template === 'enterprise' && (
                            <FL label="Presenter Avatar" hint="Talking-head overlay in the Enterprise template">
                              <div style={{ paddingTop: 6, display: 'flex', alignItems: 'center', gap: 12 }}>
                                <PresenterAvatarBadge on={get('SHOW_AVATAR', 'true') !== 'false'} />
                                <Toggle value={get('SHOW_AVATAR', 'true')} onChange={v => set('SHOW_AVATAR', v)} onLabel="Presenter: On" offLabel="Presenter: Off" />
                              </div>
                            </FL>
                          )}
                          <FL label="Screen Fit" hint="How app screen is framed">
                            <SelectBox value={get('SCREEN_FIT', 'full')} onChange={v => set('SCREEN_FIT', v)} options={[{ value: 'full', label: 'Full — edge-to-edge' }, { value: 'fit', label: 'Fit — inset' }]} />
                          </FL>
                          <div style={{ display: 'flex', gap: 7 }}>
                            <button type="button" onClick={save} style={{ padding: '7px 13px', borderRadius: 7, border: 'none', cursor: 'pointer', background: C.btnGhostBg, color: C.text, ...C.type.fieldLabel, fontFamily: C.font }}>Save</button>
                            <button type="button" onClick={() => navigateToVideo(template)} style={{ padding: '7px 13px', borderRadius: 7, border: 'none', cursor: 'pointer', background: `linear-gradient(135deg,${C.indigo},${C.violet})`, color: '#fff', ...C.type.fieldLabel, fontFamily: C.font }}>Preview</button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : isClipBased ? (
                <div style={{ background: C.cardBg, border: `1px solid ${C.border}`, borderRadius: 11, padding: '16px 13px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, boxShadow: C.cardShadow }}>
                  <span style={{ fontSize: 22 }}>🎬</span>
                  <div style={{ ...C.type.fieldLabel, color: C.sub, textAlign: 'center' }}>Run the pipeline to unlock voice & B-roll editing.</div>
                </div>
              ) : null}
            </>
          )}
        </div>

      </div>

      {/* ── TOAST ─────────────────────────────────────────────────────────── */}
      {toast && (
        <div role="status" aria-live="polite" aria-atomic="true" style={{
          position: 'absolute', bottom: 20, right: 20,
          padding: '10px 16px', borderRadius: 10,
          background: toast.ok ? 'rgba(34,197,94,0.1)' : 'rgba(229,0,38,0.1)',
          border: `1.5px solid ${toast.ok ? 'rgba(34,197,94,0.3)' : 'rgba(229,0,38,0.3)'}`,
          backdropFilter: 'blur(12px)',
          color: toast.ok ? C.green : '#ff7070',
          ...C.type.bodyLg, zIndex: 999,
          animation: 'toast-in .25s ease',
          boxShadow: toast.ok ? '0 4px 20px rgba(34,197,94,0.15)' : '0 4px 20px rgba(229,0,38,0.15)',
        }}>
          {toast.msg}
        </div>
      )}

      {/* ── CHAT WIDGET ───────────────────────────────────────────────────── */}
      <ChatWidget />
    </div>
    </div>
    </ThemeCtx.Provider>
  );

  // Fullscreen only: portal into document.body — Remotion Studio's zoom/fit
  // implementation wraps the preview in a CSS `transform`, and any ancestor
  // transform silently traps `position: fixed` inside its own box instead of
  // the real viewport (same root cause ChatWidget's own portal works around).
  // Portaling to document.body escapes that container entirely so `position:
  // fixed` above actually reaches the true screen during fullscreen.
  return isFullscreen ? ReactDOM.createPortal(content, document.body) : content;
};
