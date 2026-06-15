// Merge a project theme override into the base dark theme
import type {ThemeConfig, ProjectThemeOverride} from '../types';
import {darkTheme} from './dark';

export function resolveTheme(override: ProjectThemeOverride = {}): ThemeConfig {
  const t = JSON.parse(JSON.stringify(darkTheme)) as ThemeConfig;
  if (override.background)   t.colors.background = override.background;
  if (override.primaryColor) {
    t.colors.blue.primary = override.primaryColor;
    t.colors.border.blue  = hexAlpha(override.primaryColor, 0.35);
    t.colors.blue.subtle  = hexAlpha(override.primaryColor, 0.08);
    t.colors.blue.glow    = hexAlpha(override.primaryColor, 0.35);
  }
  if (override.accentColor) {
    t.colors.orange.primary = override.accentColor;
    t.colors.border.orange  = hexAlpha(override.accentColor, 0.35);
    t.colors.orange.subtle  = hexAlpha(override.accentColor, 0.08);
    t.colors.orange.glow    = hexAlpha(override.accentColor, 0.35);
  }
  return t;
}

function hexAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}
