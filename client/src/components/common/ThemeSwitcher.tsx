import React from 'react';
import { Box, Menu, MenuItem, ListItemText } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import { useTranslation } from 'react-i18next';
import { THEME_IDS, THEME_NAMES, THEME_COLORS, activeThemeId, setTheme, type ThemeId } from '../../theme';
import { tokens } from '../../theme/tokens';

/** A small two-tone dot: theme paper behind, theme accent on top. */
export function ThemeSwatch({ id }: { id: ThemeId }) {
  const colors = THEME_COLORS[id];
  return (
    <Box
      component="span"
      sx={{
        width: 20,
        height: 20,
        borderRadius: '50%',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.paper,
        border: `1px solid ${tokens.color.rule}`,
        flexShrink: 0,
      }}
    >
      <Box
        component="span"
        sx={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          backgroundColor: colors.accent,
        }}
      />
    </Box>
  );
}

/** The active theme, for the account menu's "Theme" row. */
export const activeTheme = { id: activeThemeId, name: THEME_NAMES[activeThemeId] } as const;

export type ThemeMenuProps = {
  /** Where the menu opens: the account button, so it reads as a sub-menu. */
  anchorEl: HTMLElement | null;
  onClose: () => void;
};

/**
 * The colour theme picker. It lives in the account menu: in the 3.0 drafts
 * the bar holds the logo, the links and the avatar, nothing else. Picking a
 * theme saves it and reloads (see `setTheme`).
 */
export const ThemeMenu: React.FC<ThemeMenuProps> = ({ anchorEl, onClose }) => {
  const { t } = useTranslation();

  const handleSelect = (id: ThemeId) => {
    onClose();
    if (id === activeThemeId) return;
    setTheme(id);
  };

  return (
    <Menu
      anchorEl={anchorEl}
      open={Boolean(anchorEl)}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      slotProps={{ list: { 'aria-label': t('theme.label') } }}
    >
      {THEME_IDS.map((id) => (
        <MenuItem
          key={id}
          selected={id === activeThemeId}
          onClick={() => handleSelect(id)}
          data-testid={`theme-option-${id}`}
          sx={{ minHeight: 40, gap: 1.25 }}
        >
          <ThemeSwatch id={id} />
          <ListItemText primary={THEME_NAMES[id]} />
          {id === activeThemeId ? <CheckIcon fontSize="small" sx={{ ml: 1, color: 'primary.main' }} /> : null}
        </MenuItem>
      ))}
    </Menu>
  );
};
