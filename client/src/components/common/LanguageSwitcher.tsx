import React from 'react';
import { Box, ListItemText, Menu, MenuItem } from '@mui/material';
import { CheckIcon } from '@phosphor-icons/react';
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
  { code: 'es-419', flagCode: 'MX', label: 'Español (Latinoamérica)' },
  { code: 'it', flagCode: 'IT', label: 'Italiano' },
  { code: 'pt-PT', flagCode: 'PT', label: 'Português (Portugal)' },
  { code: 'pt-BR', flagCode: 'BR', label: 'Português (Brasil)' },
  { code: 'pl', flagCode: 'PL', label: 'Polski' },
  { code: 'nl', flagCode: 'NL', label: 'Nederlands' },
  { code: 'zh-CN', flagCode: 'CN', label: '简体中文' },
  { code: 'zh-TW', flagCode: 'TW', label: '繁體中文' },
  { code: 'nb', flagCode: 'NO', label: 'Norsk bokmål' },
  { code: 'ru', flagCode: 'RU', label: 'Русский' },
  { code: 'uk', flagCode: 'UA', label: 'Українська' },
  { code: 'tr', flagCode: 'TR', label: 'Türkçe' },
  { code: 'ja', flagCode: 'JP', label: '日本語' },
  { code: 'ko', flagCode: 'KR', label: '한국어' },
];

type FlagComponent = React.ComponentType<Record<string, never>>;
// eslint-disable-next-line no-restricted-syntax -- the flag package's namespace: one component per country code
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
  if (/^zh-(TW|HK|MO|Hant)/i.test(lng)) return 'zh-TW';
  if (lng.startsWith('zh')) return 'zh-CN';
  if (/^pt-BR/i.test(lng)) return 'pt-BR';
  if (lng.startsWith('pt')) return 'pt-PT';
  if (lng.startsWith('fr')) return 'fr';
  if (lng.startsWith('de')) return 'de';
  if (/^es-(?!ES$)/i.test(lng)) return 'es-419';
  if (lng.startsWith('es')) return 'es';
  if (lng.startsWith('it')) return 'it';
  if (lng.startsWith('pl')) return 'pl';
  if (lng.startsWith('nl')) return 'nl';
  if (lng.startsWith('nb') || lng.startsWith('no')) return 'nb';
  if (lng.startsWith('ru')) return 'ru';
  if (lng.startsWith('uk')) return 'uk';
  if (lng.startsWith('tr')) return 'tr';
  if (lng.startsWith('ja')) return 'ja';
  if (lng.startsWith('ko')) return 'ko';
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
            <Box component={CheckIcon} size={20} sx={{ ml: 1, color: 'primary.main' }} />
          ) : null}
        </MenuItem>
      ))}
    </Menu>
  );
};
