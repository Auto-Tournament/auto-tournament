import React from 'react';
import { Box, IconButton, Menu, MenuItem, ListItemText, Tooltip } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import PaletteIcon from '@mui/icons-material/Palette';
import { useTranslation } from 'react-i18next';
import { THEME_IDS, THEME_NAMES, THEME_COLORS, activeThemeId, setTheme, type ThemeId } from '../../theme';
import { tokens } from '../../theme/tokens';

/** A small two-tone dot: theme paper behind, theme accent on top. */
function ThemeSwatch({ id }: { id: ThemeId }) {
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

export const ThemeSwitcher: React.FC = () => {
  const { t } = useTranslation();
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);

  const handleOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleSelect = (id: ThemeId) => {
    handleClose();
    if (id === activeThemeId) return;
    setTheme(id);
  };

  const label = t('theme.label');

  return (
    <>
      <Tooltip title={label}>
        <IconButton
          onClick={handleOpen}
          size="small"
          aria-label={label}
          data-testid="theme-switcher-button"
          sx={{ p: 0.75 }}
        >
          <PaletteIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
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
    </>
  );
};
