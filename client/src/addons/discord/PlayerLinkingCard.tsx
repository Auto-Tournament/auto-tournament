import { useEffect, useState } from 'react';
import { Box, Button, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { api, apiErrorMessage } from '../../utils/api';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { tokens } from '../../theme/tokens';
import { ExternalLink } from '../../components/common/ExternalLink';

const { color } = tokens;

interface Provider {
  id: string;
  enabled: boolean;
  configured: boolean;
  callbackUrl: string;
}

/**
 * Modules → Discord bot: players linking their Discord account, through the
 * Discord sign-in (Settings → Sign-in) made from the bot's own Discord app:
 * the admin adds one redirect and pastes the app's client secret here. Also
 * the server invite the bot made, for players who are not on the server.
 */
export function PlayerLinkingCard({
  appId,
  serverInvite,
}: {
  appId: string;
  serverInvite: string | null;
}) {
  const { t } = useTranslation();
  const { showError, showSuccess } = useSnackbar();
  const [provider, setProvider] = useState<Provider | null>(null);
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    api
      .get<{ providers: Provider[] }>('/api/sign-in-providers')
      .then((r) => live && setProvider(r.providers.find((p) => p.id === 'discord') ?? null))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const save = async () => {
    setBusy(true);
    try {
      const r = await api.put<{ providers: Provider[] }>('/api/sign-in-providers/discord', {
        enabled: true,
        clientId: appId,
        clientSecret: secret.trim(),
      });
      setProvider(r.providers.find((p) => p.id === 'discord') ?? null);
      setSecret('');
      showSuccess(t('discordBot.linking.saved'));
    } catch (error) {
      showError(apiErrorMessage(error, t('discordBot.saveFailed')));
    } finally {
      setBusy(false);
    }
  };

  if (!provider) return null;
  const ready = provider.enabled && provider.configured;
  return (
    <Box sx={{ mb: 2, maxWidth: 620, display: 'grid', gap: 1 }} data-testid="discord-bot-linking">
      <Typography sx={{ fontSize: '0.875rem', fontWeight: 600 }}>
        {t('discordBot.linking.label')}
      </Typography>
      {ready ? (
        <Typography sx={{ fontSize: '0.8125rem', color: color.muted }}>
          {t('discordBot.linking.ready')}
        </Typography>
      ) : (
        <>
          <Typography sx={{ fontSize: '0.8125rem', color: color.muted }}>
            {t('discordBot.linking.help')}{' '}
            <ExternalLink href={`https://discord.com/developers/applications/${appId}/oauth2`}>
              {t('discordBot.linking.portal')}
            </ExternalLink>
          </Typography>
          <Typography component="code" sx={{ fontSize: '0.8125rem', wordBreak: 'break-all' }}>
            {provider.callbackUrl}
          </Typography>
          <Box
            component="form"
            onSubmit={(e) => {
              e.preventDefault();
              if (secret.trim()) void save();
            }}
            sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'flex-start' }}
          >
            <TextField
              size="small"
              type="password"
              autoComplete="off"
              label={t('discordBot.linking.secret')}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              disabled={busy}
              sx={{ minWidth: 280 }}
            />
            <Button type="submit" variant="outlined" disabled={busy || !secret.trim()}>
              {t('discordBot.linking.save')}
            </Button>
          </Box>
        </>
      )}
      <Typography sx={{ fontSize: '0.8125rem', color: color.muted }}>
        {serverInvite
          ? t('discordBot.linking.invite', { url: serverInvite })
          : t('discordBot.linking.noInvite')}
      </Typography>
    </Box>
  );
}
