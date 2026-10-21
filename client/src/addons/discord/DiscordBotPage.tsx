import { useCallback, useEffect, useState } from 'react';
import { Box, Button, CircularProgress, MenuItem, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { api, apiErrorMessage } from '../../utils/api';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { tokens, radii } from '../../theme/tokens';

import { ExternalLink } from '../../components/common/ExternalLink';
import { SwitchRow } from '../../components/common/ui';

const { color } = tokens;

interface BotStatus {
  set: boolean;
  name: string | null;
  guilds?: Array<{ id: string; name: string }>;
  guildId?: string | null;
  matchVoice?: { enabled: boolean };
  teamChannels?: boolean;
  inviteUrl?: string | null;
  stale?: boolean;
}

/**
 * Modules → Discord bot (the Discord add-on's page): the bot that sends
 * players their Discord DMs (Account → Notifications), and the Discord server
 * it works in. Its token is checked with Discord and stored encrypted; it is
 * never shown again.
 */
export function DiscordBotPage() {
  const { t } = useTranslation();
  const { showError, showSuccess } = useSnackbar();
  const [status, setStatus] = useState<BotStatus | null>(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await api.get<BotStatus>('/api/addons/discord');
      setStatus(next);
      // Shown from the stored snapshot while the server reads Discord again: fetch it once more.
      if (next.stale) setTimeout(() => void load(), 3000);
    } catch {
      setStatus({ set: false, name: null });
    }
  }, []);
  useEffect(() => {
    const id = setTimeout(() => void load(), 0);
    // Back from inviting the bot in another tab: the new server shows up.
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => {
      clearTimeout(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [load]);

  const save = async (value: string | null) => {
    setBusy(true);
    try {
      const r = await api.put<{ set: boolean; name: string | null }>('/api/addons/discord/token', {
        token: value,
      });
      setToken('');
      await load();
      showSuccess(r.set ? t('discordBot.saved', { name: r.name ?? '' }) : t('discordBot.cleared'));
    } catch (error) {
      showError(apiErrorMessage(error, t('discordBot.saveFailed')));
    } finally {
      setBusy(false);
    }
  };

  const pickGuild = async (guildId: string) => {
    setBusy(true);
    try {
      await api.put('/api/addons/discord/guild', { guildId: guildId || null });
      setStatus((prev) => (prev ? { ...prev, guildId: guildId || null } : prev));
      showSuccess(t('discordBot.guildSaved'));
    } catch (error) {
      showError(apiErrorMessage(error, t('discordBot.saveFailed')));
    } finally {
      setBusy(false);
    }
  };

  const saveVoice = async (patch: { enabled: boolean }) => {
    setBusy(true);
    try {
      const r = await api.put<{ matchVoice: NonNullable<BotStatus['matchVoice']> }>(
        '/api/addons/discord/match-voice',
        patch
      );
      setStatus((prev) => (prev ? { ...prev, matchVoice: r.matchVoice } : prev));
      showSuccess(t('discordBot.voice.saved'));
    } catch (error) {
      showError(apiErrorMessage(error, t('discordBot.saveFailed')));
    } finally {
      setBusy(false);
    }
  };

  const saveTeamChannels = async (enabled: boolean) => {
    setBusy(true);
    try {
      await api.put('/api/addons/discord/team-channels', { enabled });
      setStatus((prev) => (prev ? { ...prev, teamChannels: enabled } : prev));
    } catch (error) {
      showError(apiErrorMessage(error, t('discordBot.saveFailed')));
    } finally {
      setBusy(false);
    }
  };

  // Only before the very first answer: after that the page shows the stored snapshot at once.
  if (!status) {
    return (
      <Box
        sx={{ display: 'flex', justifyContent: 'center', py: 6 }}
        data-testid="discord-bot-loading"
      >
        <CircularProgress size={28} />
      </Box>
    );
  }

  return (
    <Box data-testid="discord-bot">
      {status?.set && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 1.5,
            p: 1.5,
            borderRadius: radii.md,
            bgcolor: color.paper3,
            mb: 2,
          }}
        >
          <Typography sx={{ fontSize: '0.875rem' }} data-testid="discord-bot-status">
            {status.name
              ? t('discordBot.connected', { name: status.name })
              : t('discordBot.setNoAnswer')}
          </Typography>
          <Button size="small" color="error" disabled={busy} onClick={() => void save(null)}>
            {t('discordBot.remove')}
          </Button>
        </Box>
      )}
      {status?.set && (
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', flexWrap: 'wrap', mb: 2 }}>
          <TextField
            select
            size="small"
            label={t('discordBot.guild')}
            value={status.guildId ?? ''}
            disabled={busy}
            onChange={(e) => void pickGuild(e.target.value)}
            helperText={
              status.guilds?.length ? t('discordBot.guildHint') : t('discordBot.noGuilds')
            }
            inputProps={{ 'data-testid': 'discord-bot-guild' }}
            sx={{ minWidth: 280, maxWidth: 420, flex: '1 1 280px' }}
          >
            <MenuItem value="">{t('discordBot.noGuild')}</MenuItem>
            {(status.guilds ?? []).map((g) => (
              <MenuItem key={g.id} value={g.id}>
                {g.name}
              </MenuItem>
            ))}
          </TextField>
          {status.inviteUrl && (
            <Button
              component={ExternalLink}
              href={status.inviteUrl}
              variant="outlined"
              underline="none"
              data-testid="discord-bot-invite"
              sx={{ borderRadius: radii.pill, mt: 0.25 }}
            >
              {t('discordBot.invite')}
            </Button>
          )}
        </Box>
      )}
      {status?.set && status.guildId && (
        <Box sx={{ mb: 2, maxWidth: 520 }}>
          <SwitchRow
            label={t('discordBot.voice.label')}
            help={t('discordBot.voice.help')}
            checked={status.matchVoice?.enabled ?? false}
            disabled={busy}
            onChange={(e) => void saveVoice({ enabled: e.target.checked })}
            size="small"
            data-testid="discord-bot-voice"
          />
        </Box>
      )}
      {status?.set && status.guildId && (
        <Box sx={{ mb: 2, maxWidth: 620 }} data-testid="discord-bot-commands">
          <Typography sx={{ fontSize: '0.875rem', fontWeight: 600 }}>
            {t('discordBot.commands.label')}
          </Typography>
          <Typography sx={{ fontSize: '0.8125rem', color: color.muted, mb: 0.5 }}>
            {t('discordBot.commands.help')}
          </Typography>
          <Typography component="code" sx={{ fontSize: '0.8125rem', wordBreak: 'break-all' }}>
            {`${window.location.origin}/api/addons/discord/interactions`}
          </Typography>
        </Box>
      )}
      {status?.set && status.guildId && (
        <Box sx={{ mb: 2, maxWidth: 520 }}>
          <SwitchRow
            label={t('discordBot.teamChannels.label')}
            help={t('discordBot.teamChannels.help')}
            checked={status.teamChannels ?? false}
            disabled={busy}
            onChange={(e) => void saveTeamChannels(e.target.checked)}
            size="small"
            data-testid="discord-bot-team-channels"
          />
        </Box>
      )}
      <Box
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          void save(token.trim());
        }}
        sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'flex-start' }}
      >
        <TextField
          size="small"
          type="password"
          autoComplete="off"
          label={status?.set ? t('discordBot.replace') : t('discordBot.token')}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          inputProps={{ 'data-testid': 'discord-bot-token' }}
          sx={{ minWidth: 280, flex: '1 1 280px', maxWidth: 420 }}
        />
        <Button
          type="submit"
          variant="contained"
          disabled={busy || !token.trim()}
          data-testid="discord-bot-save"
          sx={{ borderRadius: radii.pill }}
        >
          {t('discordBot.save')}
        </Button>
      </Box>
      <Typography sx={{ mt: 1, fontSize: '0.8125rem', color: color.muted }}>
        {t('discordBot.howTo')}{' '}
        <ExternalLink href="https://discord.com/developers/applications">
          {t('discordBot.portal')}
        </ExternalLink>
      </Typography>
    </Box>
  );
}
