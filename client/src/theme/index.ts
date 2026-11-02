import { createAtTheme } from '@auto-tournament/ui';
import '@fontsource/sora/600.css';
import '@fontsource/sora/700.css';
import '@fontsource/geist/400.css';
import '@fontsource/geist/500.css';
import '@fontsource/geist/600.css';
import '@fontsource/geist-mono/400.css';
import '@fontsource/geist-mono/500.css';
import '@fontsource/geist-mono/600.css';
import { moduleIconVars } from './moduleIcons';
import { activeThemeId } from './tokens';

export {
  tokens,
  radii,
  textSize,
  fontBody,
  fontDisplay,
  fontMono,
  mono,
  withAlpha,
  gameTintPalette,
  activeThemeId,
  setTheme,
} from './tokens';
export { THEME_IDS, THEME_NAMES, THEME_COLORS, type ThemeId } from './themes';

/** The app theme, from the design system. */
export const theme = createAtTheme({ themeId: activeThemeId, rootVars: moduleIconVars });
