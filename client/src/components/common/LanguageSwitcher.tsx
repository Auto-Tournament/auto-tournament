import React from 'react';
import { Box, ListItemText, Menu, MenuItem } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import { useTranslation } from 'react-i18next';
import * as Flags from 'country-flag-icons/react/3x2';
import { tokens } from '../../theme/tokens';

type Language = {
  code: string;
  flagCode: string;
  label: string;
};

const LANGUAGES: Language[] = [
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

export function FlagIcon({ code }: { code: string }) {
  const C = FlagByCode[code] ?? FlagByCode.GB;
  return (
    <Box
      component="span"
      sx={{
        width: 26,
        height: 19,
        flexShrink: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        borderRadius: '7px',
        border: `1px solid ${tokens.color.rule}`,
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

/** The language the UI is in now, for the account menu's "Language" row. */
export function useCurrentLanguage(): Language {
  const { i18n } = useTranslation();
  const current = normalizeLanguageCode(i18n.language || i18n.resolvedLanguage || 'en');
  return LANGUAGES.find((l) => l.code === current) ?? LANGUAGES[0];
}

export type LanguageMenuProps = {
  /** Where the menu opens: the account button, so it reads as a sub-menu. */
  anchorEl: HTMLElement | null;
  onClose: () => void;
};

/** The language picker. It lives in the account menu, next to the theme. */
export const LanguageMenu: React.FC<LanguageMenuProps> = ({ anchorEl, onClose }) => {
  const { t, i18n } = useTranslation();
  const current = useCurrentLanguage();

  const handleSelect = (code: string) => {
    void i18n.changeLanguage(code);
    onClose();
  };

  return (
    <Menu
      anchorEl={anchorEl}
      open={Boolean(anchorEl)}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      slotProps={{ list: { 'aria-label': t('nav.language') } }}
    >
      {LANGUAGES.map(({ code, flagCode, label }) => (
        <MenuItem
          key={code}
          selected={code === current.code}
          onClick={() => handleSelect(code)}
          lang={code}
          data-testid={`language-option-${code}`}
          sx={{ minHeight: 40, gap: 1.25 }}
        >
          <FlagIcon code={flagCode} />
          <ListItemText primary={label} />
          {code === current.code ? (
            <CheckIcon fontSize="small" sx={{ ml: 1, color: 'primary.main' }} />
          ) : null}
        </MenuItem>
      ))}
    </Menu>
  );
};
