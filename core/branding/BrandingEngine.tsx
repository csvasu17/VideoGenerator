// Wraps a video project with theme context and branding data.
import React from 'react';
import {ThemeProvider, resolveTheme} from '../themes';
import type {ProjectConfig} from '../types';

interface Props {
  project: ProjectConfig;
  children: React.ReactNode;
}

export const BrandingEngine: React.FC<Props> = ({project, children}) => {
  const theme = resolveTheme(project.theme);
  return <ThemeProvider theme={theme}>{children}</ThemeProvider>;
};
