import { useEffect } from 'react';
import { useParams, Link as RouterLink } from 'react-router-dom';
import {
  Box,
  Container,
  Stack,
  Typography,
  CircularProgress,
  Link,
  Alert,
  Grid,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { TopNavBar } from '../components/layout/TopNavBar';
import { usePublicTournamentOverview } from '../hooks/usePublicTournamentOverview';
import { FactsGrid, type Fact } from '../components/tournament/overview/FactsGrid';
import { MapPool } from '../components/tournament/overview/MapPool';
import { RulesList } from '../components/tournament/overview/RulesList';
import { SchedulePanel } from '../components/tournament/overview/SchedulePanel';
import { PrizesCard } from '../components/tournament/overview/PrizesCard';
import { RequirementsCard, type Requirement } from '../components/tournament/overview/RequirementsCard';
import { LiveStrip } from '../components/tournament/overview/LiveStrip';
import { TournamentPageHeader } from '../components/tournament/overview/TournamentPageHeader';
import { getMapDisplayName } from '../constants/maps';
import { useIntegrationFor } from '../integrations/registry';
import { MATCH_FORMATS } from '../constants/tournament';

export default function TournamentOverview() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const {
    tournament,
    liveMatchCount,
    viewerTeam,
    viewerHasSteamIdentity,
    loading,
    error,
  } = usePublicTournamentOverview(id);
  // Before the early returns below: a hook, re-rendering when a code module arrives.
  const gameIntegration = useIntegrationFor(tournament);

  useEffect(() => {
    document.title = tournament ? tournament.name : t('overviewPage.tabs.overview');
  }, [tournament, t]);

  if (loading) {
    return (
      <Box minHeight="100vh" bgcolor="transparent">
        <TopNavBar />
        <Container maxWidth="lg" sx={{ py: { xs: 3, md: 6 } }}>
          <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
            <CircularProgress />
          </Box>
        </Container>
      </Box>
    );
  }

  if (error) {
    return (
      <Box minHeight="100vh" bgcolor="transparent">
        <TopNavBar />
        <Container maxWidth="lg" sx={{ py: { xs: 3, md: 6 } }}>
          <Alert severity="error">{t('overviewPage.loadError')}</Alert>
        </Container>
      </Box>
    );
  }

  if (!tournament) {
    return (
      <Box minHeight="100vh" bgcolor="transparent">
        <TopNavBar />
        <Container maxWidth="lg" sx={{ py: { xs: 3, md: 6 } }}>
          <Typography variant="h5" fontWeight={600} gutterBottom>
            {t('overviewPage.notFoundTitle')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('overviewPage.notFoundDescription')}
          </Typography>
        </Container>
      </Box>
    );
  }

  const settings = tournament.settings;
  const isShuffle = tournament.type === 'shuffle';
  const tournamentTypeKeyPrefix = `tournament.typeSelector.types.${tournament.type}`;
  const typeLabelKey = `${tournamentTypeKeyPrefix}.label`;
  const typeLabel = t(typeLabelKey) === typeLabelKey ? tournament.type : t(typeLabelKey);

  // A map veto and an overtime policy are Counter-Strike 2's. A game the
  // platform cannot watch has neither, and a fact line saying "Map veto:
  // Standard" about a chess cup is simply wrong (3.0 phase D, PR D10).
  const capabilities = gameIntegration.capabilities;
  // Overtime is a match rule the game module asks for in setup; a module that
  // asks for none has none to report.
  const hasMatchRules = Boolean(gameIntegration.tournamentSetupSteps.rules);

  const seriesCount = parseInt(tournament.format.replace('bo', ''), 10) || 1;
  const hasCustomVeto = Boolean(
    (settings?.customVetoOrder as Record<string, unknown> | undefined)?.[tournament.format]
  );

  const facts: Fact[] = [];
  if (!isShuffle && tournament.teamIds.length > 0) {
    facts.push({
      label: t('overviewPage.facts.teams'),
      value: t('overviewPage.facts.teamsValue', { count: tournament.teamIds.length }),
    });
  }
  if (tournament.teamSize) {
    facts.push({
      label: t('overviewPage.facts.teamSize'),
      value: t('overviewPage.facts.teamSizeValue', { count: tournament.teamSize }),
    });
  }
  facts.push({ label: t('overviewPage.facts.format'), value: typeLabel });
  facts.push({
    label: t('overviewPage.facts.series'),
    value:
      MATCH_FORMATS.find((f) => f.value === tournament.format)?.label ??
      t('overviewPage.facts.seriesValue', { count: seriesCount }),
  });
  if (!isShuffle && capabilities.veto) {
    facts.push({
      label: t('overviewPage.facts.mapVeto'),
      value: hasCustomVeto
        ? t('overviewPage.facts.mapVetoCustom')
        : t('overviewPage.facts.mapVetoStandard'),
    });
  }
  if (tournament.overtimeMode && hasMatchRules) {
    facts.push({
      label: t('overviewPage.facts.overtime'),
      value:
        tournament.overtimeMode === 'disabled'
          ? t('overviewPage.facts.overtimeDisabled')
          : tournament.overtimeSegments
            ? t('overviewPage.facts.overtimeEnabledSegments', {
                count: tournament.overtimeSegments,
              })
            : t('overviewPage.facts.overtimeEnabledUnlimited'),
    });
  }

  const mapNames = (tournament.maps || []).map(getMapDisplayName);

  const requirements: Requirement[] = [
    {
      label: viewerHasSteamIdentity
        ? t('overviewPage.requirements.steamLinkedOk')
        : t('overviewPage.requirements.steamLinkedNeutral'),
      state: viewerHasSteamIdentity ? 'ok' : 'neutral',
    },
    {
      label: viewerTeam
        ? t('overviewPage.requirements.onRosterOk')
        : t('overviewPage.requirements.onRosterNeutral'),
      state: viewerTeam ? 'ok' : 'neutral',
    },
  ];

  return (
    <Box minHeight="100vh" bgcolor="transparent" data-testid="public-tournament-overview">
      <TopNavBar />
      <Container maxWidth="lg" sx={{ py: { xs: 3, md: 6 } }}>
        <Box sx={{ mb: 2 }}>
          <TournamentPageHeader
            tournamentId={tournament.id}
            name={tournament.name}
            status={tournament.status}
            location={settings?.location}
            tab="overview"
          />
        </Box>

        <LiveStrip
          liveCount={liveMatchCount}
          label={t('overviewPage.liveNow', { count: liveMatchCount })}
          linkLabel={t('overviewPage.viewAllMatches')}
          linkTo={`/tournament/${tournament.id}/leaderboard`}
        />

        <Grid container spacing={4} sx={{ mt: 3 }}>
          <Grid size={{ xs: 12, md: 8 }}>
            <Stack spacing={4}>
              {settings?.description && (
                <Box data-testid="overview-about">
                  <Typography
                    variant="body1"
                    color="text.secondary"
                    sx={{ whiteSpace: 'pre-wrap' }}
                  >
                    {settings.description}
                  </Typography>
                </Box>
              )}

              <Box>
                <Typography variant="h6" fontWeight={600} gutterBottom>
                  {t('overviewPage.howItsPlayed')}
                </Typography>
                <FactsGrid facts={facts} />
              </Box>

              {mapNames.length > 0 && (
                <Box>
                  <Typography variant="h6" fontWeight={600} gutterBottom>
                    {t('overviewPage.mapPool')}
                  </Typography>
                  <MapPool mapNames={mapNames} />
                </Box>
              )}

              {settings?.rules && settings.rules.length > 0 && (
                <Box>
                  <Typography variant="h6" fontWeight={600} gutterBottom>
                    {t('overviewPage.rules')}
                  </Typography>
                  <RulesList
                    rules={settings.rules}
                    rulebookUrl={settings.rulebookUrl}
                    rulebookLinkLabel={t('overviewPage.fullRulebook')}
                  />
                </Box>
              )}

              {settings?.schedule && settings.schedule.length > 0 && (
                <Box>
                  <Typography variant="h6" fontWeight={600} gutterBottom>
                    {t('overviewPage.schedule')}
                  </Typography>
                  <SchedulePanel schedule={settings.schedule} />
                </Box>
              )}
            </Stack>
          </Grid>

          <Grid size={{ xs: 12, md: 4 }}>
            <Stack spacing={3}>
              {viewerTeam && (
                <Box
                  data-testid="overview-your-team"
                  sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 2 }}
                >
                  <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                    {t('overviewPage.yourTeam.title')}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    {t('overviewPage.yourTeam.onRoster', { team: viewerTeam.name })}
                  </Typography>
                  <Link component={RouterLink} to={`/team/${viewerTeam.id}`} variant="body2">
                    {t('overviewPage.yourTeam.viewTeam')}
                  </Link>
                </Box>
              )}

              <PrizesCard
                title={t('overviewPage.prizes.title')}
                prizes={settings?.prizes ?? []}
                note={t('overviewPage.prizes.note')}
              />

              <RequirementsCard
                title={t('overviewPage.requirements.title')}
                requirements={requirements}
              />
            </Stack>
          </Grid>
        </Grid>
      </Container>
    </Box>
  );
}
