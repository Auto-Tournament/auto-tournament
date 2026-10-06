import { Box, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { SectionHead } from '../components/common/ui';
import { RulesList } from '../components/tournament/overview/RulesList';
import { useTournamentPage } from '../components/tournament/page/tournamentPageContext';
import { tokens, textSize } from '../theme/tokens';

/**
 * The tournament page's Rules tab: the organizer's description in full (the
 * header shows three lines of it), the numbered rules and the rulebook link.
 */
export default function TournamentRulesTab() {
  const { t } = useTranslation();
  const { tournament } = useTournamentPage();
  const settings = tournament.settings;
  const description = settings?.description?.trim();
  const hasRules = Boolean(settings?.rules?.length || settings?.rulebookUrl);

  return (
    <Stack spacing={5} sx={{ maxWidth: '72ch' }} data-testid="tournament-rules-tab">
      {description && (
        <Box component="section" aria-labelledby="tournament-about-title">
          <SectionHead id="tournament-about-title" title={t('overviewPage.about')} />
          <Typography sx={{ whiteSpace: 'pre-wrap', color: tokens.color.ink2, fontSize: textSize.lg, lineHeight: 1.6 }}>
            {description}
          </Typography>
        </Box>
      )}
      {hasRules && (
        <Box component="section" aria-labelledby="tournament-rules-title">
          <SectionHead id="tournament-rules-title" title={t('overviewPage.rules')} />
          <RulesList
            rules={settings?.rules ?? []}
            rulebookUrl={settings?.rulebookUrl}
            rulebookLinkLabel={t('overviewPage.fullRulebook')}
          />
        </Box>
      )}
    </Stack>
  );
}
