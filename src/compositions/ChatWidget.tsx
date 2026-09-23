/**
 * ChatWidget — Floating chat bubble + draggable dialog for real-time video editing.
 * Studio-only: returns null during rendering (isStudio guard).
 *
 * Key architectural fix: ReactDOM.createPortal renders into document.body,
 * escaping Remotion Studio's CSS-transform container so position:fixed works
 * relative to the actual browser viewport — no more horizontal scrolling.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { useRemotionEnvironment, useVideoConfig } from 'remotion';
import { ThemeCtx, type ThemeTokens, getApiBase } from './ConfigPage';

const API = getApiBase();
const DW  = 480; // dialog width

// Friendly labels for the composition ids registered in src/Root.tsx.
// Several compositions share one React component but load different data
// files (see EDITABLE_COMPOSITIONS in automation/chat-service.ts) — showing
// the active one here confirms to the user which video is actually in scope.
const COMPOSITION_LABELS: Record<string, string> = {
  DemoVideo:                      'Demo Video',
  EnterpriseVideo:                'Enterprise Video',
  ManualRecordingEnterpriseVideo: 'Manual Recording Enterprise Video',
  TeaserVideo:                    'Teaser Video',
};

// ── Design tokens ────────────────────────────────────────────────────────────
// Chat-specific accents not present on the shared ConfigPage theme. `font` and
// `text`/`sub`/`hint`/`border`/`teal`/`green`/`red` come from ThemeCtx below so
// this widget always matches ConfigPage's font family and palette — falls back
// to DARK_TOKENS (ThemeCtx's default) if ever rendered outside its provider.
const CHAT_ACCENTS = {
  bg:         'rgba(8,16,30,0.98)',
  surface:    'rgba(255,255,255,0.045)',
  surfaceHov: 'rgba(255,255,255,0.09)',
  borderTeal: 'rgba(10,147,211,0.32)',
  tealLt:     '#5bc8f5',
  tealDim:    'rgba(10,147,211,0.13)',
  tealMid:    'rgba(10,147,211,0.22)',
  tealGlow:   'rgba(10,147,211,0.38)',
  amber:      '#f59e0b',
};

const KF = `
  @keyframes cw-rise  { from{opacity:0;transform:translateY(12px) scale(.97)} to{opacity:1;transform:none} }
  @keyframes cw-pop   { 0%{transform:scale(.75);opacity:0} 65%{transform:scale(1.08);opacity:1} 100%{transform:scale(1)} }
  @keyframes cw-msg   { from{opacity:0;transform:translateY(5px)} to{opacity:1;transform:none} }
  @keyframes cw-dot   { 0%,60%,100%{transform:scale(.5);opacity:.3} 30%{transform:scale(1);opacity:1} }
  @keyframes cw-ring  { 0%{transform:scale(1);opacity:.55} 100%{transform:scale(2.3);opacity:0} }
  @keyframes cw-spin  { to{transform:rotate(360deg)} }
  @keyframes cw-toast { from{opacity:0;transform:translateY(5px)} to{opacity:1;transform:none} }
  @keyframes cw-flash { 0%{opacity:0} 15%{opacity:1} 75%{opacity:1} 100%{opacity:0} }
`;

interface ChatOp     { op: string; path: string; value?: unknown; }
interface ChatMsg    { id: string; role: 'user'|'assistant'; text: string; changes?: ChatOp[]; applied?: boolean; error?: string; }
interface ChatResult { reply: string; changes: ChatOp[]; applied: boolean; error?: string; }
interface Pos        { x: number; y: number; }

const WELCOME: ChatMsg = {
  id: 'w0', role: 'assistant',
  text: "Hi! Tell me what to change in the video — title, narration, call to action, or any text — and I'll update the preview instantly.",
};

const EXAMPLE_PROMPTS = [
  'Change the opening title to "Transform Your Workflow"',
  'Rewrite scene 1 narration to focus on ROI benefits',
  'Update the call to action to "Book a Free Demo Today"',
];

const CHIPS = [
  {
    label: 'Opening title',
    prefix: 'Change the opening title to: ',
    icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  },
  {
    label: 'Scene narration',
    prefix: 'Rewrite narration for scene 1 to: ',
    icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  },
  {
    label: 'Call to action',
    prefix: 'Change the call to action to: ',
    icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  },
  {
    label: 'Benefit bullet',
    prefix: 'Update benefit bullet 1 to: ',
    icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  },
];

// ── Avatars ────────────────────────────────────────────────────────────────────
type ChatTheme = ThemeTokens & typeof CHAT_ACCENTS;

const AiAvatar = ({ C }: { C: ChatTheme }) => (
  <div style={{ width:32, height:32, borderRadius:'50%', flexShrink:0, marginTop:2, background:`linear-gradient(135deg,${C.teal},#0670a0)`, display:'flex', alignItems:'center', justifyContent:'center', boxShadow:`0 0 10px ${C.tealGlow}` }}>
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
      <path d="M12 2a2 2 0 012 2v1h3a2 2 0 012 2v10a2 2 0 01-2 2H7a2 2 0 01-2-2V7a2 2 0 012-2h3V4a2 2 0 012-2z" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx="9" cy="11" r="1.2" fill="#fff"/>
      <circle cx="15" cy="11" r="1.2" fill="#fff"/>
      <path d="M9 15s1 1.5 3 1.5 3-1.5 3-1.5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  </div>
);

const UserAvatar = ({ C }: { C: ChatTheme }) => (
  <div style={{ width:32, height:32, borderRadius:'50%', flexShrink:0, marginTop:2, background:'rgba(255,255,255,0.08)', border:'1px solid rgba(255,255,255,0.14)', display:'flex', alignItems:'center', justifyContent:'center' }}>
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="7" r="4" stroke={C.sub} strokeWidth="1.8"/>
      <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke={C.sub} strokeWidth="1.8" strokeLinecap="round"/>
    </svg>
  </div>
);

// ── Main component ─────────────────────────────────────────────────────────────
export const ChatWidget: React.FC = () => {
  const { isStudio } = useRemotionEnvironment();
  const { id: compositionId } = useVideoConfig();
  const theme = React.useContext(ThemeCtx);
  const C: ChatTheme = { ...theme, ...CHAT_ACCENTS };

  const [open,      setOpen]      = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [msgs,      setMsgs]      = useState<ChatMsg[]>([WELCOME]);
  const [input,     setInput]     = useState('');
  const [busy,      setBusy]      = useState(false);
  const [connected, setConnected] = useState<boolean|null>(null);
  const [toast,     setToast]     = useState<{msg:string;ok:boolean}|null>(null);
  const [chipHint,  setChipHint]  = useState(false);
  const [flash,     setFlash]     = useState(false);
  const [hovChip,   setHovChip]   = useState<number|null>(null);
  const [hovPrompt, setHovPrompt] = useState<number|null>(null);

  // Drag: dialogPos = undefined means "use bottom/right CSS anchor"
  const [dialogPos, setDialogPos] = useState<Pos|undefined>(undefined);
  const [dragging,  setDragging]  = useState(false);
  const dragOff  = useRef<Pos>({ x:0, y:0 });
  const dialogRef = useRef<HTMLDivElement>(null);
  const endRef    = useRef<HTMLDivElement>(null);
  const taRef     = useRef<HTMLTextAreaElement>(null);

  // ── Inject keyframes into document.head ────────────────────────────────────
  useEffect(() => {
    if (!isStudio) return;
    if (document.querySelector('style[data-cw]')) return;
    const el = document.createElement('style');
    el.setAttribute('data-cw', '1');
    el.textContent = KF;
    document.head.appendChild(el);
  }, [isStudio]);

  // ── Keyboard shortcut Ctrl/Cmd+Shift+C ─────────────────────────────────────
  useEffect(() => {
    if (!isStudio) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'C') {
        e.preventDefault();
        setOpen(o => !o);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isStudio]);

  // ── Drag mousemove / mouseup ────────────────────────────────────────────────
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const nx = Math.max(8, Math.min(window.innerWidth  - DW - 8, e.clientX - dragOff.current.x));
      const ny = Math.max(8, Math.min(window.innerHeight - 48,     e.clientY - dragOff.current.y));
      setDialogPos({ x: nx, y: ny });
    };
    const onUp = () => setDragging(false);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    };
  }, [dragging]);

  // ── Status check ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    setConnected(null);
    fetch(`${API}/api/chat/status?compositionId=${encodeURIComponent(compositionId)}`)
      .then(r => r.json())
      .then((d: { ok: boolean }) => setConnected(d.ok))
      .catch(() => setConnected(false));
  }, [open, compositionId]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior:'smooth' }); }, [msgs, busy]);
  useEffect(() => { if (open && !minimized) setTimeout(() => taRef.current?.focus(), 120); }, [open, minimized]);

  const showToast = useCallback((msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const triggerFlash = useCallback(() => {
    setFlash(true);
    setTimeout(() => setFlash(false), 750);
  }, []);

  const send = useCallback(async (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    setMsgs(p => [...p, { id:`u${Date.now()}`, role:'user', text:t }]);
    setInput(''); setChipHint(false); setBusy(true);
    try {
      const res  = await fetch(`${API}/api/chat`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ message: t, compositionId }),
      });
      const data = await res.json() as ChatResult;
      setMsgs(p => [...p, { id:`a${Date.now()}`, role:'assistant',
        text:data.reply, changes:data.changes, applied:data.applied, error:data.error }]);
      if (data.applied && data.changes?.length > 0) {
        showToast(`${data.changes.length} change${data.changes.length>1?'s':''} applied — preview updating…`);
        triggerFlash();
      } else if (data.error) {
        showToast(data.error, false);
      }
    } catch {
      setMsgs(p => [...p, { id:`e${Date.now()}`, role:'assistant',
        text:'Could not reach config server. Make sure npm run dev is running.' }]);
    } finally { setBusy(false); }
  }, [busy, showToast, triggerFlash, compositionId]);

  // Read actual DOM position at drag start — works regardless of CSS anchor mode
  const onDragStart = useCallback((e: React.MouseEvent) => {
    const rect = dialogRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragOff.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    setDialogPos({ x: rect.left, y: rect.top });
    setDragging(true);
    e.preventDefault();
  }, []);

  // ── Guard — must be after all hooks ────────────────────────────────────────
  if (!isStudio) return null;

  const dotColor = connected === null ? C.amber : connected ? C.green : C.red;
  const dotLabel = connected === null ? 'Connecting…' : connected ? 'Connected' : 'Offline';
  const unread   = msgs.filter(m => m.role==='assistant' && m.id!=='w0').length;
  const isEmpty  = msgs.length === 1 && !busy;

  // Dialog CSS position: bottom/right anchor by default; switches to top/left after first drag
  const dialogPosStyle: React.CSSProperties = dialogPos
    ? { top: dialogPos.y, left: dialogPos.x }
    : { bottom: 104, right: 28 };

  // ── Portal content — rendered into document.body, outside Remotion transform ─
  const portalContent = (
    <>
      {/* Viewport flash on apply */}
      {flash && (
        <div style={{
          position:'fixed', inset:0, zIndex:2147483640, pointerEvents:'none',
          border:`3px solid ${C.green}`, borderRadius:4,
          boxShadow:`inset 0 0 48px rgba(34,197,94,0.1), 0 0 40px rgba(34,197,94,0.15)`,
          animation:'cw-flash .75s ease both',
        }}/>
      )}

      {/* Floating bubble */}
      <div style={{ position:'fixed', bottom:28, right:28, zIndex:2147483646 }}>
        {!open && (
          <div className="cfg-anim-decorative" style={{
            position:'absolute', inset:-2, borderRadius:'50%',
            border:`2px solid ${C.teal}`,
            animation:'cw-ring 2.6s ease-out infinite',
            pointerEvents:'none',
          }}/>
        )}
        <button type="button"
          onClick={() => setOpen(o => !o)}
          title={`${open ? 'Close' : 'Open'} Video Editor  (Ctrl+Shift+C)`}
          style={{
            width:58, height:58, borderRadius:'50%', border:'none',
            background:'linear-gradient(145deg,#1190d0,#0670a0)',
            boxShadow: open
              ? `0 2px 16px ${C.tealGlow}, 0 0 0 2px rgba(10,147,211,0.28)`
              : `0 6px 24px ${C.tealGlow}, 0 2px 8px rgba(0,0,0,0.5)`,
            cursor:'pointer',
            display:'flex', alignItems:'center', justifyContent:'center',
            transform: open ? 'scale(0.9) rotate(8deg)' : 'scale(1)',
            transition:'transform .18s ease, box-shadow .18s ease',
            animation:'cw-pop .35s cubic-bezier(.34,1.56,.64,1) both',
          }}>
          {open
            ? <svg width="20" height="20" viewBox="0 0 18 18" fill="none"><path d="M2.5 2.5l13 13M15.5 2.5l-13 13" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"/></svg>
            : <svg width="25" height="25" viewBox="0 0 24 24" fill="none">
                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <circle cx="8.5"  cy="10" r="1.1" fill="#fff"/>
                <circle cx="12"   cy="10" r="1.1" fill="#fff"/>
                <circle cx="15.5" cy="10" r="1.1" fill="#fff"/>
              </svg>
          }
        </button>
        {!open && unread > 0 && (
          <div style={{
            position:'absolute', top:-4, right:-4,
            width:22, height:22, borderRadius:'50%',
            background:C.red, border:'2px solid #08101e',
            display:'flex', alignItems:'center', justifyContent:'center',
            ...C.type.fieldLabel, fontWeight:700, color:'#fff', fontFamily:C.font,
          }}>
            {unread > 9 ? '9+' : unread}
          </div>
        )}
      </div>

      {/* Dialog */}
      {open && (
        <div
          ref={dialogRef}
          style={{
            position:'fixed', ...dialogPosStyle, width:DW,
            background:C.bg,
            backdropFilter:'blur(28px)',
            border:`1px solid ${C.borderTeal}`,
            borderRadius:16,
            display:'flex', flexDirection:'column',
            boxShadow:'0 24px 64px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.04)',
            animation:'cw-rise .22s cubic-bezier(.4,0,.2,1) both',
            overflow:'hidden',
            fontFamily:C.font,
            zIndex:2147483645,
            userSelect: dragging ? 'none' : 'auto',
          }}>

          {/* ── Header / drag handle ─────────────────────────────────────── */}
          <div
            onMouseDown={onDragStart}
            style={{
              padding:'13px 14px',
              background:'linear-gradient(135deg,rgba(10,147,211,0.14),rgba(6,112,160,0.04))',
              borderBottom: minimized ? 'none' : `1px solid ${C.borderTeal}`,
              display:'flex', alignItems:'center', gap:10,
              cursor: dragging ? 'grabbing' : 'grab',
            }}>

            {/* Icon */}
            <div style={{
              width:36, height:36, borderRadius:10, flexShrink:0,
              background:`linear-gradient(135deg,${C.teal},#0670a0)`,
              display:'flex', alignItems:'center', justifyContent:'center',
              boxShadow:`0 3px 12px ${C.tealGlow}`,
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>

            {/* Title + status */}
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ ...C.type.h3, color:C.text, lineHeight:1.2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {COMPOSITION_LABELS[compositionId] ?? compositionId}
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:5, marginTop:2 }}>
                <div style={{ width:6, height:6, borderRadius:'50%', flexShrink:0, background:dotColor, boxShadow:`0 0 5px ${dotColor}` }}/>
                <span style={{ ...C.type.body, color:C.sub }}>{dotLabel}</span>
              </div>
            </div>

            {/* Grip dots */}
            <div style={{ color:C.hint, flexShrink:0 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                <circle cx="9"  cy="5"  r="1.5" fill="currentColor"/>
                <circle cx="15" cy="5"  r="1.5" fill="currentColor"/>
                <circle cx="9"  cy="12" r="1.5" fill="currentColor"/>
                <circle cx="15" cy="12" r="1.5" fill="currentColor"/>
                <circle cx="9"  cy="19" r="1.5" fill="currentColor"/>
                <circle cx="15" cy="19" r="1.5" fill="currentColor"/>
              </svg>
            </div>

            {/* Clear */}
            <button type="button" title="Clear history"
              onClick={(e) => { e.stopPropagation(); setMsgs([WELCOME]); }}
              style={{ background:'none', border:'none', cursor:'pointer', color:C.hint, padding:'4px 7px', borderRadius:6, display:'flex', alignItems:'center', ...C.type.body, fontFamily:C.font, gap:4 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Clear
            </button>

            {/* Minimize */}
            <button type="button" title={minimized ? 'Expand' : 'Minimize'}
              onClick={(e) => { e.stopPropagation(); setMinimized(m => !m); }}
              style={{ background:'none', border:'none', cursor:'pointer', color:C.hint, padding:6, borderRadius:6, display:'flex', alignItems:'center' }}>
              {minimized
                ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M5 15l7-7 7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                : <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M5 9l7 7 7-7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              }
            </button>

            {/* Close */}
            <button type="button" title="Close (Ctrl+Shift+C)"
              onClick={(e) => { e.stopPropagation(); setOpen(false); }}
              style={{ background:'none', border:'none', cursor:'pointer', color:C.hint, padding:6, borderRadius:6, display:'flex', alignItems:'center' }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M1.5 1.5l11 11M12.5 1.5l-11 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </button>
          </div>

          {!minimized && (
            <>
              {/* ── Chips ──────────────────────────────────────────────────── */}
              <div style={{ padding:'10px 14px 8px', borderBottom:`1px solid rgba(255,255,255,0.06)` }}>
                <div style={{ ...C.type.label, color:C.hint, marginBottom:7 }}>
                  Quick edits
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:7 }}>
                  {CHIPS.map((c,i) => (
                    <button key={c.label} type="button"
                      onMouseEnter={() => setHovChip(i)}
                      onMouseLeave={() => setHovChip(null)}
                      onClick={() => { setInput(c.prefix); setChipHint(true); setTimeout(()=>taRef.current?.focus(),40); }}
                      style={{
                        ...C.type.body, fontFamily:C.font,
                        padding:'9px 11px', borderRadius:9, textAlign:'left',
                        border:`1px solid ${hovChip===i ? C.teal : C.borderTeal}`,
                        borderLeft:`3px solid ${C.teal}`,
                        background: hovChip===i ? C.tealMid : C.tealDim,
                        color: hovChip===i ? C.tealLt : C.teal,
                        cursor:'pointer',
                        display:'flex', alignItems:'center', gap:6,
                        transition:'all .12s',
                        overflow:'hidden',
                      }}>
                      <span style={{ flexShrink:0, opacity:.8 }}>{c.icon}</span>
                      <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{c.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Messages ───────────────────────────────────────────────── */}
              <div style={{
                flex:1, overflowY:'auto', padding:'12px 14px',
                display:'flex', flexDirection:'column', gap:12,
                minHeight:160, maxHeight:300,
              }}>
                {msgs.map(m => (
                  <div key={m.id} style={{
                    display:'flex',
                    flexDirection: m.role==='user' ? 'row-reverse' : 'row',
                    gap:9, alignItems:'flex-start',
                    animation:'cw-msg .2s ease both',
                  }}>
                    {m.role==='assistant' ? <AiAvatar C={C}/> : <UserAvatar C={C}/>}
                    <div style={{
                      maxWidth:'80%',
                      padding:'10px 13px',
                      borderRadius: m.role==='user' ? '14px 4px 14px 14px' : '4px 14px 14px 14px',
                      background: m.role==='user' ? 'rgba(10,147,211,0.16)' : C.surface,
                      border:`1px solid ${m.role==='user' ? C.borderTeal : C.border}`,
                      ...C.type.bodyLg, fontWeight:400, color:C.text, lineHeight:1.65,
                    }}>
                      <div>{m.text}</div>
                      {m.role==='assistant' && m.changes && m.changes.length>0 && (
                        <div style={{
                          display:'inline-flex', alignItems:'center', gap:5,
                          marginTop:8, padding:'3px 9px', borderRadius:20,
                          background: m.applied ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                          border:`1px solid ${m.applied ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
                          ...C.type.fieldLabel,
                          color: m.applied ? C.green : C.red,
                        }}>
                          <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                            {m.applied
                              ? <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                              : <path d="M2 2l8 8M10 2L2 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>}
                          </svg>
                          {m.applied
                            ? `${m.changes.length} change${m.changes.length>1?'s':''} applied`
                            : m.error ? `Failed: ${m.error.slice(0,36)}` : 'Could not apply'}
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {/* Empty state */}
                {isEmpty && (
                  <div style={{ display:'flex', flexDirection:'column', gap:6, marginTop:2 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:7 }}>
                      <div style={{ flex:1, height:1, background:'rgba(255,255,255,0.07)' }}/>
                      <span style={{ ...C.type.caption, color:C.hint }}>Try an example</span>
                      <div style={{ flex:1, height:1, background:'rgba(255,255,255,0.07)' }}/>
                    </div>
                    {EXAMPLE_PROMPTS.map((p,i) => (
                      <button key={i} type="button"
                        onMouseEnter={() => setHovPrompt(i)}
                        onMouseLeave={() => setHovPrompt(null)}
                        onClick={() => send(p)}
                        style={{
                          background: hovPrompt===i ? C.surfaceHov : C.surface,
                          border:`1px solid ${hovPrompt===i ? C.borderTeal : C.border}`,
                          borderRadius:9, padding:'8px 12px',
                          color: hovPrompt===i ? C.tealLt : C.sub,
                          ...C.type.body, fontFamily:C.font, textAlign:'left',
                          cursor:'pointer', transition:'all .13s',
                          display:'flex', alignItems:'center', gap:7,
                        }}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" style={{ flexShrink:0, opacity:.5 }}>
                          <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>"{p}"</span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Typing dots */}
                {busy && (
                  <div style={{ display:'flex', gap:9, alignItems:'flex-start', animation:'cw-msg .2s ease both' }}>
                    <AiAvatar C={C}/>
                    <div style={{ padding:'12px 15px', borderRadius:'4px 14px 14px 14px', background:C.surface, border:`1px solid ${C.border}`, display:'flex', gap:5, alignItems:'center' }}>
                      {[0,1,2].map(i=>(
                        <div key={i} style={{ width:7, height:7, borderRadius:'50%', background:C.teal, animation:`cw-dot 1.3s ease ${i*0.22}s infinite` }}/>
                      ))}
                    </div>
                  </div>
                )}
                <div ref={endRef}/>
              </div>

              {/* ── Input ──────────────────────────────────────────────────── */}
              <div style={{ padding:'9px 14px 13px', borderTop:`1px solid rgba(255,255,255,0.07)`, background:'rgba(0,0,0,0.2)' }}>
                {chipHint && input && (
                  <div style={{ ...C.type.body, color:C.teal, marginBottom:6, display:'flex', alignItems:'center', gap:4 }}>
                    <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.5"/><path d="M6 5v4M6 4h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                    Complete the prompt, then press Enter to send
                  </div>
                )}
                <div style={{ display:'flex', gap:8, alignItems:'flex-end' }}>
                  <textarea
                    ref={taRef}
                    value={input}
                    onChange={e => { setInput(e.target.value); if (!e.target.value) setChipHint(false); }}
                    onKeyDown={e => { if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); send(input); }}}
                    placeholder="Ask me to edit the video… (Enter to send)"
                    rows={2}
                    style={{
                      flex:1, resize:'none', boxSizing:'border-box',
                      background:'rgba(255,255,255,0.055)',
                      border:`1.5px solid ${input ? C.borderTeal : 'rgba(255,255,255,0.1)'}`,
                      borderRadius:11, color:C.text, fontFamily:C.font,
                      ...C.type.bodyLg, fontWeight:400, lineHeight:1.6,
                      padding:'9px 12px', outline:'none',
                      transition:'border-color .15s, box-shadow .15s',
                      boxShadow: input ? `0 0 0 3px rgba(10,147,211,0.11)` : 'none',
                    }}
                  />
                  <button type="button" onClick={() => send(input)}
                    disabled={!input.trim() || busy} title="Send (Enter)"
                    style={{
                      flexShrink:0, width:42, height:42, borderRadius:11, border:'none',
                      background: input.trim() && !busy
                        ? `linear-gradient(135deg,${C.teal},#0670a0)`
                        : 'rgba(255,255,255,0.06)',
                      color: input.trim() && !busy ? '#fff' : C.hint,
                      cursor: input.trim() && !busy ? 'pointer' : 'default',
                      display:'flex', alignItems:'center', justifyContent:'center',
                      transition:'all .2s cubic-bezier(.34,1.56,.64,1)',
                      boxShadow: input.trim() && !busy ? `0 3px 14px ${C.tealGlow}` : 'none',
                      transform: input.trim() && !busy ? 'scale(1)' : 'scale(0.86)',
                    }}>
                    {busy
                      ? <div style={{ width:16, height:16, borderRadius:'50%', border:'2px solid rgba(255,255,255,0.2)', borderTopColor:'#fff', animation:'cw-spin .7s linear infinite' }}/>
                      : <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    }
                  </button>
                </div>
                <div style={{ marginTop:6, ...C.type.body, color:C.hint, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <span>Shift+Enter for new line</span>
                  <span style={{ display:'flex', alignItems:'center', gap:3 }}>
                    <span style={{ padding:'1px 5px', borderRadius:4, border:'1px solid rgba(255,255,255,0.12)', ...C.type.caption, color:C.sub }}>Enter</span>
                    to send
                  </span>
                </div>
              </div>

              {/* Toast */}
              {toast && (
                <div role="status" aria-live="polite" aria-atomic="true" style={{
                  position:'absolute', bottom:72, left:10, right:10,
                  padding:'9px 13px', borderRadius:9,
                  background: toast.ok ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
                  border:`1px solid ${toast.ok ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)'}`,
                  backdropFilter:'blur(10px)',
                  color: toast.ok ? C.green : C.red,
                  ...C.type.fieldLabel, textAlign:'center',
                  animation:'cw-toast .2s ease', pointerEvents:'none',
                }}>
                  {toast.ok ? '✓ ' : '✗ '}{toast.msg}
                </div>
              )}
            </>
          )}

          {/* Caret arrow — only in default bottom-right position */}
          {!dialogPos && !minimized && (
            <div style={{ position:'absolute', bottom:-8, right:38, width:16, height:9, overflow:'hidden', pointerEvents:'none' }}>
              <div style={{ width:14, height:14, background:C.bg, border:`1px solid ${C.borderTeal}`, borderRadius:2, transform:'rotate(45deg)', margin:'-4px auto 0' }}/>
            </div>
          )}
        </div>
      )}
    </>
  );

  // ── Portal into document.body — escapes Remotion's CSS-transform container ──
  return ReactDOM.createPortal(portalContent, document.body);
};
