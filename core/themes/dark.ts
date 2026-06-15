// Premium dark theme — deep navy base with vivid accent colors
import type {ThemeConfig} from '../types';

export const darkTheme: ThemeConfig = {
  colors: {
    background:          '#060510',   // deep dark matching reference blob base
    backgroundSecondary: '#090B28',
    backgroundCard:      '#0C0E2A',   // card surface with blue tint
    backgroundCardHover: '#10143A',
    blue: {
      primary: '#0066FF',
      light:   '#3399FF',
      bright:  '#66BBFF',
      glow:    'rgba(0,102,255,0.35)',
      subtle:  'rgba(0,102,255,0.08)',
    },
    orange: {
      primary: '#FF6B00',
      light:   '#FF8C33',
      bright:  '#FFAA66',
      glow:    'rgba(255,107,0,0.35)',
      subtle:  'rgba(255,107,0,0.08)',
    },
    text: {
      primary:   '#FFFFFF',
      secondary: '#9090A8',
      tertiary:  '#555568',
      accent:    '#66B2FF',
    },
    border: {
      subtle: 'rgba(255,255,255,0.05)',
      normal: 'rgba(255,255,255,0.10)',
      bright: 'rgba(255,255,255,0.18)',
      blue:   'rgba(0,102,255,0.35)',
      orange: 'rgba(255,107,0,0.35)',
    },
  },
  fonts: {
    heading: '"Inter","SF Pro Display",system-ui,sans-serif',
    body:    '"Inter","SF Pro Text",system-ui,sans-serif',
    mono:    '"JetBrains Mono","SF Mono",monospace',
  },
  spacing: {xs:8, sm:16, md:24, lg:40, xl:64, xxl:96},
  radius:  {sm:8, md:12, lg:20, xl:32, full:9999},
};
