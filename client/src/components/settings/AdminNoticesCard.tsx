/**
 * Settings → Admin notifications: per kind of notice, off, the bell, or the
 * bell with a sound (api services/adminNoticeService.ts). Saved per change.
 */
import React from 'react';
import { Box, MenuItem, Select, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { api } from '../../utils/api';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { tokens } from '../../theme/tokens';
import { SettingsCardHead } from './SettingsRow';
import { NOTICE_GROUPS, type AdminNoticeDelivery } from '../admin/adminNoticeText';

const { color } = tokens;

export function AdminNoticesCard() {
  const { t } = useTranslation();
  const { showError } = useSnackbar();
  const [settings, setSettings] = React.useState<Record<string, AdminNoticeDelivery> | null>(null);

  React.useEffect(() => {
    api
      .get<{ success: boolean; settings: Record<string, AdminNoticeDelivery> }>(
        '/api/admin-notices/settings'
      )
      .then((res) => setSettings(res.settings))
      .catch(() => setSettings({}));
  }, []);

  const change = async (kind: string, value: AdminNoticeDelivery) => {
    const before = settings;
    setSettings((s) => ({ ...(s ?? {}), [kind]: value }));
    try {
      const res = await api.put<{ settings: Record<string, AdminNoticeDelivery> }>(
        '/api/admin-notices/settings',
        {
          [kind]: value,
        }
      );
      setSettings(res.settings);
    } catch (error) {
      setSettings(before);
      showError((error as Error).message || t('adminNotices.saveFailed'));
    }
  };

  return (
    <Box data-testid="admin-notices-settings">
      <SettingsCardHead
        title={t('adminNotices.settingsTitle')}
        hint={t('adminNotices.settingsHint')}
      />
      {settings && (
        <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
          {Object.entries(NOTICE_GROUPS).map(([group, kinds]) => (
            <Box key={group} sx={{ display: 'grid', gap: 0.75 }}>
              <Typography
                sx={{
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: color.muted,
                }}
              >
                {t(`adminNotices.group.${group}`)}
              </Typography>
              {kinds.map((kind) => (
                <Box
                  key={kind}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 2,
                  }}
                >
                  <Typography sx={{ fontSize: '0.875rem', minWidth: 0 }}>
                    {t(`adminNotices.name.${kind}`)}
                  </Typography>
                  <Select
                    size="small"
                    value={settings[kind] ?? 'bell'}
                    onChange={(e) => void change(kind, e.target.value as AdminNoticeDelivery)}
                    inputProps={{
                      'aria-label': t(`adminNotices.name.${kind}`),
                      'data-testid': `admin-notice-setting-${kind}`,
                    }}
                    sx={{ minWidth: 150 }}
                  >
                    <MenuItem value="off">{t('adminNotices.delivery.off')}</MenuItem>
                    <MenuItem value="bell">{t('adminNotices.delivery.bell')}</MenuItem>
                    <MenuItem value="sound">{t('adminNotices.delivery.sound')}</MenuItem>
                  </Select>
                </Box>
              ))}
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
