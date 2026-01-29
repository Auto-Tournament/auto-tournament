import React from 'react';
import { Box, IconButton, Menu, MenuItem, Tooltip } from '@mui/material';
import { useTranslation } from 'react-i18next';
import * as Flags from 'country-flag-icons/react/3x2';

const LANGUAGES: {
  code: string;
  flagCode: string;
  label: string;
}[] = [
  { code: 'en', flagCode: 'GB', label: 'English' },
  { code: 'fr', flagCode: 'FR', label: 'Français' },
  { code: 'de', flagCode: 'DE', label: 'Deutsch' },
  { code: 'es', flagCode: 'ES', label: 'Español' },
  { code: 'it', flagCode: 'IT', label: 'Italiano' },
  { code: 'pt-PT', flagCode: 'PT', label: 'Português' },
  { code: 'pl', flagCode: 'PL', label: 'Polski' },
  { code: 'nl', flagCode: 'NL', label: 'Nederlands' },
  { code: 'zh-CN', flagCode: 'CN', label: '简体中文' },
  { code: 'nb', flagCode: 'NO', label: 'Norsk bokmål' },
];

type FlagComponent = React.ComponentType<Record<string, never>>;
const FlagByCode = Flags as unknown as Record<string, FlagComponent>;

function FlagIcon({ code }: { code: string }) {
  const C = FlagByCode[code] ?? FlagByCode.GB;
  return (
    <Box
      component="span"
      sx={{
        width: 26,
        height: 19,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        borderRadius: '7px',
        border: '1px solid rgba(255, 255, 255, 0.18)',
        boxShadow: '0 1px 2px rgba(0, 0, 0, 0.35)',
        '& svg': {
          width: '100%',
          height: '100%',
          display: 'block',
        },
      }}
    >
      <C />
    </Box>
  );
}

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
  if (lng.startsWith('nb') || lng.startsWith('no')) return 'nb';
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
          <FlagIcon code={currentLang.flagCode} />
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {LANGUAGES.map(({ code, flagCode, label }) => (
          <MenuItem
            key={code}
            selected={isSelected(code)}
            onClick={() => handleSelect(code)}
            sx={{ minHeight: 40 }}
            aria-label={label}
          >
            <FlagIcon code={flagCode} />
          </MenuItem>
        ))}
      </Menu>
    </>
  );
};
