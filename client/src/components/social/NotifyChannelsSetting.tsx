import React from 'react';
import { Box, Switch, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { apiErrorMessage } from '../../utils/api';
import { fontDisplay, tokens } from '../../theme/tokens';
import { panelSx, panelBorderSx } from '../../components/common/ui';

/**
 * Account page, "Notifications" (the Connections draft): where the site tells
 * you things that need you when you are not on it. One row per event, a
 * Discord DM and an email switch each. A channel that cannot reach you says
 * why (no verified email, Discord not linked, no bot on this site).
 */

const { color } = tokens;

type Event =
  'match_ready' | 'veto_turn' | 'checkin_open' | 'new_tournament' | 'tournament_starting';
type Channel = 'discord' | 'email' | 'push';
const EVENTS: Event[] = [
  'match_ready',
  'veto_turn',
  'checkin_open',
  'tournament_starting',
  'new_tournament',
];
const CHANNELS: Channel[] = ['push', 'discord', 'email'];

interface Prefs {
  events: Record<Event, Record<Channel, boolean>>;
  channels: Record<Channel, { available: boolean; reason?: string }>;
}

export function NotifyChannelsSetting() {
  const { t } = useTranslation();
  const { showError } = useSnackbar();
  const [prefs, setPrefs] = React.useState<Prefs | null>(null);
  const [saving, setSaving] = React.useState<string | null>(null);

  React.useEffect(() => {
    void fetch('/api/social/notifications/channels', { credentials: 'same-origin' })
      .then((r) => (r.ok ? (r.json() as Promise<Prefs>) : null))
      .then((b) => b && setPrefs({ events: b.events, channels: b.channels }))
      .catch(() => undefined);
  }, []);

  const save = async (event: Event, channel: Channel, on: boolean) => {
    if (!prefs) return;
    const before = prefs;
    setPrefs({
      ...prefs,
      events: { ...prefs.events, [event]: { ...prefs.events[event], [channel]: on } },
    });
    setSaving(`${event}:${channel}`);
    try {
      const res = await fetch('/api/social/notifications/channels', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event, channel, on }),
      });
      if (!res.ok) throw new Error(await res.text());
      const b = (await res.json()) as Prefs;
      setPrefs({ events: b.events, channels: b.channels });
    } catch (error) {
      setPrefs(before);
      showError(apiErrorMessage(error, t('notifyChannels.saveFailed')));
    } finally {
      setSaving(null);
    }
  };

  return (
    <Box
      component="section"
      aria-labelledby="account-notify-channels"
      sx={{ mt: 6 }}
      data-testid="notify-channels"
    >
      <Typography
        id="account-notify-channels"
        component="h2"
        variant="h6"
        sx={{ fontFamily: fontDisplay, fontWeight: 600 }}
      >
        {t('notifyChannels.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2, maxWidth: '62ch' }}>
        {t('notifyChannels.description')}
      </Typography>
      {prefs && (
        <Box
          sx={{
            ...panelSx,
            ...panelBorderSx,
            overflowX: 'auto',
          }}
        >
          <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <Box component="th" scope="col" sx={{ textAlign: 'left', p: 1.5 }}>
                  <Box component="span" sx={{ position: 'absolute', left: -9999 }}>
                    {t('notifyChannels.event')}
                  </Box>
                </Box>
                {CHANNELS.map((c) => (
                  <Box
                    key={c}
                    component="th"
                    scope="col"
                    sx={{
                      p: 1.5,
                      fontWeight: 500,
                      fontSize: '0.8125rem',
                      color: color.muted,
                      textAlign: 'center',
                      width: 140,
                    }}
                  >
                    {t(`notifyChannels.channel.${c}`)}
                    {!prefs.channels[c].available && prefs.channels[c].reason && (
                      <Box
                        component="span"
                        data-testid={`notify-channel-why-${c}`}
                        sx={{ display: 'block', fontSize: '0.75rem', color: color.warning }}
                      >
                        {t(`notifyChannels.reason.${prefs.channels[c].reason}`)}
                      </Box>
                    )}
                  </Box>
                ))}
              </tr>
            </thead>
            <tbody>
              {EVENTS.map((event) => (
                <Box component="tr" key={event} sx={{ borderTop: `1px solid ${color.rule}` }}>
                  <Box
                    component="th"
                    scope="row"
                    sx={{ textAlign: 'left', p: 1.5, fontWeight: 400 }}
                  >
                    <Typography sx={{ fontWeight: 500 }}>
                      {t(`notifyChannels.events.${event}.title`)}
                    </Typography>
                    <Typography sx={{ fontSize: '0.8125rem', color: color.muted }}>
                      {t(`notifyChannels.events.${event}.hint`)}
                    </Typography>
                  </Box>
                  {CHANNELS.map((channel) => (
                    <Box key={channel} component="td" sx={{ p: 1.5, textAlign: 'center' }}>
                      <Switch
                        checked={prefs.events[event][channel]}
                        disabled={!prefs.channels[channel].available || saving !== null}
                        onChange={(e) => void save(event, channel, e.target.checked)}
                        slotProps={{
                          input: {
                            'aria-label': t('notifyChannels.switchLabel', {
                              event: t(`notifyChannels.events.${event}.title`),
                              channel: t(`notifyChannels.channel.${channel}`),
                            }),
                            'data-testid': `notify-${event}-${channel}`,
                          } as React.InputHTMLAttributes<HTMLInputElement>,
                        }}
                      />
                    </Box>
                  ))}
                </Box>
              ))}
            </tbody>
          </Box>
        </Box>
      )}
    </Box>
  );
}
