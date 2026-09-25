import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';
import { api, apiErrorMessage } from '../../utils/api';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { DEFAULT_SITE_NAME } from '../../hooks/useAdminHomeData';

/** The API's limit (`SITE_NAME_MAX_LENGTH`). */
const MAX_LENGTH = 80;

interface SettingsResponse {
  settings: { siteName?: string | null };
}

/**
 * Settings: the site's own name ("Edition 35 LAN"), the admin home's H1.
 * Stored like the other settings (`site_name`, `PUT /api/settings`); an empty
 * field goes back to "Auto Tournament". Saves on its own, so it never sends
 * the page's other fields.
 */
export function SiteNameCard() {
  const { t } = useTranslation();
  const { showSuccess, showError } = useSnackbar();
  const [saved, setSaved] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .get<SettingsResponse>('/api/settings')
      .then((res) => {
        const name = res.settings.siteName?.trim() || DEFAULT_SITE_NAME;
        setSaved(name);
        setValue(name);
      })
      .catch(() => setSaved(null));
  }, []);

  if (saved === null) return null;

  const trimmed = value.trim();
  const dirty = (trimmed || DEFAULT_SITE_NAME) !== saved;

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.put<SettingsResponse>('/api/settings', { siteName: trimmed || null });
      const name = res.settings.siteName?.trim() || DEFAULT_SITE_NAME;
      setSaved(name);
      setValue(name);
      showSuccess(t('settingsPage.site.saved'));
    } catch (err) {
      showError(apiErrorMessage(err, t('settingsPage.site.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box data-testid="settings-site-name-card">
      <Typography variant="h6" fontWeight={600} gutterBottom>
        {t('settingsPage.site.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" mb={2}>
        {t('settingsPage.site.description')}
      </Typography>
      <Stack
        component="form"
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        alignItems={{ sm: 'flex-start' }}
        onSubmit={(e: React.FormEvent) => {
          e.preventDefault();
          if (dirty) void save();
        }}
      >
        <TextField
          label={t('settingsPage.site.label')}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={saving}
          size="small"
          placeholder={DEFAULT_SITE_NAME}
          helperText={t('settingsPage.site.helper')}
          sx={{ flex: 1 }}
          slotProps={{ htmlInput: { maxLength: MAX_LENGTH, 'data-testid': 'settings-site-name-input' } }}
        />
        <Button
          type="submit"
          variant="contained"
          disabled={!dirty || saving}
          data-testid="settings-site-name-save"
        >
          {t('settingsPage.site.save')}
        </Button>
      </Stack>
    </Box>
  );
}
