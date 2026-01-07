import React from 'react';
import { FormControl, InputLabel, MenuItem, Select, SelectChangeEvent } from '@mui/material';
import { useTranslation } from 'react-i18next';

export const LanguageSwitcher: React.FC = () => {
  const { i18n, t } = useTranslation();

  const handleChange = (event: SelectChangeEvent<string>) => {
    const nextLang = event.target.value;
    void i18n.changeLanguage(nextLang);
  };

  const current = i18n.language || i18n.resolvedLanguage || 'en';

  return (
    <FormControl size="small" variant="outlined">
      <InputLabel id="language-switcher-label">{t('language.label')}</InputLabel>
      <Select
        labelId="language-switcher-label"
        value={current}
        label={t('language.label')}
        onChange={handleChange}
      >
        {/* Language names are shown in their own language (not translated) */}
        <MenuItem value="en">English</MenuItem>
        <MenuItem value="zh-CN">简体中文</MenuItem>
      </Select>
    </FormControl>
  );
};


