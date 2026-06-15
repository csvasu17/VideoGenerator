/**
 * DashboardReveal — simulated live-dashboard scene for Remotion.
 *
 * Animation sequence:
 *   0 – 50f  : Dashboard window slides up from bottom + fades in
 *  20 – 50f  : Browser chrome + app header fade in
 *  40 – 90f  : KPI strip cards stagger in (translateY + opacity)
 *  70 – 130f : Alert rows slide in from left with stagger
 *  80 – 140f : Site-health bars fill in
 * calloutDelay : CalloutTooltip pops in with scale punch + ping
 *
 * Default data is Rheem-branded, but every prop is overridable.
 */
import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate} from 'remotion';
import {theme} from '../config/theme';
import {Springs, staggerDelay, glowPulse} from '../utils/animations';
import {cinematicFade} from '../../core/utils/transitions';
import {CalloutTooltip} from '../components/CalloutTooltip';

interface MockKPI {
  label: string;
  value: string;
  delta?: string;
  positive?: boolean;
}

interface MockAlert {
  device: string;
  issue: string;
  level: 'critical' | 'warning' | 'info';
}

interface SiteHealth {
  name: string;
  pct: number;
}

interface CalloutDef {
  icon?: string;
  title: string;
  value: string;
  description?: string;
}

interface Props {
  kpis?: MockKPI[];
  alerts?: MockAlert[];
  sites?: SiteHealth[];
  accent?: 'blue' | 'orange';
  callout?: CalloutDef;
  /** Frame at which the callout tooltip appears */
  calloutDelay?: number;
}

// ─── Rheem defaults ───────────────────────────────────────────────────────────

const DEFAULT_KPIS: MockKPI[] = [
  {label: 'Connected Devices', value: '27',   delta: '+3 this week', positive: true},
  {label: 'Online Now',        value: '100%', delta: '0 offline',    positive: true},
  {label: 'Active Alerts',     value: '4',    delta: '2 critical',   positive: false},
  {label: 'AI Predictions',    value: '2',    delta: 'Next 72 hours', positive: false},
];

const DEFAULT_ALERTS: MockAlert[] = [
  {device: 'RTU F202401391', issue: 'Temp threshold exceeded — Floor 3',    level: 'critical'},
  {device: 'RTU A109821044', issue: 'Refrigerant pressure low — Site 2',    level: 'warning'},
  {device: 'RTU B200134921', issue: 'AI: failure risk HIGH within 72h',     level: 'critical'},
  {device: 'RTU C103920111', issue: 'Scheduled maintenance due in 3 days',  level: 'info'},
];

const DEFAULT_SITES: SiteHealth[] = [
  {name: 'Site A — Chicago',  pct: 98},
  {name: 'Site B — Houston',  pct: 100},
  {name: 'Site C — Phoenix',  pct: 94},
];

const DEFAULT_CALLOUT: CalloutDef = {
  icon: '⚡',
  title: 'Live Fleet Monitor',
  value: '27 Devices',
  description: 'All connected · Real-time',
};

// ─── Sub-components ───────────────────────────────────────────────────────────

const alertColors: Record<MockAlert['level'], string> = {
  critical: '#FF6B00',
  warning:  '#FBBF24',
  info:     '#0066FF',
};

const alertIcons: Record<MockAlert['level'], string> = {
  critical: '🔴',
  warning:  '🟡',
  info:     '🔵',
};

// ─── Main component ───────────────────────────────────────────────────────────

export const DashboardReveal: React.FC<Props> = ({
  kpis          = DEFAULT_KPIS,
  alerts        = DEFAULT_ALERTS,
  sites         = DEFAULT_SITES,
  accent        = 'blue',
  callout       = DEFAULT_CALLOUT,
  calloutDelay  = 100,
}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();

  const accentColor  = accent === 'blue' ? theme.colors.blue.primary  : theme.colors.orange.primary;
  const accentGlow   = accent === 'blue' ? theme.colors.blue.glow     : theme.colors.orange.glow;
  const accentSubtle = accent === 'blue' ? theme.colors.blue.subtle   : theme.colors.orange.subtle;
  const pulse        = glowPulse(frame, fps, 0.38);
  const sceneOp      = cinematicFade(frame, durationInFrames, 20, 24);

  // ── Dashboard window slide-in ──────────────────────────────────────────────
  const winP      = spring({fps, frame: frame - 0, config: Springs.cinematic, durationInFrames: 50});
  const winTY     = interpolate(winP, [0,1], [90, 0],   {extrapolateLeft:'clamp', extrapolateRight:'clamp'});
  const winScale  = interpolate(winP, [0,1], [0.95,1.0], {extrapolateLeft:'clamp', extrapolateRight:'clamp'});
  const winOp     = interpolate(winP, [0,0.2,1], [0,1,1], {extrapolateLeft:'clamp', extrapolateRight:'clamp'});

  // ── Header fade ────────────────────────────────────────────────────────────
  const headerP = spring({fps, frame: frame - 22, config: Springs.gentle, durationInFrames: 28});
  const headerOp = interpolate(headerP, [0,0.4,1], [0,1,1], {extrapolateLeft:'clamp', extrapolateRight:'clamp'});

  return (
    <AbsoluteFill style={{background: theme.colors.background, opacity: sceneOp}}>

      {/* ── Ambient background glow ─────────────────────────────────────── */}
      <div style={{
        position: 'absolute', top: '-15%', left: '-8%',
        width: 920, height: 920, borderRadius: '50%',
        background: `radial-gradient(circle, rgba(0,102,255,${0.10 + pulse * 0.05}) 0%, transparent 68%)`,
        filter: 'blur(55px)', pointerEvents: 'none',
      }}/>
      <div style={{
        position: 'absolute', bottom: '-18%', right: '-8%',
        width: 840, height: 840, borderRadius: '50%',
        background: `radial-gradient(circle, rgba(255,107,0,${0.06 + pulse * 0.04}) 0%, transparent 68%)`,
        filter: 'blur(55px)', pointerEvents: 'none',
      }}/>

      {/* ── Scene label (top-left eyebrow) ──────────────────────────────── */}
      <div style={{
        position: 'absolute', top: 44, left: 80,
        fontFamily: theme.fonts.heading, fontSize: 12, fontWeight: 700,
        color: accentColor, letterSpacing: '0.14em', textTransform: 'uppercase' as const,
        opacity: headerOp,
      }}>
        Live Dashboard
      </div>

      {/* ── Dashboard window ────────────────────────────────────────────── */}
      <div style={{
        position: 'absolute', top: '50%', left: '50%',
        transform: `translate(-50%, calc(-50% + ${winTY}px)) scale(${winScale})`,
        opacity: winOp,
        width: 1460,
        background: theme.colors.backgroundSecondary,
        border: `1px solid ${theme.colors.border.normal}`,
        borderRadius: 16,
        overflow: 'hidden',
        boxShadow: `0 40px 120px rgba(0,0,0,0.65), 0 0 80px ${accentGlow}`,
      }}>

        {/* Browser chrome bar */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px',
          background: theme.colors.background,
          borderBottom: `1px solid ${theme.colors.border.subtle}`,
        }}>
          {/* Traffic lights */}
          {(['#FF5F57','#FEBC2E','#28C840'] as const).map((c, i) => (
            <div key={i} style={{width: 12, height: 12, borderRadius: '50%', background: c}}/>
          ))}
          {/* URL bar */}
          <div style={{
            flex: 1, marginLeft: 8, height: 24, borderRadius: 6,
            background: 'rgba(255,255,255,0.04)', border: `1px solid ${theme.colors.border.subtle}`,
            display: 'flex', alignItems: 'center', paddingLeft: 12,
            fontFamily: theme.fonts.mono, fontSize: 11, color: theme.colors.text.tertiary,
          }}>
            app.rheem-totalview.com/dashboard
          </div>
        </div>

        {/* App navigation header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 28px',
          background: theme.colors.background,
          borderBottom: `1px solid ${theme.colors.border.subtle}`,
          opacity: headerOp,
        }}>
          {/* Logo */}
          <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
            <div style={{
              width: 28, height: 28, borderRadius: 7,
              background: `linear-gradient(135deg, ${accentColor}, ${accentColor}88)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14,
            }}>🔥</div>
            <div style={{fontFamily: theme.fonts.heading, fontSize: 15, fontWeight: 700, color: theme.colors.text.primary}}>
              Rheem TotalView
            </div>
          </div>
          {/* Nav items */}
          <div style={{display: 'flex', gap: 24}}>
            {['Dashboard','Devices','Alarms','AI Predict','Reports'].map((nav, i) => (
              <div key={i} style={{
                fontFamily: theme.fonts.body, fontSize: 13,
                fontWeight: i === 0 ? 600 : 400,
                color: i === 0 ? accentColor : theme.colors.text.tertiary,
              }}>
                {nav}
              </div>
            ))}
          </div>
          {/* Avatar */}
          <div style={{
            width: 30, height: 30, borderRadius: '50%',
            background: accentSubtle, border: `1px solid ${accentGlow}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14,
          }}>
            👤
          </div>
        </div>

        {/* KPI strip */}
        <div style={{
          display: 'flex', padding: '18px 28px',
          borderBottom: `1px solid ${theme.colors.border.subtle}`,
          gap: 0,
        }}>
          {kpis.map((kpi, idx) => {
            const kpiP = spring({fps, frame: frame - 40 - staggerDelay(idx, 10), config: Springs.cinematic, durationInFrames: 40});
            return (
              <div key={idx} style={{
                flex: 1, display: 'flex', flexDirection: 'column', gap: 3,
                padding: '0 20px',
                borderRight: idx < kpis.length - 1 ? `1px solid ${theme.colors.border.subtle}` : 'none',
                opacity: interpolate(kpiP, [0,0.2,1], [0,1,1], {extrapolateLeft:'clamp', extrapolateRight:'clamp'}),
                transform: `translateY(${interpolate(kpiP, [0,1], [14,0])}px)`,
              }}>
                <div style={{
                  fontFamily: theme.fonts.body, fontSize: 10, fontWeight: 600,
                  color: theme.colors.text.tertiary, letterSpacing: '0.07em', textTransform: 'uppercase' as const,
                }}>
                  {kpi.label}
                </div>
                <div style={{
                  fontFamily: theme.fonts.heading, fontSize: 26, fontWeight: 800,
                  color: theme.colors.text.primary, letterSpacing: '-0.02em',
                }}>
                  {kpi.value}
                </div>
                {kpi.delta && (
                  <div style={{
                    fontFamily: theme.fonts.body, fontSize: 10, fontWeight: 600,
                    color: kpi.positive ? '#22C55E' : theme.colors.orange.primary,
                  }}>
                    {kpi.positive ? '▲' : '▼'} {kpi.delta}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Content area — alerts + site health */}
        <div style={{display: 'flex', padding: '20px 28px', gap: 20}}>

          {/* Alert list */}
          <div style={{flex: 1, display: 'flex', flexDirection: 'column', gap: 10}}>
            <div style={{
              fontFamily: theme.fonts.heading, fontSize: 11, fontWeight: 700,
              color: theme.colors.text.secondary, letterSpacing: '0.10em',
              textTransform: 'uppercase' as const, marginBottom: 4,
              opacity: interpolate(
                spring({fps, frame: frame - 60, config: Springs.gentle, durationInFrames: 22}),
                [0,0.4,1],[0,1,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}),
            }}>
              Active Alerts
            </div>
            {alerts.map((alert, idx) => {
              const aP = spring({fps, frame: frame - 70 - staggerDelay(idx, 9), config: Springs.cinematic, durationInFrames: 35});
              return (
                <div key={idx} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 14px',
                  background: theme.colors.backgroundCard,
                  border: `1px solid ${theme.colors.border.subtle}`,
                  borderLeft: `3px solid ${alertColors[alert.level]}`,
                  borderRadius: 8,
                  opacity: interpolate(aP, [0,0.2,1], [0,1,1], {extrapolateLeft:'clamp', extrapolateRight:'clamp'}),
                  transform: `translateX(${interpolate(aP, [0,1], [-24,0])}px)`,
                }}>
                  <span style={{fontSize: 14}}>{alertIcons[alert.level]}</span>
                  <div style={{flex: 1}}>
                    <div style={{fontFamily: theme.fonts.heading, fontSize: 12, fontWeight: 600, color: theme.colors.text.primary}}>
                      {alert.device}
                    </div>
                    <div style={{fontFamily: theme.fonts.body, fontSize: 11, color: theme.colors.text.secondary}}>
                      {alert.issue}
                    </div>
                  </div>
                  <div style={{
                    fontFamily: theme.fonts.body, fontSize: 9, fontWeight: 700,
                    color: alertColors[alert.level], letterSpacing: '0.08em',
                    textTransform: 'uppercase' as const,
                  }}>
                    {alert.level}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Site health panel */}
          <div style={{width: 210, display: 'flex', flexDirection: 'column', gap: 10}}>
            <div style={{
              fontFamily: theme.fonts.heading, fontSize: 11, fontWeight: 700,
              color: theme.colors.text.secondary, letterSpacing: '0.10em',
              textTransform: 'uppercase' as const, marginBottom: 4,
              opacity: interpolate(
                spring({fps, frame: frame - 60, config: Springs.gentle, durationInFrames: 22}),
                [0,0.4,1],[0,1,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}),
            }}>
              Site Health
            </div>
            {sites.map((site, idx) => {
              const sP = spring({fps, frame: frame - 80 - staggerDelay(idx, 10), config: Springs.cinematic, durationInFrames: 35});
              const barP = spring({fps, frame: frame - 90 - staggerDelay(idx, 10), config: Springs.swell, durationInFrames: 45});
              const barColor = site.pct >= 99 ? '#22C55E' : site.pct >= 95 ? '#FBBF24' : theme.colors.orange.primary;
              const barWidth = interpolate(barP, [0,1], [0, site.pct], {extrapolateLeft:'clamp', extrapolateRight:'clamp'});
              return (
                <div key={idx} style={{
                  padding: '10px 12px',
                  background: theme.colors.backgroundCard,
                  border: `1px solid ${theme.colors.border.subtle}`,
                  borderRadius: 8,
                  opacity: interpolate(sP, [0,0.2,1], [0,1,1], {extrapolateLeft:'clamp', extrapolateRight:'clamp'}),
                  transform: `translateY(${interpolate(sP, [0,1], [12,0])}px)`,
                }}>
                  <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: 6}}>
                    <div style={{fontFamily: theme.fonts.body, fontSize: 11, color: theme.colors.text.secondary}}>
                      {site.name}
                    </div>
                    <div style={{fontFamily: theme.fonts.heading, fontSize: 11, fontWeight: 700, color: barColor}}>
                      {site.pct}%
                    </div>
                  </div>
                  <div style={{height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2}}>
                    <div style={{
                      height: '100%', width: `${barWidth}%`,
                      background: barColor, borderRadius: 2,
                      boxShadow: `0 0 6px ${barColor}`,
                    }}/>
                  </div>
                </div>
              );
            })}
          </div>

        </div>
      </div>

      {/* ── Callout tooltip ──────────────────────────────────────────────── */}
      {callout && (
        <div style={{position: 'absolute', top: '26%', right: '8%'}}>
          <CalloutTooltip
            icon={callout.icon}
            title={callout.title}
            value={callout.value}
            description={callout.description}
            delay={calloutDelay}
            accent={accent}
            arrowSide="none"
          />
        </div>
      )}

    </AbsoluteFill>
  );
};
