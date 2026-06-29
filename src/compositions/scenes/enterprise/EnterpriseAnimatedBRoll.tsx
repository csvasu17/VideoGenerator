/**
 * EnterpriseAnimatedBRoll — 5 IoT-domain motion graphic scenes for Act 1.
 *
 * Each animationType is a self-contained 12-second Remotion animation built
 * from SVG + React. Configure via demo-package.json brollScenes[].animationType.
 *
 * Types:
 *   iot-network   — device nodes appearing + animated connection edges + data packets
 *   data-stream   — live waveform + bar chart + KPI counters
 *   alert-cascade — severity-coded alert cards sliding in from right
 *   ai-prediction — radar scanner + neural network pulse + prediction result
 *   global-fleet  — world map dots appearing + fleet stats counting up
 */

import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { FONT_STACK } from '../../tokens';

export type BRollAnimationType =
  // ── IoT / device management ──────────────────────────────────────────────
  | 'iot-network'
  | 'data-stream'
  | 'alert-cascade'
  | 'ai-prediction'
  | 'global-fleet'
  // ── Helpdesk / ticket management ─────────────────────────────────────────
  | 'ticket-flood'
  | 'sla-breach'
  | 'multi-channel'
  | 'ai-triage'
  | 'kpi-metrics'
  // ── Prior Authorization / Healthcare RCM ─────────────────────────────────
  | 'pa-intake'
  | 'clinical-nlp'
  | 'policy-engine'
  | 'auth-pipeline'
  | 'rcm-kpi';

export interface EnterpriseAnimatedBRollProps {
  animationType: BRollAnimationType;
  subtitle:      string;
  index:         number;
  total:         number;
}

const W = 1920;
const H = 1080;

// ─────────────────────────────────────────────────────────────────────────────
// Scene 1: IoT Network — nodes appear, connect, data packets travel
// ─────────────────────────────────────────────────────────────────────────────

interface NodeDef { x: number; y: number; delay: number; color: string; r: number; label: string }
interface EdgeDef { a: number; b: number }

const NET_NODES: NodeDef[] = [
  { x: 960,  y: 460, delay:  0, color: '#0a93d3', r: 44, label: 'HUB'      },
  { x: 310,  y: 220, delay: 12, color: '#059669', r: 28, label: 'GATEWAY'  },
  { x: 670,  y: 160, delay: 18, color: '#0a93d3', r: 26, label: 'SENSOR'   },
  { x: 1290, y: 180, delay: 15, color: '#f59e0b', r: 28, label: 'DEVICE'   },
  { x: 1610, y: 320, delay: 24, color: '#059669', r: 26, label: 'SENSOR'   },
  { x: 1680, y: 680, delay: 28, color: '#0a93d3', r: 24, label: 'MONITOR'  },
  { x: 1300, y: 830, delay: 22, color: '#ef4444', r: 28, label: 'ALERT'    },
  { x: 670,  y: 820, delay: 20, color: '#059669', r: 26, label: 'SENSOR'   },
  { x: 230,  y: 720, delay: 16, color: '#0a93d3', r: 24, label: 'GATEWAY'  },
  { x: 160,  y: 440, delay: 10, color: '#f59e0b', r: 26, label: 'DEVICE'   },
];

const NET_EDGES: EdgeDef[] = [
  { a: 0, b: 1 }, { a: 0, b: 2 }, { a: 0, b: 3 }, { a: 0, b: 4 },
  { a: 0, b: 5 }, { a: 0, b: 6 }, { a: 0, b: 7 }, { a: 0, b: 8 },
  { a: 0, b: 9 }, { a: 1, b: 9 }, { a: 1, b: 2 }, { a: 3, b: 4 }, { a: 6, b: 7 },
];

function IoTNetworkScene({ frame, fps }: { frame: number; fps: number }) {
  return (
    <svg width={W} height={H} style={{ position: 'absolute', inset: 0 }} viewBox={`0 0 ${W} ${H}`}>
      <defs>
        <radialGradient id="hubGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#0a93d3" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#0a93d3" stopOpacity="0" />
        </radialGradient>
        <pattern id="ngrid" width="80" height="80" patternUnits="userSpaceOnUse">
          <path d="M 80 0 L 0 0 0 80" fill="none" stroke="rgba(10,147,211,0.07)" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="url(#ngrid)" />

      {/* Hub glow */}
      <circle cx={NET_NODES[0].x} cy={NET_NODES[0].y} r={200} fill="url(#hubGlow)" />

      {/* Edges */}
      {NET_EDGES.map(({ a, b }, i) => {
        const na = NET_NODES[a];
        const nb = NET_NODES[b];
        const len = Math.sqrt((nb.x - na.x) ** 2 + (nb.y - na.y) ** 2);
        const startF = Math.max(na.delay, nb.delay) + 20;
        const offset = interpolate(frame, [startF, startF + 35], [len, 0], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
        });
        const lineOpacity = interpolate(frame, [startF, startF + 20], [0, 0.38], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
        });
        // Animated data packet
        const pCycle = 110;
        const pF = (frame - startF - 35) % pCycle;
        const pT = Math.max(0, Math.min(1, pF / (pCycle * 0.75)));
        const px = na.x + (nb.x - na.x) * pT;
        const py = na.y + (nb.y - na.y) * pT;
        const showPacket = frame > startF + 35 && pF >= 0 && pF < pCycle * 0.75;
        return (
          <g key={i}>
            <line
              x1={na.x} y1={na.y} x2={nb.x} y2={nb.y}
              stroke={na.color} strokeWidth="1.5"
              strokeDasharray={`${len}`} strokeDashoffset={`${offset}`}
              opacity={lineOpacity}
            />
            {showPacket && (
              <circle cx={px} cy={py} r={5} fill={na.color} opacity={0.9} />
            )}
          </g>
        );
      })}

      {/* Nodes */}
      {NET_NODES.map((node, i) => {
        const scale = spring({ frame: Math.max(0, frame - node.delay), fps, config: { damping: 16, stiffness: 90 } });
        const pPhase = Math.max(0, frame - node.delay - 30) % 90 / 90;
        const pr = node.r + pPhase * node.r * 1.6;
        const po = Math.max(0, interpolate(pPhase, [0, 0.4, 1], [0.5, 0.15, 0]));
        return (
          <g key={i} transform={`translate(${node.x},${node.y}) scale(${scale})`}>
            {frame > node.delay + 30 && (
              <circle r={pr} fill="none" stroke={node.color} strokeWidth="1.5" opacity={po} />
            )}
            <circle r={node.r} fill={`${node.color}22`} stroke={node.color} strokeWidth="2" />
            <circle r={node.r * 0.45} fill={node.color} opacity={0.9} />
            {scale > 0.7 && (
              <text textAnchor="middle" y={node.r + 18}
                fill="rgba(255,255,255,0.55)" fontSize={11} fontFamily={FONT_STACK} fontWeight={600}>
                {node.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scene 2: Data Stream — waveform + bar chart + KPI counters
// ─────────────────────────────────────────────────────────────────────────────

const DS_BARS = [0.82, 0.65, 0.90, 0.45, 0.78, 0.55, 0.88, 0.70, 0.92, 0.60, 0.75, 0.85, 0.50, 0.93];
const DS_STATS = [
  { label: 'Active Devices', val: 2847 },
  { label: 'Uptime',         val: 99.2, decimals: 1, suffix: '%' },
  { label: 'Alerts Today',   val: 14   },
  { label: 'Sites Online',   val: 24   },
];

function DataStreamScene({ frame }: { frame: number }) {
  return (
    <svg width={W} height={H} style={{ position: 'absolute', inset: 0 }} viewBox={`0 0 ${W} ${H}`}>
      {/* Waveform rows */}
      {[0, 1, 2].map(row => {
        const pts = Array.from({ length: 100 }, (_, k) => {
          const x = (k / 99) * W;
          const phase = frame * 0.042 + row * 0.9 + k * 0.14;
          const y = H * 0.42 + row * 72 + Math.sin(phase) * (30 - row * 6);
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        }).join(' ');
        const colors  = ['#0a93d3', '#059669', '#f59e0b'];
        const widths  = [2.5, 1.8, 1.2];
        const opacitys = [0.55, 0.35, 0.20];
        return (
          <polyline key={row} points={pts} fill="none"
            stroke={colors[row]} strokeWidth={widths[row]} opacity={opacitys[row]} />
        );
      })}

      {/* Bar chart */}
      {DS_BARS.map((h, i) => {
        const maxH = 200;
        const barW = 56;
        const gap  = 76;
        const startX = W * 0.08 + i * gap;
        const barH = interpolate(frame, [18 + i * 4, 60 + i * 4], [0, h * maxH], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
        });
        const color = h > 0.8 ? '#0a93d3' : h > 0.6 ? '#059669' : '#f59e0b';
        return (
          <g key={i}>
            <rect x={startX} y={H * 0.68 - barH} width={barW} height={barH}
              fill={color} opacity={0.65} rx={4} />
            <rect x={startX} y={H * 0.68 - barH} width={barW} height={5}
              fill={color} rx={2} />
          </g>
        );
      })}

      {/* Base line */}
      <line x1={W * 0.08} y1={H * 0.68} x2={W * 0.92} y2={H * 0.68}
        stroke="rgba(255,255,255,0.1)" strokeWidth="1" />

      {/* KPI cards */}
      {DS_STATS.map((stat, i) => {
        const cur = interpolate(frame, [28, 160], [0, stat.val], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
        });
        const display = stat.decimals
          ? cur.toFixed(1) + (stat.suffix ?? '')
          : Math.round(cur).toLocaleString() + (stat.suffix ?? '');
        const cardX = W * 0.10 + i * (W * 0.215);
        const cardOpacity = interpolate(frame, [8 + i * 10, 28 + i * 10], [0, 1], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
        });
        return (
          <g key={i} opacity={cardOpacity}>
            <rect x={cardX - 100} y={H * 0.80} width={200} height={108}
              fill="rgba(10,147,211,0.10)" stroke="rgba(10,147,211,0.28)" strokeWidth="1" rx={10} />
            <text x={cardX} y={H * 0.80 + 56} textAnchor="middle"
              fill="#ffffff" fontSize={36} fontWeight={700} fontFamily={FONT_STACK}>
              {display}
            </text>
            <text x={cardX} y={H * 0.80 + 84} textAnchor="middle"
              fill="rgba(255,255,255,0.5)" fontSize={14} fontFamily={FONT_STACK}>
              {stat.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scene 3: Alert Cascade — severity cards slide in from right
// ─────────────────────────────────────────────────────────────────────────────

const ALERTS = [
  { title: 'Temperature Critical',    loc: 'Site 7 — Unit 12A',      sev: 'CRITICAL', delay:  8, color: '#ef4444' },
  { title: 'Motor Vibration High',    loc: 'Site 3 — Pump Station',  sev: 'WARNING',  delay: 28, color: '#f59e0b' },
  { title: 'Connectivity Lost',       loc: 'Site 12 — Sensor 04',    sev: 'CRITICAL', delay: 48, color: '#ef4444' },
  { title: 'Predictive Maintenance',  loc: 'Site 1 — Compressor B',  sev: 'WARNING',  delay: 66, color: '#f59e0b' },
  { title: 'Flow Rate Anomaly',       loc: 'Site 9 — Zone B',        sev: 'INFO',     delay: 84, color: '#0a93d3' },
];

function AlertCascadeScene({ frame, fps }: { frame: number; fps: number }) {
  const alertsVisible = ALERTS.filter(a => frame > a.delay + 22).length;
  return (
    <svg width={W} height={H} style={{ position: 'absolute', inset: 0 }} viewBox={`0 0 ${W} ${H}`}>
      {/* Central fault icon */}
      <g transform={`translate(${W * 0.28}, ${H * 0.46})`}>
        <circle r={96} fill="rgba(239,68,68,0.07)" stroke="rgba(239,68,68,0.25)" strokeWidth="1.5" />
        <circle
          r={96 + interpolate(frame % 80, [0, 40, 80], [0, 36, 0])}
          fill="none" stroke="rgba(239,68,68,0.12)" strokeWidth="1.5"
        />
        <circle r={62} fill="rgba(239,68,68,0.12)" stroke="rgba(239,68,68,0.45)" strokeWidth="2" />
        <text textAnchor="middle" y={16} fill="#ef4444" fontSize={52} fontFamily="monospace">!</text>
        <text textAnchor="middle" y={52} fill="rgba(255,255,255,0.45)" fontSize={13}
          fontFamily={FONT_STACK} fontWeight={600} letterSpacing="1.5">
          DEVICE FAULT
        </text>
      </g>

      {/* Alert count badge */}
      {alertsVisible > 0 && (
        <g transform={`translate(${W * 0.28 + 66}, ${H * 0.46 - 86})`}>
          <circle r={30} fill="#ef4444" />
          <text textAnchor="middle" y={10} fill="#ffffff" fontSize={24} fontWeight={700}
            fontFamily={FONT_STACK}>
            {alertsVisible}
          </text>
        </g>
      )}

      {/* Alert cards */}
      {ALERTS.map((alert, i) => {
        const slideX = interpolate(frame, [alert.delay, alert.delay + 26], [340, 0], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
        });
        const cardOpacity = interpolate(frame, [alert.delay, alert.delay + 22], [0, 1], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
        });
        const cx = W * 0.50;
        const cy = H * 0.19 + i * 136;
        const cw = 660;
        const ch = 116;

        return (
          <g key={i} opacity={cardOpacity} transform={`translate(${slideX}, 0)`}>
            <rect x={cx} y={cy} width={cw} height={ch}
              fill="rgba(8,15,36,0.88)" stroke={alert.color} strokeWidth="1.5" rx={10} />
            <rect x={cx} y={cy} width={5} height={ch}
              fill={alert.color} rx={3} />
            <text x={cx + 28} y={cy + 38} fill={alert.color} fontSize={13} fontWeight={700}
              fontFamily={FONT_STACK} letterSpacing="1.8">
              {alert.sev}
            </text>
            <text x={cx + 28} y={cy + 66} fill="#ffffff" fontSize={22} fontWeight={600}
              fontFamily={FONT_STACK}>
              {alert.title}
            </text>
            <text x={cx + 28} y={cy + 92} fill="rgba(255,255,255,0.48)" fontSize={14}
              fontFamily={FONT_STACK}>
              {alert.loc}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scene 4: AI Prediction — radar scan + neural network pulse
// ─────────────────────────────────────────────────────────────────────────────

const NN_LAYERS: { x: number; y: number }[][] = [
  [{ x: -340, y: -120 }, { x: -340, y: 0 }, { x: -340, y: 120 }],
  [{ x: -150, y: -160 }, { x: -150, y: -53 }, { x: -150, y: 53 }, { x: -150, y: 160 }],
  [{ x:  100, y: -80  }, { x:  100, y: 0   }, { x:  100, y: 80  }],
  [{ x:  310, y: -40  }, { x:  310, y: 40  }],
];
const NN_ALL = NN_LAYERS.flat();
const NN_CONNS: [number, number][] = [];
let _idx = 0;
for (let l = 0; l < NN_LAYERS.length - 1; l++) {
  const la = NN_LAYERS[l];
  const lb = NN_LAYERS[l + 1];
  const aBase = NN_LAYERS.slice(0, l).reduce((s, r) => s + r.length, 0);
  const bBase = aBase + la.length;
  la.forEach((_, ai) => lb.forEach((_, bi) => NN_CONNS.push([aBase + ai, bBase + bi])));
}

function AIPredictionScene({ frame }: { frame: number }) {
  const cx = W * 0.5;
  const cy = H * 0.46;
  const rot = (frame / 240) * 360;
  const netOpacity  = interpolate(frame, [0, 28], [0, 1], { extrapolateRight: 'clamp' });
  const predOpacity = interpolate(frame, [160, 190], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <svg width={W} height={H} style={{ position: 'absolute', inset: 0 }} viewBox={`0 0 ${W} ${H}`}>
      {/* Radar rings */}
      {[200, 320, 440].map((r, i) => (
        <circle key={i} cx={cx} cy={cy} r={r}
          fill="none" stroke="rgba(10,147,211,0.10)" strokeWidth="1" strokeDasharray="8 6" />
      ))}

      {/* Rotating scanner arm */}
      <g transform={`rotate(${rot}, ${cx}, ${cy})`}>
        <line x1={cx} y1={cy} x2={cx + 440} y2={cy}
          stroke="rgba(10,147,211,0.55)" strokeWidth="2" />
        <circle cx={cx + 440} cy={cy} r={7} fill="#0a93d3" opacity={0.9} />
      </g>

      {/* Neural network */}
      <g opacity={netOpacity}>
        {NN_CONNS.map(([a, b], i) => {
          const na = NN_ALL[a];
          const nb = NN_ALL[b];
          const pulse = Math.sin(frame * 0.05 + i * 0.31) * 0.5 + 0.5;
          return (
            <line key={i}
              x1={cx + na.x} y1={cy + na.y}
              x2={cx + nb.x} y2={cy + nb.y}
              stroke={`rgba(10,147,211,${(0.12 + pulse * 0.22).toFixed(2)})`}
              strokeWidth="1"
            />
          );
        })}
        {NN_ALL.map((node, i) => {
          const pulse = Math.sin(frame * 0.06 + i * 0.42) * 0.5 + 0.5;
          return (
            <circle key={i} cx={cx + node.x} cy={cy + node.y}
              r={8 + pulse * 5}
              fill={`rgba(10,147,211,${(0.55 + pulse * 0.45).toFixed(2)})`}
            />
          );
        })}
      </g>

      {/* Prediction result banner */}
      <g opacity={predOpacity}>
        <rect x={cx - 260} y={cy + 270} width={520} height={108}
          fill="rgba(5,150,105,0.14)" stroke="#059669" strokeWidth="1.5" rx={10} />
        <text x={cx} y={cy + 310} textAnchor="middle"
          fill="#059669" fontSize={13} fontWeight={700} fontFamily={FONT_STACK} letterSpacing="2.5">
          AI PREDICTION
        </text>
        <text x={cx} y={cy + 346} textAnchor="middle"
          fill="#ffffff" fontSize={26} fontWeight={700} fontFamily={FONT_STACK}>
          Failure risk detected — 18 days ahead
        </text>
      </g>
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scene 5: Global Fleet — world grid, location pins appear, fleet stats
// ─────────────────────────────────────────────────────────────────────────────

const SITES = [
  { x: 0.12, y: 0.36, delay:  5, label: 'Chicago'   },
  { x: 0.20, y: 0.52, delay: 12, label: 'Houston'   },
  { x: 0.07, y: 0.28, delay:  8, label: 'Seattle'   },
  { x: 0.27, y: 0.40, delay: 18, label: 'New York'  },
  { x: 0.47, y: 0.28, delay: 22, label: 'London'    },
  { x: 0.52, y: 0.33, delay: 26, label: 'Berlin'    },
  { x: 0.55, y: 0.52, delay: 30, label: 'Dubai'     },
  { x: 0.72, y: 0.33, delay: 20, label: 'Mumbai'    },
  { x: 0.82, y: 0.30, delay: 28, label: 'Singapore' },
  { x: 0.88, y: 0.48, delay: 24, label: 'Sydney'    },
  { x: 0.76, y: 0.20, delay: 16, label: 'Tokyo'     },
  { x: 0.33, y: 0.66, delay: 34, label: 'São Paulo' },
];
const HUB = { x: 0.50, y: 0.43 };

function GlobalFleetScene({ frame, fps }: { frame: number; fps: number }) {
  const sitesVisible = SITES.filter(s => frame > s.delay + 22).length;
  const devCount = Math.round(interpolate(frame, [18, 200], [0, 2847], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
  const uptimeVal = interpolate(frame, [60, 200], [0, 99.2], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <svg width={W} height={H} style={{ position: 'absolute', inset: 0 }} viewBox={`0 0 ${W} ${H}`}>
      {/* World grid */}
      {Array.from({ length: 16 }, (_, i) => (
        <line key={`v${i}`}
          x1={(i / 15) * W} y1={H * 0.08} x2={(i / 15) * W} y2={H * 0.88}
          stroke="rgba(10,147,211,0.07)" strokeWidth="1" />
      ))}
      {Array.from({ length: 8 }, (_, i) => (
        <line key={`h${i}`}
          x1={0} y1={H * 0.08 + (i / 7) * H * 0.8} x2={W} y2={H * 0.08 + (i / 7) * H * 0.8}
          stroke="rgba(10,147,211,0.07)" strokeWidth="1" />
      ))}

      {/* Hub */}
      <g transform={`translate(${HUB.x * W}, ${HUB.y * H})`}>
        {[60, 90, 120].map((r, i) => (
          <circle key={i} r={r}
            fill="none" stroke="rgba(10,147,211,0.10)" strokeWidth="1" strokeDasharray="6 5" />
        ))}
        <circle r={22} fill="rgba(10,147,211,0.2)" stroke="#0a93d3" strokeWidth="2" />
        <circle r={9} fill="#0a93d3" />
      </g>

      {/* Sites */}
      {SITES.map((site, i) => {
        const scale = spring({ frame: Math.max(0, frame - site.delay), fps, config: { damping: 18, stiffness: 100 } });
        const lineOpacity = interpolate(frame, [site.delay + 15, site.delay + 35], [0, 0.28], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
        });
        const sx = site.x * W;
        const sy = site.y * H;
        return (
          <g key={i}>
            <line x1={sx} y1={sy} x2={HUB.x * W} y2={HUB.y * H}
              stroke="#0a93d3" strokeWidth="1" opacity={lineOpacity}
              strokeDasharray="4 5" />
            <g transform={`translate(${sx},${sy}) scale(${scale})`}>
              <circle r={18} fill="rgba(10,147,211,0.15)" stroke="#0a93d3" strokeWidth="1.5" />
              <circle r={6} fill="#0a93d3" />
            </g>
            {scale > 0.75 && (
              <text x={sx + 24} y={sy + 5}
                fill="rgba(255,255,255,0.55)" fontSize={13} fontFamily={FONT_STACK}>
                {site.label}
              </text>
            )}
          </g>
        );
      })}

      {/* Stats row */}
      {[
        { label: 'Global Sites',    value: `${sitesVisible}` },
        { label: 'Total Devices',   value: devCount.toLocaleString() },
        { label: 'Fleet Uptime',    value: `${uptimeVal.toFixed(1)}%` },
      ].map((stat, i) => {
        const cardOpacity = interpolate(frame, [8 + i * 14, 28 + i * 14], [0, 1], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
        });
        const cardX = W * 0.10 + i * (W * 0.30);
        return (
          <g key={i} opacity={cardOpacity}>
            <rect x={cardX - 110} y={H * 0.80} width={220} height={108}
              fill="rgba(10,147,211,0.10)" stroke="rgba(10,147,211,0.24)" strokeWidth="1" rx={10} />
            <text x={cardX} y={H * 0.80 + 56} textAnchor="middle"
              fill="#ffffff" fontSize={34} fontWeight={700} fontFamily={FONT_STACK}>
              {stat.value}
            </text>
            <text x={cardX} y={H * 0.80 + 84} textAnchor="middle"
              fill="rgba(255,255,255,0.5)" fontSize={14} fontFamily={FONT_STACK}>
              {stat.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scene: Ticket Flood — cascading ticket cards with live counter
// ─────────────────────────────────────────────────────────────────────────────

const TICKET_CARDS = [
  { label: 'Print button not working',      priority: 'HIGH',     dept: 'Software',  delay:  0,  x: 0.18, y: 0.18 },
  { label: 'Invoice export fails',          priority: 'CRITICAL', dept: 'Finance',   delay: 12,  x: 0.52, y: 0.13 },
  { label: 'Login issue after update',      priority: 'HIGH',     dept: 'IT',        delay: 22,  x: 0.76, y: 0.20 },
  { label: 'Dashboard not loading',         priority: 'MEDIUM',   dept: 'Software',  delay: 34,  x: 0.08, y: 0.42 },
  { label: 'Email notifications delayed',   priority: 'LOW',      dept: 'Admin',     delay: 44,  x: 0.36, y: 0.36 },
  { label: 'Data sync error in CRM',        priority: 'CRITICAL', dept: 'Database',  delay: 54,  x: 0.64, y: 0.32 },
  { label: 'User cannot reset password',    priority: 'HIGH',     dept: 'Security',  delay: 62,  x: 0.86, y: 0.44 },
  { label: 'Report download timeout',       priority: 'MEDIUM',   dept: 'Analytics', delay: 72,  x: 0.22, y: 0.60 },
  { label: 'API response slow on mobile',   priority: 'HIGH',     dept: 'Software',  delay: 82,  x: 0.55, y: 0.55 },
  { label: 'Bulk import not completing',    priority: 'CRITICAL', dept: 'Data',      delay: 92,  x: 0.80, y: 0.62 },
];

const PRIORITY_COLOR: Record<string, string> = {
  CRITICAL: '#ef4444',
  HIGH:     '#f59e0b',
  MEDIUM:   '#0a93d3',
  LOW:      '#059669',
};

function TicketFloodScene({ frame, fps }: { frame: number; fps: number }) {
  const totalVisible = TICKET_CARDS.filter(t => frame > t.delay + 10).length;
  const counterVal   = Math.round(interpolate(frame, [0, 280], [0, 347], { extrapolateRight: 'clamp' }));

  return (
    <>
      <svg width={W} height={H} style={{ position: 'absolute', inset: 0 }} viewBox={`0 0 ${W} ${H}`}>
        {/* Subtle grid */}
        <pattern id="tgrid" width="60" height="60" patternUnits="userSpaceOnUse">
          <path d="M 60 0 L 0 0 0 60" fill="none" stroke="rgba(10,147,211,0.05)" strokeWidth="1"/>
        </pattern>
        <rect width={W} height={H} fill="url(#tgrid)" />

        {TICKET_CARDS.map((t, i) => {
          const sc = spring({ frame: Math.max(0, frame - t.delay), fps, config: { damping: 20, stiffness: 100 } });
          const cx = t.x * W;
          const cy = t.y * H;
          const cw = 340; const ch = 96;
          const col = PRIORITY_COLOR[t.priority] ?? '#0a93d3';
          return (
            <g key={i} opacity={sc} transform={`translate(0, ${(1 - sc) * -30})`}>
              <rect x={cx} y={cy} width={cw} height={ch} rx={10}
                fill="rgba(8,18,40,0.92)" stroke={col} strokeWidth="1.5" />
              <rect x={cx} y={cy} width={4} height={ch} rx={2} fill={col} />
              <text x={cx + 22} y={cy + 28} fill={col} fontSize={10} fontWeight={800}
                fontFamily={FONT_STACK} letterSpacing="1.6">{t.priority}</text>
              <text x={cx + 22} y={cy + 54} fill="#ffffff" fontSize={18} fontWeight={600}
                fontFamily={FONT_STACK}>{t.label}</text>
              <text x={cx + 22} y={cy + 76} fill="rgba(255,255,255,0.40)" fontSize={12}
                fontFamily={FONT_STACK}>{t.dept} · Unassigned</text>
            </g>
          );
        })}
      </svg>

      {/* Live counter */}
      <div style={{
        position: 'absolute', top: '6%', right: '5%',
        background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.40)',
        borderRadius: 16, padding: '20px 36px', textAlign: 'center', fontFamily: FONT_STACK,
      }}>
        <div style={{ color: '#ef4444', fontSize: 64, fontWeight: 800, lineHeight: 1 }}>{counterVal}</div>
        <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 14, marginTop: 6, letterSpacing: '1.5px' }}>
          OPEN TICKETS TODAY
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scene: SLA Breach — countdown timers turning red, breach alerts
// ─────────────────────────────────────────────────────────────────────────────

const SLA_ROWS = [
  { id: '#TF-1042', title: 'Print button not working',    target: '4h',  elapsed: '6h 12m', breached: true,  delay:  8 },
  { id: '#TF-1039', title: 'Invoice export fails',        target: '2h',  elapsed: '3h 45m', breached: true,  delay: 24 },
  { id: '#TF-1035', title: 'Login issue after update',    target: '4h',  elapsed: '4h 03m', breached: true,  delay: 40 },
  { id: '#TF-1031', title: 'Dashboard not loading',       target: '8h',  elapsed: '2h 10m', breached: false, delay: 56 },
  { id: '#TF-1028', title: 'Email notifications delayed', target: '24h', elapsed: '1h 22m', breached: false, delay: 70 },
];

function SLABreachScene({ frame, fps }: { frame: number; fps: number }) {
  const breachCount = SLA_ROWS.filter(r => r.breached && frame > r.delay + 20).length;
  const pulse = Math.sin(frame * 0.15) * 0.4 + 0.6;

  return (
    <svg width={W} height={H} style={{ position: 'absolute', inset: 0 }} viewBox={`0 0 ${W} ${H}`}>
      {/* Header */}
      <text x={W / 2} y={100} textAnchor="middle" fill="rgba(255,255,255,0.70)"
        fontSize={22} fontWeight={700} fontFamily={FONT_STACK} letterSpacing="2">
        SLA RESPONSE TRACKER
      </text>
      <line x1={W * 0.15} y1={118} x2={W * 0.85} y2={118}
        stroke="rgba(255,255,255,0.08)" strokeWidth="1" />

      {SLA_ROWS.map((row, i) => {
        const sc  = spring({ frame: Math.max(0, frame - row.delay), fps, config: { damping: 18, stiffness: 80 } });
        const ry  = 155 + i * 130;
        const col = row.breached ? '#ef4444' : '#059669';
        const bgc = row.breached ? 'rgba(239,68,68,0.08)' : 'rgba(5,150,105,0.06)';
        return (
          <g key={i} opacity={sc} transform={`translate(${(1 - sc) * 40}, 0)`}>
            <rect x={W * 0.12} y={ry - 10} width={W * 0.76} height={110} rx={10}
              fill={bgc} stroke={col} strokeWidth="1" />
            {/* Ticket ID + title */}
            <text x={W * 0.16} y={ry + 22} fill="rgba(255,255,255,0.45)" fontSize={13}
              fontFamily={FONT_STACK}>{row.id}</text>
            <text x={W * 0.16} y={ry + 52} fill="#ffffff" fontSize={22} fontWeight={600}
              fontFamily={FONT_STACK}>{row.title}</text>
            {/* SLA target */}
            <text x={W * 0.60} y={ry + 30} fill="rgba(255,255,255,0.45)" fontSize={12}
              fontFamily={FONT_STACK}>TARGET</text>
            <text x={W * 0.60} y={ry + 56} fill="rgba(255,255,255,0.80)" fontSize={22}
              fontWeight={600} fontFamily={FONT_STACK}>{row.target}</text>
            {/* Elapsed */}
            <text x={W * 0.74} y={ry + 30} fill={col} fontSize={12}
              fontFamily={FONT_STACK} fontWeight={700}>ELAPSED</text>
            <text x={W * 0.74} y={ry + 56} fill={col} fontSize={22}
              fontWeight={800} fontFamily={FONT_STACK}
              opacity={row.breached ? pulse : 1}>{row.elapsed}</text>
            {/* Status badge */}
            {row.breached && frame > row.delay + 20 && (
              <>
                <rect x={W * 0.84} y={ry + 28} width={120} height={34} rx={6} fill="rgba(239,68,68,0.20)" />
                <text x={W * 0.84 + 60} y={ry + 51} textAnchor="middle"
                  fill="#ef4444" fontSize={13} fontWeight={800} fontFamily={FONT_STACK} letterSpacing="1.2">
                  BREACHED
                </text>
              </>
            )}
          </g>
        );
      })}

      {/* Breach counter */}
      {breachCount > 0 && (
        <g>
          <rect x={W * 0.38} y={H * 0.88} width={W * 0.24} height={52} rx={8}
            fill="rgba(239,68,68,0.18)" stroke="rgba(239,68,68,0.50)" strokeWidth="1.5" />
          <text x={W / 2} y={H * 0.88 + 34} textAnchor="middle"
            fill="#ef4444" fontSize={18} fontWeight={800} fontFamily={FONT_STACK}>
            {breachCount} SLA BREACH{breachCount > 1 ? 'ES' : ''} TODAY
          </text>
        </g>
      )}
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scene: Multi-Channel Chaos — disconnected tool icons with no central view
// ─────────────────────────────────────────────────────────────────────────────

const TOOLS = [
  { name: 'Email',    color: '#0a93d3', x: 0.20, y: 0.32, delay:  5,  icon: 'M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2zm0 2l8 5 8-5M4 6v12h16V6' },
  { name: 'Slack',    color: '#7c3aed', x: 0.50, y: 0.22, delay: 18,  icon: 'M14.5 10c-.83 0-1.5-.67-1.5-1.5v-5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5v5c0 .83-.67 1.5-1.5 1.5zm-5 0c-.83 0-1.5-.67-1.5-1.5v-5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5v5c0 .83-.67 1.5-1.5 1.5zM10 14.5c0 .83-.67 1.5-1.5 1.5s-1.5-.67-1.5-1.5.67-1.5 1.5-1.5h1.5v1.5zm1 0c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5v5c0 .83-.67 1.5-1.5 1.5s-1.5-.67-1.5-1.5v-5z' },
  { name: 'Jira',     color: '#0052CC', x: 0.80, y: 0.30, delay: 30,  icon: 'M11.53 2c0 2.4 1.97 4.35 4.35 4.35h1.78v1.7c0 2.4 1.94 4.34 4.34 4.35V2.84a.84.84 0 0 0-.84-.84zM6.77 6.8a4.362 4.362 0 0 0 4.34 4.34h1.79v1.71a4.362 4.362 0 0 0 4.34 4.34V7.63a.84.84 0 0 0-.83-.83zM2 11.6c0 2.4 1.95 4.34 4.35 4.34h1.78v1.72c.01 2.39 1.95 4.34 4.35 4.34v-9.57a.84.84 0 0 0-.84-.83z' },
  { name: 'GitHub',   color: '#059669', x: 0.20, y: 0.62, delay: 42,  icon: 'M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22' },
  { name: 'Teams',    color: '#5059C9', x: 0.50, y: 0.68, delay: 55,  icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z' },
];

function MultiChannelScene({ frame, fps }: { frame: number; fps: number }) {
  const CX = W * 0.50;
  const CY = H * 0.46;

  return (
    <svg width={W} height={H} style={{ position: 'absolute', inset: 0 }} viewBox={`0 0 ${W} ${H}`}>
      {/* Central chaos icon */}
      <circle cx={CX} cy={CY} r={80} fill="rgba(239,68,68,0.08)" stroke="rgba(239,68,68,0.30)" strokeWidth="2"
        strokeDasharray="8 5" />
      <circle cx={CX} cy={CY} r={48} fill="rgba(239,68,68,0.12)" stroke="rgba(239,68,68,0.45)" strokeWidth="2" />
      <text x={CX} y={CY - 8} textAnchor="middle" fill="#ef4444" fontSize={42} fontFamily="monospace">?</text>
      <text x={CX} y={CY + 28} textAnchor="middle" fill="rgba(239,68,68,0.65)" fontSize={11}
        fontFamily={FONT_STACK} fontWeight={700} letterSpacing="2">NO SINGLE VIEW</text>

      {/* Tool nodes */}
      {TOOLS.map((tool, i) => {
        const sc = spring({ frame: Math.max(0, frame - tool.delay), fps, config: { damping: 16, stiffness: 80 } });
        const tx = tool.x * W;
        const ty = tool.y * H;
        const lineOpacity = interpolate(frame, [tool.delay + 20, tool.delay + 40], [0, 0.30], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
        });
        // Animated dash offset for "disconnected" feel
        const dashOff = (frame * 1.5 + i * 30) % 24;
        return (
          <g key={i} opacity={sc}>
            <line x1={tx} y1={ty} x2={CX} y2={CY}
              stroke={tool.color} strokeWidth="1.5" opacity={lineOpacity}
              strokeDasharray="8 6" strokeDashoffset={dashOff} />
            <circle cx={tx} cy={ty} r={54} fill={`${tool.color}14`} stroke={tool.color} strokeWidth="1.5" />
            <g transform={`translate(${tx - 12}, ${ty - 18})`}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
                stroke={tool.color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d={tool.icon} />
              </svg>
            </g>
            <text x={tx} y={ty + 36} textAnchor="middle" fill={tool.color}
              fontSize={13} fontWeight={700} fontFamily={FONT_STACK}>{tool.name}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scene: AI Triage — ticket routing with AI auto-assignment
// ─────────────────────────────────────────────────────────────────────────────

const TRIAGE_TICKETS = [
  { label: 'Print button broken',   cat: 'Software Bug',    team: 'L2 Support', confidence: 94, delay:  0 },
  { label: 'Invoice export error',  cat: 'Finance System',  team: 'L2 Support', confidence: 89, delay: 50 },
  { label: 'Password reset fails',  cat: 'Auth / Security', team: 'Security',   confidence: 97, delay: 100 },
  { label: 'Report timeout',        cat: 'Performance',     team: 'Backend',    confidence: 82, delay: 150 },
];

function AITriageScene({ frame, fps }: { frame: number; fps: number }) {
  return (
    <>
      <svg width={W} height={H} style={{ position: 'absolute', inset: 0 }} viewBox={`0 0 ${W} ${H}`}>
        {/* AI Brain — central element */}
        <g transform={`translate(${W * 0.50}, ${H * 0.35})`}>
          {/* Outer rings */}
          {[120, 160, 200].map((r, i) => (
            <circle key={i} r={r} fill="none"
              stroke={`rgba(10,147,211,${0.12 - i * 0.03})`} strokeWidth="1"
              strokeDasharray="6 5"
              transform={`rotate(${(frame * (0.3 + i * 0.15))})`} />
          ))}
          {/* Core */}
          <circle r={72} fill="rgba(10,147,211,0.12)" stroke="#0a93d3" strokeWidth="2" />
          <text textAnchor="middle" y={-10} fill="#0a93d3" fontSize={15} fontWeight={800}
            fontFamily={FONT_STACK} letterSpacing="2">AI TRIAGE</text>
          <text textAnchor="middle" y={16} fill="rgba(255,255,255,0.50)" fontSize={12}
            fontFamily={FONT_STACK}>AUTO-ROUTING</text>
        </g>

        {/* Ticket → AI → Team routing */}
        {TRIAGE_TICKETS.map((t, i) => {
          const sc  = spring({ frame: Math.max(0, frame - t.delay), fps, config: { damping: 18, stiffness: 70 } });
          const ry  = 460 + i * 110;
          const bar = interpolate(frame, [t.delay + 20, t.delay + 60], [0, t.confidence], {
            extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
          });
          return (
            <g key={i} opacity={sc}>
              {/* Ticket card */}
              <rect x={W * 0.08} y={ry - 8} width={W * 0.36} height={88} rx={8}
                fill="rgba(8,18,40,0.90)" stroke="rgba(10,147,211,0.30)" strokeWidth="1" />
              <text x={W * 0.12} y={ry + 24} fill="rgba(255,255,255,0.50)" fontSize={11}
                fontFamily={FONT_STACK}>INCOMING TICKET</text>
              <text x={W * 0.12} y={ry + 52} fill="#ffffff" fontSize={18} fontWeight={600}
                fontFamily={FONT_STACK}>{t.label}</text>
              <text x={W * 0.12} y={ry + 72} fill="#0a93d3" fontSize={12} fontFamily={FONT_STACK}>{t.cat}</text>
              {/* Arrow */}
              <line x1={W * 0.44} y1={ry + 36} x2={W * 0.56} y2={ry + 36}
                stroke="#0a93d3" strokeWidth="1.5" opacity={0.60} />
              <polygon points={`${W * 0.56},${ry + 30} ${W * 0.56 + 14},${ry + 36} ${W * 0.56},${ry + 42}`}
                fill="#0a93d3" opacity={0.60} />
              {/* Result card */}
              <rect x={W * 0.58} y={ry - 8} width={W * 0.34} height={88} rx={8}
                fill="rgba(5,150,105,0.10)" stroke="rgba(5,150,105,0.40)" strokeWidth="1" />
              <text x={W * 0.62} y={ry + 24} fill="rgba(5,150,105,0.70)" fontSize={11}
                fontWeight={700} fontFamily={FONT_STACK} letterSpacing="1.2">ASSIGNED TO</text>
              <text x={W * 0.62} y={ry + 50} fill="#ffffff" fontSize={18} fontWeight={700}
                fontFamily={FONT_STACK}>{t.team}</text>
              {/* Confidence bar */}
              <rect x={W * 0.62} y={ry + 64} width={200} height={8} rx={4}
                fill="rgba(255,255,255,0.08)" />
              <rect x={W * 0.62} y={ry + 64} width={bar * 2} height={8} rx={4}
                fill="#059669" />
              <text x={W * 0.62 + 210} y={ry + 73} fill="#059669" fontSize={11}
                fontFamily={FONT_STACK} fontWeight={700}>{Math.round(bar)}%</text>
            </g>
          );
        })}
      </svg>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scene: KPI Metrics — live animated dashboard with CSAT, resolution time, etc.
// ─────────────────────────────────────────────────────────────────────────────

const KPI_CARDS = [
  { label: 'Avg Resolution Time', val: 18.4, suffix: 'hrs',  color: '#ef4444', target: '8 hrs',   bad: true  },
  { label: 'CSAT Score',          val: 2.8,  suffix: '★',    color: '#f59e0b', target: '4.5 ★',   bad: true  },
  { label: 'SLA Breach Rate',     val: 34,   suffix: '%',    color: '#ef4444', target: '<5%',      bad: true  },
  { label: 'Unassigned Tickets',  val: 127,  suffix: '',     color: '#f59e0b', target: '0',        bad: true  },
];

const BARS_DATA = [0.82, 0.45, 0.91, 0.60, 0.78, 0.38, 0.95, 0.52, 0.87, 0.43, 0.76, 0.58];

function KPIMetricsScene({ frame }: { frame: number }) {
  return (
    <svg width={W} height={H} style={{ position: 'absolute', inset: 0 }} viewBox={`0 0 ${W} ${H}`}>
      <text x={W / 2} y={80} textAnchor="middle" fill="rgba(255,255,255,0.65)"
        fontSize={20} fontWeight={700} fontFamily={FONT_STACK} letterSpacing="2.5">
        SUPPORT OPERATIONS — CURRENT STATE
      </text>

      {/* KPI cards */}
      {KPI_CARDS.map((kpi, i) => {
        const cardX = W * 0.06 + i * (W * 0.235);
        const val   = interpolate(frame, [10 + i * 12, 80 + i * 12], [0, kpi.val], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
        });
        const op    = interpolate(frame, [8 + i * 10, 30 + i * 10], [0, 1], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
        });
        const displayVal = kpi.val < 10 ? val.toFixed(1) : Math.round(val).toString();
        return (
          <g key={i} opacity={op}>
            <rect x={cardX} y={120} width={W * 0.21} height={200} rx={12}
              fill={`${kpi.color}0e`} stroke={kpi.color} strokeWidth="1.5" />
            <text x={cardX + W * 0.105} y={185} textAnchor="middle"
              fill={kpi.color} fontSize={52} fontWeight={800} fontFamily={FONT_STACK}>
              {displayVal}{kpi.suffix}
            </text>
            <text x={cardX + W * 0.105} y={225} textAnchor="middle"
              fill="rgba(255,255,255,0.55)" fontSize={13} fontFamily={FONT_STACK}>
              {kpi.label}
            </text>
            <rect x={cardX + 16} y={248} width={W * 0.21 - 32} height={1}
              fill="rgba(255,255,255,0.08)" />
            <text x={cardX + W * 0.105} y={285} textAnchor="middle"
              fill="rgba(255,255,255,0.35)" fontSize={12} fontFamily={FONT_STACK}>
              Target: {kpi.target}
            </text>
            {/* Warning icon */}
            <text x={cardX + W * 0.21 - 28} y={148} fill={kpi.color} fontSize={22}>⚠</text>
          </g>
        );
      })}

      {/* Trend bar chart */}
      <text x={W * 0.06} y={380} fill="rgba(255,255,255,0.45)" fontSize={12}
        fontFamily={FONT_STACK} fontWeight={700} letterSpacing="1.5">
        TICKET VOLUME — LAST 12 WEEKS
      </text>
      {BARS_DATA.map((h, i) => {
        const maxH = 180;
        const bw   = 68; const gap = 88;
        const bx   = W * 0.06 + i * gap;
        const barH = interpolate(frame, [28 + i * 5, 70 + i * 5], [0, h * maxH], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
        });
        const col  = h > 0.75 ? '#ef4444' : h > 0.55 ? '#f59e0b' : '#0a93d3';
        return (
          <g key={i}>
            <rect x={bx} y={H * 0.90 - barH} width={bw} height={barH} rx={4} fill={col} opacity={0.70} />
            <rect x={bx} y={H * 0.90 - barH} width={bw} height={4} fill={col} rx={2} />
          </g>
        );
      })}
      <line x1={W * 0.06} y1={H * 0.90} x2={W * 0.06 + 12 * 88} y2={H * 0.90}
        stroke="rgba(255,255,255,0.10)" strokeWidth="1" />
    </svg>
  );
}



// ─────────────────────────────────────────────────────────────────────────────
// 11. PA INTAKE — prior authorization request flood (healthcare domain)
// ─────────────────────────────────────────────────────────────────────────────
const PA_CARDS = [
  { id: 'PA-2024-1892', provider: 'Dr. Raj Patel',   member: 'James K.',    cpt: '72148', payer: 'Aetna',        status: 'PENDING' },
  { id: 'PA-2024-1893', provider: 'Dr. Lisa Chen',   member: 'Maria S.',    cpt: '27447', payer: 'UnitedHealth', status: 'PENDING' },
  { id: 'PA-2024-1894', provider: 'Dr. Mike Torres', member: 'Robert L.',   cpt: '62442', payer: 'Cigna',        status: 'REVIEW'  },
  { id: 'PA-2024-1895', provider: 'Dr. Sarah Kim',   member: 'Patricia W.', cpt: '23472', payer: 'Blue Cross',   status: 'URGENT'  },
  { id: 'PA-2024-1896', provider: 'Dr. John Adams',  member: 'Thomas B.',   cpt: '27130', payer: 'Humana',       status: 'PENDING' },
  { id: 'PA-2024-1897', provider: 'Dr. Amy Wilson',  member: 'Susan M.',    cpt: '99214', payer: 'Aetna',        status: 'PENDING' },
  { id: 'PA-2024-1898', provider: 'Dr. Kevin Park',  member: 'David C.',    cpt: '70553', payer: 'UnitedHealth', status: 'PENDING' },
  { id: 'PA-2024-1899', provider: 'Dr. Priya Nair',  member: 'Linda M.',    cpt: '43239', payer: 'Cigna',        status: 'REVIEW'  },
];
const PA_STATUS_COLOR: Record<string, string> = {
  PENDING: '#f59e0b',
  REVIEW:  '#0a93d3',
  URGENT:  '#ef4444',
};

const PAIntakeScene: React.FC<{ frame: number; fps: number }> = ({ frame }) => {
  const counter = Math.min(347 + Math.floor(frame * 0.35), 389);
  return (
    <svg viewBox="0 0 1920 1080" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
      <rect x="40" y="28" width="490" height="72" rx="8" fill="rgba(239,68,68,0.15)" stroke="rgba(239,68,68,0.45)" strokeWidth="1.5" />
      <text x="62" y="79" fill="#ef4444" fontSize="38" fontWeight="700">{counter} PENDING REQUESTS</text>
      {PA_CARDS.map((c, i) => {
        const delay  = i * 12;
        const prog   = Math.max(0, Math.min(1, (frame - delay) / 20));
        const slideX = interpolate(prog, [0, 1], [340, 0]);
        const col = i % 2;
        const row = Math.floor(i / 2);
        const cx  = 60  + col * 950;
        const cy  = 130 + row * 222;
        const sc  = PA_STATUS_COLOR[c.status] ?? '#f59e0b';
        return (
          <g key={c.id} transform={`translate(${cx + slideX},${cy})`} opacity={prog}>
            <rect width="870" height="178" rx="10" fill="rgba(255,255,255,0.055)" stroke="rgba(255,255,255,0.10)" strokeWidth="1" />
            <rect width="5" height="178" rx="2.5" fill={sc} />
            <text x="22" y="38" fill="#60a5fa" fontSize="22" fontWeight="700" fontFamily="monospace">{c.id}</text>
            <rect x="680" y="12" width="170" height="32" rx="6" fill={sc + '28'} stroke={sc} strokeWidth="1" />
            <text x="765" y="35" fill={sc} fontSize="17" fontWeight="700" textAnchor="middle">{c.status}</text>
            <text x="22" y="76" fill="rgba(255,255,255,0.5)" fontSize="17">Provider</text>
            <text x="148" y="76" fill="rgba(255,255,255,0.88)" fontSize="17" fontWeight="600">{c.provider}</text>
            <text x="22" y="112" fill="rgba(255,255,255,0.5)" fontSize="17">Member</text>
            <text x="148" y="112" fill="rgba(255,255,255,0.88)" fontSize="17">{c.member}</text>
            <text x="22" y="148" fill="rgba(255,255,255,0.5)" fontSize="17">CPT · Payer</text>
            <text x="148" y="148" fill="rgba(255,255,255,0.88)" fontSize="17">{c.cpt} · {c.payer}</text>
          </g>
        );
      })}
    </svg>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// 12. CLINICAL NLP — AI extraction of clinical entities from PA documents
// ─────────────────────────────────────────────────────────────────────────────
const NLP_ENTITIES = [
  { label: 'Diagnosis',  code: 'M54.4', value: 'Lumbar radiculopathy',            conf: 0.97 },
  { label: 'Procedure',  code: '72148', value: 'MRI Lumbar Spine w/ contrast',    conf: 0.99 },
  { label: 'Medication', code: 'RxN',   value: 'Ibuprofen 400mg PO TID',          conf: 0.94 },
  { label: 'Lab Result', code: 'CBC',   value: 'Within normal limits',             conf: 0.91 },
  { label: 'Symptom',    code: 'R52',   value: 'Chronic lower back pain',          conf: 0.96 },
  { label: 'Treatment',  code: '8 wks', value: 'Conservative treatment completed', conf: 0.88 },
];
const DOC_LINES = [
  'Patient: James K. — DOB: 04/12/1978 — MRN: 8841923',
  'Referring Physician: Dr. Raj Patel, MD — NPI: 1234567890',
  'Primary Diagnosis: Lumbar radiculopathy (M54.4)',
  'Requested Service: MRI Lumbar Spine with contrast',
  'CPT Code: 72148 — Payer: Aetna — Plan: PPO',
  'Clinical History: Patient presents with 8-week history',
  'of chronic lower back pain with bilateral radiation.',
  'Conservative treatment including PT and NSAIDs has',
  'been completed without adequate relief. CBC normal.',
  'No contraindications to MRI identified.',
];

const ClinicalNLPScene: React.FC<{ frame: number; fps: number }> = ({ frame }) => {
  const scanY  = interpolate(frame % 60, [0, 60], [100, 960]);
  const scanOp = 0.55 + 0.45 * Math.sin(frame * 0.15);
  return (
    <svg viewBox="0 0 1920 1080" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
      <defs>
        <linearGradient id="scan-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(96,165,250,0)" />
          <stop offset="100%" stopColor="rgba(96,165,250,0.10)" />
        </linearGradient>
        <filter id="nlp-glow">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      {/* Document panel */}
      <text x="60" y="56" fill="#60a5fa" fontSize="26" fontWeight="700" letterSpacing="3">CLINICAL NLP EXTRACTION</text>
      <line x1="60" y1="68" x2="860" y2="68" stroke="rgba(96,165,250,0.3)" strokeWidth="1" />
      <rect x="60" y="86" width="800" height="948" rx="10" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.09)" strokeWidth="1" />
      <rect x="60" y="86" width="800" height="44" rx="10" fill="rgba(255,255,255,0.07)" />
      <text x="80" y="116" fill="rgba(255,255,255,0.55)" fontSize="15" fontFamily="monospace">patient_referral_dr_patel.pdf</text>
      {DOC_LINES.map((line, i) => (
        <text key={i} x="80" y={150 + i * 44} fill="rgba(255,255,255,0.32)" fontSize="16" fontFamily="monospace">{line}</text>
      ))}
      {/* Scan beam */}
      <rect x="60" y={scanY - 28} width="800" height="30" fill="url(#scan-grad)" />
      <rect x="60" y={scanY} width="800" height="4" rx="2" fill={`rgba(96,165,250,${scanOp})`} filter="url(#nlp-glow)" />
      {/* Entity panel */}
      <text x="920" y="56" fill="#34d399" fontSize="26" fontWeight="700" letterSpacing="3">EXTRACTED ENTITIES</text>
      <line x1="920" y1="68" x2="1880" y2="68" stroke="rgba(52,211,153,0.3)" strokeWidth="1" />
      {NLP_ENTITIES.map((e, i) => {
        const delay  = i * 18;
        const prog   = Math.max(0, Math.min(1, (frame - delay) / 18));
        const slideX = interpolate(prog, [0, 1], [60, 0]);
        const ey     = 90 + i * 154;
        return (
          <g key={i} transform={`translate(${slideX},0)`} opacity={prog}>
            <rect x="920" y={ey} width="960" height="130" rx="8" fill="rgba(52,211,153,0.05)" stroke="rgba(52,211,153,0.18)" strokeWidth="1" />
            <rect x="920" y={ey + 116} width="960" height="6" rx="3" fill="rgba(52,211,153,0.1)" />
            <rect x="920" y={ey + 116} width={960 * e.conf} height="6" rx="3" fill="rgba(52,211,153,0.7)" />
            <text x="944" y={ey + 38} fill="rgba(255,255,255,0.5)" fontSize="17">{e.label}</text>
            <rect x="1084" y={ey + 16} width="82" height="26" rx="5" fill="rgba(96,165,250,0.2)" />
            <text x="1125" y={ey + 35} fill="#60a5fa" fontSize="15" fontWeight="700" textAnchor="middle" fontFamily="monospace">{e.code}</text>
            <text x="1184" y={ey + 38} fill="rgba(255,255,255,0.92)" fontSize="19" fontWeight="600">{e.value}</text>
            <text x="1860" y={ey + 38} fill="#34d399" fontSize="17" fontWeight="700" textAnchor="end">{Math.round(e.conf * 100)}%</text>
          </g>
        );
      })}
    </svg>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// 13. POLICY ENGINE — clinical rule evaluation and compliance scoring
// ─────────────────────────────────────────────────────────────────────────────
const POLICY_RULES = [
  { rule: 'Clinical necessity documented',             met: true },
  { rule: 'Prior conservative treatment (8+ weeks)',   met: true },
  { rule: 'No FDA contraindications present',          met: true },
  { rule: 'Member eligibility confirmed',              met: true },
  { rule: 'Payer coverage policy matched (Aetna PPO)', met: true },
  { rule: 'CPT code authorization required — MRI',     met: true },
];

const PolicyEngineScene: React.FC<{ frame: number; fps: number }> = ({ frame }) => {
  const scoreProg = Math.max(0, Math.min(1, (frame - 55) / 65));
  const scoreNow  = Math.round(94 * scoreProg);
  const R   = 140;
  const gcx = 1540;
  const gcy = 480;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const arcPt = (angle: number) => ({
    x: gcx + R * Math.cos(toRad(angle)),
    y: gcy + R * Math.sin(toRad(angle)),
  });
  const sa = 200; const ea = 340;
  const fillEnd = sa + (ea - sa) * scoreProg;
  const p1 = arcPt(sa); const p2 = arcPt(fillEnd); const p3 = arcPt(ea);
  const lg = fillEnd - sa > 180 ? 1 : 0;
  return (
    <svg viewBox="0 0 1920 1080" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
      <defs>
        <filter id="pe-glow">
          <feGaussianBlur stdDeviation="6" result="blur" />
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <text x="60" y="60" fill="#a78bfa" fontSize="26" fontWeight="700" letterSpacing="3">POLICY ENGINE — RULE EVALUATION</text>
      <line x1="60" y1="72" x2="1260" y2="72" stroke="rgba(167,139,250,0.3)" strokeWidth="1" />
      {POLICY_RULES.map((r, i) => {
        const delay     = i * 16;
        const prog      = Math.max(0, Math.min(1, (frame - delay) / 18));
        const checkProg = Math.max(0, Math.min(1, (frame - delay - 12) / 12));
        const ry        = 92 + i * 160;
        return (
          <g key={i} opacity={prog}>
            <rect x="60" y={ry} width="1200" height="132" rx="8"
              fill="rgba(16,185,129,0.06)" stroke="rgba(16,185,129,0.22)" strokeWidth="1" />
            <text x="84" y={ry + 62} fill="rgba(255,255,255,0.88)" fontSize="22" fontWeight="600">{r.rule}</text>
            <text x="84" y={ry + 104} fill="rgba(255,255,255,0.33)" fontSize="15">RULE {String(i + 1).padStart(2, '0')}</text>
            <g opacity={checkProg}>
              <circle cx="1218" cy={ry + 66} r="28" fill="rgba(16,185,129,0.25)" stroke="#10b981" strokeWidth="2" />
              <text x="1218" y={ry + 76} textAnchor="middle" fill="#10b981" fontSize="28" fontWeight="700">✓</text>
            </g>
          </g>
        );
      })}
      {/* Score gauge */}
      <rect x="1340" y="80" width="560" height="570" rx="12" fill="rgba(167,139,250,0.05)" stroke="rgba(167,139,250,0.20)" strokeWidth="1" />
      <text x="1620" y="132" textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize="20" letterSpacing="2">POLICY SCORE</text>
      <path d={`M ${p1.x} ${p1.y} A ${R} ${R} 0 1 1 ${p3.x} ${p3.y}`} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="22" strokeLinecap="round" />
      {scoreProg > 0.01 && (
        <path d={`M ${p1.x} ${p1.y} A ${R} ${R} 0 ${lg} 1 ${p2.x} ${p2.y}`} fill="none" stroke="#10b981" strokeWidth="22" strokeLinecap="round" filter="url(#pe-glow)" />
      )}
      <text x={gcx} y={gcy + 16} textAnchor="middle" fill="#10b981" fontSize="96" fontWeight="800">{scoreNow}</text>
      <text x={gcx} y={gcy + 62} textAnchor="middle" fill="rgba(255,255,255,0.45)" fontSize="24">/ 100</text>
      <g opacity={scoreProg}>
        <rect x="1420" y="660" width="400" height="54" rx="8" fill="rgba(16,185,129,0.18)" stroke="#10b981" strokeWidth="1.5" />
        <text x="1620" y="697" textAnchor="middle" fill="#10b981" fontSize="26" fontWeight="700">POLICY READY</text>
      </g>
    </svg>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// 14. AUTH PIPELINE — cases flowing through PA authorization stages
// ─────────────────────────────────────────────────────────────────────────────
const AUTH_STAGES = [
  { label: 'Intake',       count: 24, color: '#64748b' },
  { label: 'Extraction',   count: 18, color: '#0a93d3' },
  { label: 'Policy Check', count: 12, color: '#f59e0b' },
  { label: 'UM Review',    count:  7, color: '#f97316' },
  { label: 'Decision',     count:  4, color: '#10b981' },
];
const STAGE_CASE_IDS = [
  ['PA-1891','PA-1882','PA-1875','PA-1868','PA-1861','PA-1854'],
  ['PA-1847','PA-1840','PA-1833','PA-1826','PA-1819','PA-1812'],
  ['PA-1805','PA-1798','PA-1791','PA-1784','PA-1777','PA-1770'],
  ['PA-1763','PA-1756','PA-1749','PA-1742','PA-1735','PA-1728'],
  ['PA-1721','PA-1714','PA-1707','PA-1700'],
];

const AuthPipelineScene: React.FC<{ frame: number; fps: number }> = ({ frame }) => {
  const stageW = 346;
  const moveProg = Math.min(4, frame / 45);
  const stageIdx = Math.floor(moveProg);
  const stagePct = moveProg - stageIdx;
  const cardX = 60 + stageIdx * (stageW + 14) + stagePct * (stageW + 14);
  return (
    <svg viewBox="0 0 1920 1080" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
      <text x="60" y="56" fill="#f97316" fontSize="26" fontWeight="700" letterSpacing="3">AUTHORIZATION PIPELINE</text>
      <line x1="60" y1="68" x2="1860" y2="68" stroke="rgba(249,115,22,0.3)" strokeWidth="1" />
      {AUTH_STAGES.map((s, i) => {
        const sx      = 60 + i * (stageW + 14);
        const entProg = Math.max(0, Math.min(1, (frame - i * 10) / 22));
        const cases   = STAGE_CASE_IDS[i] ?? [];
        return (
          <g key={i} opacity={entProg}>
            <rect x={sx} y={82} width={stageW} height={52} rx="8" fill={s.color + '28'} />
            <text x={sx + stageW / 2} y={116} textAnchor="middle" fill={s.color} fontSize="19" fontWeight="700">{s.label}</text>
            <rect x={sx + stageW - 52} y={90} width={44} height={28} rx="6" fill={s.color + '44'} />
            <text x={sx + stageW - 30} y={111} textAnchor="middle" fill={s.color} fontSize="17" fontWeight="800">{s.count}</text>
            <rect x={sx} y={142} width={stageW} height={900} rx="8" fill="rgba(255,255,255,0.025)" stroke={s.color + '33'} strokeWidth="1" />
            {cases.slice(0, 6).map((id, j) => (
              <g key={j}>
                <rect x={sx + 10} y={158 + j * 124} width={stageW - 20} height={108} rx="6"
                  fill="rgba(255,255,255,0.04)" stroke={s.color + '44'} strokeWidth="1" />
                <text x={sx + 26} y={196 + j * 124} fill="rgba(255,255,255,0.72)" fontSize="15" fontFamily="monospace" fontWeight="600">{id}</text>
                <rect x={sx + 10} y={214 + j * 124} width={stageW - 20} height="5" rx="2" fill="rgba(255,255,255,0.07)" />
                <rect x={sx + 10} y={214 + j * 124} width={(stageW - 20) * (0.25 + j * 0.12)} height="5" rx="2" fill={s.color + 'aa'} />
              </g>
            ))}
            {s.count > 6 && (
              <text x={sx + stageW / 2} y={910} textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="14">+{s.count - 6} more</text>
            )}
          </g>
        );
      })}
      {/* Animated rider card */}
      <g transform={`translate(${cardX},930)`}>
        <rect width={stageW - 20} height={56} rx="8" fill={AUTH_STAGES[Math.min(stageIdx, 4)].color} opacity="0.88" />
        <text x="14" y="37" fill="#fff" fontSize="18" fontWeight="700" fontFamily="monospace">PA-2024-1900 ►</text>
      </g>
      {/* Stage arrows */}
      {[0,1,2,3].map(i => (
        <text key={i} x={60 + (i + 1) * (stageW + 14) - 7} y={542} fill="rgba(249,115,22,0.45)" fontSize="26" textAnchor="middle">→</text>
      ))}
    </svg>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// 15. RCM KPI — revenue cycle problem-state metrics (Prior Auth domain)
// ─────────────────────────────────────────────────────────────────────────────
const RCM_KPIS = [
  { label: 'Denial Rate',     value: '34%',       trend: '+12% YoY', color: '#ef4444', sub: 'of PA submissions denied by payer'        },
  { label: 'Avg Turnaround',  value: '18 days',   trend: '↑ 3 days', color: '#ef4444', sub: 'from intake to authorization decision'    },
  { label: 'First-Pass Rate', value: '42%',       trend: '↓ 8 pts',  color: '#ef4444', sub: 'approved without additional info request' },
  { label: 'Manual Load/Day', value: '127 cases', trend: '↑ 28%',    color: '#f59e0b', sub: 'per UR specialist — unsustainable volume' },
];

const RCMKPIScene: React.FC<{ frame: number }> = ({ frame }) => (
  <svg viewBox="0 0 1920 1080" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
    <text x="60" y="64" fill="rgba(255,255,255,0.7)" fontSize="26" fontWeight="700" letterSpacing="3">PRIOR AUTH — CURRENT STATE</text>
    <line x1="60" y1="76" x2="1860" y2="76" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
    {RCM_KPIS.map((k, i) => {
      const delay = i * 18;
      const prog  = Math.max(0, Math.min(1, (frame - delay) / 22));
      const col   = i % 2;
      const row   = Math.floor(i / 2);
      const kx    = 60  + col * 950;
      const ky    = 96  + row * 468;
      const pulse = 0.5 + 0.5 * Math.sin(frame * 0.12 + i);
      return (
        <g key={i} opacity={prog}>
          <rect x={kx} y={ky} width={890} height={430} rx="14"
            fill={k.color + '0d'} stroke={k.color + '55'} strokeWidth="1.5" />
          <rect x={kx} y={ky} width={890} height={54} rx="14" fill={k.color + '1a'} />
          <text x={kx + 24} y={ky + 38} fill={k.color} fontSize="20" fontWeight="700">{k.trend}</text>
          <text x={kx + 445} y={ky + 240} textAnchor="middle" fill={k.color} fontSize="108" fontWeight="900"
            style={{ filter: `drop-shadow(0 0 ${Math.round(14 * pulse)}px ${k.color})` }}>
            {k.value}
          </text>
          <text x={kx + 445} y={ky + 312} textAnchor="middle" fill="rgba(255,255,255,0.75)" fontSize="30" fontWeight="700">{k.label}</text>
          <text x={kx + 445} y={ky + 368} textAnchor="middle" fill="rgba(255,255,255,0.38)" fontSize="18">{k.sub}</text>
        </g>
      );
    })}
  </svg>
);

// ─────────────────────────────────────────────────────────────────────────────
// Main composition
// ─────────────────────────────────────────────────────────────────────────────

const BG = 'linear-gradient(145deg, #060d1c 0%, #09152a 55%, #0b1c38 100%)';

export const EnterpriseAnimatedBRoll: React.FC<EnterpriseAnimatedBRollProps> = ({
  animationType,
  subtitle,
  index,
  total,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const fadeIn  = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: 'clamp' });
  const fadeOut = interpolate(frame, [durationInFrames - 20, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp',
  });
  const opacity = Math.min(fadeIn, fadeOut);

  const subEnter  = spring({ frame: Math.max(0, frame - 14), fps, from: 0, to: 1, config: { damping: 18 } });
  const subTransY = interpolate(subEnter, [0, 1], [14, 0]);

  return (
    <AbsoluteFill style={{ fontFamily: FONT_STACK, overflow: 'hidden', opacity }}>
      {/* Background */}
      <div style={{ position: 'absolute', inset: 0, background: BG }} />

      {/* Animated scene layer */}
      {animationType === 'iot-network'    && <IoTNetworkScene    frame={frame} fps={fps} />}
      {animationType === 'data-stream'    && <DataStreamScene    frame={frame} />}
      {animationType === 'alert-cascade'  && <AlertCascadeScene  frame={frame} fps={fps} />}
      {animationType === 'ai-prediction'  && <AIPredictionScene  frame={frame} />}
      {animationType === 'global-fleet'   && <GlobalFleetScene   frame={frame} fps={fps} />}
      {animationType === 'ticket-flood'   && <TicketFloodScene   frame={frame} fps={fps} />}
      {animationType === 'sla-breach'     && <SLABreachScene     frame={frame} fps={fps} />}
      {animationType === 'multi-channel'  && <MultiChannelScene  frame={frame} fps={fps} />}
      {animationType === 'ai-triage'      && <AITriageScene      frame={frame} fps={fps} />}
      {animationType === 'kpi-metrics'    && <KPIMetricsScene    frame={frame} />}
      {animationType === 'pa-intake'      && <PAIntakeScene      frame={frame} fps={fps} />}
      {animationType === 'clinical-nlp'   && <ClinicalNLPScene   frame={frame} fps={fps} />}
      {animationType === 'policy-engine'  && <PolicyEngineScene  frame={frame} fps={fps} />}
      {animationType === 'auth-pipeline'  && <AuthPipelineScene  frame={frame} fps={fps} />}
      {animationType === 'rcm-kpi'        && <RCMKPIScene        frame={frame} />}

      {/* Subtitle pill — mirrors reference video caption style */}
      <div style={{
        position:  'absolute', bottom: 42, left: 0, right: 0,
        display:   'flex', justifyContent: 'center',
        opacity:   subEnter,
        transform: `translateY(${subTransY}px)`,
        pointerEvents: 'none',
      }}>
        <div style={{
          padding:    '14px 44px',
          background: 'rgba(0,0,0,0.58)',
          borderRadius: 8,
          border:     '1px solid rgba(255,255,255,0.09)',
          maxWidth:   '70%',
          textAlign:  'center',
        }}>
          <span style={{
            color:       '#ffffff',
            fontSize:    34,
            fontWeight:  600,
            lineHeight:  1.3,
            letterSpacing: '-0.3px',
          }}>
            {subtitle}
          </span>
        </div>
      </div>

      {/* Scene progress bar — 4px dots at bottom */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, height: 4,
        display: 'flex', gap: 2,
      }}>
        {Array.from({ length: total }).map((_, i) => (
          <div key={i} style={{
            flex: 1, height: '100%',
            background: i <= index ? 'rgba(10,147,211,0.80)' : 'rgba(255,255,255,0.10)',
          }} />
        ))}
      </div>
    </AbsoluteFill>
  );
};
