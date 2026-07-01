import React, { useState, useEffect, useRef, useCallback } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// KEYFRAMES — injected into <head> on mount
// ─────────────────────────────────────────────────────────────────────────────
const KEYFRAMES = `
  @keyframes orb-a {
    0%,100% { transform: translate(0,0) scale(1); opacity:.55; }
    40%      { transform: translate(40px,25px) scale(1.12); opacity:.8; }
    70%      { transform: translate(-15px,35px) scale(.95); opacity:.45; }
  }
  @keyframes orb-b {
    0%,100% { transform: translate(0,0) scale(1); opacity:.4; }
    35%      { transform: translate(-30px,-20px) scale(1.08); opacity:.7; }
    65%      { transform: translate(20px,-30px) scale(.92); opacity:.35; }
  }
  @keyframes orb-c {
    0%,100% { transform: translate(0,0); opacity:.3; }
    50%      { transform: translate(25px,-18px); opacity:.55; }
  }
  @keyframes step-fwd {
    from { opacity:0; transform:translateX(28px) scale(.98); }
    to   { opacity:1; transform:translateX(0) scale(1); }
  }
  @keyframes step-bwd {
    from { opacity:0; transform:translateX(-28px) scale(.98); }
    to   { opacity:1; transform:translateX(0) scale(1); }
  }
  @keyframes spin { to { transform:rotate(360deg); } }
  @keyframes pulse-ring {
    0%   { transform:scale(1); opacity:.7; }
    100% { transform:scale(2.6); opacity:0; }
  }
  @keyframes shimmer {
    from { left:-70%; }
    to   { left:120%; }
  }
  @keyframes toast-in {
    from { opacity:0; transform:translateY(10px) scale(.96); }
    to   { opacity:1; transform:translateY(0) scale(1); }
  }
  @keyframes progress-fill {
    from { width:0; }
    to   { width:100%; }
  }
  @keyframes card-hover {
    from { transform:translateY(0); box-shadow:none; }
    to   { transform:translateY(-2px); }
  }
  @keyframes dot-pulse {
    0%,100% { transform:scale(1); }
    50%      { transform:scale(1.35); }
  }
  @keyframes chat-slide-up {
    from { opacity:0; transform:translateY(14px) scale(.97); }
    to   { opacity:1; transform:translateY(0) scale(1); }
  }
  @keyframes chat-dot {
    0%,80%,100% { transform:scale(0.6); opacity:.4; }
    40%         { transform:scale(1); opacity:1; }
  }
  @keyframes chat-bubble-pop {
    0%   { transform:scale(0.85); opacity:0; }
    60%  { transform:scale(1.06); opacity:1; }
    100% { transform:scale(1); }
  }
`;

// ─────────────────────────────────────────────────────────────────────────────
// TOKENS
// ─────────────────────────────────────────────────────────────────────────────
const T = {
  bg:        '#040c17',
  surface:   'rgba(255,255,255,0.032)',
  card:      'rgba(255,255,255,0.028)',
  glass:     'rgba(10,25,55,0.72)',
  border:    'rgba(255,255,255,0.07)',
  borderMd:  'rgba(255,255,255,0.13)',
  inputBdr:  'rgba(255,255,255,0.16)',   // P0 — visible resting border for inputs
  input:     'rgba(255,255,255,0.055)',
  text:      '#e4e9f5',
  sub:       '#7b8fb5',
  hint:      'rgba(120,140,180,0.55)',
  teal:      '#0a93d3',
  red:       '#e50026',
  purple:    '#8b5cf6',
  green:     '#22c55e',
  yellow:    '#f59e0b',
  font:      '"Inter","Helvetica Neue",system-ui,sans-serif',
  mono:      '"Consolas","Fira Code",monospace',
};

const API  = 'http://localhost:3001';
const MASK = '••••••••';
const PW_KEYS = ['APP_PASSWORD', 'APP_PASSWORD_2'];

// ── Chat widget types ─────────────────────────────────────────────────────────
interface ChatOp { op: string; path: string; value?: unknown; }
interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  changes?: ChatOp[];
  applied?: boolean;
  error?: string;
  ts: number;
}
interface ChatResult { reply: string; changes: ChatOp[]; applied: boolean; error?: string; }

const QUICK_ACTIONS = [
  { label: 'Change opening title',    prefix: 'Change the opening title to: '      },
  { label: 'Rewrite scene narration', prefix: 'Rewrite narration for scene 1 to: ' },
  { label: 'Update call to action',   prefix: 'Change the call to action to: '     },
  { label: 'Edit benefit bullet',     prefix: 'Update benefit bullet 1 to: '       },
];

const WELCOME_MSG: ChatMsg = {
  id: 'welcome', role: 'assistant', ts: 0,
  text: 'Hi! I can edit your video in real-time. Describe any change — like "Change the opening title to Hello World" or "Rewrite narration for scene 2" — and I\'ll update the preview instantly.',
};

// P1 — all steps use same teal; no red/purple for step indicators (those colors collide with error semantics)
const STEPS = [
  { label: 'App Setup',  sub: 'Connection & auth',  accent: T.teal, glyph: '01' },
  { label: 'Narration',  sub: 'Context & routes',   accent: T.teal, glyph: '02' },
  { label: 'Template',   sub: 'Visual style',       accent: T.teal, glyph: '03' },
];

// ─────────────────────────────────────────────────────────────────────────────
// PRIMITIVE COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

function TextInput({ value, onChange, placeholder, type = 'text', password = false }: {
  value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; password?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: 'relative', width: '100%' }}>
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
          background: focused ? 'rgba(255,255,255,0.07)' : T.input,
          // P0 — raised border contrast so fields are clearly editable
          border: `1.5px solid ${focused ? T.teal : T.inputBdr}`,
          borderRadius: 9,
          color: T.text,
          fontFamily: T.font,
          fontSize: 13.5,
          padding: '10px 14px',
          paddingRight: password ? 40 : 14,
          outline: 'none',
          transition: 'border-color .18s, background .18s, box-shadow .18s',
          boxShadow: focused ? `0 0 0 3px rgba(10,147,211,.15), 0 1px 6px rgba(0,0,0,.35)` : '0 1px 3px rgba(0,0,0,.3)',
        }}
      />
      {password && (
        <button type="button" onClick={() => setShow(s => !s)} style={{
          position: 'absolute', right: 11, top: '50%', transform: 'translateY(-50%)',
          background: 'none', border: 'none', cursor: 'pointer',
          color: T.hint, fontSize: 13, padding: 2, lineHeight: 1,
        }}>
          {show ? '🙈' : '👁️'}
        </button>
      )}
    </div>
  );
}

function SelectBox({ value, onChange, options }: {
  value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <select value={value} onChange={e => onChange(e.target.value)}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        style={{
          width: '100%', boxSizing: 'border-box', appearance: 'none',
          background: focused ? 'rgba(255,255,255,0.07)' : T.input,
          // P0 — raised border contrast
          border: `1.5px solid ${focused ? T.teal : T.inputBdr}`,
          borderRadius: 9, color: T.text, fontFamily: T.font, fontSize: 13.5,
          padding: '10px 36px 10px 14px', outline: 'none', cursor: 'pointer',
          transition: 'border-color .18s, background .18s, box-shadow .18s',
          boxShadow: focused ? `0 0 0 3px rgba(10,147,211,.15)` : '0 1px 3px rgba(0,0,0,.3)',
        }}>
        {options.map(o => <option key={o.value} value={o.value} style={{ background: '#0d1e35', color: T.text }}>{o.label}</option>)}
      </select>
      <div style={{ position: 'absolute', right: 13, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: T.hint }}>
        <svg width="10" height="6" viewBox="0 0 10 6"><path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>
      </div>
    </div>
  );
}

function Textarea({ value, onChange, placeholder, rows = 4 }: {
  value: string; onChange: (v: string) => void; placeholder?: string; rows?: number;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <textarea value={value} placeholder={placeholder} rows={rows}
      onChange={e => onChange(e.target.value)}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      style={{
        width: '100%', boxSizing: 'border-box', resize: 'vertical',
        background: focused ? 'rgba(255,255,255,0.07)' : T.input,
        // P0 — raised border contrast
        border: `1.5px solid ${focused ? T.teal : T.inputBdr}`,
        borderRadius: 9, color: T.text,
        fontFamily: T.mono, fontSize: 11.5, lineHeight: 1.7,
        padding: '10px 14px', outline: 'none',
        transition: 'border-color .18s, background .18s, box-shadow .18s',
        boxShadow: focused ? `0 0 0 3px rgba(10,147,211,.15)` : '0 1px 3px rgba(0,0,0,.3)',
      }}
    />
  );
}

function Toggle({ value, onChange, onLabel = 'Enabled', offLabel = 'Disabled' }: {
  value: string; onChange: (v: string) => void; onLabel?: string; offLabel?: string;
}) {
  const on = value !== 'false';
  return (
    <div onClick={() => onChange(on ? 'false' : 'true')}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none' }}>
      <div style={{
        position: 'relative', width: 44, height: 25, borderRadius: 13,
        background: on ? T.teal : 'rgba(255,255,255,0.1)',
        border: `1.5px solid ${on ? T.teal : 'rgba(255,255,255,0.12)'}`,
        transition: 'background .22s, border-color .22s',
        boxShadow: on ? `0 0 12px rgba(10,147,211,0.35)` : 'none',
      }}>
        <div style={{
          position: 'absolute', top: 3, left: on ? 21 : 3,
          width: 17, height: 17, borderRadius: '50%', background: '#fff',
          transition: 'left .2s cubic-bezier(.34,1.56,.64,1)',
          boxShadow: '0 1px 4px rgba(0,0,0,.4)',
        }} />
      </div>
      <span style={{ fontSize: 13, fontWeight: 500, color: on ? T.text : T.sub }}>{on ? onLabel : offLabel}</span>
    </div>
  );
}

// P1 — "REQUIRED" label replaced with a simple asterisk
function FL({ label, hint, req, children, full }: {
  label: string; hint?: string; req?: boolean; children: React.ReactNode; full?: boolean;
}) {
  return (
    <div style={{ marginBottom: 17, gridColumn: full ? '1/-1' : undefined }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: hint ? 3 : 6 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'rgba(180,195,230,0.85)', letterSpacing: '.01em' }}>{label}</span>
        {req && <span style={{ fontSize: 14, fontWeight: 700, color: T.red, lineHeight: 1 }}>*</span>}
      </div>
      {hint && <div style={{ fontSize: 11, color: T.hint, lineHeight: 1.45, marginBottom: 7 }}>{hint}</div>}
      {children}
    </div>
  );
}

// 2-col grid
function Grid({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 20px' }}>{children}</div>;
}

// Thin rule
function Rule() {
  return <div style={{ height: 1, background: T.border, margin: '6px 0 20px' }} />;
}

// Template card
function TemplateCard({ title, desc, tags, accent, active, onClick, previewEl }: {
  title: string; desc: string; tags: string[]; accent: string;
  active: boolean; onClick: () => void; previewEl: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        borderRadius: 12, overflow: 'hidden', cursor: 'pointer',
        border: `1.5px solid ${active ? accent : hovered ? T.borderMd : T.inputBdr}`,
        background: active ? `rgba(${accent === T.teal ? '10,147,211' : '139,92,246'},0.07)` : T.surface,
        boxShadow: active
          ? `0 0 0 1px ${accent}33, 0 4px 24px ${accent}22, 0 8px 40px rgba(0,0,0,0.5)`
          : hovered ? '0 4px 20px rgba(0,0,0,0.4)' : '0 2px 10px rgba(0,0,0,0.3)',
        transform: hovered && !active ? 'translateY(-2px)' : 'translateY(0)',
        transition: 'all .22s cubic-bezier(.4,0,.2,1)',
      }}
    >
      {/* Preview band */}
      <div style={{ height: 130, position: 'relative', overflow: 'hidden', background: `rgba(0,0,0,0.25)` }}>
        {previewEl}
        {active && (
          <div style={{
            position: 'absolute', top: 10, right: 10,
            width: 22, height: 22, borderRadius: '50%',
            background: accent, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 700, color: '#fff', boxShadow: `0 2px 10px ${accent}55`,
          }}>✓</div>
        )}
      </div>
      {/* Info */}
      <div style={{ padding: '13px 15px 14px' }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: active ? T.text : 'rgba(220,230,250,0.8)', marginBottom: 5, letterSpacing: '-0.01em' }}>{title}</div>
        <div style={{ fontSize: 11, color: T.hint, lineHeight: 1.5, marginBottom: 10 }}>{desc}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {tags.map(t => (
            <span key={t} style={{
              fontSize: 10, fontWeight: 600, letterSpacing: '.04em',
              padding: '2px 7px', borderRadius: 4,
              background: active ? `${accent}18` : 'rgba(255,255,255,0.05)',
              color: active ? accent : T.sub,
              border: `1px solid ${active ? `${accent}30` : 'rgba(255,255,255,0.08)'}`,
            }}>{t}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TEMPLATE PREVIEW ELEMENTS — realistic video-frame mockups
// ─────────────────────────────────────────────────────────────────────────────

// Modern SaaS: dark glassmorphic dashboard with KPI cards, chart, narration bar
const ModernPreview = () => (
  <div style={{ position:'absolute', inset:0, overflow:'hidden', background:'linear-gradient(160deg,#050e20 0%,#071628 60%,#0a1f3a 100%)' }}>
    {/* Ambient glow */}
    <div style={{ position:'absolute', top:-30, left:-20, width:130, height:130, borderRadius:'50%', background:'radial-gradient(circle,rgba(10,147,211,0.28) 0%,transparent 65%)', pointerEvents:'none' }} />
    <div style={{ position:'absolute', bottom:-20, right:30, width:90, height:90, borderRadius:'50%', background:'radial-gradient(circle,rgba(229,0,38,0.2) 0%,transparent 65%)', pointerEvents:'none' }} />

    {/* Top nav bar */}
    <div style={{ position:'absolute', top:0, left:0, right:0, height:18, background:'rgba(255,255,255,0.04)', borderBottom:'1px solid rgba(255,255,255,0.07)', display:'flex', alignItems:'center', padding:'0 8px', gap:6 }}>
      <div style={{ width:14, height:8, borderRadius:2, background:'rgba(10,147,211,0.6)' }} />
      <div style={{ flex:1, display:'flex', gap:5 }}>
        {[28,22,30].map((w,i) => <div key={i} style={{ height:4, width:w, borderRadius:2, background:'rgba(255,255,255,0.12)' }} />)}
      </div>
      <div style={{ width:18, height:9, borderRadius:10, background:'rgba(10,147,211,0.35)', border:'1px solid rgba(10,147,211,0.5)' }} />
    </div>

    {/* KPI metric cards */}
    <div style={{ position:'absolute', top:24, left:8, right:8, display:'flex', gap:5 }}>
      {[
        { val:'2,847', lbl:'Cases', color:'rgba(10,147,211,0.7)' },
        { val:'94%',   lbl:'Approved', color:'rgba(34,197,94,0.7)' },
        { val:'1.4h',  lbl:'Avg Time', color:'rgba(245,158,11,0.7)' },
      ].map(k => (
        <div key={k.lbl} style={{ flex:1, background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:4, padding:'4px 5px' }}>
          <div style={{ fontSize:9, fontWeight:800, color:k.color, lineHeight:1 }}>{k.val}</div>
          <div style={{ fontSize:7, color:'rgba(180,200,230,0.5)', marginTop:2 }}>{k.lbl}</div>
        </div>
      ))}
    </div>

    {/* Chart area */}
    <div style={{ position:'absolute', top:58, left:8, right:8, height:28, background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.07)', borderRadius:4, overflow:'hidden', display:'flex', alignItems:'flex-end', padding:'4px 6px', gap:3 }}>
      {[55,70,45,80,60,90,75,50,85,65].map((h,i) => (
        <div key={i} style={{ flex:1, height:`${h}%`, borderRadius:'2px 2px 0 0', background:`rgba(10,147,211,${0.25 + h/300})` }} />
      ))}
    </div>

    {/* Glassmorphism narration bar (signature Modern SaaS element) */}
    <div style={{ position:'absolute', bottom:0, left:0, right:0, height:20, background:'rgba(10,147,211,0.12)', backdropFilter:'blur(8px)', borderTop:'1px solid rgba(10,147,211,0.25)', display:'flex', alignItems:'center', padding:'0 8px', gap:5 }}>
      <div style={{ width:6, height:6, borderRadius:'50%', background:T.red, boxShadow:'0 0 4px rgba(229,0,38,0.6)', flexShrink:0 }} />
      <div style={{ flex:1, height:2, borderRadius:1, background:'rgba(255,255,255,0.15)' }}>
        <div style={{ width:'40%', height:'100%', borderRadius:1, background:'rgba(10,147,211,0.8)' }} />
      </div>
      <div style={{ fontSize:6, color:'rgba(10,147,211,0.9)', fontFamily:'monospace', flexShrink:0 }}>▶ 0:24</div>
    </div>
  </div>
);

// Enterprise: B-roll opener + app screen recording + presenter avatar overlay
const EnterprisePreview = () => (
  <div style={{ position:'absolute', inset:0, overflow:'hidden', background:'linear-gradient(160deg,#0c0718 0%,#130b28 100%)' }}>
    {/* B-roll background blur effect */}
    <div style={{ position:'absolute', inset:0, background:'radial-gradient(ellipse at 70% 40%,rgba(139,92,246,0.18) 0%,transparent 60%)' }} />
    <div style={{ position:'absolute', inset:0, background:'radial-gradient(ellipse at 20% 80%,rgba(59,7,100,0.35) 0%,transparent 55%)' }} />

    {/* B-roll strip at top */}
    <div style={{ position:'absolute', top:0, left:0, right:0, height:22, background:'rgba(0,0,0,0.4)', borderBottom:'1px solid rgba(139,92,246,0.2)', display:'flex', alignItems:'center', gap:3, padding:'0 8px' }}>
      <div style={{ fontSize:6, fontWeight:700, color:'rgba(139,92,246,0.7)', letterSpacing:'.05em', textTransform:'uppercase', flexShrink:0 }}>B-Roll</div>
      <div style={{ flex:1, display:'flex', gap:3 }}>
        {[1,2,3,4].map(i => (
          <div key={i} style={{ flex:1, height:14, borderRadius:2, background:'rgba(139,92,246,0.18)', border:'1px solid rgba(139,92,246,0.3)', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <div style={{ width:0, height:0, borderStyle:'solid', borderWidth:'3px 0 3px 5px', borderColor:'transparent transparent transparent rgba(139,92,246,0.7)' }} />
          </div>
        ))}
      </div>
    </div>

    {/* App screen recording frame */}
    <div style={{ position:'absolute', top:28, left:30, right:8, bottom:22, background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:3, overflow:'hidden' }}>
      {/* App nav */}
      <div style={{ height:10, background:'rgba(139,92,246,0.15)', borderBottom:'1px solid rgba(255,255,255,0.06)', display:'flex', alignItems:'center', padding:'0 5px', gap:3 }}>
        {[1,2,3].map(i => <div key={i} style={{ width:3, height:3, borderRadius:'50%', background:`rgba(255,255,255,${0.1+i*0.08})` }} />)}
      </div>
      {/* App content rows */}
      <div style={{ padding:'4px 5px', display:'flex', flexDirection:'column', gap:2.5 }}>
        {[80,55,70,45].map((w,i) => (
          <div key={i} style={{ display:'flex', gap:3, alignItems:'center' }}>
            <div style={{ width:6, height:6, borderRadius:1, background:'rgba(139,92,246,0.35)', flexShrink:0 }} />
            <div style={{ height:3, width:`${w}%`, borderRadius:2, background:'rgba(255,255,255,0.1)' }} />
          </div>
        ))}
      </div>
    </div>

    {/* Presenter avatar — signature Enterprise element */}
    <div style={{ position:'absolute', bottom:26, left:8, width:26, height:26, borderRadius:'50%', background:'linear-gradient(135deg,#7c3aed,#4c1d95)', border:'2px solid rgba(139,92,246,0.7)', boxShadow:'0 0 10px rgba(139,92,246,0.5)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12 }}>👤</div>

    {/* Bottom benefit bar */}
    <div style={{ position:'absolute', bottom:0, left:0, right:0, height:22, background:'rgba(139,92,246,0.12)', borderTop:'1px solid rgba(139,92,246,0.25)', display:'flex', alignItems:'center', padding:'0 8px', gap:5 }}>
      <div style={{ fontSize:6, fontWeight:700, color:'rgba(139,92,246,0.8)', flexShrink:0 }}>KEY BENEFITS</div>
      <div style={{ flex:1, display:'flex', gap:5 }}>
        {['Faster','Accurate','Scalable'].map(t => (
          <div key={t} style={{ fontSize:6, color:'rgba(200,180,255,0.7)', background:'rgba(139,92,246,0.15)', borderRadius:3, padding:'1px 4px', border:'1px solid rgba(139,92,246,0.25)' }}>{t}</div>
        ))}
      </div>
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export const ConfigPage: React.FC = () => {
  const [step, setStep]     = useState(0);
  const [dir, setDir]       = useState(1);
  const [vals, setVals]     = useState<Record<string, string>>({});
  const [existing, setExisting] = useState<Record<string, string>>({});
  const [loading, setLoading]   = useState(true);
  const [serverErr, setServerErr] = useState<string | null>(null);
  const [toast, setToast]   = useState<{ msg: string; ok: boolean } | null>(null);
  const [pStatus, setPStatus] = useState<'idle' | 'running' | 'success' | 'failed'>('idle');
  const [log, setLog]       = useState<string[]>([]);
  const [shimmer, setShimmer] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);
  const esRef  = useRef<EventSource | null>(null);

  // ── Chat widget state ───────────────────────────────────────────────────────
  const [chatOpen, setChatOpen]     = useState(false);
  const [chatMsgs, setChatMsgs]     = useState<ChatMsg[]>([WELCOME_MSG]);
  const [chatInput, setChatInput]   = useState('');
  const [chatBusy, setChatBusy]     = useState(false);
  const [chatConnected, setChatConnected] = useState<boolean | null>(null);
  const [chatToast, setChatToast]   = useState<{ msg: string; ok: boolean } | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const get = (k: string, fb = '') => vals[k] ?? fb;
  const set = useCallback((k: string, v: string) => setVals(p => ({ ...p, [k]: v })), []);
  const toast$ = useCallback((msg: string, ok = true) => {
    setToast({ msg, ok }); setTimeout(() => setToast(null), 3500);
  }, []);

  const showChatToast = useCallback((msg: string, ok = true) => {
    setChatToast({ msg, ok }); setTimeout(() => setChatToast(null), 3500);
  }, []);

  const sendChatMessage = useCallback(async (text: string) => {
    if (!text.trim() || chatBusy) return;
    const userMsg: ChatMsg = { id: String(Date.now()), role: 'user', text, ts: Date.now() };
    setChatMsgs(p => [...p, userMsg]);
    setChatInput('');
    setChatBusy(true);
    try {
      const res = await fetch(`${API}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json() as ChatResult;
      const aMsg: ChatMsg = {
        id: String(Date.now() + 1), role: 'assistant',
        text: data.reply, changes: data.changes,
        applied: data.applied, error: data.error, ts: Date.now(),
      };
      setChatMsgs(p => [...p, aMsg]);
      if (data.applied && data.changes?.length > 0) {
        showChatToast(`${data.changes.length} change${data.changes.length > 1 ? 's' : ''} applied — preview updating…`);
      } else if (data.error) {
        showChatToast(`Could not apply: ${data.error}`, false);
      }
    } catch {
      setChatMsgs(p => [...p, {
        id: String(Date.now() + 1), role: 'assistant',
        text: 'Network error — is the config server running? (npm run dev)', ts: Date.now(),
      }]);
    } finally {
      setChatBusy(false);
    }
  }, [chatBusy, showChatToast]);

  // Inject keyframes
  useEffect(() => {
    const el = document.createElement('style');
    el.textContent = KEYFRAMES;
    document.head.appendChild(el);
    return () => { try { document.head.removeChild(el); } catch {} };
  }, []);

  // Load config
  useEffect(() => {
    fetch(`${API}/api/config`).then(r => r.json())
      .then((d: { values: Record<string, string> }) => {
        const v = d.values ?? {};
        setExisting(v);
        const display = { ...v };
        PW_KEYS.forEach(k => { if (v[k]) display[k] = MASK; });
        setVals(display);
        setLoading(false);
      })
      .catch(() => { setServerErr('Config server offline'); setLoading(false); });

    fetch(`${API}/api/pipeline-status`).then(r => r.json())
      .then((d: { status: string }) => { if (d.status === 'running') { setPStatus('running'); startSSE(); } })
      .catch(() => {});
    return () => esRef.current?.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [log]);

  // Chat: check server on open + auto-scroll messages
  useEffect(() => {
    if (!chatOpen) return;
    fetch(`${API}/api/chat/status`).then(r => r.json())
      .then((d: { ok: boolean }) => setChatConnected(d.ok))
      .catch(() => setChatConnected(false));
  }, [chatOpen]);

  useEffect(() => {
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [chatMsgs]);

  const startSSE = useCallback(() => {
    esRef.current?.close();
    const es = new EventSource(`${API}/api/pipeline-stream`);
    esRef.current = es;
    es.onmessage = e => {
      try {
        const d = JSON.parse(e.data) as { type: string; line?: string; status?: string };
        if (d.type === 'log' && d.line) setLog(p => [...p.slice(-999), d.line!]);
        else if (d.status) { setPStatus(d.status as typeof pStatus); if (d.type === 'done') es.close(); }
      } catch {}
    };
    es.onerror = () => { es.close(); esRef.current = null; };
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
    const r = await fetch(`${API}/api/config`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ values: payload() }) }).catch(() => null);
    if (!r) { toast$('Network error', false); return; }
    const d = await r.json() as { saved?: boolean; error?: string };
    d.saved ? toast$('Saved ✓') : toast$(d.error ?? 'Error saving', false);
  }, [payload, toast$]);

  const run = useCallback(async () => {
    if (pStatus === 'running') return;
    setLog([]); setPStatus('running');
    await fetch(`${API}/api/config`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ values: payload() }) }).catch(() => {});
    const r = await fetch(`${API}/api/run-pipeline`, { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' }).catch(() => null);
    if (!r) { toast$('Network error', false); setPStatus('idle'); return; }
    const d = await r.json() as { started?: boolean; error?: string };
    if (d.started) startSSE(); else { toast$(d.error ?? 'Error', false); setPStatus('idle'); }
  }, [pStatus, payload, startSSE, toast$]);

  const goStep = useCallback((next: number) => {
    if (next === step) return;
    setDir(next > step ? 1 : -1);
    setStep(next);
  }, [step]);

  const loginType  = get('LOGIN_TYPE', '1');
  const template   = get('VIDEO_TEMPLATE', 'modern_saas');
  const running    = pStatus === 'running';
  const isLastStep = step === STEPS.length - 1;
  const stepAccent = STEPS[step].accent;

  // ── Status config ──────────────────────────────────────────────────────────
  const statusCfg = {
    idle:    { dot: T.sub,    pulse: false, label: 'Ready to generate' },
    running: { dot: T.yellow, pulse: true,  label: 'Pipeline running…' },
    success: { dot: T.green,  pulse: false, label: 'Done — preview your video' },
    failed:  { dot: T.red,    pulse: false, label: 'Pipeline failed' },
  }[pStatus];

  // ── STEP CONTENT ───────────────────────────────────────────────────────────
  const renderStep = () => {
    if (step === 0) return (
      <div key="step0">
        <Grid>
          <FL label="Product Name" req hint="Output folder name (e.g. PriorCore → out/priorcore/)">
            <TextInput value={get('APP_PRODUCT_NAME')} onChange={v => set('APP_PRODUCT_NAME', v)} placeholder="PriorCore" />
          </FL>
          <FL label="App URL" req hint="URL of the application to record">
            <TextInput value={get('APP_URL')} onChange={v => set('APP_URL', v)} placeholder="http://10.1.9.23:3013" />
          </FL>
        </Grid>

        <FL label="Login Method" hint="How the automation authenticates with your app">
          <SelectBox
            value={get('LOGIN_TYPE', '1')}
            onChange={v => set('LOGIN_TYPE', v)}
            options={[
              { value: '1', label: 'Fill username & password form' },
              { value: '2', label: 'Click Quick Access card  (no credentials needed)' },
            ]}
          />
        </FL>

        {loginType === '1' && (
          <Grid>
            <FL label="Username" req>
              <TextInput value={get('APP_USERNAME')} onChange={v => set('APP_USERNAME', v)} placeholder="admin" />
            </FL>
            <FL label="Password" req>
              <TextInput value={get('APP_PASSWORD')} onChange={v => set('APP_PASSWORD', v)} placeholder={MASK} password />
            </FL>
          </Grid>
        )}

        {/* P2 — Quick Access Index grouped in a half-width column so it doesn't float alone */}
        {loginType === '2' && (
          <Grid>
            <FL label="Quick Access Card Index" hint="0-based position of the card on the login screen">
              <TextInput value={get('APP_QUICK_ACCESS_INDEX', '0')} onChange={v => set('APP_QUICK_ACCESS_INDEX', v)} type="number" placeholder="0" />
            </FL>
            <div />
          </Grid>
        )}

        <Rule />

        {/* Secondary credentials */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: T.hint, letterSpacing: '.08em', textTransform: 'uppercase' }}>Secondary User</span>
          <span style={{ fontSize: 9.5, fontWeight: 600, color: T.sub, background: 'rgba(255,255,255,0.06)', border: `1px solid ${T.border}`, borderRadius: 4, padding: '1px 6px', letterSpacing: '.04em', textTransform: 'uppercase' }}>Optional</span>
          <div style={{ flex: 1, height: 1, background: T.border }} />
        </div>
        <Grid>
          <FL label="Username" hint="End-user role for multi-role demos">
            <TextInput value={get('APP_USERNAME_2')} onChange={v => set('APP_USERNAME_2', v)} placeholder="user" />
          </FL>
          <FL label="Password">
            <TextInput value={get('APP_PASSWORD_2')} onChange={v => set('APP_PASSWORD_2', v)} placeholder={MASK} password />
          </FL>
        </Grid>
      </div>
    );

    // P2 — balance textarea heights: App Context 4 rows, Route Map & Glossary 4 rows each (equal)
    if (step === 1) return (
      <div key="step1">
        <FL label="App Context" hint="1–5 sentences describing your app and audience. Powers feature ranking and narration personalisation.">
          <Textarea value={get('APP_CONTEXT_TEXT')} onChange={v => set('APP_CONTEXT_TEXT', v)} rows={4}
            placeholder="This product is an AI-powered Prior Authorization system for healthcare organizations that automates the clinical review and insurance approval process…" />
        </FL>
        <Grid>
          <FL label="Route Map" hint='JSON: { "/path": "Page description" }'>
            <Textarea value={get('APP_ROUTE_MAP')} onChange={v => set('APP_ROUTE_MAP', v)} rows={4}
              placeholder={'{"/" : "Dashboard", "/intake": "PA Intake Queue"}'} />
          </FL>
          <FL label="Glossary" hint="KEY=Value per line — domain terms for narration">
            <Textarea value={get('APP_GLOSSARY')} onChange={v => set('APP_GLOSSARY', v)} rows={4}
              placeholder={"PA=Prior Authorization\nUM=Utilization Management\nEHR=Electronic Health Record"} />
          </FL>
        </Grid>
      </div>
    );

    if (step === 2) return (
      <div key="step2">
        {/* P1 — REQUIRED → * asterisk */}
        <div style={{ marginBottom: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: 'rgba(180,195,230,0.85)' }}>Template</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: T.red, lineHeight: 1 }}>*</span>
          </div>
          <div style={{ fontSize: 11, color: T.hint, marginBottom: 12 }}>Select the visual style for your generated video</div>
        </div>
        <Grid>
          <TemplateCard
            title="Modern SaaS"
            desc="Dark glassmorphic design with Ken-Burns animated camera, glassmorphism narration bar, and feature pills closing card."
            tags={['Animated Camera', 'Dark Theme', 'Glassmorphism']}
            accent={T.teal}
            active={template === 'modern_saas'}
            onClick={() => set('VIDEO_TEMPLATE', 'modern_saas')}
            previewEl={<ModernPreview />}
          />
          <TemplateCard
            title="Enterprise"
            desc="Professional B-roll opener, animated presenter overlay, benefit slide, and full-screen presenter close."
            tags={['B-Roll', 'Presenter', 'Benefit Slide']}
            accent={T.purple}
            active={template === 'enterprise'}
            onClick={() => set('VIDEO_TEMPLATE', 'enterprise')}
            previewEl={<EnterprisePreview />}
          />
        </Grid>

        {template === 'enterprise' && (
          <>
            <div style={{ marginTop: 20 }} />
            <Rule />
            <Grid>
              <FL label="Screen Fit" hint="How the app screen is framed">
                <SelectBox value={get('SCREEN_FIT', 'full')} onChange={v => set('SCREEN_FIT', v)}
                  options={[
                    { value: 'full', label: 'Full — edge-to-edge' },
                    { value: 'fit',  label: 'Fit — inset with padding & rounded corners' },
                  ]}
                />
              </FL>
              <FL label="Presenter Avatar" hint="Animated talking-head overlay on product scenes">
                <div style={{ paddingTop: 6 }}>
                  <Toggle value={get('SHOW_AVATAR', 'true')} onChange={v => set('SHOW_AVATAR', v)} onLabel="Show presenter" offLabel="Hide presenter" />
                </div>
              </FL>
            </Grid>
          </>
        )}

        {/* Pipeline log */}
        {(log.length > 0 || running) && (
          <div style={{ marginTop: 16, borderRadius: 10, overflow: 'hidden', border: `1px solid ${T.border}` }}>
            <div style={{ padding: '8px 14px', background: 'rgba(0,0,0,0.3)', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: T.sub, textTransform: 'uppercase', letterSpacing: '.07em' }}>Output</span>
              {running && <span style={{ fontSize: 10.5, color: T.yellow }}>● running</span>}
              {pStatus === 'success' && <span style={{ fontSize: 10.5, color: T.green }}>✓ done — switch to your video composition</span>}
              {pStatus === 'failed'  && <span style={{ fontSize: 10.5, color: T.red }}>✗ failed</span>}
            </div>
            <pre ref={logRef} style={{ margin: 0, padding: '10px 14px', background: '#020b14', color: '#5dba7d', fontSize: 10.5, fontFamily: T.mono, lineHeight: 1.7, maxHeight: 140, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {log.length === 0 ? 'Initialising…' : log.join('\n')}
            </pre>
          </div>
        )}
      </div>
    );
    return null;
  };

  // ── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <div style={{
      width: '100%', height: '100%', overflow: 'hidden',
      background: T.bg, fontFamily: T.font, color: T.text,
      display: 'flex', flexDirection: 'column',
      backgroundImage: `url("data:image/svg+xml,%3Csvg width='32' height='32' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='1' cy='1' r='1' fill='rgba(10%2C147%2C211%2C0.06)'/%3E%3C/svg%3E")`,
    }}>

      {/* ── HEADER ─────────────────────────────────────────────────────────── */}
      <div style={{
        position: 'relative', height: 72, flexShrink: 0, overflow: 'hidden',
        background: 'linear-gradient(135deg,#06111f 0%,#0a1a35 50%,#080f1e 100%)',
        borderBottom: `1px solid ${T.border}`,
      }}>
        {/* Animated gradient orbs */}
        <div style={{ position:'absolute', top:-60, left:-40, width:200, height:200, borderRadius:'50%', background:'radial-gradient(circle,rgba(10,147,211,0.18) 0%,transparent 65%)', animation:'orb-a 9s ease-in-out infinite', pointerEvents:'none' }} />
        <div style={{ position:'absolute', top:-40, right:60, width:160, height:160, borderRadius:'50%', background:'radial-gradient(circle,rgba(229,0,38,0.12) 0%,transparent 65%)', animation:'orb-b 12s ease-in-out infinite', pointerEvents:'none' }} />
        <div style={{ position:'absolute', bottom:-50, right:-20, width:140, height:140, borderRadius:'50%', background:'radial-gradient(circle,rgba(139,92,246,0.14) 0%,transparent 65%)', animation:'orb-c 7s ease-in-out infinite', pointerEvents:'none' }} />

        {/* Header content */}
        <div style={{ position:'relative', height:'100%', padding:'0 22px', display:'flex', alignItems:'center', gap:14 }}>
          {/* Logo */}
          <div style={{
            width:36, height:36, borderRadius:10, flexShrink:0,
            background:'linear-gradient(135deg,#e50026,#b20000)',
            display:'flex', alignItems:'center', justifyContent:'center',
            fontSize:17, boxShadow:'0 4px 14px rgba(229,0,38,0.4), 0 0 0 1px rgba(255,255,255,0.07)',
          }}>⚙</div>

          <div>
            <div style={{ fontSize:15, fontWeight:800, color:T.text, letterSpacing:'-0.25px', lineHeight:1.1 }}>Video Generator</div>
            <div style={{ fontSize:11, color:T.hint, marginTop:2 }}>Configuration Console</div>
          </div>

          {/* Separator */}
          <div style={{ width:1, height:28, background:'rgba(255,255,255,0.08)', margin:'0 4px' }} />

          {/* P3 — instructional tagline instead of marketing copy */}
          <div style={{ fontSize:11.5, color:T.hint }}>Fill in your app details, then generate your video</div>

          {/* Status pill */}
          <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:8 }}>
            <div style={{ position:'relative', width:10, height:10 }}>
              <div style={{
                width:8, height:8, borderRadius:'50%',
                background: statusCfg.dot,
                boxShadow: `0 0 6px ${statusCfg.dot}`,
                animation: statusCfg.pulse ? 'dot-pulse 1.2s ease-in-out infinite' : 'none',
                position:'absolute', top:1, left:1,
              }} />
              {statusCfg.pulse && (
                <div style={{
                  width:10, height:10, borderRadius:'50%',
                  border: `1.5px solid ${statusCfg.dot}`,
                  position:'absolute', top:0, left:0,
                  animation:'pulse-ring 1.4s ease-out infinite',
                  opacity: 0.5,
                }} />
              )}
            </div>
            <span style={{ fontSize:11.5, color: statusCfg.dot, fontWeight:600 }}>{statusCfg.label}</span>
          </div>
        </div>
      </div>

      {/* ── STEP INDICATOR ─────────────────────────────────────────────────── */}
      {/* P0 — connector lines are 2px, inside a centered max-width row, not spanning full 1280px */}
      <div style={{
        flexShrink:0,
        background:'rgba(0,0,0,0.2)',
        borderBottom:`1px solid ${T.border}`,
        display:'flex', alignItems:'center',
        justifyContent:'center',
        padding:'0 22px',
      }}>
        <div style={{ display:'flex', alignItems:'center', width:'100%', maxWidth:560 }}>
          {STEPS.map((s, i) => {
            const active    = i === step;
            const completed = i < step;
            return (
              <React.Fragment key={s.label}>
                {/* Step node */}
                <button type="button" onClick={() => goStep(i)} style={{
                  display:'flex', alignItems:'center', gap:9,
                  padding:'12px 0', background:'none', border:'none',
                  cursor:'pointer', outline:'none', flexShrink:0,
                  opacity: active ? 1 : completed ? 0.75 : 0.38,
                  transition:'opacity .2s',
                }}>
                  {/* Circle */}
                  <div style={{
                    width:26, height:26, borderRadius:'50%', flexShrink:0,
                    display:'flex', alignItems:'center', justifyContent:'center',
                    background: active ? s.accent : completed ? `${s.accent}30` : 'rgba(255,255,255,0.06)',
                    border: `1.5px solid ${active ? s.accent : completed ? `${s.accent}50` : 'rgba(255,255,255,0.1)'}`,
                    boxShadow: active ? `0 0 14px ${s.accent}50` : 'none',
                    transition:'all .25s',
                    fontSize:10, fontWeight:800, color: active ? '#fff' : completed ? s.accent : T.sub,
                    fontFamily:T.mono,
                  }}>
                    {completed ? '✓' : s.glyph}
                  </div>
                  {/* Labels */}
                  <div>
                    <div style={{ fontSize:12.5, fontWeight: active ? 700 : 500, color: active ? T.text : T.sub, lineHeight:1.1 }}>{s.label}</div>
                    <div style={{ fontSize:10, color: active ? `${s.accent}cc` : T.hint, marginTop:1 }}>{s.sub}</div>
                  </div>
                </button>

                {/* P0 — thin 2px connector, teal fill, contained within centered row */}
                {i < STEPS.length - 1 && (
                  <div style={{ flex:1, height:2, margin:'0 14px', borderRadius:2, overflow:'hidden', background:'rgba(255,255,255,0.07)' }}>
                    <div style={{
                      height:'100%', borderRadius:2,
                      background: T.teal,
                      width: step > i ? '100%' : '0%',
                      transition:'width .5s ease',
                      opacity:0.55,
                    }} />
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* ── STEP CONTENT ───────────────────────────────────────────────────── */}
      <div style={{ flex:1, overflowY:'auto', padding:'18px 22px 0' }}>

        {serverErr && (
          <div style={{ background:'rgba(229,0,38,0.07)', border:'1.5px solid rgba(229,0,38,0.22)', borderRadius:10, padding:'14px 18px', marginBottom:16, animation:'toast-in .3s ease' }}>
            <div style={{ fontSize:13, fontWeight:600, color:'#ff7070', marginBottom:5 }}>⚠ Config server not running</div>
            <div style={{ fontSize:11.5, color:'#ff9090', marginBottom:8 }}>{serverErr}</div>
            <code style={{ display:'block', background:'rgba(0,0,0,0.35)', borderRadius:6, padding:'6px 11px', fontSize:11.5, color:'#7dd3fc', fontFamily:T.mono }}>npm run config-ui</code>
          </div>
        )}

        {loading && !serverErr && (
          <div style={{ display:'flex', alignItems:'center', gap:10, justifyContent:'center', height:160, color:T.hint, fontSize:13 }}>
            <div style={{ width:14, height:14, border:`2px solid ${T.teal}`, borderTopColor:'transparent', borderRadius:'50%', animation:'spin .7s linear infinite' }} />
            Loading configuration…
          </div>
        )}

        {/* P0 — form content in a surface card.
            key={step} remounts the div on every step change so the browser always
            fires a fresh keyframe animation — without a key the DOM element is
            reused and CSS animations never re-trigger on the same element. */}
        {!loading && !serverErr && (
          <div
            key={step}
            style={{
              animation: `${dir > 0 ? 'step-fwd' : 'step-bwd'} .22s cubic-bezier(.4,0,.2,1) both`,
            }}
          >
            <div style={{
              background: T.card,
              border: `1px solid rgba(255,255,255,0.075)`,
              borderRadius: 12,
              padding: '22px 24px 10px',
            }}>
              {renderStep()}
            </div>
          </div>
        )}

        <div style={{ height:76 }} />
      </div>

      {/* ── ACTION BAR ─────────────────────────────────────────────────────── */}
      <div style={{
        height:58, flexShrink:0,
        background:'rgba(6,12,22,0.95)',
        borderTop:`1px solid ${T.border}`,
        backdropFilter:'blur(12px)',
        padding:'0 22px',
        display:'flex', alignItems:'center', gap:10,
      }}>
        {/* Back */}
        <button type="button" onClick={() => goStep(step - 1)} disabled={step === 0}
          style={{
            padding:'8px 16px', borderRadius:8,
            border:`1.5px solid ${step === 0 ? 'rgba(255,255,255,0.04)' : T.border}`,
            background:'transparent', color: step === 0 ? 'rgba(255,255,255,0.15)' : T.sub,
            fontSize:13, fontWeight:500, fontFamily:T.font, cursor: step === 0 ? 'default' : 'pointer',
            transition:'all .15s',
          }}>
          ← Back
        </button>

        {/* Step counter */}
        <span style={{ fontSize:11, color:T.hint, fontWeight:500 }}>Step {step + 1} of {STEPS.length}</span>

        {/* Progress bar */}
        <div style={{ flex:1, height:2, borderRadius:1, background:'rgba(255,255,255,0.06)', overflow:'hidden' }}>
          <div style={{
            height:'100%', borderRadius:1,
            background: T.teal,
            width:`${((step + 1) / STEPS.length) * 100}%`,
            transition:'width .4s cubic-bezier(.4,0,.2,1)',
            opacity:0.75,
          }} />
        </div>

        {/* Next / Generate */}
        {!isLastStep ? (
          <button type="button" onClick={() => goStep(step + 1)}
            style={{
              padding:'8px 20px', borderRadius:8, border:'none',
              background:`linear-gradient(135deg,${stepAccent}ee,${stepAccent}aa)`,
              color:'#fff', fontSize:13, fontWeight:700, fontFamily:T.font, cursor:'pointer',
              boxShadow:`0 2px 12px ${stepAccent}40`,
              transition:'all .15s',
            }}>
            Next →
          </button>
        ) : (
          <div style={{ position:'relative', display:'inline-flex' }}>
            <button
              type="button" onClick={run}
              onMouseEnter={() => { if (!running) setShimmer(true); }}
              onMouseLeave={() => setShimmer(false)}
              disabled={loading || !!serverErr || running}
              style={{
                position:'relative', overflow:'hidden',
                padding:'9px 22px', borderRadius:8, border:'none',
                background: running ? 'rgba(229,0,38,0.5)' : 'linear-gradient(135deg,#e50026,#c4001f)',
                color:'#fff', fontSize:13, fontWeight:700, fontFamily:T.font,
                cursor: running ? 'not-allowed' : 'pointer',
                display:'flex', alignItems:'center', gap:8,
                boxShadow: running ? 'none' : '0 2px 16px rgba(229,0,38,0.4), 0 0 0 1px rgba(229,0,38,0.3)',
                transition:'all .18s',
              }}>
              {running
                ? <><div style={{ width:11, height:11, border:'2px solid rgba(255,255,255,0.3)', borderTopColor:'#fff', borderRadius:'50%', animation:'spin .7s linear infinite' }} />Generating…</>
                : <> ▶&ensp;Save &amp; Generate Video</>
              }
              {/* Shimmer sweep */}
              {shimmer && !running && (
                <div style={{
                  position:'absolute', top:0, bottom:0, width:'50%',
                  background:'linear-gradient(90deg,transparent,rgba(255,255,255,0.18),transparent)',
                  animation:'shimmer .55s ease forwards',
                  pointerEvents:'none',
                }} />
              )}
            </button>
          </div>
        )}

        {/* P1 — server status dots removed (developer noise, not user info) */}
        {/* Save config */}
        <button type="button" onClick={save} disabled={loading || !!serverErr}
          style={{
            padding:'8px 14px', borderRadius:8,
            border:`1.5px solid ${T.border}`, background:'transparent',
            color:T.sub, fontSize:12, fontWeight:500, fontFamily:T.font,
            cursor:'pointer', transition:'all .15s',
          }}>
          Save
        </button>
      </div>

      {/* ── TOAST ──────────────────────────────────────────────────────────── */}
      {toast && (
        <div style={{
          position:'absolute', bottom:66, right:20,
          padding:'10px 16px', borderRadius:9,
          background: toast.ok ? 'rgba(34,197,94,0.1)' : 'rgba(229,0,38,0.1)',
          border:`1.5px solid ${toast.ok ? 'rgba(34,197,94,0.3)' : 'rgba(229,0,38,0.3)'}`,
          backdropFilter:'blur(12px)',
          color: toast.ok ? T.green : '#ff7070',
          fontSize:12.5, fontWeight:600, zIndex:999,
          animation:'toast-in .25s ease',
          boxShadow: toast.ok ? '0 4px 20px rgba(34,197,94,0.15)' : '0 4px 20px rgba(229,0,38,0.15)',
        }}>
          {toast.msg}
        </div>
      )}

      {/* ── CHAT WIDGET ────────────────────────────────────────────────────── */}

      {/* Floating bubble button */}
      <button
        type="button"
        onClick={() => setChatOpen(o => !o)}
        title="Video Editor Chat"
        style={{
          position:'fixed', bottom:24, right:24, zIndex:1100,
          width:56, height:56, borderRadius:'50%', border:'none',
          background: chatOpen
            ? 'linear-gradient(135deg,#0a93d3,#0670a0)'
            : 'linear-gradient(135deg,#0a93d3,#0583be)',
          boxShadow: chatOpen
            ? '0 4px 24px rgba(10,147,211,0.55), 0 0 0 3px rgba(10,147,211,0.2)'
            : '0 4px 20px rgba(10,147,211,0.4)',
          cursor:'pointer',
          display:'flex', alignItems:'center', justifyContent:'center',
          transition:'all .2s cubic-bezier(.4,0,.2,1)',
          animation:'chat-bubble-pop .3s cubic-bezier(.34,1.56,.64,1) both',
        }}
      >
        {chatOpen ? (
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M4 4l12 12M16 4L4 16" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"/>
          </svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </button>

      {/* Chat dialog panel */}
      {chatOpen && (
        <div style={{
          position:'fixed', bottom:92, right:24, zIndex:1099,
          width:380, height:520,
          background:'rgba(4,12,23,0.97)',
          backdropFilter:'blur(24px)',
          border:'1px solid rgba(10,147,211,0.28)',
          borderRadius:16,
          display:'flex', flexDirection:'column',
          boxShadow:'0 20px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04)',
          animation:'chat-slide-up .22s cubic-bezier(.4,0,.2,1) both',
          overflow:'hidden',
          fontFamily: T.font,
        }}>

          {/* Dialog header */}
          <div style={{
            height:48, flexShrink:0,
            background:'rgba(10,147,211,0.08)',
            borderBottom:'1px solid rgba(10,147,211,0.18)',
            display:'flex', alignItems:'center',
            padding:'0 14px', gap:10,
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ flexShrink:0 }}>
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" stroke={T.teal} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span style={{ fontSize:13, fontWeight:700, color:T.text, letterSpacing:'-0.01em' }}>Video Editor</span>
            {/* Connection pill */}
            <div style={{ display:'flex', alignItems:'center', gap:5, marginLeft:4 }}>
              <div style={{
                width:6, height:6, borderRadius:'50%',
                background: chatConnected === null ? T.yellow : chatConnected ? T.green : T.red,
                boxShadow: `0 0 5px ${chatConnected === null ? T.yellow : chatConnected ? T.green : T.red}`,
              }} />
              <span style={{ fontSize:10.5, color:T.hint }}>
                {chatConnected === null ? 'Connecting…' : chatConnected ? 'Connected' : 'Offline'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setChatOpen(false)}
              style={{ marginLeft:'auto', background:'none', border:'none', cursor:'pointer', color:T.hint, padding:4, fontSize:16, lineHeight:1, display:'flex', alignItems:'center' }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
            </button>
          </div>

          {/* Quick action chips */}
          <div style={{
            padding:'8px 12px 6px',
            borderBottom:'1px solid rgba(255,255,255,0.05)',
            display:'flex', gap:6, overflowX:'auto', flexShrink:0,
          }}>
            {QUICK_ACTIONS.map(a => (
              <button
                key={a.label}
                type="button"
                onClick={() => setChatInput(a.prefix)}
                style={{
                  flexShrink:0,
                  fontSize:10.5, fontWeight:600, fontFamily:T.font,
                  padding:'4px 10px', borderRadius:20,
                  border:'1px solid rgba(10,147,211,0.3)',
                  background:'rgba(10,147,211,0.07)',
                  color: T.teal, cursor:'pointer',
                  whiteSpace:'nowrap',
                  transition:'all .15s',
                }}
              >
                {a.label}
              </button>
            ))}
          </div>

          {/* Message thread */}
          <div style={{ flex:1, overflowY:'auto', padding:'10px 12px', display:'flex', flexDirection:'column', gap:8 }}>
            {chatMsgs.map(msg => (
              <div key={msg.id} style={{
                display:'flex',
                justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
              }}>
                <div style={{
                  maxWidth:'86%',
                  padding:'9px 13px',
                  borderRadius: msg.role === 'user' ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                  background: msg.role === 'user'
                    ? 'rgba(10,147,211,0.14)'
                    : 'rgba(255,255,255,0.05)',
                  border: `1px solid ${msg.role === 'user' ? 'rgba(10,147,211,0.28)' : 'rgba(255,255,255,0.08)'}`,
                  fontSize:12.5, color:T.text, lineHeight:1.55,
                  animation:'toast-in .18s ease both',
                }}>
                  {msg.text}
                  {/* Change badge */}
                  {msg.role === 'assistant' && msg.changes && msg.changes.length > 0 && (
                    <div style={{
                      marginTop:6, fontSize:10.5, fontWeight:600,
                      color: msg.applied ? T.green : T.red,
                      display:'flex', alignItems:'center', gap:4,
                    }}>
                      <span>{msg.applied ? '✓' : '✗'}</span>
                      <span>
                        {msg.applied
                          ? `${msg.changes.length} change${msg.changes.length > 1 ? 's' : ''} applied`
                          : msg.error ?? 'Could not apply changes'}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {/* Typing indicator */}
            {chatBusy && (
              <div style={{ display:'flex', justifyContent:'flex-start' }}>
                <div style={{
                  padding:'10px 14px', borderRadius:'14px 14px 14px 4px',
                  background:'rgba(255,255,255,0.05)',
                  border:'1px solid rgba(255,255,255,0.08)',
                  display:'flex', gap:5, alignItems:'center',
                }}>
                  {[0,1,2].map(i => (
                    <div key={i} style={{
                      width:6, height:6, borderRadius:'50%',
                      background:T.teal,
                      animation:`chat-dot 1.2s ease-in-out ${i * 0.2}s infinite`,
                    }} />
                  ))}
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Input row */}
          <div style={{
            padding:'10px 12px 12px',
            borderTop:'1px solid rgba(255,255,255,0.06)',
            display:'flex', gap:8, alignItems:'flex-end',
            flexShrink:0,
          }}>
            <textarea
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendChatMessage(chatInput);
                }
              }}
              placeholder="Type a change… (Enter to send, Shift+Enter for newline)"
              rows={2}
              style={{
                flex:1, resize:'none', boxSizing:'border-box',
                background:'rgba(255,255,255,0.05)',
                border:`1.5px solid ${chatInput ? 'rgba(10,147,211,0.4)' : 'rgba(255,255,255,0.12)'}`,
                borderRadius:10, color:T.text, fontFamily:T.font,
                fontSize:12.5, lineHeight:1.5,
                padding:'8px 11px', outline:'none',
                transition:'border-color .15s',
              }}
            />
            <button
              type="button"
              onClick={() => sendChatMessage(chatInput)}
              disabled={!chatInput.trim() || chatBusy}
              style={{
                flexShrink:0, width:36, height:36, borderRadius:9,
                border:'none',
                background: !chatInput.trim() || chatBusy
                  ? 'rgba(255,255,255,0.06)'
                  : 'linear-gradient(135deg,#0a93d3,#0670a0)',
                color: !chatInput.trim() || chatBusy ? T.hint : '#fff',
                cursor: !chatInput.trim() || chatBusy ? 'default' : 'pointer',
                display:'flex', alignItems:'center', justifyContent:'center',
                transition:'all .15s',
                boxShadow: !chatInput.trim() || chatBusy ? 'none' : '0 2px 10px rgba(10,147,211,0.35)',
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>

          {/* Chat-internal toast */}
          {chatToast && (
            <div style={{
              position:'absolute', bottom:72, left:12, right:12,
              padding:'9px 14px', borderRadius:8,
              background: chatToast.ok ? 'rgba(34,197,94,0.1)' : 'rgba(229,0,38,0.1)',
              border:`1.5px solid ${chatToast.ok ? 'rgba(34,197,94,0.3)' : 'rgba(229,0,38,0.3)'}`,
              backdropFilter:'blur(10px)',
              color: chatToast.ok ? T.green : '#ff7070',
              fontSize:11.5, fontWeight:600,
              animation:'toast-in .2s ease',
              textAlign:'center',
            }}>
              {chatToast.msg}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
