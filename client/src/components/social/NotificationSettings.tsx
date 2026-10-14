/**
 * Notifications → Settings: per kind of notice, off, the bell, or the bell
 * with a sound (saved on the account, so every device follows); the sound
 * and its volume; and browser notifications while the tab is in the
 * background (per browser: the browser asks once).
 */
import React from 'react';
import { Box, Button, MenuItem, Select, Slider, Switch, Typography } from '@mui/material';
import { PlayIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { api } from '../../utils/api';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { useSoundSettings } from '../../hooks/useSoundSettings';
import { NOTIFICATION_SOUNDS } from '../../utils/soundNotification';
import {
  browserNotifyState,
  setBrowserNotify,
  type BrowserNotifyState,
} from '../../utils/browserNotify';
import { fontDisplay, tokens } from '../../theme/tokens';
import { Panel } from '../common/ui';
import type { Notice } from './socialStore';

const { color } = tokens;

type Delivery = 'off' | 'bell' | 'sound';
type Kind = Notice['kind'];

/** The kinds, grouped as the bell's filters group them. */
const GROUPS: Array<{ group: string; kinds: Kind[] }> = [
  { group: 'you', kinds: ['party_invite', 'team_invite', 'friend_request', 'friend_accepted'] },
  { group: 'tournaments', kinds: ['tournament'] },
  { group: 'skins', kinds: ['skin'] },
  { group: 'clips', kinds: ['highlight'] },
  { group: 'other', kinds: ['news', 'report'] },
];
/** Need an answer: never off. */
const ANSWERED: Kind[] = ['party_invite', 'team_invite', 'friend_request'];

const label = {
  fontSize: '0.75rem',
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: color.muted,
} as const;

function Line({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 2,
        flexWrap: 'wrap',
      }}
    >
      <Box sx={{ minWidth: 0, flex: '1 1 14rem' }}>
        <Typography sx={{ fontSize: '0.875rem' }}>{title}</Typography>
        {hint && <Typography sx={{ fontSize: '0.75rem', color: color.muted }}>{hint}</Typography>}
      </Box>
      {children}
    </Box>
  );
}

export function NotificationSettings() {
  const { t } = useTranslation();
  const { showError } = useSnackbar();
  const [settings, setSettings] = React.useState<Record<Kind, Delivery> | null>(null);
  const [browser, setBrowser] = React.useState<BrowserNotifyState>(() => browserNotifyState());
  const sound = useSoundSettings();

  React.useEffect(() => {
    api
      .get<{ settings: Record<Kind, Delivery> }>('/api/social/notifications/settings')
      .then((res) => setSettings(res.settings))
      .catch(() => setSettings(null));
  }, []);

  const change = async (kind: Kind, value: Delivery) => {
    const before = settings;
    setSettings((s) => (s ? { ...s, [kind]: value } : s));
    try {
      const res = await api.put<{ settings: Record<Kind, Delivery> }>(
        '/api/social/notifications/settings',
        { [kind]: value }
      );
      setSettings(res.settings);
    } catch (error) {
      setSettings(before);
      showError((error as Error).message || t('social.settings.saveFailed'));
    }
  };

  return (
    <Panel
      sx={{ p: { xs: 2, md: 3 }, display: 'grid', gap: 3 }}
      data-testid="notification-settings"
    >
      <Typography
        id="settings"
        component="h2"
        sx={{ fontFamily: fontDisplay, fontWeight: 600, fontSize: '1.125rem', scrollMarginTop: 96 }}
      >
        {t('social.noticeSettings.title')}
      </Typography>

      <Box sx={{ display: 'grid', gap: 1.25 }}>
        <Typography sx={label}>{t('social.noticeSettings.alerts')}</Typography>
        <Line
          title={t('social.noticeSettings.browser')}
          hint={
            browser === 'unsupported'
              ? t('social.noticeSettings.browserUnsupported')
              : browser === 'denied'
                ? t('social.noticeSettings.browserDenied')
                : t('social.noticeSettings.browserHint')
          }
        >
          <Switch
            checked={browser === 'on'}
            disabled={browser === 'unsupported' || browser === 'denied'}
            onChange={(e) => void setBrowserNotify(e.target.checked).then(setBrowser)}
            inputProps={{ 'aria-label': t('social.noticeSettings.browser') }}
            data-testid="notification-settings-browser"
          />
        </Line>
        <Line title={t('social.noticeSettings.sound')}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Select
              size="small"
              value={sound.soundFile}
              onChange={sound.handleSoundChange}
              inputProps={{ 'aria-label': t('social.noticeSettings.sound') }}
              sx={{ minWidth: 150, fontSize: '0.875rem' }}
            >
              {NOTIFICATION_SOUNDS.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
            <Button
              size="small"
              variant="outlined"
              startIcon={<PlayIcon size={14} />}
              onClick={sound.handlePreviewSound}
            >
              {t('social.noticeSettings.test')}
            </Button>
          </Box>
        </Line>
        <Line
          title={t('social.noticeSettings.volume', { percent: Math.round(sound.volume * 100) })}
        >
          <Slider
            value={sound.volume}
            onChange={(_e, v) => sound.handleVolumeChange(v as number)}
            min={0}
            max={1}
            step={0.05}
            aria-label={t('social.noticeSettings.volume', {
              percent: Math.round(sound.volume * 100),
            })}
            sx={{ width: 200 }}
          />
        </Line>
      </Box>

      {settings &&
        GROUPS.map(({ group, kinds }) => (
          <Box key={group} sx={{ display: 'grid', gap: 1.25 }}>
            <Typography sx={label}>{t(`social.noticeSettings.group.${group}`)}</Typography>
            {kinds.map((kind) => (
              <Line key={kind} title={t(`social.noticeSettings.kind.${kind}`)}>
                <Select
                  size="small"
                  value={settings[kind] ?? 'bell'}
                  onChange={(e) => void change(kind, e.target.value as Delivery)}
                  inputProps={{
                    'aria-label': t(`social.noticeSettings.kind.${kind}`),
                    'data-testid': `notification-setting-${kind}`,
                  }}
                  sx={{ minWidth: 150, fontSize: '0.875rem' }}
                >
                  {!ANSWERED.includes(kind) && (
                    <MenuItem value="off">{t('social.noticeSettings.delivery.off')}</MenuItem>
                  )}
                  <MenuItem value="bell">{t('social.noticeSettings.delivery.bell')}</MenuItem>
                  <MenuItem value="sound">{t('social.noticeSettings.delivery.sound')}</MenuItem>
                </Select>
              </Line>
            ))}
          </Box>
        ))}
    </Panel>
  );
}
