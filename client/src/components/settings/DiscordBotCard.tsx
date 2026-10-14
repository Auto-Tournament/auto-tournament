import { useCallback, useEffect, useState } from 'react';
import { Box, Button, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { api, apiErrorMessage } from '../../utils/api';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { tokens, radii } from '../../theme/tokens';
import { SettingsCardHead } from './SettingsRow';
import { ExternalLink } from '../common/ExternalLink';

const { color } = tokens;

/**
 * Settings → Integrations, "Discord bot": the bot that sends players their
 * Discord DMs (Account → Notifications). Its token is checked with Discord
 * and stored encrypted; it is never shown again.
 */
export function DiscordBotCard() {
  const { t } = useTranslation();
  const { showError, showSuccess } = useSnackbar();
  const [status, setStatus] = useState<{ set: boolean; name: string | null } | null>(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await api.get<{ set: boolean; name: string | null }>('/api/settings/discord-bot'));
    } catch {
      setStatus({ set: false, name: null });
    }
  }, []);
  useEffect(() => {
    const id = setTimeout(() => void load(), 0);
    return () => clearTimeout(id);
  }, [load]);

  const save = async (value: string | null) => {
    setBusy(true);
    try {
      const r = await api.put<{ set: boolean; name: string | null }>('/api/settings/discord-bot', {
        token: value,
      });
      setStatus(r);
      setToken('');
      showSuccess(r.set ? t('discordBot.saved', { name: r.name ?? '' }) : t('discordBot.cleared'));
    } catch (error) {
      showError(apiErrorMessage(error, t('discordBot.saveFailed')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box data-testid="discord-bot" sx={{ mt: 4 }}>
      <SettingsCardHead title={t('discordBot.title')} hint={t('discordBot.hint')} />
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
