import React, {createContext, useContext} from 'react';
import type {ThemeConfig} from '../types';
import {darkTheme} from './dark';

const ThemeCtx = createContext<ThemeConfig>(darkTheme);

export const ThemeProvider: React.FC<{theme: ThemeConfig; children: React.ReactNode}> =
  ({theme, children}) => <ThemeCtx.Provider value={theme}>{children}</ThemeCtx.Provider>;

export const useTheme = (): ThemeConfig => useContext(ThemeCtx);
