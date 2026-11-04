import type { ThemeId } from '../data/settings';

export const THEMES: ThemeId[] = ['red', 'blue', 'dark', 'light', 'minimal', 'glass'];

export const THEME_LABEL = {
  red: 'themeRed',
  blue: 'themeBlue',
  dark: 'themeDark',
  light: 'themeLight',
  minimal: 'themeMinimal',
  glass: 'themeGlass',
} as const;
