import React from 'react';
import { Box, IconButton, Menu, MenuItem, Tooltip } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { US, CN, FR, DE, ES, IT, PT, PL, NL } from 'country-flag-icons/react/3x2';

const LANGUAGES: {
  code: string;
  // `country-flag-icons` components have slightly different prop typings than React's
  // built-in `SVGProps<SVGSVGElement>` (notably around event targets). We only pass
  // `title` + `style`, so keep this permissive to avoid TS friction.
  Flag: React.ComponentType<Record<string, unknown>>;
  label: string;
}[] = [
  { code: 'en', Flag: US, label: 'English' },
  { code: 'fr', Flag: FR, label: 'Français' },
  { code: 'de', Flag: DE, label: 'Deutsch' },
  { code: 'es', Flag: ES, label: 'Español' },
  { code: 'it', Flag: IT, label: 'Italiano' },
  { code: 'pt-PT', Flag: PT, label: 'Português' },
  { code: 'pl', Flag: PL, label: 'Polski' },
  { code: 'nl', Flag: NL, label: 'Nederlands' },
  { code: 'zh-CN', Flag: CN, label: '简体中文' },
];

function normalizeLanguageCode(raw: string): string {
  const lng = raw || 'en';
  if (lng.startsWith('zh')) return 'zh-CN';
  if (lng.startsWith('pt')) return 'pt-PT';
  if (lng.startsWith('fr')) return 'fr';
  if (lng.startsWith('de')) return 'de';
  if (lng.startsWith('es')) return 'es';
  if (lng.startsWith('it')) return 'it';
  if (lng.startsWith('pl')) return 'pl';
  if (lng.startsWith('nl')) return 'nl';
  if (lng.startsWith('en')) return 'en';
  return 'en';
}

export const LanguageSwitcher: React.FC = () => {
  const { i18n } = useTranslation();
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);

  const raw = i18n.language || i18n.resolvedLanguage || 'en';
  const current = normalizeLanguageCode(raw);
  const currentLang = LANGUAGES.find((l) => l.code === current) ?? LANGUAGES[0];

  const handleOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleSelect = (code: string) => {
    void i18n.changeLanguage(code);
    handleClose();
  };

  const isSelected = (code: string) => code === current;

  return (
    <>
      <Tooltip title={currentLang.label}>
        <IconButton
          onClick={handleOpen}
          size="small"
          aria-label={`Language: ${currentLang.label}`}
          sx={{ p: 0.75 }}
        >
          <Box
            component="span"
            sx={{
              width: 22,
              height: 16,
              borderRadius: 0.5,
              overflow: 'hidden',
              display: 'block',
              boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.18)',
            }}
          >
            <currentLang.Flag
              title={currentLang.label}
              style={{ width: '100%', height: '100%', display: 'block' }}
            />
          </Box>
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {LANGUAGES.map(({ code, Flag, label }) => (
          <MenuItem
            key={code}
            selected={isSelected(code)}
            onClick={() => handleSelect(code)}
            sx={{ minHeight: 40 }}
            aria-label={label}
          >
            <Box
              component="span"
              sx={{
                width: 28,
                height: 20,
                borderRadius: 0.5,
                overflow: 'hidden',
                display: 'block',
                boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.18)',
              }}
            >
              <Flag title={label} style={{ width: '100%', height: '100%', display: 'block' }} />
            </Box>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
};
