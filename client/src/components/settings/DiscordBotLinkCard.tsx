import { Box, Button } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { paths } from '../../paths';
import { SettingsCardHead } from './SettingsRow';

/** Settings → Integrations: the Discord bot is an add-on now, set up on its own page. */
export function DiscordBotLinkCard() {
  const { t } = useTranslation();
  return (
    <Box data-testid="discord-bot-link" sx={{ mt: 4 }}>
      <SettingsCardHead title={t('discordBot.title')} hint={t('discordBot.movedHint')} />
      <Button component={RouterLink} to={`${paths.modules}/discord`} variant="outlined">
        {t('discordBot.open')}
      </Button>
    </Box>
  );
}
